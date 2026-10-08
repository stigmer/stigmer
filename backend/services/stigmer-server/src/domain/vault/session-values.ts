/**
 * A conversation's own values: the secrets, logins and repository tokens
 * an integrator hands a session instead of saving them in a vault
 * (SessionSpec.secrets, SessionSpec.connections, GitRepoSource.token).
 *
 * They are kept sealed in the session row for the conversation's life:
 *
 *   - every write seals what arrives in plaintext (SecretService, under the
 *     organization's scope) and normalizes connection addresses by the one
 *     address rule, refusing two that are one address once normalized; it
 *     refuses workspace entries that repeat a name, and a repository token
 *     on any repository that is not an https://github.com URL, the only
 *     clone the runner authenticates (a token elsewhere would be sealed and
 *     never used);
 *   - every read shows the redaction marker in place of each value;
 *   - a write that sends the marker back keeps the stored value. This is
 *     what keeps them alive: the runner rewrites the whole session after
 *     every turn (harness_state_id), sending back what it read. A marker
 *     with nothing stored behind it is refused, and so is a value shaped
 *     like server ciphertext, at every write;
 *   - a stale write never drops a value it could not have seen. A write is
 *     stale when the spec audit stamp it echoes (status.audit.spec_audit
 *     .updated_at, read from the request as sent) is older than the
 *     stored row's: every write of a session advances that stamp, so
 *     another write landed after this one's read. The runner is the
 *     common case, whatever caller class an edition stamps it with: it
 *     sends back the session it read when its turn started. A stale write
 *     keeps every stored value it omits (a secret, a connection, the
 *     token of a repository it sends by the same name and URL with
 *     none), drops without a word a marker whose value was removed since,
 *     refuses a merge that comes to more than 100 secrets or 100
 *     connections, and keeps the stored vaults (`newKeepStoredVaultsOnStaleWriteStep`),
 *     so it neither detaches a vault attached since nor re-attaches one
 *     removed since. A write that echoes no stamp, or the current one,
 *     drops what it omits and is refused for a marker with nothing behind
 *     it. The stamp is the writer's word, and believing an old one only
 *     keeps what is stored: it never reveals a value or adds one;
 *   - values a write drops have their backing state destroyed after the
 *     persist, and the delete chain destroys the rest; a replaced value
 *     has none to destroy: it is sealed under the organization's scope
 *     alone, which only codecs that keep the value in the row write
 *     (domain/vault/service.ts says more).
 *
 * The run resolver opens them in process (`openSessionValues`); nothing
 * opened leaves the server. Every secret is opened, since every one
 * reaches the run; a login or a repository's token is opened only when a
 * requirement matches it, so one the run does not use is never decrypted
 * and, if it cannot be opened, refuses nothing. A repository's token is
 * opened under its entry's name and URL together (`repositoryTokenKey`),
 * the identity its stored slot has, so it fills only the clone of that
 * repository.
 *
 * Proven by __tests__/session-values.test.ts, the stale write through the
 * composed session chain in __tests__/session-values-composed.test.ts, and
 * the session values arms of the vault conformance suite.
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

import { gitHostOf, normalizeAddress } from "./address.js";
import type { InvalidAddressError } from "./address.js";
import { once } from "./service.js";
import type { SealedValue } from "./service.js";
import {
  GITHUB_HOST,
  forgedCiphertextMessage,
  markerRejectionMessage,
  reservedSecretNameRefusal,
} from "./constants.js";

type SessionDesc = typeof SessionSchema;

/** A session's own values: the secrets opened, the rest opened only when asked. Server-side only. */
export interface SessionOwnValues {
  readonly secrets: ReadonlyMap<string, string>;
  /** Keyed by normalized address. */
  readonly connections: ReadonlyMap<string, SealedValue>;
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
   * What the slot is, namespaced by kind so a marker is only ever matched
   * to a stored value of the same kind: a secret, a connection, or a
   * repository by its name and URL (a repository moved to another URL is
   * a new slot, so its stored token never follows it to another host).
   */
  readonly key: string;
  /** How the messages name it: "secret 'API_KEY'". */
  readonly label: string;
  get(): string;
  set(value: string): void;
  /** Takes the value out of the write: the entry, or a repository's token. */
  drop(): void;
}

