/**
 * The vault service: the one in-process door to vault rows for every
 * domain that saves or reads a login or a secret on someone's behalf (the
 * entry RPCs, sign-in, the GitHub sign-in and reads, the run resolver, the
 * connect lane, a member's departure).
 *
 * Three guarantees live here and nowhere else:
 *
 *   - One My vault per person per organization, at the moment of the
 *     write. The first write claims the name (person, organization) in the
 *     store's name table (`resourceNames`, the claim the organization slug
 *     and the child organization's external id use) before the row exists,
 *     so two first writes in the same instant create one vault: the loser
 *     reads the winner's row. A claim whose holder never stored its row
 *     (a create that died between claim and persist) is freed once it is a
 *     minute old, as the child organization's is. A row stored whose
 *     authorization tuples then failed is kept with its claim, never
 *     removed, and every write that finds a My vault its person cannot see
 *     writes the tuples again before using it (the lifecycle's creation
 *     write is idempotent): the next write finishes the create, and a
 *     racing write never lands in a row that is removed after it.
 *   - No entry write loses another. Each write seals its new values first
 *     (asynchronous, outside any lock), then changes only its own entries
 *     inside the store's atomic read-modify-write (`updateResource`, a row
 *     lock in both drivers). A sign-in's renewal during a run and a secret
 *     saved in the same second both land.
 *   - Values are sealed at rest and opened only in process. `entries` and
 *     `open` are the only readers of plaintext; nothing they return leaves
 *     the server. `entries` opens nothing until asked, one entry at a
 *     time, so a reader that needs a few values (the run resolver) never
 *     decrypts the rest, and a value it cannot open refuses only what
 *     needs that value. An opened login opens its sign-in's refresh token
 *     only when asked again (`refreshToken`), which only a renewal does;
 *     `open` opens every value, refresh tokens included.
 *
 * A login write may name the sealed token it read (`expectStoredToken`):
 * it then lands only while the vault still holds that token, so a renewal
 * never overwrites a sign-in made after it read, and it keeps the login's
 * `saved_by`, since a renewal is the same sign-in whoever's run made it. A sign-in written with
 * `keepRefreshToken` and no refresh token keeps the previous sign-in's
 * only when the same person saved it through the same login app, client and
 * token endpoint (`sameSignInIssuer`): in a shared vault the previous
 * sign-in may be a teammate's, and a refresh token of theirs would renew
 * the login back into their account.
 * Entries are looked up as own keys only, and the names that reach an
 * object's prototype are refused as secret names.
 *
 * Removed sealed values have their backing state destroyed after the write
 * (pipeline/steps/secret-cleanup.ts, best-effort). A replaced value's is
 * not, because it has none: `seal` encrypts under the organization's
 * scope alone (`EncryptionScope.forOrganization`, no kind, id or entry),
 * and every codec that writes under such a scope keeps the whole value in
 * the row (enc:v1, and the cloud's enc:v2), so replacing the row's string
 * leaves nothing behind and destroying it would be a no-op. A codec that
 * keeps values outside the row (the cloud's enc:v3) refuses a scope with
 * no location, so no vault value is one. Should `seal` ever pass a scope
 * located at the vault and entry, a replacement would land at the old
 * value's place, and destroying the old value would destroy the new one;
 * the replace path would then need that codec's version-pinned destroy.
 *
 * Proven by __tests__/service.test.ts (first-write races, the atomic entry
 * write against a concurrent writer, sealing and opening, the cap,
 * departure) and the vault conformance suite.
 */
import { create } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";

