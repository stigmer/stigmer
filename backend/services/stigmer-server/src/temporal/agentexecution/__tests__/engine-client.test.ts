/**
 * Engine-client tests — pins TemporalExecutionEngine's wire contract
 * (workflow start plus the lifecycle mapping):
 *
 *   - startInvokeWorkflow: the byte-pinned workflow type + workflow-ID
 *     format, the stigmer task queue, the ONE memo key with the
 *     dispatch-resolved value, the slim snake_case input with zero-value
 *     fields omitted (harness/execution_target from dispatch), and NO
 *     run timeout;
 *   - dispatch failures throw EngineDispatchError with the resolver's
 *     message VERBATIM (the create step surfaces it as
 *     FailedPrecondition);
 *   - lifecycle ops signal/cancel/terminate the pinned workflow ID and
 *     map the SDK's workflow-not-found onto EngineWorkflowNotFoundError
 *     (the seam's sentinel);
 *   - workflowLiveness describes the pinned workflow ID: running and
 *     paused are open, every ending is closed, a workflow the engine does
 *     not hold is not_found, and a status it cannot name throws;
 *   - the engine-state provider: DISCONNECTED until the first connect,
 *     memoized per client instance, re-built on client swap (reconnect);
 *   - the run credential on the input: minted through the
 *     composed provider's capability and bound to the execution with no
 *     clock; the key is ABSENT when the provider lacks the capability
 *     (an edition credentialed another way), when it is keyless, and
 *     when the mint throws — a dispatch never fails on a mint;
 *   - a reconcile turn's input carries `reconcile_file_review`, and every
 *     other run's omits the key;
 *   - a turn a shared runner serves (per-session routing, shared runners
 *     on, a CLOUD conversation without a computer) goes to the runner
 *     queue with `runner: "shared"` and its credential SEALED: the clear
 *     key is absent, the sealed one opens under the payload key to the
 *     minted credential, and the mint is told the placement; with shared
 *     runners off the same conversation goes to its own queue as before,
 *     and a shared turn with no sealer fails its start rather than carry
 *     the credential in the clear;
 *   - the caller's facts ride every input (`caller_class`, and the
 *     routine and the caller's id when set), and a CLOUD target's input
 *     carries the server's limit on a wait for room, zero included, which
 *     a LOCAL target's omits.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { create } from "@bufbuild/protobuf";
import type { Client, WorkflowExecutionStatusName } from "@temporalio/client";
import { WorkflowNotFoundError } from "@temporalio/common";
import { afterEach, describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import {
  Computer,
  ExecutionTarget,
  Harness,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { EncryptionPayloadCodec, openSealedString, sealString } from "@stigmer/temporal-codecs";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import {
  EngineDispatchError,
  EngineWorkflowNotFoundError,
} from "../../../domain/run/engine.js";
import {
  AgentExecutionTemporalConfig,
  DEFAULT_EXECUTION_TARGET_CLOUD,
  DEFAULT_EXECUTION_TARGET_LOCAL,
  ROUTING_GLOBAL,
  ROUTING_SESSION,
} from "../../../domain/run/temporal/config.js";
import type { RunCredentialTurn } from "../../../runnerauth/runner-credential-provider.js";
import type { RunCredentialMint } from "../../../runnerauth/dispatch-credential.js";
import { newExecutionScopedRunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import {
  isClockedToken,
  RunnerAuthService,
  TOKEN_TYPE_EXECUTION_SCOPED,
} from "../../../runnerauth/runnerauth.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import type { TemporalManager } from "../../manager.js";
import {
  newExecutionEngineStateProvider,
  TemporalExecutionEngine,
} from "../engine-client.js";
import type { TemporalExecutionEngineDeps } from "../engine-client.js";
import { DEFAULT_ACTIVITY_TASK_QUEUE } from "../names.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/** The keyed OSS default — what a real open-source boot composes. */
const runnerAuth = RunnerAuthService.create(randomBytes(32));
const keyedCredentials = newExecutionScopedRunnerCredentialProvider(runnerAuth);

