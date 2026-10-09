/**
 * What the vault domain's tests share: a real SQLite store opened with the
 * server's list indexes, a secret facade whose sealed values are
 * recognisable and whose destroys are recorded, the vault service over
 * both, and row seeds for shared vaults and My vaults.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";

import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { LIST_INDEXES } from "../../../boot/list-indexes.js";
import { createLogger } from "../../../boot/logger.js";
import type { SecretCodec } from "../../../encryption/codec.js";
import { SecretService } from "../../../encryption/encryption.js";
import type { EncryptionScope } from "../../../encryption/encryption.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";

import { myVaultSlugOf } from "../constants.js";
import { newVaultService } from "../service.js";
import type { VaultService } from "../service.js";

export const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/** A codec whose sealed values read `enc:v9:<base64>` and whose destroys are recorded. */
export class RecordingCodec implements SecretCodec {
  readonly version = "v9";
  readonly deleted: string[] = [];
  async encrypt(plaintext: string, _scope: EncryptionScope): Promise<string> {
    return `enc:v9:${Buffer.from(plaintext, "utf8").toString("base64")}`;
  }
  async decrypt(encrypted: string): Promise<string> {
    return Buffer.from(encrypted.slice("enc:v9:".length), "base64").toString("utf8");
  }
  async delete(storedValue: string): Promise<void> {
    this.deleted.push(storedValue);
  }
}

export interface VaultRig {
  readonly store: Store;
  readonly codec: RecordingCodec;
  readonly secrets: SecretService;
  readonly vaults: VaultService;
  close(): void;
}

/** A fresh store, facade and vault service; `close` removes the store. */
export function openVaultRig(): VaultRig {
  const dir = mkdtempSync(path.join(tmpdir(), "vault-test-"));
  const store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, {
    listIndexes: LIST_INDEXES,
  });
  const codec = new RecordingCodec();
  const secrets = SecretService.withCodecs({
    codecs: new Map<string, SecretCodec>([["v9", codec]]),
    writeVersion: "v9",
  });
  const vaults = newVaultService({
    store,
    logger: silentLogger,
    secretService: secrets,
    authorizationLifecycle: undefined,
  });
  return {
    store,
    codec,
    secrets,
    vaults,
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Seeds a shared vault row of `org` directly. */
export async function seedSharedVault(
  store: Store,
  org: string,
  slug: string,
  init: {
    readonly visibility?: ApiResourceVisibility;
    readonly secrets?: Record<string, string>;
    readonly connections?: Record<string, string>;
  } = {},
): Promise<Vault> {
  const id = `vlt_${org}_${slug}`.replace(/-/g, "_");
  const vault = create(VaultSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Vault",
    metadata: {
      id,
      name: slug,
      slug,
      org,
      visibility: init.visibility ?? ApiResourceVisibility.visibility_private,
    },
    spec: {
      owner: { case: "org", value: org },
      secrets: Object.fromEntries(
        Object.entries(init.secrets ?? {}).map(([name, value]) => [name, { value }]),
      ),
      connections: Object.fromEntries(
        Object.entries(init.connections ?? {}).map(([address, token]) => [
          address,
          { token },
        ]),
      ),
    },
  });
  await store.saveResource(ApiResourceKind.vault, id, VaultSchema, vault);
  return vault;
}

/** Seeds a person's My vault row of `org` directly (no name claim: lookups by reference only). */
export async function seedMyVaultRow(
  store: Store,
  org: string,
  person: string,
  secrets: Record<string, string> = {},
): Promise<Vault> {
  const id = `vlt_mine_${person}`;
  const vault = create(VaultSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Vault",
    metadata: { id, name: "My vault", slug: myVaultSlugOf(person), org },
    spec: {
      owner: { case: "person", value: person },
      secrets: Object.fromEntries(
        Object.entries(secrets).map(([name, value]) => [name, { value }]),
      ),
    },
  });
  await store.saveResource(ApiResourceKind.vault, id, VaultSchema, vault);
  return vault;
}