function slotsOf(session: Session | undefined): ValueSlot[] {
  const spec = session?.spec;
  if (spec === undefined) {
    return [];
  }
  const slots: ValueSlot[] = [];
  for (const name of Object.keys(spec.secrets)) {
    slots.push({
      key: `secret\u0000${name}`,
      label: `secret '${name}'`,
      get: () => spec.secrets[name] ?? "",
      set: (value) => {
        spec.secrets[name] = value;
      },
      drop: () => {
        delete spec.secrets[name];
      },
    });
  }
  for (const address of Object.keys(spec.connections)) {
    slots.push({
      key: `connection\u0000${address}`,
      label: `connection '${address}'`,
      get: () => spec.connections[address] ?? "",
      set: (value) => {
        spec.connections[address] = value;
      },
      drop: () => {
        delete spec.connections[address];
      },
    });
  }
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
 * a repository that is not an https://github.com URL, normalizes
 * connection addresses (refusing two that are one address), keeps stored
 * values the write echoes back as the marker, and
 * refuses a marker with nothing behind it or a value shaped like server
 * ciphertext. Runs while the spec is client input: after BuildNewState
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
      for (const name of Object.keys(spec.secrets)) {
        const refusal = reservedSecretNameRefusal(name);
        if (refusal !== undefined) {
          throw invalidArgumentError(refusal);
        }
      }
      const normalized: Record<string, string> = {};
      for (const [address, token] of Object.entries(spec.connections)) {
        let key: string;
        try {
          key = normalizeAddress(address);
        } catch (error) {
          // The address rule throws only its own refusal, whose message
          // carries the rule and never the address.
          throw invalidArgumentError(
            `a connection of this conversation: ${(error as InvalidAddressError).message}`,
          );
        }
        if (Object.hasOwn(normalized, key)) {
          // Keeping either would drop the other's login without a word.
          throw invalidArgumentError(
            "two connections of this conversation name the same address (case, a default port, one trailing slash, a query and a fragment do not count): send each address once",
          );
        }
        normalized[key] = token;
      }
      spec.connections = normalized;

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
        keepStoredValuesOmitted(existing, spec);
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
 * Keeps the stored vaults on a stale update: the write cannot have seen a
 * vault attached or removed after its read, so it neither detaches nor
 * re-attaches one. Runs right after BuildUpdateState, before the
 * reference rule and VaultAttachments judge what the write introduces.
 */
export function newKeepStoredVaultsOnStaleWriteStep(): PipelineStep<SessionDesc> {
  return {
    name: "KeepStoredVaultsOnStaleWrite",
    execute(ctx: RequestContext<SessionDesc>): void {
      const spec = ctx.newState.spec;
      if (spec === undefined || !isStaleSessionWrite(ctx)) {
        return;
      }
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Session | undefined;
      spec.vaults = (existing?.spec?.vaults ?? []).map((ref) => clone(ApiResourceReferenceSchema, ref));
    },
  };
}

/** The most secrets, and the most connections, a conversation holds (SessionSpec's max_pairs). */
const MAX_SESSION_VALUES = 100;

/**
 * Copies into a stale write every stored value it omits: a secret or
 * connection absent from it, and the token of a repository it sends, by
 * the same name and URL, with none. The write was read before the stored
 * row's last write, so what it lacks may have been added since. The
 * request's own limits were checked before this merge, so a merge that
 * comes to more than a conversation holds is refused, naming the limit.
 */
function keepStoredValuesOmitted(existing: Session | undefined, spec: NonNullable<Session["spec"]>): void {
  const stored = existing?.spec;
  for (const [name, value] of Object.entries(stored?.secrets ?? {})) {
    if (!Object.hasOwn(spec.secrets, name)) {
      spec.secrets[name] = value;
    }
  }
  for (const [address, value] of Object.entries(stored?.connections ?? {})) {
    if (!Object.hasOwn(spec.connections, address)) {
      spec.connections[address] = value;
    }
  }
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
  for (const [kind, values] of [
    ["secrets", spec.secrets],
    ["connections", spec.connections],
  ] as const) {
    if (Object.keys(values).length > MAX_SESSION_VALUES) {
      throw invalidArgumentError(
        `this conversation would hold more than ${MAX_SESSION_VALUES} ${kind} once the ones saved since this write's read are kept: a conversation holds at most ${MAX_SESSION_VALUES}. Read the conversation again and send at most ${MAX_SESSION_VALUES}`,
      );
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
          "Encryption disabled: a session's own secrets will be stored in plaintext",
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

/** Opens a stored session's secrets for the run resolver; its logins and repository tokens wait to be asked. */
export async function openSessionValues(
  secretService: SecretService,
  session: Session | undefined,
): Promise<SessionOwnValues> {
  const unseal = async (value: string): Promise<string> =>
    value !== "" && secretService.isEncrypted(value) ? secretService.decrypt(value) : value;
  const sealed = (value: string): SealedValue => ({
    present: value !== "",
    open: once(() => unseal(value)),
  });
  const spec = session?.spec;
  const secrets = new Map<string, string>();
  const connections = new Map<string, SealedValue>();
  const repositoryTokens = new Map<string, SealedValue>();
  for (const [name, value] of Object.entries(spec?.secrets ?? {})) {
    secrets.set(name, await unseal(value));
  }
  for (const [address, value] of Object.entries(spec?.connections ?? {})) {
    connections.set(address, sealed(value));
  }
  for (const entry of spec?.workspaceEntries ?? []) {
    const source = entry.source?.source;
    if (source?.case === "gitRepo" && source.value.token !== "") {
      repositoryTokens.set(repositoryTokenKey(entry.name, source.value.url), sealed(source.value.token));
    }
  }
  return { secrets, connections, repositoryTokens };
}
