/**
 * Pins the runtime resolution service against Go's
 * runtime_resolution_test.go: RPC-identical lookup semantics (slug+org,
 * org required for this org-scoped kind, kind-mismatch rejection), decrypt
 * in place on the loaded copy (the store is never touched), the per-key
 * WARN-and-drop for undecryptable ciphertext, and the fail-loud
 * propagation of the keyless-with-ciphertext state.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../../boot/logger.js";
import { SecretService } from "../../../../encryption/encryption.js";
import { SqliteStore } from "../../../../store/sqlite/store.js";
import type { Store } from "../../../../store/interface.js";
import { RuntimeResolutionService } from "../resolution.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const KEY = Buffer.alloc(32, 7);

let dir: string;
let store: Store;
let secretService: SecretService;
let service: RuntimeResolutionService;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "env-resolution-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), silentLogger);
  secretService = SecretService.create(KEY);
  service = new RuntimeResolutionService(store, secretService, silentLogger);

  await seed("resolved", "acme", {
    API_KEY: { value: secretService.encrypt("real-key"), isSecret: true },
    LEGACY: { value: "pre-oss405-plaintext", isSecret: true },
    REGION: { value: "us-east-1", isSecret: false },
  });
});

afterAll(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function seed(
  slug: string,
  org: string,
  data: Record<string, { value: string; isSecret: boolean }>,
): Promise<string> {
  const id = `env_${slug}`;
  const env = create(EnvironmentSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Environment",
    metadata: { id, name: slug, slug, org },
    spec: {
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [
          k,
          { value: v.value, isSecret: v.isSecret, description: "" },
        ]),
      ),
    },
  });
  await store.saveResource(ApiResourceKind.environment, id, EnvironmentSchema, env);
  return id;
}

async function connectError(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
    throw new Error("expected the call to fail");
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
}

function ref(slug: string, org: string, kind = ApiResourceKind.environment) {
  return { slug, org, kind } as Parameters<
    RuntimeResolutionService["resolveByReference"]
  >[0];
}

describe("resolveByReference", () => {
  it("decrypts is_secret values in place; legacy plaintext and non-secrets pass through", async () => {
    const env = await service.resolveByReference(ref("resolved", "acme"));
    expect(env.spec?.data["API_KEY"]?.value).toBe("real-key");
    expect(env.spec?.data["LEGACY"]?.value).toBe("pre-oss405-plaintext");
    expect(env.spec?.data["REGION"]?.value).toBe("us-east-1");
  });

  it("never touches the store — the persisted row keeps its ciphertext", async () => {
    await service.resolveByReference(ref("resolved", "acme"));
    const stored = await store.getResource(
      ApiResourceKind.environment,
      "env_resolved",
      EnvironmentSchema,
    );
    expect(stored.spec?.data["API_KEY"]?.value.startsWith("enc:v1:")).toBe(true);
  });

  it("accepts an unspecified kind (unknown = no assertion), rejects a wrong one", async () => {
    const viaUnknown = await service.resolveByReference(
      ref("resolved", "acme", ApiResourceKind.api_resource_kind_unknown),
    );
    expect(viaUnknown.metadata?.id).toBe("env_resolved");

    const error = await connectError(() =>
      service.resolveByReference(ref("resolved", "acme", ApiResourceKind.agent)),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe("kind mismatch: expected environment, got agent");
  });

  it("requires a slug and an org (org-scoped kind — no cross-tenant resolution)", async () => {
    const noSlug = await connectError(() => service.resolveByReference(ref("", "acme")));
    expect(noSlug.code).toBe(Code.InvalidArgument);
    expect(noSlug.rawMessage).toBe("environment reference with slug is required");

    const noOrg = await connectError(() => service.resolveByReference(ref("resolved", "")));
    expect(noOrg.code).toBe(Code.InvalidArgument);
  });

  it("answers NotFound for an unresolvable reference (authoring error, never a silent run)", async () => {
    const error = await connectError(() =>
      service.resolveByReference(ref("ghost", "acme")),
    );
    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe("environment not found: ghost");
  });

  it("WARNs and DROPS an undecryptable key, keeping the rest (per-key skip)", async () => {
    await seed("partially-broken", "acme", {
      GOOD: { value: secretService.encrypt("good-value"), isSecret: true },
      BROKEN: { value: "enc:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", isSecret: true },
    });
    const env = await service.resolveByReference(ref("partially-broken", "acme"));
    expect(env.spec?.data["GOOD"]?.value).toBe("good-value");
    expect(env.spec?.data["BROKEN"]).toBeUndefined();
  });

  it("fails LOUD when ciphertext exists but no key is configured (never a credential-less run)", async () => {
    await seed("keyless-victim", "acme", {
      SEALED: { value: secretService.encrypt("sealed"), isSecret: true },
    });
    const keyless = new RuntimeResolutionService(
      store,
      SecretService.create(undefined),
      silentLogger,
    );
    const error = await connectError(() =>
      keyless.resolveByReference(ref("keyless-victim", "acme")),
    );
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(
      "environment env_keyless-victim holds encrypted secret 'SEALED' but no encryption key is configured",
    );
  });
});