import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import {
  VaultConnectionSchema,
  VaultConnectionSignInSchema,
  VaultConnectionSource,
  VaultSecretSchema,
  VaultSpecSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import type {
  VaultConnection,
  VaultSecret,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { Code, ConnectError } from "@connectrpc/connect";

import type { Logger } from "../../boot/logger.js";
import { EncryptionScope } from "../../encryption/encryption.js";
import type { SecretService } from "../../encryption/encryption.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { getIdPrefix } from "../../pipeline/apiresource-meta.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newCreateAuthorizationTuplesStep } from "../../pipeline/steps/authorization-tuples.js";
import {
  assignServerId,
  generateId,
  newBuildNewStateStep,
  setAuditFieldsForUpdate,
} from "../../pipeline/steps/defaults.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { destroySecretBackingState } from "../../pipeline/steps/secret-cleanup.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type {
  ResourceNameClaim,
  ResourceNameKey,
  Store,
} from "../../store/interface.js";

import { normalizeAddress } from "./address.js";
import {
  MAX_VAULT_ENTRIES,
  MY_VAULT_NAME,
  myVaultSlugOf,
  reservedSecretNameRefusal,
  vaultFullMessage,
} from "./constants.js";

/** The name-table kind that keeps one My vault per (organization, person). */
export const MY_VAULT_NAME_KIND = "vault_person";

/** The name-table kind that keeps a shared vault's external id unique per organization. */
export const EXTERNAL_ID_NAME_KIND = "vault_external_id";

/** How old a claim must be before a holder with no row counts as gone. */
const ABANDONED_CLAIM_AFTER_MS = 60 * 1000;

/** How long a first write waits for a concurrent first write's row to appear. */
const CONCURRENT_CREATE_WAIT_MS = [10, 20, 40, 80, 160, 320, 640];

/** Thrown inside a guarded login write when the stored token moved on: the write is skipped. */
class StoredTokenMoved extends Error {}

/** An entry of a map field by own key: never one the object inherits. */
function entryOf<T>(entries: { readonly [key: string]: T }, key: string): T | undefined {
  return Object.hasOwn(entries, key) ? entries[key] : undefined;
}

/** Refuses a write that would take a vault past MAX_VAULT_ENTRIES. */
function refuseOverCap(vault: Vault, adding: number): void {
  const current =
    Object.keys(vault.spec?.secrets ?? {}).length +
    Object.keys(vault.spec?.connections ?? {}).length;
  if (current + adding > MAX_VAULT_ENTRIES) {
    throw failedPreconditionError(vaultFullMessage(current, adding));
  }
}

/**
 * Refuses, as setConnection would, a login at `address` that would be a
 * new entry of a full vault; a login already saved there is replaced in
 * place and adds none. For a caller that must refuse before spending
 * something it cannot get back (sign-in's code exchange); setConnection
 * checks again inside its atomic write, which is the guarantee.
 */
export function refuseNewConnectionOverCap(vault: Vault, address: string): void {
  if (entryOf(vault.spec?.connections ?? {}, normalizeAddress(address)) === undefined) {
    refuseOverCap(vault, 1);
  }
}

/** The sign-in record of a connection, in plaintext, as the service takes and opens it. */
export interface VaultSignIn {
  readonly expiresAt: bigint;
  readonly clientId: string;
  readonly authMethod: string;
  readonly tokenEndpoint: string;
  readonly refreshToken: string;
  /** The login app the sign-in used ("org:<id>", "stigmer:<key>"), "" for a public client. */
  readonly loginApp: string;
}

/** A login to save. The service seals the token and the refresh token. */
export interface VaultConnectionWrite {
  readonly token: string;
  readonly source: VaultConnectionSource;
  readonly signIn?: VaultSignIn;
  readonly description?: string;
  /**
   * The sealed token the writer read (`OpenedConnection.storedToken`):
   * the write lands only while the vault still holds it at the address,
   * and otherwise changes nothing. Such a write renews the login it read,
   * so the login keeps its `saved_by`.
   */
  readonly expectStoredToken?: string;
  /**
   * A sign-in arriving without a refresh token keeps the one the previous
   * sign-in at the address saved, when the same person saved it through
   * the same login app, client and token endpoint (a provider that answers
   * a repeat sign-in without one leaves the old one valid). Anyone else's,
   * or one issued to another client, is never carried over.
   */
  readonly keepRefreshToken?: boolean;
}

/** A sign-in record without its refresh token: what matching and a run read. */
export type VaultSignInRecord = Omit<VaultSignIn, "refreshToken">;

/** One saved login, its token opened. Server-side only. */
export interface OpenedConnection {
  readonly address: string;
  readonly token: string;
  readonly source: VaultConnectionSource;
  /** The sign-in record; its refresh token is opened only by `refreshToken`. */
  readonly signIn?: VaultSignInRecord;
  /** The token as the vault stores it (sealed), for a guarded write back. */
  readonly storedToken?: string;
  /**
   * The sign-in's refresh token in plaintext ("" for none), opened on the
   * first ask: only a renewal asks. Absent on a login no vault holds (a
   * conversation's own), which has no sign-in to renew.
   */
  refreshToken?(): Promise<string>;
}

/** One saved login with every value opened, its refresh token included. Server-side only. */
export interface FullyOpenedConnection extends Omit<OpenedConnection, "signIn"> {
  readonly signIn?: VaultSignIn;
}

/** A stored value, opened only when asked. */
export interface SealedValue {
  /** Whether a value is stored: an empty one counts as none. */
  readonly present: boolean;
  /** The value in plaintext, opened on the first ask and kept for the next. */
  open(): Promise<string>;
}

/** One saved login with its token and refresh token unopened: what a match reads. */
export interface SealedConnection {
  readonly address: string;
  readonly source: VaultConnectionSource;
  /** Whether a token is stored: an empty one counts as none. */
  readonly present: boolean;
  /** The sign-in record without its refresh token. */
  readonly signIn?: VaultSignInRecord;
  /** The login's token opened on the first ask and kept for the next; its refresh token stays sealed until asked. */
  open(): Promise<OpenedConnection>;
}

/** A vault's entries, each opened only when asked. Server-side only: never returned to a client. */
export interface SealedVault {
  readonly vault: Vault;
  readonly secrets: ReadonlyMap<string, SealedValue>;
  readonly connections: ReadonlyMap<string, SealedConnection>;
}

/** A vault with its values opened. Server-side only: never returned to a client. */
export interface OpenedVault {
  readonly vault: Vault;
  readonly secrets: ReadonlyMap<string, string>;
  readonly connections: ReadonlyMap<string, FullyOpenedConnection>;
}

/** A secret to save, in plaintext. */
export interface VaultSecretWrite {
  readonly value: string;
  readonly description: string;
}

export interface VaultService {
  /** The person's My vault in an organization, or undefined before their first write. */
  findMine(orgId: string, person: string): Promise<Vault | undefined>;
  /** The caller's My vault, created through the create chain when absent. */
  ensureMine(orgId: string, caller: CallerIdentity): Promise<Vault>;
  findById(id: string): Promise<Vault | undefined>;
  /** A vault by reference; an empty org on the reference reads `fallbackOrgId`. */
  findByReference(
    ref: ApiResourceReference,
    fallbackOrgId: string,
  ): Promise<Vault | undefined>;
  /** The shared vault holding an external id in an organization, or undefined. */
  findByExternalId(orgId: string, externalId: string): Promise<Vault | undefined>;
  setConnection(
    vaultId: string,
    address: string,
    write: VaultConnectionWrite,
    caller: CallerIdentity,
  ): Promise<Vault>;
  removeConnections(
    vaultId: string,
    addresses: readonly string[],
    caller: CallerIdentity,
  ): Promise<{ readonly vault: Vault; readonly removed: readonly string[] }>;
  setSecrets(
    vaultId: string,
    secrets: Readonly<Record<string, VaultSecretWrite>>,
    caller: CallerIdentity,
  ): Promise<Vault>;
  removeSecrets(
    vaultId: string,
    names: readonly string[],
    caller: CallerIdentity,
  ): Promise<{ readonly vault: Vault; readonly removed: readonly string[] }>;
  /** A stored vault's entries, each opened only when asked: nothing is decrypted here. */
  entries(vault: Vault): SealedVault;
  /** Opens every value of a stored vault. */
  open(vault: Vault): Promise<OpenedVault>;
}

export interface VaultServiceDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly secretService: SecretService;
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /**
   * Asks whether a person can see the My vault a write found, so one whose
   * tuples never landed gets them written again. Without one, a found My
   * vault has its tuples written again on every write.
   */
  readonly authorizer?: Authorizer;
}

