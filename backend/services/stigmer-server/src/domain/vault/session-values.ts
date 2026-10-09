/**
 * A conversation's own values: the token a repository entry carries for
 * its clone (GitRepoSource.token), the one value a conversation holds
 * itself. Every other secret and login reaches a run from the vaults the
 * conversation uses.
 *
 * Tokens are kept sealed in the session row for the conversation's life:
 *
 *   - every write seals what arrives in plaintext (SecretService, under the
 *     organization's scope); it refuses workspace entries that repeat a
 *     name, and a token on any repository that is not an
 *     https://github.com URL, the only clone the runner authenticates (a
 *     token elsewhere would be sealed and never used);
 *   - every read shows the redaction marker in place of each token;
 *   - a write that sends the marker back keeps the stored token. This is
 *     what keeps them alive: the runner rewrites the whole session after
 *     every turn (harness_state_id), sending back what it read. A marker
 *     with nothing stored behind it is refused, and so is a value shaped
 *     like server ciphertext, at every write;
 *   - a stale write never drops a token it could not have seen, and never
 *     changes the vault choice. A write is stale when the spec audit stamp
 *     it echoes (status.audit.spec_audit.updated_at, read from the request
 *     as sent) is older than the stored row's: every write of a session
 *     advances that stamp, so another write landed after this one's read.
 *     The runner is the common case, whatever caller class an edition
 *     stamps it with: it sends back the session it read when its turn
 *     started. A stale write keeps the token of a repository it sends by
 *     the same name and URL with none, drops without a word a marker whose
 *     token was removed since, and keeps the stored vaults and
 *     include_my_vault (`newKeepStoredVaultChoiceOnStaleWriteStep`), so it
 *     neither detaches a vault attached since, nor re-attaches one removed
 *     since, nor switches My vault back. A write that echoes no stamp, or
 *     the current one, drops what it omits and is refused for a marker
 *     with nothing behind it. The stamp is the writer's word, and
 *     believing an old one only keeps what is stored: it never reveals a
 *     value or adds one;
 *   - tokens a write drops have their backing state destroyed after the
 *     persist, and the delete chain destroys the rest; a replaced token
 *     has none to destroy: it is sealed under the organization's scope
 *     alone, which only codecs that keep the value in the row write
 *     (domain/vault/service.ts says more).
 *
 * The run resolver opens them in process (`openSessionValues`); nothing
 * opened leaves the server. A token is opened only when a clone's
 * requirement matches it, so one the run does not use is never decrypted
 * and, if it cannot be opened, refuses nothing. It is opened under its
 * entry's name and URL together (`repositoryTokenKey`), the identity its
 * stored slot has, so it fills only the clone of that repository.
 *
 * Proven by __tests__/session-values.test.ts, the stale write through the
 * composed session chain in __tests__/session-values-composed.test.ts, and
 * the repository token arms of the vault conformance suite.
 */
import { clone } from "@bufbuild/protobuf";

