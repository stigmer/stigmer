/**
 * Pins the session domain against Go's pkg/domain/session tests — through
 * the REAL stack: a composed server on an ephemeral port, a native gRPC
 * client, and the full interceptor chain.
 *
 * The load-bearing pins:
 *   - an empty agent_instance_id is the built-in assistant: create stores
 *     it empty (nothing resolves it into an instance), an explicit id is
 *     kept as given, and a session may gain an agent or drop back to the
 *     assistant on update — the instance is not an immutable field;
 *   - harness immutability locks only once harness_state_id is non-empty,
 *     with UNSPECIFIED==NATIVE equivalence in both directions and the
 *     exact FAILED_PRECONDITION copy;
 *   - execution-target immutability resolves UNSPECIFIED through the
 *     deployment default on BOTH sides (oss#397) — a no-op round-trip
 *     passes on a local-default config, a real change is refused with the
 *     exact copy (Go enum value names + the config string), and a
 *     cloud-default config flips which transitions count as changes;
 *   - harness_state_id_history is server-owned: appended on replace, never
 *     duplicated, client-sent values discarded;
 *   - updateSubject is a field-level RMW that stamps ONLY the spec_audit
 *     slot (#540) and leaves the status slot untouched;
 *   - delete is refused while any of the four active execution phases
 *     exists (exact count copy), terminal phases don't block, and the
 *     cascade removes exactly the session's own executions.
 */
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { SessionSpec } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import {
  ExecutionTarget,
  Harness,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import {
  AgentExecutionTemporalConfig,
  DEFAULT_EXECUTION_TARGET_CLOUD,
  DEFAULT_EXECUTION_TARGET_LOCAL,
  ROUTING_GLOBAL,
  newConfigFromEnv,
} from "../../agentexecution/temporal/config.js";
import { newValidateExecutionTargetImmutabilityStep } from "../steps.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "acme";

const HARNESS_IMMUTABILITY_REFUSAL =
  "session harness cannot be changed after the first execution — each harness owns its conversation state independently";

let dir: string;
let server: ComposedServer;
let transport: Transport;
let agentCommand: Client<typeof AgentCommandController>;
let command: Client<typeof SessionCommandController>;
let query: Client<typeof SessionQueryController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "session-domain-test-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: 127.0.0.1:1 is deterministically
      // closed, so boots fail the non-fatal connect fast and can never touch
      // a live local Temporal (the conformance CRUD harness does the same).
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      // The skill artifact store + staging wipe (#8) must stay inside the
      // test dir — the default resolves to ~/.stigmer/storage.
      STORAGE_PATH: path.join(dir, "storage"),
      // Keep the artifact store inside the test dir — the default
      // resolves to ~/.stigmer, which tests must never touch.
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  agentCommand = createClient(AgentCommandController, transport);
  command = createClient(SessionCommandController, transport);
  query = createClient(SessionQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

async function createAgent(name: string) {
  return agentCommand.create({
    apiVersion: API_VERSION,
    kind: "Agent",
    metadata: { name, org: ORG },
    spec: {
      instructions: "You are a helpful agent used by the session tests.",
    },
  });
}

let sessionCounter = 0;
async function createSession(
  spec: Partial<Omit<SessionSpec, "$typeName">> = {},
): Promise<Session> {
  sessionCounter += 1;
  return command.create({
    apiVersion: API_VERSION,
    kind: "Session",
    metadata: { name: `Session ${sessionCounter}`, org: ORG },
    spec,
  });
}

function updateInput(
  session: Session,
  spec: Partial<Omit<SessionSpec, "$typeName">>,
) {
  return {
    apiVersion: API_VERSION,
    kind: "Session",
    metadata: {
      id: session.metadata!.id,
      name: session.metadata!.name,
      slug: session.metadata!.slug,
      org: session.metadata!.org,
    },
    spec,
  };
}

/** Simulates a completed first execution: sets the immutability sentinel. */
async function markSessionUsed(
  sessionId: string,
  harnessStateId: string,
): Promise<void> {
  const stored = await server.store.getResource(
    ApiResourceKind.session,
    sessionId,
    SessionSchema,
  );
  stored.spec!.harnessStateId = harnessStateId;
  await server.store.saveResource(
    ApiResourceKind.session,
    sessionId,
    SessionSchema,
    stored,
  );
}

let executionCounter = 0;
async function seedExecution(
  sessionId: string,
  phase: ExecutionPhase,
): Promise<string> {
  executionCounter += 1;
  const id = `aex_sessiontest_${executionCounter}`;
  const execution = create(AgentExecutionSchema, {
    apiVersion: API_VERSION,
    kind: "AgentExecution",
    metadata: { id, name: `Execution ${executionCounter}`, org: ORG },
    spec: { sessionId },
    status: { phase },
  });
  await server.store.saveResource(
    ApiResourceKind.agent_execution,
    id,
    AgentExecutionSchema,
    execution,
  );
  return id;
}

async function grpcError(run: () => Promise<unknown>): Promise<ConnectError> {
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

describe("session create and update — the built-in assistant", () => {
  it("stores an empty agent_instance_id as given: no agent is resolved for the session", async () => {
    const session = await createSession({});
    expect(session.spec?.agentInstanceId).toBe("");
    const fetched = await query.get({ value: session.metadata!.id });
    expect(fetched.spec?.agentInstanceId).toBe("");
    await command.delete({ value: session.metadata!.id });
  });

  it("keeps an explicit agent_instance_id as given", async () => {
    const session = await createSession({ agentInstanceId: "ain_explicit" });
    expect(session.spec?.agentInstanceId).toBe("ain_explicit");
    await command.delete({ value: session.metadata!.id });
  });

  it("lets a conversation gain an agent and drop back to the assistant on update", async () => {
    const session = await createSession({});

    const withAgent = await command.update(
      updateInput(session, { agentInstanceId: "ain_picked" }),
    );
    expect(withAgent.spec?.agentInstanceId).toBe("ain_picked");

    const dropped = await command.update(
      updateInput(withAgent, { agentInstanceId: "" }),
    );
    expect(dropped.spec?.agentInstanceId).toBe("");
    const fetched = await query.get({ value: session.metadata!.id });
    expect(fetched.spec?.agentInstanceId).toBe("");

    await command.delete({ value: session.metadata!.id });
  });
});

describe("session update — harness immutability", () => {
  it("allows a harness change while harness_state_id is empty (session not yet used)", async () => {
    const session = await createSession({
      agentInstanceId: "ain_h1",
      harness: Harness.NATIVE,
    });

    const updated = await command.update(
      updateInput(session, {
        agentInstanceId: "ain_h1",
        harness: Harness.CURSOR,
      }),
    );
    expect(updated.spec?.harness).toBe(Harness.CURSOR);
  });

  it("rejects a harness change after the first execution with the exact copy", async () => {
    const session = await createSession({
      agentInstanceId: "ain_h2",
      harness: Harness.NATIVE,
    });
    await markSessionUsed(session.metadata!.id, "thread-1");

    const error = await grpcError(() =>
      command.update(
        updateInput(session, {
          agentInstanceId: "ain_h2",
          harness: Harness.CURSOR,
        }),
      ),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(HARNESS_IMMUTABILITY_REFUSAL);
  });

  it("treats UNSPECIFIED as NATIVE: existing NATIVE + input UNSPECIFIED passes", async () => {
    const session = await createSession({
      agentInstanceId: "ain_h3",
      harness: Harness.NATIVE,
    });
    await markSessionUsed(session.metadata!.id, "thread-3");

    const updated = await command.update(
      updateInput(session, {
        agentInstanceId: "ain_h3",
        subject: "still native",
      }),
    );
    expect(updated.spec?.subject).toBe("still native");
  });

  it("treats UNSPECIFIED as NATIVE: existing UNSPECIFIED + input NATIVE passes; CURSOR is refused", async () => {
    const session = await createSession({ agentInstanceId: "ain_h4" });
    await markSessionUsed(session.metadata!.id, "thread-4");

    const updated = await command.update(
      updateInput(session, {
        agentInstanceId: "ain_h4",
        harness: Harness.NATIVE,
      }),
    );
    expect(updated.spec?.harness).toBe(Harness.NATIVE);

    // Re-arm the sentinel (the passing update replaced the spec).
    await markSessionUsed(session.metadata!.id, "thread-4");
    const error = await grpcError(() =>
      command.update(
        updateInput(session, {
          agentInstanceId: "ain_h4",
          harness: Harness.CURSOR,
        }),
      ),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(HARNESS_IMMUTABILITY_REFUSAL);
  });
});

describe("session update — execution-target immutability (oss#397)", () => {
  it("passes an unset→unset round-trip on the local-default deployment (both resolve LOCAL)", async () => {
    const session = await createSession({ agentInstanceId: "ain_t1" });
    await markSessionUsed(session.metadata!.id, "thread-t1");

    const updated = await command.update(
      updateInput(session, { agentInstanceId: "ain_t1", subject: "no move" }),
    );
    expect(updated.spec?.subject).toBe("no move");
  });

  it("passes unset→LOCAL on the local-default deployment (no dispatch change)", async () => {
    const session = await createSession({ agentInstanceId: "ain_t2" });
    await markSessionUsed(session.metadata!.id, "thread-t2");

    const updated = await command.update(
      updateInput(session, {
        agentInstanceId: "ain_t2",
        executionTarget: ExecutionTarget.LOCAL,
      }),
    );
    expect(updated.spec?.executionTarget).toBe(ExecutionTarget.LOCAL);
  });

  it("refuses unset→CLOUD with the exact copy (Go enum names + the config default string)", async () => {
    const session = await createSession({ agentInstanceId: "ain_t3" });
    await markSessionUsed(session.metadata!.id, "thread-t3");

    const error = await grpcError(() =>
      command.update(
        updateInput(session, {
          agentInstanceId: "ain_t3",
          executionTarget: ExecutionTarget.CLOUD,
        }),
      ),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(
      "session execution_target cannot be changed after the first execution " +
        "(EXECUTION_TARGET_LOCAL → EXECUTION_TARGET_CLOUD; unset resolves to the " +
        "deployment default, local) — workspace state may not be portable " +
        "between local and cloud environments",
    );
  });

  it("resolves through a cloud-default config: unset==CLOUD passes, LOCAL is refused (step-level)", () => {
    const cloudConfig = new AgentExecutionTemporalConfig(
      "agent_execution_stigmer",
      "stigmer_runner",
      ROUTING_GLOBAL,
      DEFAULT_EXECUTION_TARGET_CLOUD,
    );
    const step = newValidateExecutionTargetImmutabilityStep(cloudConfig);

    const existing = create(SessionSchema, {
      spec: {
        harnessStateId: "thread-x",
        executionTarget: ExecutionTarget.UNSPECIFIED,
      },
    });

    // unset existing + explicit CLOUD input: both resolve CLOUD — passes.
    const passCtx = new RequestContext(
      SessionSchema,
      create(SessionSchema, {
        spec: { executionTarget: ExecutionTarget.CLOUD },
      }),
      testCallerIdentity(),
      ApiResourceKind.session,
    );
    passCtx.set(EXISTING_RESOURCE_KEY, existing);
    expect(() => step.execute(passCtx)).not.toThrow();

    // unset existing + LOCAL input: CLOUD → LOCAL is a real move — refused,
    // with the cloud default string in the copy.
    const failCtx = new RequestContext(
      SessionSchema,
      create(SessionSchema, {
        spec: { executionTarget: ExecutionTarget.LOCAL },
      }),
      testCallerIdentity(),
      ApiResourceKind.session,
    );
    failCtx.set(EXISTING_RESOURCE_KEY, existing);
    let thrown: unknown;
    try {
      step.execute(failCtx);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConnectError);
    expect((thrown as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((thrown as ConnectError).rawMessage).toBe(
      "session execution_target cannot be changed after the first execution " +
        "(EXECUTION_TARGET_CLOUD → EXECUTION_TARGET_LOCAL; unset resolves to the " +
        "deployment default, cloud) — workspace state may not be portable " +
        "between local and cloud environments",
    );
  });

  it("newConfigFromEnv defaults resolve UNSPECIFIED to LOCAL and pass explicit values through", () => {
    const config = newConfigFromEnv();
    expect(config.defaultExecutionTarget).toBe(DEFAULT_EXECUTION_TARGET_LOCAL);
    expect(config.resolveExecutionTarget(ExecutionTarget.UNSPECIFIED)).toBe(
      ExecutionTarget.LOCAL,
    );
    expect(config.resolveExecutionTarget(ExecutionTarget.CLOUD)).toBe(
      ExecutionTarget.CLOUD,
    );
  });
});

describe("session update — server-owned harness_state_id_history", () => {
  it("appends the replaced id, never duplicates, and discards client-sent history", async () => {
    const session = await createSession({ agentInstanceId: "ain_hist" });
    await markSessionUsed(session.metadata!.id, "hs-1");

    // Replace hs-1 with hs-2: the replaced id lands in the history.
    const first = await command.update(
      updateInput(session, {
        agentInstanceId: "ain_hist",
        harnessStateId: "hs-2",
      }),
    );
    expect(first.spec?.harnessStateId).toBe("hs-2");
    expect(first.spec?.harnessStateIdHistory).toEqual(["hs-1"]);

    // Same id again, with client-forged history: no duplicate append and
    // the forged entry is discarded (server-owned field).
    const second = await command.update(
      updateInput(session, {
        agentInstanceId: "ain_hist",
        harnessStateId: "hs-2",
        harnessStateIdHistory: ["client-forged"],
      }),
    );
    expect(second.spec?.harnessStateId).toBe("hs-2");
    expect(second.spec?.harnessStateIdHistory).toEqual(["hs-1"]);

    // A second replacement appends behind the first.
    const third = await command.update(
      updateInput(session, {
        agentInstanceId: "ain_hist",
        harnessStateId: "hs-3",
      }),
    );
    expect(third.spec?.harnessStateIdHistory).toEqual(["hs-1", "hs-2"]);

    // The persisted row agrees with the wire answer.
    const fetched = await query.get({ value: session.metadata!.id });
    expect(fetched.spec?.harnessStateIdHistory).toEqual(["hs-1", "hs-2"]);
  });
});

describe("session updateSubject — field-level RMW (#540 spec_audit slot)", () => {
  it("updates only the subject, stamps spec_audit, and leaves status_audit untouched", async () => {
    const session = await createSession({
      agentInstanceId: "ain_subj",
      subject: "original",
      harness: Harness.NATIVE,
    });
    const statusAuditBefore = session.status!.audit!.statusAudit!;

    const updated = await command.updateSubject({
      id: session.metadata!.id,
      subject: "renamed thread",
    });

    expect(updated.spec?.subject).toBe("renamed thread");
    // Every other spec field survives the RMW.
    expect(updated.spec?.agentInstanceId).toBe("ain_subj");
    expect(updated.spec?.harness).toBe(Harness.NATIVE);

    // The SPEC slot took the update stamp...
    expect(updated.status?.audit?.specAudit?.event).toBe("updated");
    // ...and the STATUS slot is byte-identical to before (not rewritten).
    const statusAuditAfter = updated.status?.audit?.statusAudit;
    expect(statusAuditAfter?.event).toBe("created");
    expect(statusAuditAfter?.updatedAt?.seconds).toBe(
      statusAuditBefore.updatedAt?.seconds,
    );
    expect(statusAuditAfter?.updatedAt?.nanos).toBe(
      statusAuditBefore.updatedAt?.nanos,
    );
  });

  it("returns NotFound for an unknown session id", async () => {
    const error = await grpcError(() =>
      command.updateSubject({ id: "ses_doesnotexist", subject: "anything" }),
    );
    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe("session not found: ses_doesnotexist");
  });
});

describe("session delete — active-execution guard and cascade", () => {
  const activePhases: ReadonlyArray<[string, ExecutionPhase]> = [
    ["EXECUTION_PENDING", ExecutionPhase.EXECUTION_PENDING],
    ["EXECUTION_IN_PROGRESS", ExecutionPhase.EXECUTION_IN_PROGRESS],
    [
      "EXECUTION_WAITING_FOR_APPROVAL",
      ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    ],
    ["EXECUTION_PAUSED", ExecutionPhase.EXECUTION_PAUSED],
  ];

  for (const [name, phase] of activePhases) {
    it(`blocks delete while an execution is ${name} (exact count copy)`, async () => {
      const session = await createSession({ agentInstanceId: "ain_guard" });
      const executionId = await seedExecution(session.metadata!.id, phase);

      const error = await grpcError(() =>
        command.delete({ value: session.metadata!.id }),
      );
      expect(error.code).toBe(Code.FailedPrecondition);
      expect(error.rawMessage).toBe(
        "session has 1 active execution(s); cancel them or wait for completion before deleting",
      );

      // The refused delete left everything in place.
      await expect(
        query.get({ value: session.metadata!.id }),
      ).resolves.toBeDefined();

      // Unblock and converge: the retried delete succeeds and cascades.
      await server.store.deleteResource(
        ApiResourceKind.agent_execution,
        executionId,
      );
      await command.delete({ value: session.metadata!.id });
    });
  }

  it("terminal executions don't block; the cascade removes exactly the session's own executions", async () => {
    const doomed = await createSession({ agentInstanceId: "ain_cascade" });
    const survivor = await createSession({ agentInstanceId: "ain_cascade" });

    const completedId = await seedExecution(
      doomed.metadata!.id,
      ExecutionPhase.EXECUTION_COMPLETED,
    );
    const failedId = await seedExecution(
      doomed.metadata!.id,
      ExecutionPhase.EXECUTION_FAILED,
    );
    const survivorExecutionId = await seedExecution(
      survivor.metadata!.id,
      ExecutionPhase.EXECUTION_COMPLETED,
    );

    const deleted = await command.delete({ value: doomed.metadata!.id });
    expect(deleted.metadata?.id).toBe(doomed.metadata?.id);

    // The doomed session's executions are gone (children before parent)...
    await expect(
      server.store.getResource(
        ApiResourceKind.agent_execution,
        completedId,
        AgentExecutionSchema,
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(
      server.store.getResource(
        ApiResourceKind.agent_execution,
        failedId,
        AgentExecutionSchema,
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);

    // ...while the other session's execution is untouched.
    const untouched = await server.store.getResource(
      ApiResourceKind.agent_execution,
      survivorExecutionId,
      AgentExecutionSchema,
    );
    expect(untouched.spec?.sessionId).toBe(survivor.metadata?.id);

    await command.delete({ value: survivor.metadata!.id });
  });
});