/**
 * One construction site for every arm: the realistic deps by default,
 * any of them overridable, so the next dependency costs one line here.
 */
function newEngine(
  client: Client,
  overrides: Partial<Omit<TemporalExecutionEngineDeps, "client">> = {},
): TemporalExecutionEngine {
  return new TemporalExecutionEngine({
    client,
    config: config(),
    store: overrides.store ?? newStore(),
    runnerCredentials: keyedCredentials,
    sandboxWaitSeconds: 900,
    sandboxLane: false,
    logger: silentLogger,
    ...overrides,
  });
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

function newStore(): Store {
  const dir = mkdtempSync(path.join(tmpdir(), "engine-client-test-"));
  const store = SqliteStore.open(path.join(dir, "engine.sqlite"), silentLogger);
  cleanups.push(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

function config(): AgentExecutionTemporalConfig {
  return new AgentExecutionTemporalConfig(
    "agent_execution_stigmer",
    DEFAULT_ACTIVITY_TASK_QUEUE,
    ROUTING_GLOBAL,
    DEFAULT_EXECUTION_TARGET_LOCAL,
  );
}

interface StartCall {
  readonly workflowType: string;
  readonly options: Record<string, unknown>;
}

interface HandleCall {
  readonly workflowId: string;
  readonly method: string;
  readonly args: unknown[];
}

function stubClient(behavior?: { handleError?: Error; status?: WorkflowExecutionStatusName }) {
  const startCalls: StartCall[] = [];
  const handleCalls: HandleCall[] = [];
  const client = {
    workflow: {
      start: async (
        workflowType: string,
        options: Record<string, unknown>,
      ): Promise<void> => {
        startCalls.push({ workflowType, options });
      },
      getHandle: (workflowId: string) => ({
        signal: async (...args: unknown[]) => {
          handleCalls.push({ workflowId, method: "signal", args });
          if (behavior?.handleError) throw behavior.handleError;
        },
        cancel: async () => {
          handleCalls.push({ workflowId, method: "cancel", args: [] });
          if (behavior?.handleError) throw behavior.handleError;
        },
        terminate: async (reason: string) => {
          handleCalls.push({ workflowId, method: "terminate", args: [reason] });
          if (behavior?.handleError) throw behavior.handleError;
        },
        describe: async () => {
          handleCalls.push({ workflowId, method: "describe", args: [] });
          if (behavior?.handleError) throw behavior.handleError;
          return { status: { name: behavior?.status ?? "RUNNING" } };
        },
      }),
    },
  } as unknown as Client;
  return { client, startCalls, handleCalls };
}

/** The one workflow input the stub recorded. */
function dispatchedInput(startCalls: StartCall[]): Record<string, unknown> {
  expect(startCalls).toHaveLength(1);
  return (startCalls[0]!.options["args"] as unknown[])[0] as Record<string, unknown>;
}

function startInput(overrides: Partial<Parameters<TemporalExecutionEngine["startInvokeWorkflow"]>[0]> = {}) {
  return {
    executionId: "run_1",
    org: "org_1",
    sessionId: "",
    agentId: "agt_1",
    autoApproveAll: false,
    caller: { identityId: "", callerClass: "internal" },
    ...overrides,
  };
}

describe("TemporalExecutionEngine.startInvokeWorkflow", () => {
  it("starts the byte-pinned workflow type with the memo, queue, and slim input", async () => {
    const { client, startCalls } = stubClient();
    const engine = newEngine(client);

    await engine.startInvokeWorkflow(startInput());

    expect(startCalls).toHaveLength(1);
    const call = startCalls[0]!;
    expect(call.workflowType).toBe("stigmer/agent-execution/invoke");
    expect(call.options["workflowId"]).toBe("stigmer/agent-execution/invoke/run_1");
    expect(call.options["taskQueue"]).toBe("agent_execution_stigmer");
    expect(call.options["memo"]).toEqual({
      activityTaskQueue: DEFAULT_ACTIVITY_TASK_QUEUE,
    });
    // No run timeout: HITL can block for days.
    expect(call.options["workflowRunTimeout"]).toBeUndefined();
    expect(call.options["args"]).toEqual([
      {
        execution_id: "run_1",
        session_id: "",
        agent_id: "agt_1",
        // Dispatch defaults: harness STIGMER (nonzero, so the wire
        // carries it) and target resolved LOCAL.
        harness: Harness.STIGMER,
        execution_target: ExecutionTarget.LOCAL,
        // The run credential, minted per dispatch (its own arms below).
        execution_context_token: expect.any(String),
        caller_class: "internal",
      },
    ]);
  });

  it("carries the run credential minted through the provider: bound to the execution, no clock", async () => {
    const { client, startCalls } = stubClient();
    const engine = newEngine(client);

    await engine.startInvokeWorkflow(startInput({ executionId: "run_cred" }));

    const token = dispatchedInput(startCalls)["execution_context_token"];
    expect(typeof token).toBe("string");
    expect(runnerAuth.verify(token as string)).toBe("run_cred");
    expect(isClockedToken(token as string)).toBe(false);
  });

  it("omits the credential when the provider lacks the capability — an edition credentialed another way", async () => {
    const { client, startCalls } = stubClient();
    const withoutCapability: RunCredentialMint = {};
    const engine = newEngine(client, { runnerCredentials: withoutCapability });

    await engine.startInvokeWorkflow(startInput());

    expect("execution_context_token" in dispatchedInput(startCalls)).toBe(
      false,
    );
  });

  it("omits the credential when the provider is keyless", async () => {
    const { client, startCalls } = stubClient();
    const keyless = newExecutionScopedRunnerCredentialProvider(
      RunnerAuthService.create(undefined),
    );
    const engine = newEngine(client, { runnerCredentials: keyless });

    await engine.startInvokeWorkflow(startInput());

    expect("execution_context_token" in dispatchedInput(startCalls)).toBe(
      false,
    );
  });

  it("a mint that throws degrades to a dispatch without the credential — the start still happens", async () => {
    const { client, startCalls } = stubClient();
    const throwing: RunCredentialMint = {
      mintRunCredential(): string {
        throw new Error("signing failed");
      },
    };
    const engine = newEngine(client, { runnerCredentials: throwing });

    await engine.startInvokeWorkflow(startInput());

    expect(startCalls).toHaveLength(1);
    expect("execution_context_token" in dispatchedInput(startCalls)).toBe(
      false,
    );
  });

  it("marks a reconcile turn's input, and leaves the key off every other run's (omitempty)", async () => {
    const reconcile = stubClient();
    await newEngine(reconcile.client).startInvokeWorkflow(startInput({ reconcileFileReview: true }));
    expect(dispatchedInput(reconcile.startCalls)["reconcile_file_review"]).toBe(true);

    const message = stubClient();
    await newEngine(message.client).startInvokeWorkflow(startInput({ reconcileFileReview: false }));
    expect("reconcile_file_review" in dispatchedInput(message.startCalls)).toBe(false);
  });

  it("resolves session routing through dispatch (harness + target in the input)", async () => {
    const { client, startCalls } = stubClient();
    const store = newStore();
    await store.saveResource(
      ApiResourceKind.session,
      "ses_1",
      SessionSchema,
      create(SessionSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Session",
        metadata: { id: "ses_1", name: "s", org: "o" },
        spec: {
          harness: Harness.CLAUDE,
          executionTarget: ExecutionTarget.CLOUD,
        },
      }),
    );
    const engine = newEngine(client, { store });

    await engine.startInvokeWorkflow(startInput({ sessionId: "ses_1" }));

    const input = dispatchedInput(startCalls);
    expect(input["harness"]).toBe(Harness.CLAUDE);
    expect(input["execution_target"]).toBe(ExecutionTarget.CLOUD);
    // Omitempty shape: a false auto_approve_all carries NO key.
    expect("auto_approve_all" in input).toBe(false);
    // A CLOUD turn carries the server's limit on its wait for room.
    expect(input["sandbox_wait_seconds"]).toBe(900);
  });

  it("carries the caller's facts, and a CLOUD target's wait limit even when it is zero", async () => {
    const store = newStore();
    await store.saveResource(
      ApiResourceKind.session,
      "ses_cloud",
      SessionSchema,
      create(SessionSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Session",
        metadata: { id: "ses_cloud", name: "s", org: "o" },
        spec: { executionTarget: ExecutionTarget.CLOUD },
      }),
    );
    const fire = stubClient();
    await newEngine(fire.client, { store, sandboxWaitSeconds: 0 }).startInvokeWorkflow(
      startInput({
        sessionId: "ses_cloud",
        caller: { identityId: "ida_owner", callerClass: "user", routineId: "rtn_1" },
      }),
    );
    const input = dispatchedInput(fire.startCalls);
    expect(input).toMatchObject({
      caller_class: "user",
      routine_id: "rtn_1",
      caller_identity_id: "ida_owner",
      sandbox_wait_seconds: 0,
    });

    const local = stubClient();
    await newEngine(local.client).startInvokeWorkflow(startInput());
    const localInput = dispatchedInput(local.startCalls);
    expect("sandbox_wait_seconds" in localInput).toBe(false);
    expect("routine_id" in localInput).toBe(false);
    expect("caller_identity_id" in localInput).toBe(false);
  });

  it("wraps dispatch-resolution failures in EngineDispatchError with the message verbatim", async () => {
    const { client } = stubClient();
    const store = newStore();
    await store.close(); // Forces a non-NotFound store failure in dispatch.
    const engine = newEngine(client, { store });

    await expect(
      engine.startInvokeWorkflow(startInput({ sessionId: "ses_any" })),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof EngineDispatchError &&
        error.message.startsWith("failed to load session for dispatch:"),
    );
  });
});

describe("TemporalExecutionEngine.startInvokeWorkflow on shared runners", () => {
  const codec = new EncryptionPayloadCodec({ primary: { keyId: "pk1", key: randomBytes(32) } });
  const seal = (value: string) => sealString(codec, value);

  function sessionConfig(sharedRunners: boolean): AgentExecutionTemporalConfig {
    return new AgentExecutionTemporalConfig(
      "agent_execution_stigmer",
      DEFAULT_ACTIVITY_TASK_QUEUE,
      ROUTING_SESSION,
      DEFAULT_EXECUTION_TARGET_CLOUD,
      sharedRunners,
    );
  }

  async function storeWithSession(computer: Computer): Promise<Store> {
    const store = newStore();
    await store.saveResource(
      ApiResourceKind.session,
      "ses_c",
      SessionSchema,
      create(SessionSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Session",
        metadata: { id: "ses_c", name: "s", org: "org_1" },
        spec: {},
        status: { computer },
      }),
    );
    return store;
  }

  it("sends a conversation without a computer to the runner queue, marked shared, its credential sealed", async () => {
    const turns: (RunCredentialTurn | undefined)[] = [];
    const recording: RunCredentialMint = {
      mintRunCredential: (executionId, turn) => {
        turns.push(turn);
        return keyedCredentials.mintRunCredential!(executionId);
      },
    };
    const { client, startCalls } = stubClient();
    await newEngine(client, {
      config: sessionConfig(true),
      store: await storeWithSession(Computer.NONE),
      sandboxLane: true,
      runnerCredentials: recording,
      sealRunCredential: seal,
    }).startInvokeWorkflow(startInput({ sessionId: "ses_c" }));

    expect(startCalls[0]!.options["memo"]).toEqual({ activityTaskQueue: DEFAULT_ACTIVITY_TASK_QUEUE });
    const input = dispatchedInput(startCalls);
    expect(input["runner"]).toBe("shared");
    expect("execution_context_token" in input).toBe(false);
    const sealed = input["sealed_execution_context_token"] as string;
    const opened = await openSealedString(codec, sealed);
    expect(keyedCredentials.verify(TOKEN_TYPE_EXECUTION_SCOPED, opened)).toBe("run_1");
    // The history shows no credential: nothing in the input is the token.
    expect(JSON.stringify(input)).not.toContain(opened);
    expect(turns).toEqual([{ sessionId: "ses_c", org: "org_1", runner: "shared" }]);
  });

  it("keeps a conversation with a computer on its own queue, unsealed, and tells the mint it is a sandbox's", async () => {
    const turns: (RunCredentialTurn | undefined)[] = [];
    const recording: RunCredentialMint = {
      mintRunCredential: (executionId, turn) => {
        turns.push(turn);
        return keyedCredentials.mintRunCredential!(executionId);
      },
    };
    const { client, startCalls } = stubClient();
    await newEngine(client, {
      config: sessionConfig(true),
      store: await storeWithSession(Computer.REQUIRED),
      sandboxLane: true,
      runnerCredentials: recording,
      sealRunCredential: seal,
    }).startInvokeWorkflow(startInput({ sessionId: "ses_c" }));

    expect(startCalls[0]!.options["memo"]).toEqual({ activityTaskQueue: "session:ses_c" });
    const input = dispatchedInput(startCalls);
    expect("runner" in input).toBe(false);
    expect("sealed_execution_context_token" in input).toBe(false);
    expect(input["execution_context_token"]).toEqual(expect.any(String));
    expect(turns[0]?.runner).toBe("sandbox");
  });

  it("with shared runners off, places a conversation without a computer exactly as before", async () => {
    const { client, startCalls } = stubClient();
    await newEngine(client, {
      config: sessionConfig(false),
      store: await storeWithSession(Computer.NONE),
      sandboxLane: true,
      sealRunCredential: seal,
    }).startInvokeWorkflow(startInput({ sessionId: "ses_c" }));

    expect(startCalls[0]!.options["memo"]).toEqual({ activityTaskQueue: "session:ses_c" });
    const input = dispatchedInput(startCalls);
    expect("runner" in input).toBe(false);
    expect("sealed_execution_context_token" in input).toBe(false);
  });

  it("refuses to start a shared turn it cannot seal, rather than carry the credential in the clear", async () => {
    const { client, startCalls } = stubClient();
    await expect(
      newEngine(client, {
        config: sessionConfig(true),
        store: await storeWithSession(Computer.NONE),
        sandboxLane: true,
      }).startInvokeWorkflow(startInput({ sessionId: "ses_c" })),
    ).rejects.toThrow(/payload key/);
    expect(startCalls).toHaveLength(0);
  });
});

