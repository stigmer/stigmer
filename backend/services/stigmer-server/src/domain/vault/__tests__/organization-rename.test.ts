/**
 * Pins that a secret sealed before its organization is renamed still opens
 * after, through a composed OSS server whose write codec ("v9", an
 * extension codec) keys every value by the organization tenant its scope
 * names, as a per-organization key would:
 *
 *   - a secret saved into a vault named through the organization's slug is
 *     sealed under the organization's id, never the slug;
 *   - after a rename, the vault service opens it to the value saved, and a
 *     secret saved through the new slug or the old one is sealed under the
 *     same id, so one vault never holds values under two keys.
 *
 * Values are write-only on the wire, so the conformance suite's rename arm
 * reads only the entry and when it was saved; this is where the sealed
 * value itself is opened after the rename.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import type { SecretCodec } from "../../../encryption/codec.js";
import type { EncryptionScope } from "../../../encryption/encryption.js";
import { organizationId, seedOrganizations } from "../../organization/__tests__/support.js";
import { loadVault, newVaultService } from "../service.js";
import type { VaultService } from "../service.js";
import { silentLogger } from "./support.js";

const TEST_KEY_B64 = Buffer.alloc(32, 9).toString("base64");
const SLUG = "rename-acme";
const RENAMED = "rename-acme-corp";
const SECRET = "the-secret-survives-the-rename";

/** Seals as `enc:v9:<tenant>:<base64>`; opens only a tenant it sealed for, as a per-organization key would. */
class TenantKeyedCodec implements SecretCodec {
  readonly version = "v9";
  private readonly tenants = new Set<string>();
  async encrypt(plaintext: string, scope: EncryptionScope): Promise<string> {
    this.tenants.add(scope.tenantSegment);
    return `enc:v9:${scope.tenantSegment}:${Buffer.from(plaintext, "utf8").toString("base64")}`;
  }
  async decrypt(encrypted: string): Promise<string> {
    const [tenant = "", sealed = ""] = encrypted.slice("enc:v9:".length).split(":");
    if (!this.tenants.has(tenant)) {
      throw new Error(`no key for tenant '${tenant}'`);
    }
    return Buffer.from(sealed, "base64").toString("utf8");
  }
  async delete(): Promise<void> {}
}

let dir: string;
let server: ComposedServer;
let vaultCommand: Client<typeof VaultCommandController>;
let organizations: Client<typeof OrganizationCommandController>;
let vaults: VaultService;
let orgId: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "vault-organization-rename-"));
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", TEST_KEY_B64);
  vi.stubEnv("STIGMER_ENCRYPTION_WRITE_VERSION", "v9");
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    extensions: [
      {
        name: "tenant-keyed-secret-codec",
        drivers: { secretCodecs: new Map<string, SecretCodec>([["v9", new TenantKeyedCodec()]]) },
      },
    ],
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  vaultCommand = createClient(VaultCommandController, transport);
  organizations = createClient(OrganizationCommandController, transport);
  orgId = organizationId(await seedOrganizations(transport, [SLUG]), SLUG);
  vaults = newVaultService({
    store: server.store,
    logger: silentLogger,
    secretService: server.secrets,
    authorizationLifecycle: undefined,
  });
});

afterAll(async () => {
  await server.shutdown();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("a secret sealed before an organization rename", () => {
  it("is sealed under the organization's id and opens after the rename", async () => {
    const vault = await vaultCommand.create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Vault",
      metadata: { name: "Rename Vault", org: SLUG },
    });
    const vaultId = vault.metadata?.id ?? "";
    await vaultCommand.setSecrets({
      vault: { org: SLUG, vault: { case: "id", value: vaultId } },
      secrets: { TOKEN: { value: SECRET, description: "" } },
    });
    const tenantPrefix = `enc:v9:org-${orgId}:`;
    const sealedBefore = (await loadVault(server.store, vaultId))?.spec?.secrets.TOKEN?.value ?? "";
    expect(sealedBefore.startsWith(tenantPrefix), "sealed under the id, not the slug").toBe(true);

    const renamed = await organizations.rename({ resourceId: orgId, slug: RENAMED });
    expect(renamed.metadata?.id).toBe(orgId);
    expect(renamed.metadata?.slug).toBe(RENAMED);

    const stored = await loadVault(server.store, vaultId);
    expect(stored?.spec?.secrets.TOKEN?.value, "the rename leaves the sealed value as it was").toBe(sealedBefore);
    expect((await vaults.open(stored!)).secrets.get("TOKEN")).toBe(SECRET);

    for (const [name, org] of [
      ["AFTER_NEW_SLUG", RENAMED],
      ["AFTER_OLD_SLUG", SLUG],
    ] as const) {
      await vaultCommand.setSecrets({
        vault: { org, vault: { case: "id", value: vaultId } },
        secrets: { [name]: { value: `${name}-value`, description: "" } },
      });
    }
    const after = (await loadVault(server.store, vaultId))!;
    for (const name of ["AFTER_NEW_SLUG", "AFTER_OLD_SLUG"]) {
      expect(after.spec?.secrets[name]?.value.startsWith(tenantPrefix), `${name} under the same id`).toBe(true);
    }
    const opened = await vaults.open(after);
    expect(opened.secrets.get("TOKEN")).toBe(SECRET);
    expect(opened.secrets.get("AFTER_NEW_SLUG")).toBe("AFTER_NEW_SLUG-value");
    expect(opened.secrets.get("AFTER_OLD_SLUG")).toBe("AFTER_OLD_SLUG-value");
  });
});