import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import type { Logger } from "../../boot/logger.js";
import {
  EncryptionScope,
  REDACTED_MARKER,
  isCiphertextShaped,
} from "../../encryption/encryption.js";
import type { SecretService } from "../../encryption/encryption.js";
import { internalError, invalidArgumentError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { destroySecretBackingState } from "../../pipeline/steps/secret-cleanup.js";

import { gitHostOf } from "./address.js";
import { once } from "./service.js";
import type { SealedValue } from "./service.js";
import { GITHUB_HOST, forgedCiphertextMessage, markerRejectionMessage } from "./constants.js";

type SessionDesc = typeof SessionSchema;

/** A session's own values, each opened only when asked. Server-side only. */
export interface SessionOwnValues {
  /** Keyed by repositoryTokenKey: the workspace entry's name and URL. */
  readonly repositoryTokens: ReadonlyMap<string, SealedValue>;
}

/** A repository's identity for its own token: its entry's name and its URL. */
export function repositoryTokenKey(name: string, url: string): string {
  return `${name}\u0000${url}`;
}

/** One sealable slot of a session: where it lives, for the messages and the walk. */
interface ValueSlot {
  /**
   * What the slot is: a repository by its name and URL (a repository moved
   * to another URL is a new slot, so its stored token never follows it to
   * another host).
   */
  readonly key: string;
  /** How the messages name it: "repository 'app'". */
  readonly label: string;
  get(): string;
  set(value: string): void;
  /** Takes the token out of the write. */
  drop(): void;
}

function slotsOf(session: Session | undefined): ValueSlot[] {
  const spec = session?.spec;
  if (spec === undefined) {
    return [];
  }
  const slots: ValueSlot[] = [];
  for (const entry of spec.workspaceEntries) {
    const source = entry.source?.source;
    if (source?.case !== "gitRepo" || source.value.token === "") {
      continue;
    }
    const repo = source.value;
    slots.push({
      key: `repository\u0000${repositoryTokenKey(entry.name, repo.url)}`,
      label: `repository '${entry.name}'`,
      get: () => repo.token,
      set: (value) => {
        repo.token = value;
      },
      drop: () => {
        repo.token = "";
      },
    });
  }
  return slots;
}

/** The stored value behind a slot of the same key, or undefined. */
function storedValueOf(existing: Session | undefined, key: string): string | undefined {
  return slotsOf(existing).find((slot) => slot.key === key)?.get();
}

/** Shows the redaction marker in place of every value, in place. */
export function redactSessionValues(session: Session | undefined): void {
  for (const slot of slotsOf(session)) {
    if (slot.get() !== "") {
      slot.set(REDACTED_MARKER);
    }
  }
}

/**
 * Refuses workspace entries that repeat a name and a repository token on
 * a repository that is not an https://github.com URL, keeps stored tokens
 * the write echoes back as the marker, and refuses a marker with nothing
 * behind it or a value shaped like server ciphertext. Runs while the spec is client input: after BuildNewState
 * (create) or BuildUpdateState (update).
 */
export function newPreserveSessionValuesStep(): PipelineStep<SessionDesc> {
  return {
    name: "PreserveSessionValues",
    execute(ctx: RequestContext<SessionDesc>): void {
      const spec = ctx.newState.spec;
      if (spec === undefined) {
        return;
      }
      const entryNames = new Set<string>();
      for (const entry of spec.workspaceEntries) {
        if (entryNames.has(entry.name)) {
          throw invalidArgumentError(
            `workspace entry '${entry.name}' appears more than once: give each entry its own name`,
          );
        }
        entryNames.add(entry.name);
        const source = entry.source?.source;
        if (
          source?.case === "gitRepo" &&
          source.value.token !== "" &&
          gitHostOf(source.value.url) !== GITHUB_HOST
        ) {
          throw invalidArgumentError(
            `a repository token is used only for https://github.com repositories (repository '${entry.name}')`,
          );
        }
      }
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Session | undefined;
      const stale = isStaleSessionWrite(ctx);
      for (const slot of slotsOf(ctx.newState)) {
        const value = slot.get();
        if (value === REDACTED_MARKER) {
          const stored = storedValueOf(existing, slot.key);
          if (stored === undefined || stored === "") {
            if (stale) {
              // Removed after this write's read: the echo is of a value
              // gone, not a forged one.
              slot.drop();
              continue;
            }
            throw invalidArgumentError(markerRejectionMessage(slot.label));
          }
          slot.set(stored);
          continue;
        }
        if (isCiphertextShaped(value) && storedValueOf(existing, slot.key) !== value) {
          throw invalidArgumentError(forgedCiphertextMessage(slot.label));
        }
      }
      if (stale) {
        keepStoredTokensOmitted(existing, spec);
      }
    },
  };
}

/**
 * Whether an update was built on an older read than the row it lands on:
 * the spec audit stamp the request echoes, as sent (BuildUpdateState
 * replaces the status the write carries), is older than the stored
 * row's. A request with no stamp, a row with none, or an equal stamp is
 * not stale.
 */
export function isStaleSessionWrite(ctx: RequestContext<SessionDesc>): boolean {
  const sent = ctx.input.status?.audit?.specAudit?.updatedAt;
  const existing = ctx.get(EXISTING_RESOURCE_KEY) as Session | undefined;
  const stored = existing?.status?.audit?.specAudit?.updatedAt;
  if (sent === undefined || stored === undefined) {
    return false;
  }
  return sent.seconds < stored.seconds || (sent.seconds === stored.seconds && sent.nanos < stored.nanos);
}

/**
 * Keeps the stored vault choice on a stale update: the vaults and
 * include_my_vault. The write cannot have seen a vault attached or
 * removed, or My vault included or left out, after its read, so it
 * neither detaches nor re-attaches a vault and never switches My vault
 * back: the runner's write after every turn sends the session it read
 * when the turn started. Runs right after BuildUpdateState, before the
 * reference rule and VaultAttachments judge what the write introduces.
 */
export function newKeepStoredVaultChoiceOnStaleWriteStep(): PipelineStep<SessionDesc> {
  return {
    name: "KeepStoredVaultChoiceOnStaleWrite",
    execute(ctx: RequestContext<SessionDesc>): void {
      const spec = ctx.newState.spec;
      if (spec === undefined || !isStaleSessionWrite(ctx)) {
        return;
      }
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Session | undefined;
      spec.vaults = (existing?.spec?.vaults ?? []).map((ref) => clone(ApiResourceReferenceSchema, ref));
      spec.includeMyVault = existing?.spec?.includeMyVault ?? false;
    },
  };
}

/**
 * Copies into a stale write the token of every repository it sends, by
 * the same name and URL, with none. The write was read before the stored
 * row's last write, so the token it lacks may have been added since.
 */
function keepStoredTokensOmitted(existing: Session | undefined, spec: NonNullable<Session["spec"]>): void {
  const stored = existing?.spec;
  for (const entry of stored?.workspaceEntries ?? []) {
    const source = entry.source?.source;
    const sent = spec.workspaceEntries.find((candidate) => candidate.name === entry.name)?.source?.source;
    if (
      source?.case === "gitRepo" &&
      sent?.case === "gitRepo" &&
      sent.value.url === source.value.url &&
      sent.value.token === ""
    ) {
      sent.value.token = source.value.token;
    }
  }
}

/**
 * Seals every value that arrived in plaintext; stored ciphertext passes
 * through untouched. Runs after PreserveSessionValues, before Persist.
 * Keyless servers keep plaintext with one warning per request, the
 * convention every secret kind shares.
 */
export function newSealSessionValuesStep(
  secretService: SecretService,
  logger: Logger,
): PipelineStep<SessionDesc> {
  return {
    name: "SealSessionValues",
    async execute(ctx: RequestContext<SessionDesc>): Promise<void> {
      const slots = slotsOf(ctx.newState).filter((slot) => slot.get() !== "");
      if (slots.length === 0) {
        return;
      }
      if (!secretService.isEnabled()) {
        logger.warn(
          "Encryption disabled: a session's repository tokens will be stored in plaintext",
          { sessionId: ctx.newState.metadata?.id ?? "" },
        );
        return;
      }
      const scope = EncryptionScope.forOrganization(ctx.newState.metadata?.org ?? "");
      for (const slot of slots) {
        const value = slot.get();
        if (secretService.isEncrypted(value)) {
          continue;
        }
        try {
          slot.set(await secretService.encrypt(value, scope));
        } catch (error) {
          throw internalError(error, `failed to seal the session's ${slot.label}`);
        }
      }
    },
  };
}

/** After an update persists: destroys the backing state of values the update dropped. */
export function newDestroyDroppedSessionValuesStep(
  secretService: SecretService,
  logger: Logger,
): PipelineStep<SessionDesc> {
  return {
    name: "DestroyDroppedSessionValues",
    async execute(ctx: RequestContext<SessionDesc>): Promise<void> {
      // The update chain loads the stored row before this step.
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Session;
      // By label (kind and name): a replaced value, a repository's token
      // under a new URL included, is not destroyed; it has no state
      // outside the row (the module header).
      const kept = new Set(slotsOf(ctx.newState).map((slot) => slot.label));
      const dropped = slotsOf(existing)
        .filter((slot) => !kept.has(slot.label))
        .map((slot) => slot.get())
        .filter((value) => value !== "" && value !== REDACTED_MARKER);
      await destroySecretBackingState(
        secretService,
        logger,
        { kind: "session", resourceId: existing.metadata?.id ?? "", operation: "update" },
        dropped,
      );
    },
  };
}

/** Every sealed value a session holds: the delete chain's extractor. */
export function sealedValuesOfSession(session: Session): string[] {
  return slotsOf(session)
    .map((slot) => slot.get())
    .filter((value) => value !== "" && value !== REDACTED_MARKER);
}

/** A stored session's repository tokens for the run resolver, each opened only when asked. */
export function openSessionValues(
  secretService: SecretService,
  session: Session | undefined,
): SessionOwnValues {
  const unseal = async (value: string): Promise<string> =>
    value !== "" && secretService.isEncrypted(value) ? secretService.decrypt(value) : value;
  const sealed = (value: string): SealedValue => ({
    present: value !== "",
    open: once(() => unseal(value)),
  });
  const spec = session?.spec;
  const repositoryTokens = new Map<string, SealedValue>();
  for (const entry of spec?.workspaceEntries ?? []) {
    const source = entry.source?.source;
    if (source?.case === "gitRepo" && source.value.token !== "") {
      repositoryTokens.set(repositoryTokenKey(entry.name, source.value.url), sealed(source.value.token));
    }
  }
  return { repositoryTokens };
}