describe("TemporalExecutionEngine lifecycle operations", () => {
  it("targets the pinned workflow ID for signal/cancel/terminate", async () => {
    const { client, handleCalls } = stubClient();
    const engine = newEngine(client);

    await engine.signalApprovalGateResolved("run_2");
    await engine.signalPause("run_2", "Paused by user");
    await engine.signalResume("run_2");
    await engine.cancelWorkflow("run_2");
    await engine.terminateWorkflow("run_2", "Terminated by user");

    expect(handleCalls.map((call) => [call.workflowId, call.method, ...call.args])).toEqual([
      ["stigmer/agent-execution/invoke/run_2", "signal", "approvalGateResolved"],
      ["stigmer/agent-execution/invoke/run_2", "signal", "pause", "Paused by user"],
      ["stigmer/agent-execution/invoke/run_2", "signal", "resume"],
      ["stigmer/agent-execution/invoke/run_2", "cancel"],
      ["stigmer/agent-execution/invoke/run_2", "terminate", "Terminated by user"],
    ]);
  });

  it("maps the SDK's workflow-not-found onto the seam's sentinel", async () => {
    const { client } = stubClient({
      handleError: new WorkflowNotFoundError("nope", "wf", undefined),
    });
    const engine = newEngine(client);

    for (const op of [
      () => engine.signalApprovalGateResolved("run_3"),
      () => engine.signalPause("run_3", "r"),
      () => engine.signalResume("run_3"),
      () => engine.cancelWorkflow("run_3"),
      () => engine.terminateWorkflow("run_3", "r"),
    ]) {
      await expect(op()).rejects.toBeInstanceOf(EngineWorkflowNotFoundError);
    }
  });

  it("passes through other errors unmapped", async () => {
    const { client } = stubClient({ handleError: new Error("connection reset") });
    const engine = newEngine(client);
    await expect(engine.signalResume("run_4")).rejects.toThrow("connection reset");
  });
});