/** The person a My vault belongs to, or undefined for a shared vault. */
export function personOf(vault: Vault | undefined): string | undefined {
  const owner = vault?.spec?.owner;
  return owner?.case === "person" ? owner.value : undefined;
}

/** Whether a vault is someone's My vault. */
export function isMyVault(vault: Vault | undefined): boolean {
  return personOf(vault) !== undefined;
}

/** The name key of a person's My vault. */
export function myVaultNameKey(orgId: string, person: string): ResourceNameKey {
  return { kind: MY_VAULT_NAME_KIND, org: orgId, name: person };
}

/** The name key of a shared vault's external id. */
export function externalIdNameKey(
  orgId: string,
  externalId: string,
): ResourceNameKey {
  return { kind: EXTERNAL_ID_NAME_KIND, org: orgId, name: externalId };
}

/**
 * Claims a name, freeing a holder that never stored its row once the claim
 * is old enough (the child organization's `claimFreeingGoneChild`).
 */
export async function claimVaultName(
  store: Store,
  key: ResourceNameKey,
  id: string,
): Promise<ResourceNameClaim> {
  const now = new Date();
  const claim = await store.resourceNames.claim(key, id, now.toISOString());
  if (claim.claimed) {
    return claim;
  }
  const holder = claim.entry;
  const young =
    now.getTime() - Date.parse(holder.claimedAt) < ABANDONED_CLAIM_AFTER_MS;
  if (young || (await loadVault(store, holder.id)) !== undefined) {
    return claim;
  }
  await store.resourceNames.release(key.kind, key.org, holder.id);
  return store.resourceNames.claim(key, id, now.toISOString());
}

