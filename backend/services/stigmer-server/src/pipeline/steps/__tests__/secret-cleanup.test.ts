/**
 * Pins the secret backing-state cleanup contract (convergence 20260830.04
 * Stage 3, gate ruling Q7) at the unit level: the destroyer walks every
 * sealed value best-effort — one failure logs ERROR and never interrupts
 * the rest or the request — while plaintext, markers, and blanks are
 * silent no-ops by the facade's own dispatch (the property that keeps the
 * OSS default codec set conformance-invisible). The step arm reads the
 * doomed resource from EXISTING_RESOURCE_KEY and no-ops when it is
 * absent. The end-to-end wiring through the delete/update/removeVariables
 * chains is pinned in extensions/__tests__/secret-cleanup-composed.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { SecretCodec } from "../../../encryption/codec.js";
import {
  EncryptionScope,
  REDACTED_MARKER,
  SecretService,
} from "../../../encryption/encryption.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { RequestContext } from "../../request-context.js";
import { EXISTING_RESOURCE_KEY } from "../load-existing.js";
import {
  destroySecretBackingState,
  newDestroySecretBackingStateStep,
} from "../secret-cleanup.js";

const caller: CallerIdentity = {
  identityId: "ida_test",
  callerClass: "user",
  issuer: "",
  rawToken: "",
};

/**
 * A codec whose delete records calls; failNext holds errors thrown one
 * per call (queue order), so a test can fail the first destroy and prove
 * the walk continues to the second.
 */
class RecordingCodec implements SecretCodec {
  readonly version = "v9";
  readonly deleted: string[] = [];
  readonly failNext: Error[] = [];

  async encrypt(plaintext: string, _scope: EncryptionScope): Promise<string> {
    return `enc:v9:${Buffer.from(plaintext, "utf8").toString("base64")}`;
  }

  async decrypt(encrypted: string): Promise<string> {
    return Buffer.from(encrypted.slice("enc:v9:".length), "base64").toString(
      "utf8",
    );
  }

  async delete(storedValue: string): Promise<void> {
    const failure = this.failNext.shift();
    if (failure !== undefined) {
      throw failure;
    }
    this.deleted.push(storedValue);
  }
}

function newFixture(): {
  codec: RecordingCodec;
  secrets: SecretService;
  errorLines: string[];
} {
  const codec = new RecordingCodec();
  const secrets = SecretService.withCodecs({
    codecs: new Map<string, SecretCodec>([["v9", codec]]),
    writeVersion: "v9",
  });
  const errorLines: string[] = [];
  return { codec, secrets, errorLines };
}

function captureLogger(errorLines: string[]) {
  return createLogger({
    level: "error",
    pretty: false,
    write: (line: string) => {
      errorLines.push(line);
    },
  });
}

describe("destroySecretBackingState (the SecretValueCleanup port)", () => {
  it("destroys each sealed value in order, skipping blanks", async () => {
    const { codec, secrets, errorLines } = newFixture();
    const a = await codec.encrypt(
      "alpha",
      EncryptionScope.forOrganization("acme"),
    );
    const b = await codec.encrypt(
      "beta",
      EncryptionScope.forOrganization("acme"),
    );

    await destroySecretBackingState(
      secrets,
      captureLogger(errorLines),
      { kind: "environment", resourceId: "env_1" },
      [a, "", b],
    );

    expect(codec.deleted).toEqual([a, b]);
    expect(errorLines).toEqual([]);
  });

  it("plaintext and the marker are silent no-ops (the conformance-invisibility property)", async () => {
    const { codec, secrets, errorLines } = newFixture();

    await destroySecretBackingState(
      secrets,
      captureLogger(errorLines),
      { kind: "environment", resourceId: "env_2" },
      ["just-plaintext", REDACTED_MARKER],
    );

    expect(codec.deleted).toEqual([]);
    expect(errorLines).toEqual([]);
  });

  it("a destroy failure logs ERROR and never interrupts the rest or throws", async () => {
    const { codec, secrets, errorLines } = newFixture();
    const a = await codec.encrypt(
      "alpha",
      EncryptionScope.forOrganization("acme"),
    );
    const b = await codec.encrypt(
      "beta",
      EncryptionScope.forOrganization("acme"),
    );

    codec.failNext.push(new Error("vault is down"));

    await expect(
      destroySecretBackingState(
        secrets,
        captureLogger(errorLines),
        { kind: "environment", resourceId: "env_3" },
        [a, b],
      ),
    ).resolves.toBeUndefined();

    expect(codec.deleted).toEqual([b]);
    expect(errorLines).toHaveLength(1);
    expect(errorLines[0]).toContain(
      "secret backing-state destruction failed after persist",
    );
    expect(errorLines[0]).toContain("env_3");
  });

  it("an unregistered version refuses on the unavailable arm and is contained", async () => {
    const { codec, secrets, errorLines } = newFixture();

    await expect(
      destroySecretBackingState(
        secrets,
        captureLogger(errorLines),
        { kind: "environment", resourceId: "env_4" },
        ["enc:v1:AAAA"],
      ),
    ).resolves.toBeUndefined();

    expect(codec.deleted).toEqual([]);
    expect(errorLines).toHaveLength(1);
  });
});

describe("DestroySecretBackingState (the delete-chain step)", () => {
  it("extracts the doomed resource's sealed values from context", async () => {
    const { codec, secrets, errorLines } = newFixture();
    const sealed = await codec.encrypt(
      "alpha",
      EncryptionScope.forOrganization("acme"),
    );
    const env = create(EnvironmentSchema, {
      metadata: { id: "env_5", org: "acme" },
      spec: {
        data: {
          SEALED: { value: sealed, isSecret: true },
          PLAIN: { value: "visible", isSecret: false },
        },
      },
    });

    const ctx = new RequestContext(
      EnvironmentSchema,
      create(EnvironmentSchema, {}),
      caller,
      ApiResourceKind.environment,
    );
    ctx.set(EXISTING_RESOURCE_KEY, env);

    const step = newDestroySecretBackingStateStep<
      typeof EnvironmentSchema,
      typeof EnvironmentSchema
    >(secrets, captureLogger(errorLines), (resource) =>
      Object.values(resource.spec?.data ?? {})
        .filter((value) => value.isSecret)
        .map((value) => value.value),
    );
    expect(step.name).toBe("DestroySecretBackingState");
    await step.execute(ctx);

    expect(codec.deleted).toEqual([sealed]);
    expect(errorLines).toEqual([]);
  });

  it("no-ops when the doomed resource is absent from context", async () => {
    const { codec, secrets, errorLines } = newFixture();
    const ctx = new RequestContext(
      EnvironmentSchema,
      create(EnvironmentSchema, {}),
      caller,
      ApiResourceKind.environment,
    );

    const step = newDestroySecretBackingStateStep<
      typeof EnvironmentSchema,
      typeof EnvironmentSchema
    >(secrets, captureLogger(errorLines), () => {
      throw new Error("extractor must not run without a resource");
    });
    await step.execute(ctx);

    expect(codec.deleted).toEqual([]);
    expect(errorLines).toEqual([]);
  });
});