describe("TemporalExecutionEngine.workflowLiveness", () => {
  it("describes the pinned workflow ID", async () => {
    const { client, handleCalls } = stubClient();
    await newEngine(client).workflowLiveness("run_5");
    expect(handleCalls.map((call) => [call.workflowId, call.method])).toEqual([
      ["stigmer/agent-execution/invoke/run_5", "describe"],
    ]);
  });

  it("answers open for a running or paused workflow and closed for every ending", async () => {
    const cases: ReadonlyArray<readonly [WorkflowExecutionStatusName, string]> = [
      ["RUNNING", "open"],
      ["PAUSED", "open"],
      ["COMPLETED", "closed"],
      ["FAILED", "closed"],
      ["CANCELLED", "closed"],
      ["TERMINATED", "closed"],
      ["TIMED_OUT", "closed"],
      ["CONTINUED_AS_NEW", "closed"],
    ];
    for (const [status, liveness] of cases) {
      const { client } = stubClient({ status });
      expect([status, await newEngine(client).workflowLiveness("run_6")]).toEqual([status, liveness]);
    }
  });

  it("throws on a status it cannot name, so no run is ended on it", async () => {
    // ARCHIVED: a name a later SDK could add, which this code has never seen.
    const unnamed: WorkflowExecutionStatusName[] = ["UNSPECIFIED", "UNKNOWN", "ARCHIVED" as WorkflowExecutionStatusName];
    for (const status of unnamed) {
      const { client } = stubClient({ status });
      await expect(newEngine(client).workflowLiveness("run_7")).rejects.toThrow(
        `workflow status ${status} for execution run_7 cannot be read`,
      );
    }
  });

  it("answers not_found for a workflow the engine does not hold, and passes other errors through", async () => {
    const gone = stubClient({ handleError: new WorkflowNotFoundError("nope", "wf", undefined) });
    expect(await newEngine(gone.client).workflowLiveness("run_8")).toBe("not_found");
    const down = stubClient({ handleError: new Error("connection reset") });
    await expect(newEngine(down.client).workflowLiveness("run_8")).rejects.toThrow("connection reset");
  });
});

describe("newExecutionEngineStateProvider", () => {
  it("is DISCONNECTED until the first connect, then memoizes per client and re-builds on swap", () => {
    let current: Client | undefined;
    const manager = { getClient: () => current } as unknown as TemporalManager;
    const provider = newExecutionEngineStateProvider({
      manager,
      config: config(),
      store: newStore(),
      runnerCredentials: keyedCredentials,
      sandboxWaitSeconds: 900,
      sandboxLane: false,
      logger: silentLogger,
    });

    expect(provider().connected).toBe(false);

    const { client: clientA } = stubClient();
    current = clientA;
    const stateA = provider();
    expect(stateA.connected).toBe(true);
    // Memoized: the same client yields the same state object.
    expect(provider()).toBe(stateA);

    // A reconnect swaps the client; the provider rebuilds the engine.
    const { client: clientB } = stubClient();
    current = clientB;
    const stateB = provider();
    expect(stateB.connected).toBe(true);
    expect(stateB).not.toBe(stateA);
  });
});