/** A vault by id, or undefined when no row holds it. */
export async function loadVault(
  store: Store,
  id: string,
): Promise<Vault | undefined> {
  try {
    return await store.getResource(ApiResourceKind.vault, id, VaultSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw error;
  }
}

export function newVaultService(deps: VaultServiceDeps): VaultService {
  const { store, logger, secretService } = deps;

  async function findMine(
    orgId: string,
    person: string,
  ): Promise<Vault | undefined> {
    const entry = await store.resourceNames.resolve(
      myVaultNameKey(orgId, person),
      new Date().toISOString(),
    );
    if (entry === undefined) {
      return undefined;
    }
    const vault = await loadVault(store, entry.id);
    if (vault === undefined || personOf(vault) !== person) {
      return undefined;
    }
    return vault;
  }

  async function waitForConcurrentCreate(
    holderId: string,
  ): Promise<Vault | undefined> {
    for (const delay of CONCURRENT_CREATE_WAIT_MS) {
      const vault = await loadVault(store, holderId);
      if (vault !== undefined) {
        return vault;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return loadVault(store, holderId);
  }

  async function ensureMine(
    orgId: string,
    caller: CallerIdentity,
  ): Promise<Vault> {
    const person = caller.identityId;
    if (person === "") {
      throw failedPreconditionError(
        "My vault belongs to a person, and this caller is none",
      );
    }
    const existing = await findMine(orgId, person);
    if (existing !== undefined) {
      return withTuples(existing, caller);
    }

    const id = generateId(getIdPrefix(ApiResourceKind.vault));
    const claim = await claimVaultName(store, myVaultNameKey(orgId, person), id);
    if (!claim.claimed) {
      const winner = await waitForConcurrentCreate(claim.entry.id);
      if (winner !== undefined && personOf(winner) === person) {
        return withTuples(winner, caller);
      }
      throw new ConnectError(
        "My vault is being created by another request; try again",
        Code.Unavailable,
      );
    }

    const vault = create(VaultSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Vault",
      metadata: {
        name: MY_VAULT_NAME,
        slug: myVaultSlugOf(person),
        org: orgId,
      },
      spec: create(VaultSpecSchema, {
        owner: { case: "person", value: person },
      }),
    });
    const ctx = new RequestContext(
      VaultSchema,
      vault,
      caller,
      ApiResourceKind.vault,
    );
    assignServerId(ctx, id);
    try {
      await newPipeline<typeof VaultSchema>("vault-create-mine", logger)
        .addStep(newBuildNewStateStep())
        .addStep(newPersistStep(store))
        .addStep(
          newCreateAuthorizationTuplesStep(deps.authorizationLifecycle, logger),
        )
        .build()
        .execute(ctx);
    } catch (error) {
      // A create whose row never landed frees its claim. A row stored
      // without its authorization tuples keeps it: a racing write may
      // already be using the row, and the next write finds the row and
      // writes the tuples (`withTuples`).
      await releaseUnstoredClaim(store, logger, myVaultNameKey(orgId, person), id);
      throw error;
    }
    return ctx.newState;
  }

  /**
   * A found My vault, its authorization tuples written again first when
   * its person cannot see it: a first write whose tuple write failed left
   * the row, and a racing first write may be reading the row before its
   * creator's tuples land. No lifecycle composed means no tuples to write.
   */
  async function withTuples(vault: Vault, caller: CallerIdentity): Promise<Vault> {
    const lifecycle = deps.authorizationLifecycle;
    if (lifecycle === undefined) {
      return vault;
    }
    if (deps.authorizer !== undefined) {
      const decision = await deps.authorizer.authorize(caller, {
        permission: IamPermission.can_view,
        resourceKind: ApiResourceKind.vault,
        resourceId: vault.metadata?.id ?? "",
      });
      if (decision.kind === "allow") {
        return vault;
      }
      if (decision.kind === "unavailable") {
        throw internalError(decision.cause, "failed to check My vault's authorization");
      }
      logger.warn("My vault found that its person cannot see; writing its tuples again", {
        vaultId: vault.metadata?.id ?? "",
      });
    }
    const ctx = new RequestContext(VaultSchema, vault, caller, ApiResourceKind.vault);
    await newCreateAuthorizationTuplesStep<typeof VaultSchema>(lifecycle, logger).execute(ctx);
    return vault;
  }

  async function findById(id: string): Promise<Vault | undefined> {
    return loadVault(store, id);
  }

  async function findByReference(
    ref: ApiResourceReference,
    fallbackOrgId: string,
  ): Promise<Vault | undefined> {
    const org = ref.org !== "" ? ref.org : fallbackOrgId;
    if (org === "" || ref.slug === "") {
      return undefined;
    }
    return findResourceBySlug(
      store,
      ApiResourceKind.vault,
      VaultSchema,
      ref.slug,
      org,
    );
  }

  async function findByExternalId(
    orgId: string,
    externalId: string,
  ): Promise<Vault | undefined> {
    const entry = await store.resourceNames.resolve(
      externalIdNameKey(orgId, externalId),
      new Date().toISOString(),
    );
    if (entry === undefined) {
      return undefined;
    }
    const vault = await loadVault(store, entry.id);
    if (vault === undefined || vault.spec?.externalId !== externalId) {
      return undefined;
    }
    return vault;
  }

  /**
   * A keyless server keeps a vault's values in plaintext: one warning per
   * write, the convention every secret kind shares.
   */
  function warnWhenKeyless(vaultId: string, operation: string): void {
    if (!secretService.isEnabled()) {
      logger.warn("Encryption disabled: a vault's secrets and logins will be stored in plaintext", {
        vaultId,
        operation,
      });
    }
  }

  async function seal(value: string, orgId: string): Promise<string> {
    if (value === "" || !secretService.isEnabled()) {
      return value;
    }
    return secretService.encrypt(value, EncryptionScope.forOrganization(orgId));
  }

  async function unseal(value: string): Promise<string> {
    if (value === "" || !secretService.isEncrypted(value)) {
      return value;
    }
    return secretService.decrypt(value);
  }

  /**
   * The one entry write: `change` runs synchronously under the row lock
   * and returns the sealed values it removed, which are destroyed after
   * the write lands. A write that does not land destroys nothing: the
   * values it sealed beforehand live only in the strings it discards
   * (the module header says why no vault value has state outside the
   * row).
   */
  async function writeEntries(
    vaultId: string,
    operation: string,
    caller: CallerIdentity,
    change: (vault: Vault) => readonly string[],
  ): Promise<Vault> {
    let displaced: readonly string[] = [];
    let written: Vault;
    try {
      written = await store.updateResource(
        ApiResourceKind.vault,
        vaultId,
        VaultSchema,
        (vault) => {
          vault.spec ??= create(VaultSpecSchema);
          displaced = change(vault);
          setAuditFieldsForUpdate(VaultSchema, vault, "spec_audit", caller);
        },
      );
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        throw new ConnectError(`vault not found: ${vaultId}`, Code.NotFound);
      }
      if (error instanceof ConnectError || error instanceof StoredTokenMoved) {
        throw error;
      }
      throw internalError(error, "failed to write the vault entry");
    }
    await destroySecretBackingState(
      secretService,
      logger,
      { kind: "vault", resourceId: vaultId, operation },
      displaced,
    );
    return written;
  }

  function orgOfVaultOrThrow(vault: Vault | undefined, vaultId: string): string {
    if (vault === undefined) {
      throw new ConnectError(`vault not found: ${vaultId}`, Code.NotFound);
    }
    return vault.metadata?.org ?? "";
  }

  async function setConnection(
    vaultId: string,
    address: string,
    write: VaultConnectionWrite,
    caller: CallerIdentity,
  ): Promise<Vault> {
    const normalized = normalizeAddress(address);
    const org = orgOfVaultOrThrow(await loadVault(store, vaultId), vaultId);
    warnWhenKeyless(vaultId, "setConnection");
    const token = await seal(write.token, org);
    const signIn =
      write.signIn === undefined
        ? undefined
        : create(VaultConnectionSignInSchema, {
            expiresAt: write.signIn.expiresAt,
            clientId: write.signIn.clientId,
            authMethod: write.signIn.authMethod,
            tokenEndpoint: write.signIn.tokenEndpoint,
            refreshToken: await seal(write.signIn.refreshToken, org),
            loginApp: write.signIn.loginApp,
          });
    let unchanged: Vault | undefined;
    try {
      return await writeEntries(vaultId, "setConnection", caller, (vault) => {
        const spec = vault.spec!;
        const previous = entryOf(spec.connections, normalized);
        if (
          write.expectStoredToken !== undefined &&
          (previous?.token ?? "") !== write.expectStoredToken
        ) {
          unchanged = vault;
          throw new StoredTokenMoved();
        }
        if (previous === undefined) {
          refuseOverCap(vault, 1);
        }
        if (
          write.keepRefreshToken === true &&
          signIn !== undefined &&
          signIn.refreshToken === "" &&
          previous !== undefined &&
          sameSignInIssuer(previous, signIn, caller.identityId)
        ) {
          // A provider that answers a fresh sign-in without a refresh
          // token leaves the previous one valid.
          signIn.refreshToken = previous.signIn?.refreshToken ?? "";
        }
        spec.connections[normalized] = create(VaultConnectionSchema, {
          token,
          source: write.source,
          signIn,
          // An empty description keeps the saved one, as setSecrets does.
          description:
            write.description !== undefined && write.description !== ""
              ? write.description
              : (previous?.description ?? ""),
          savedBy:
            write.expectStoredToken !== undefined && previous !== undefined
              ? previous.savedBy
              : caller.identityId,
          savedAt: timestampNow(),
        });
        // A replaced login has no state outside the row (the module header).
        return [];
      });
    } catch (error) {
      if (!(error instanceof StoredTokenMoved) || unchanged === undefined) {
        throw error;
      }
      logger.info("A login changed since it was read; the guarded write is skipped", {
        vaultId,
        address: normalized,
      });
      return unchanged;
    }
  }

  async function removeConnections(
    vaultId: string,
    addresses: readonly string[],
    caller: CallerIdentity,
  ): Promise<{ readonly vault: Vault; readonly removed: readonly string[] }> {
    const normalized = addresses.map((address) => normalizeAddress(address));
    const removed: string[] = [];
    const vault = await writeEntries(
      vaultId,
      "removeConnections",
      caller,
      (row) => {
        const spec = row.spec!;
        const displaced: string[] = [];
        for (const address of normalized) {
          const previous = entryOf(spec.connections, address);
          if (previous === undefined) {
            continue;
          }
          displaced.push(...sealedValuesOfConnection(previous));
          delete spec.connections[address];
          removed.push(address);
        }
        return displaced;
      },
    );
    return { vault, removed };
  }

  async function setSecrets(
    vaultId: string,
    secrets: Readonly<Record<string, VaultSecretWrite>>,
    caller: CallerIdentity,
  ): Promise<Vault> {
    for (const name of Object.keys(secrets)) {
      const refusal = reservedSecretNameRefusal(name);
      if (refusal !== undefined) {
        throw invalidArgumentError(refusal);
      }
    }
    const org = orgOfVaultOrThrow(await loadVault(store, vaultId), vaultId);
    warnWhenKeyless(vaultId, "setSecrets");
    const sealed = new Map<string, VaultSecret>();
    for (const [name, secret] of Object.entries(secrets)) {
      sealed.set(
        name,
        create(VaultSecretSchema, {
          value: await seal(secret.value, org),
          description: secret.description,
        }),
      );
    }
    return writeEntries(vaultId, "setSecrets", caller, (vault) => {
      const spec = vault.spec!;
      const adding = [...sealed.keys()].filter(
        (name) => entryOf(spec.secrets, name) === undefined,
      ).length;
      refuseOverCap(vault, adding);
      const savedAt = timestampNow();
      for (const [name, secret] of sealed) {
        const previous = entryOf(spec.secrets, name);
        secret.savedBy = caller.identityId;
        secret.savedAt = savedAt;
        if (secret.description === "" && previous !== undefined) {
          secret.description = previous.description;
        }
        spec.secrets[name] = secret;
      }
      return [];
    });
  }

  async function removeSecrets(
    vaultId: string,
    names: readonly string[],
    caller: CallerIdentity,
  ): Promise<{ readonly vault: Vault; readonly removed: readonly string[] }> {
    const removed: string[] = [];
    const vault = await writeEntries(vaultId, "removeSecrets", caller, (row) => {
      const spec = row.spec!;
      const displaced: string[] = [];
      for (const name of names) {
        const previous = entryOf(spec.secrets, name);
        if (previous === undefined) {
          continue;
        }
        displaced.push(previous.value);
        delete spec.secrets[name];
        removed.push(name);
      }
      return displaced;
    });
    return { vault, removed };
  }

  function entries(vault: Vault): SealedVault {
    const secrets = new Map<string, SealedValue>();
    for (const [name, secret] of Object.entries(vault.spec?.secrets ?? {})) {
      secrets.set(name, {
        present: secret.value !== "",
        open: once(() => unseal(secret.value)),
      });
    }
    const connections = new Map<string, SealedConnection>();
    for (const [address, connection] of Object.entries(
      vault.spec?.connections ?? {},
    )) {
      const signIn = connection.signIn;
      const sealedRefreshToken = signIn?.refreshToken ?? "";
      const record =
        signIn === undefined
          ? undefined
          : {
              expiresAt: signIn.expiresAt,
              clientId: signIn.clientId,
              authMethod: signIn.authMethod,
              tokenEndpoint: signIn.tokenEndpoint,
              loginApp: signIn.loginApp,
            };
      connections.set(address, {
        address,
        source: connection.source,
        present: connection.token !== "",
        signIn: record,
        open: once(async () => ({
          address,
          token: await unseal(connection.token),
          storedToken: connection.token,
          source: connection.source,
          signIn: record,
          refreshToken: once(() => unseal(sealedRefreshToken)),
        })),
      });
    }
    return { vault, secrets, connections };
  }

  async function open(vault: Vault): Promise<OpenedVault> {
    const sealed = entries(vault);
    const secrets = new Map<string, string>();
    for (const [name, secret] of sealed.secrets) {
      secrets.set(name, await secret.open());
    }
    const connections = new Map<string, FullyOpenedConnection>();
    for (const [address, connection] of sealed.connections) {
      const opened = await connection.open();
      connections.set(address, {
        ...opened,
        signIn:
          opened.signIn === undefined
            ? undefined
            : { ...opened.signIn, refreshToken: (await opened.refreshToken?.()) ?? "" },
      });
    }
    return { vault, secrets, connections };
  }

  return {
    findMine,
    ensureMine,
    findById,
    findByReference,
    findByExternalId,
    setConnection,
    removeConnections,
    setSecrets,
    removeSecrets,
    entries,
    open,
  };
}

/** A load run once: every later ask answers the first ask's promise. */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= load());
}

