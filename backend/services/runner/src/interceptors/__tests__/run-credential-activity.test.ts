/**
 * The activity boundary's entry into the run-credential store
 * (`run-credential-activity.ts`): the input key a dispatch carries the
 * credential under, the credential-less pass-through, and the promise that
 * the boundary never writes a log line (a credential must never reach one).
 */

import { describe, expect, it, vi } from "vitest";
import type { ActivityExecuteInput } from "@temporalio/worker";

import { runCredentialActivityInterceptor } from "../run-credential-activity.js";
import { RUN_CREDENTIAL_INPUT_KEY } from "../../shared/run-credential.js";
import { currentRunCredential } from "../../shared/run-credential-store.js";

function execute(input: ActivityExecuteInput): Promise<string | undefined> {
  const interceptors = runCredentialActivityInterceptor({} as never);
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
            execution_id: "aex_1",
            thread_id: "",
            [RUN_CREDENTIAL_INPUT_KEY]: "cred-input",
          },
        ],
        headers: {},
      }),
    ).toBe("cred-input");
  });

  it("runs a credential-less activity with an empty store — an older server, the cloud", async () => {
    expect(await execute({ args: ["aex_1", ""], headers: {} })).toBeUndefined();
    expect(
      await execute({
        args: [{ execution_id: "aex_1", thread_id: "" }],
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
      await execute({ args: ["aex_1"], headers: {} });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
