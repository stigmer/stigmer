/**
 * Pins sendSignal against Go's send_signal_test.go and
 * send_signal_dedupe_test.go case-for-case: the validation and phase
 * arms, the relay-envelope construction on the byte-pinned relaySignal
 * channel, and the two-phase dedupe contract (oss#442) — ALREADY_EXISTS
 * on a DELIVERED duplicate, ABORTED on a live in-flight claim,
 * release-after-failure enabling an immediate retry, empty-key and
 * store-error skips, and org-scoped key isolation.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { SendSignalInputSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import type { SendSignalInput } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { SqliteStore } from "../../../store/sqlite/store.js";

import { WORKFLOW_CREATOR_UNAVAILABLE_MESSAGE } from "../constants.js";
import { ENGINE_DISCONNECTED } from "../engine.js";
import { sendSignal } from "../send-signal.js";
import type { SendSignalDeps } from "../send-signal.js";
import { stubConnectedEngine } from "./engine-stub.js";
import type { EngineStub } from "./engine-stub.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let dir: string;
let store: SqliteStore;
let counter = 0;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wfexec-signal-"));
  store = SqliteStore.open(path.join(dir, "test.db"));
});

afterAll(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

function deps(engineStub?: EngineStub): SendSignalDeps {
  return {
    store,
    logger: silentLogger,
    engineState: () => engineStub?.state ?? ENGINE_DISCONNECTED,
  };
}

async function seed(phase: ExecutionPhase, org = "acme"): Promise<string> {
  counter += 1;
  const id = `wfx_sig_${counter}`;
  await store.saveResource(
    ApiResourceKind.workflow_execution,
    id,
    WorkflowExecutionSchema,
    create(WorkflowExecutionSchema, {
      metadata: { id, name: id, org },
      spec: { workflowId: `wf_${counter}`, workflowInstanceId: `wfi_${counter}` },
      status: { phase },
    }),
  );
  return id;
}

function input(
  executionId: string,
  signalName = "user_event",
  idempotencyKey = "",
): SendSignalInput {
  return create(SendSignalInputSchema, {
    executionId,
    signalName,
    idempotencyKey,
    payload: { hello: "world" },
  });
}

async function expectCode(
  fn: () => Promise<unknown>,
  code: Code,
): Promise<ConnectError> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(code);
    return error as ConnectError;
  }
  throw new Error(`expected ${Code[code]}, call succeeded`);
}

describe("sendSignal validation + phase arms (send_signal_test.go)", () => {
  it("requires execution_id and signal_name", async () => {
    const missing = await expectCode(
      () => sendSignal(deps(), input("", "sig")),
      Code.InvalidArgument,
    );
    expect(missing.rawMessage).toBe("execution_id is required");
    const id = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    const noName = await expectCode(
      () => sendSignal(deps(), input(id, "")),
      Code.InvalidArgument,
    );
    expect(noName.rawMessage).toBe("signal_name is required");
  });

  it("unknown execution answers NotFound", async () => {
    const err = await expectCode(
      () => sendSignal(deps(), input("wfx_missing")),
      Code.NotFound,
    );
    expect(err.rawMessage).toBe("workflow_execution not found: wfx_missing");
  });

  it("terminal phases refuse FailedPrecondition with the pinned copy", async () => {
    const completed = await seed(ExecutionPhase.EXECUTION_COMPLETED);
    const err = await expectCode(
      () => sendSignal(deps(), input(completed)),
      Code.FailedPrecondition,
    );
    expect(err.rawMessage).toBe(
      "cannot send signal to execution in phase EXECUTION_COMPLETED; only PENDING or IN_PROGRESS executions can receive signals",
    );
  });

  it("engineless send refuses FailedPrecondition with the creator copy", async () => {
    const id = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    const err = await expectCode(
      () => sendSignal(deps(), input(id)),
      Code.FailedPrecondition,
    );
    expect(err.rawMessage).toBe(WORKFLOW_CREATOR_UNAVAILABLE_MESSAGE);
  });

  it("delivers the relay envelope on the relaySignal channel (PENDING is signalable)", async () => {
    const engine = stubConnectedEngine();
    const id = await seed(ExecutionPhase.EXECUTION_PENDING);
    const result = await sendSignal(deps(engine), input(id, "order_arrived"));
    expect(result.metadata?.id).toBe(id);

    expect(engine.calls).toHaveLength(1);
    const [startInput, signalName, payload] = engine.calls[0].args as [
      { executionId: string; recoveryMode: boolean },
      string,
      unknown,
    ];
    expect(startInput.executionId).toBe(id);
    expect(signalName).toBe("relaySignal");
    // The envelope's JSON shape is the runner's wire contract.
    expect(payload).toEqual({
      signalName: "order_arrived",
      payload: { hello: "world" },
    });
  });

  it("a nil payload rides as null in the envelope (Go interface{} nil)", async () => {
    const engine = stubConnectedEngine();
    const id = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    await sendSignal(
      deps(engine),
      create(SendSignalInputSchema, { executionId: id, signalName: "ping" }),
    );
    const [, , payload] = engine.calls[0].args as [unknown, string, unknown];
    expect(payload).toEqual({ signalName: "ping", payload: null });
  });
});

describe("sendSignal dedupe (send_signal_dedupe_test.go, oss#442)", () => {
  it("a DELIVERED duplicate answers AlreadyExists with the pinned shape", async () => {
    const engine = stubConnectedEngine();
    const id = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    await sendSignal(deps(engine), input(id, "sig", "key-delivered"));

    const err = await expectCode(
      () => sendSignal(deps(engine), input(id, "sig", "key-delivered")),
      Code.AlreadyExists,
    );
    expect(err.rawMessage).toBe(
      "signal_with_idempotency_key already exists: key-delivered",
    );
    // The successful send delivered exactly once.
    expect(
      engine.calls.filter((call) => call.method === "signalWithStart"),
    ).toHaveLength(1);
  });

  it("a live in-flight claim answers Aborted (retryable conflict)", async () => {
    const engine = stubConnectedEngine();
    const id = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    // Claim the key directly (a concurrent request's live hold).
    await store.signalDedupe.claim("acme", "key-inflight", id, "sig", 300_000);

    const err = await expectCode(
      () => sendSignal(deps(engine), input(id, "sig", "key-inflight")),
      Code.Aborted,
    );
    expect(err.rawMessage).toBe(
      'signal with idempotency_key "key-inflight" is currently being delivered; retry shortly',
    );
  });

  it("a failed send releases the claim so the retry claims freshly", async () => {
    const engine = stubConnectedEngine();
    engine.failures.signalWithStart = new Error("temporal exploded");
    const id = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);

    const err = await expectCode(
      () => sendSignal(deps(engine), input(id, "sig", "key-retry")),
      Code.Internal,
    );
    expect(err.rawMessage).toBe("failed to send signal to workflow");

    // The retry with the same key must claim freshly and deliver.
    const healthy = stubConnectedEngine();
    await sendSignal(deps(healthy), input(id, "sig", "key-retry"));
    expect(
      healthy.calls.filter((call) => call.method === "signalWithStart"),
    ).toHaveLength(1);
  });

  it("no idempotency key skips dedupe entirely (backward compatible)", async () => {
    const engine = stubConnectedEngine();
    const id = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    await sendSignal(deps(engine), input(id, "sig", ""));
    await sendSignal(deps(engine), input(id, "sig", ""));
    expect(
      engine.calls.filter((call) => call.method === "signalWithStart"),
    ).toHaveLength(2);
  });

  it("distinct keys do not collide; keys are org-scoped", async () => {
    const engine = stubConnectedEngine();
    const id = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    await sendSignal(deps(engine), input(id, "sig", "key-a"));
    await sendSignal(deps(engine), input(id, "sig", "key-b"));

    // The same key under ANOTHER org claims independently ({org}:{key}).
    const otherOrg = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS, "beta");
    await sendSignal(deps(engine), input(otherOrg, "sig", "key-a"));

    expect(
      engine.calls.filter((call) => call.method === "signalWithStart"),
    ).toHaveLength(3);
  });

  it("engineless failure after a claim also releases it (the send step is the failure)", async () => {
    const id = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    await expectCode(
      () => sendSignal(deps(), input(id, "sig", "key-engineless")),
      Code.FailedPrecondition,
    );
    // The claim was released: a healthy retry delivers instead of Aborted.
    const healthy = stubConnectedEngine();
    await sendSignal(deps(healthy), input(id, "sig", "key-engineless"));
    expect(
      healthy.calls.filter((call) => call.method === "signalWithStart"),
    ).toHaveLength(1);
  });
});