/**
 * Whether a saved connection is a sign-in by the same person, through the
 * same login app, client and token endpoint as a new one: the only previous
 * sign-in whose refresh token a new sign-in may keep.
 */
function sameSignInIssuer(
  previous: VaultConnection,
  next: { readonly clientId: string; readonly tokenEndpoint: string; readonly loginApp: string },
  person: string,
): boolean {
  const saved = previous.signIn;
  return (
    previous.source === VaultConnectionSource.sign_in &&
    saved !== undefined &&
    person !== "" &&
    previous.savedBy === person &&
    saved.loginApp === next.loginApp &&
    saved.clientId === next.clientId &&
    saved.tokenEndpoint === next.tokenEndpoint
  );
}

/** The sealed values a removed connection held. */
function sealedValuesOfConnection(connection: VaultConnection): string[] {
  return [connection.token, connection.signIn?.refreshToken ?? ""].filter(
    (value) => value !== "",
  );
}

/**
 * Frees a name a failed create claimed when its row was never stored. A
 * fault is logged: the next claim frees the name once it is old enough.
 */
export async function releaseUnstoredClaim(
  store: Store,
  logger: Logger,
  key: ResourceNameKey,
  id: string,
): Promise<void> {
  try {
    if ((await loadVault(store, id)) !== undefined) {
      return;
    }
    await store.resourceNames.release(key.kind, key.org, id);
  } catch (error) {
    logger.error(
      "vault create failed and its name claim could not be released; it stays claimed",
      {
        kind: key.kind,
        org: key.org,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/** The sealed values a vault carries: the delete chain's extractor. */
export function sealedValuesOfVault(vault: Vault): string[] {
  const values: string[] = [];
  for (const secret of Object.values(vault.spec?.secrets ?? {})) {
    values.push(secret.value);
  }
  for (const connection of Object.values(vault.spec?.connections ?? {})) {
    values.push(connection.token, connection.signIn?.refreshToken ?? "");
  }
  return values.filter((value) => value !== "");
}

export { VaultConnectionSource };
