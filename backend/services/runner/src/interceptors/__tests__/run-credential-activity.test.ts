/**
 * The activity boundary's entry into the run-credential store
 * (`run-credential-activity.ts`): the input key a dispatch carries the
 * credential under, the credential-less pass-through, and the promise that
 * the boundary never writes a log line (a credential must never reach one).
 *
 * And the sealed credential a shared runner's turn carries: opened with the
 * payload codec the runner decodes with, and refused — never run without its
 * credential — when it was sealed under another key, tampered with, reaches
 * a runner with no payload key, or arrives beside a clear one; and the
 * shared runner's requirement that a turn carry a credential at all.
 */

import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityExecuteInput } from "@temporalio/worker";
import { ApplicationFailure } from "@temporalio/common";
import { EncryptionPayloadCodec, sealString } from "@stigmer/temporal-codecs";

import {
  RUN_CREDENTIAL_REFUSED_FAILURE_TYPE,
  configureRunCredentialBoundary,
  runCredentialActivityInterceptor,
} from "../run-credential-activity.js";
import { RUN_CREDENTIAL_INPUT_KEY, SEALED_RUN_CREDENTIAL_INPUT_KEY } from "../../shared/run-credential.js";
import { currentRunCredential } from "../../shared/run-credential-store.js";
import { sealedValueOpener } from "../../payload-codecs.js";

afterEach(() => configureRunCredentialBoundary({}));

function execute(input: ActivityExecuteInput, activityType = "ExecuteDeepAgent"): Promise<string | undefined> {
  const interceptors = runCredentialActivityInterceptor({ info: { activityType } } as never);
  const execute = interceptors.inbound?.execute;
  if (execute === undefined)
    throw new Error("the interceptor must implement execute");
  return execute(input, async () => currentRunCredential()) as Promise<
    string | undefined
  >;
}

describe("runCredentialActivityInterceptor", () => {
  it("enters the input object's credential — the server's dispatch", async () => {
    expect(
      await execute({
        args: [
          {
            execution_id: "run_1",
            thread_id: "",
            [RUN_CREDENTIAL_INPUT_KEY]: "cred-input",
          },
        ],
        headers: {},
      }),
    ).toBe("cred-input");
  });

  it("runs a credential-less activity with an empty store, as the cloud dispatches it", async () => {
    expect(await execute({ args: ["run_1", ""], headers: {} })).toBeUndefined();
    expect(
      await execute({
        args: [{ execution_id: "run_1", thread_id: "" }],
        headers: {},
      }),
    ).toBeUndefined();
    expect(await execute({ args: [], headers: {} })).toBeUndefined();
  });

  it("does not read the connect lane's camelCase per-call token", async () => {
    expect(
      await execute({
        args: [
          { mcpServerId: "mcp_1", executionContextToken: "connect-token" },
        ],
        headers: {},
      }),
    ).toBeUndefined();
  });

  it("leaves the store empty once the activity has returned", async () => {
    await execute({
      args: [{ [RUN_CREDENTIAL_INPUT_KEY]: "cred-x" }],
      headers: {},
    });
    expect(currentRunCredential()).toBeUndefined();
  });

  it("writes nothing to the console on any path", async () => {
    const spies = (["log", "warn", "error", "info", "debug"] as const).map(
      (level) => vi.spyOn(console, level).mockImplementation(() => {}),
    );
    try {
      await execute({
        args: [{ [RUN_CREDENTIAL_INPUT_KEY]: "cred-secret" }],
        headers: {},
      });
      await execute({ args: ["run_1"], headers: {} });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("a sealed run credential", () => {
  const key = randomBytes(32);
  const codec = new EncryptionPayloadCodec({ primary: { keyId: "k1", key } });

  async function refusal(input: ActivityExecuteInput, activityType?: string): Promise<ApplicationFailure> {
    const ran = vi.fn(async () => currentRunCredential());
    const interceptors = runCredentialActivityInterceptor({ info: { activityType: activityType ?? "ExecuteDeepAgent" } } as never);
    const err = await interceptors.inbound!.execute!(input, ran).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(ran, "the activity never runs").not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(ApplicationFailure);
    const failure = err as ApplicationFailure;
    expect(failure.type).toBe(RUN_CREDENTIAL_REFUSED_FAILURE_TYPE);
    expect(failure.nonRetryable, "the same dispatch fails the same way on any attempt").toBe(true);
    return failure;
  }

  it("opens with the runner's payload codec and enters the opened credential", async () => {
    configureRunCredentialBoundary({ openSealed: sealedValueOpener([codec]) });
    const sealed = await sealString(codec, "cred-of-org-a");
    expect(await execute({ args: [{ execution_id: "run_1", thread_id: "", [SEALED_RUN_CREDENTIAL_INPUT_KEY]: sealed }], headers: {} })).toBe("cred-of-org-a");
  });

  it("fails the turn on a tampered seal, naming why, never running it tokenless", async () => {
    configureRunCredentialBoundary({ openSealed: sealedValueOpener([codec]) });
    const bytes = Buffer.from(await sealString(codec, "cred-of-org-a"), "base64");
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    const failure = await refusal({ args: [{ execution_id: "run_1", [SEALED_RUN_CREDENTIAL_INPUT_KEY]: bytes.toString("base64") }], headers: {} });
    expect(failure.message).toMatch(/^This turn's sealed credential could not be opened \(.+\), so the runner did not run the turn\.$/);
    expect(failure.message).not.toContain("cred-of-org-a");
  });

  it("fails the turn on a seal made under a key this runner does not hold", async () => {
    configureRunCredentialBoundary({ openSealed: sealedValueOpener([codec]) });
    const other = new EncryptionPayloadCodec({ primary: { keyId: "k2", key: randomBytes(32) } });
    const failure = await refusal({ args: [{ [SEALED_RUN_CREDENTIAL_INPUT_KEY]: await sealString(other, "cred") }], headers: {} });
    expect(failure.message).toContain("unknown key id 'k2'");
  });

  it("fails the turn on a runner that holds no payload key, naming the setting", async () => {
    const failure = await refusal({ args: [{ [SEALED_RUN_CREDENTIAL_INPUT_KEY]: await sealString(codec, "cred") }], headers: {} });
    expect(failure.message).toContain("STIGMER_PAYLOAD_ENCRYPTION_KEY");
  });

  it("refuses a dispatch that carries the credential both sealed and in the clear", async () => {
    configureRunCredentialBoundary({ openSealed: sealedValueOpener([codec]) });
    await refusal({ args: [{ [RUN_CREDENTIAL_INPUT_KEY]: "clear", [SEALED_RUN_CREDENTIAL_INPUT_KEY]: await sealString(codec, "cred") }], headers: {} });
  });

  it("writes nothing to the console opening or refusing a seal", async () => {
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    try {
      configureRunCredentialBoundary({ openSealed: sealedValueOpener([codec]) });
      await execute({ args: [{ [SEALED_RUN_CREDENTIAL_INPUT_KEY]: await sealString(codec, "cred-secret") }], headers: {} });
      await execute({ args: [{ [SEALED_RUN_CREDENTIAL_INPUT_KEY]: "not-a-seal" }], headers: {} }).catch(() => undefined);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("a runner that requires every turn to carry its credential", () => {
  it("refuses a required activity whose dispatch carried none, and passes every other one through", async () => {
    configureRunCredentialBoundary({ requireCredentialFor: new Set(["ExecuteDeepAgent", "GenerateSessionSubject"]) });
    const interceptors = runCredentialActivityInterceptor({ info: { activityType: "GenerateSessionSubject" } } as never);
    const ran = vi.fn(async () => "ran");
    await expect(interceptors.inbound!.execute!({ args: [{ execution_id: "run_1" }], headers: {} }, ran)).rejects.toThrow(
      "This runner serves the conversations of many organizations and runs GenerateSessionSubject only with the turn's own credential, and its dispatch carried none.",
    );
    expect(ran).not.toHaveBeenCalled();
    expect(await execute({ args: ["ses-1", "agt-1"], headers: {} }, "EnsureThread"), "an activity that presents no credential").toBeUndefined();
    expect(await execute({ args: [{ [RUN_CREDENTIAL_INPUT_KEY]: "cred" }], headers: {} }), "a required one that carries it").toBe("cred");
  });
});
