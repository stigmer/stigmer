/**
 * Pins the session domain against Go's pkg/domain/session tests — through
 * the REAL stack: a composed server on an ephemeral port, a native gRPC
 * client, and the full interceptor chain.
 *
 * The load-bearing pins:
 *   - an empty agent_ref is the built-in assistant: create stores no
 *     reference and no pin; a reference to an agent is kept as given and
 *     pins the agent's id and current version in status; a session may
 *     gain an agent, change it or drop back to the assistant on update,
 *     the pin following each time — the agent is not an immutable field;
 *   - `latest` is an instruction, not a state: an update naming it moves
 *     the pin to the agent's current version and stores the reference
 *     with no version, while an echo of the stored reference keeps the
 *     pin after the author saved;
 *   - update runs the reference rule on what it introduces: adding a
 *     missing agent or skill, or another organization's agent that is not
 *     platform-visible, is refused and the stored row is left as it was;
 *     an echo of a skill deleted since the session named it passes (the
 *     runner's harness-state write-back sends the whole row);
 *   - listByAgent answers the sessions whose pin names the agent, and
 *     refuses an empty agent_id, at the filter step as well as at proto
 *     validation;
 *   - harness immutability locks only once harness_state_id is non-empty,
 *     with a stored UNSPECIFIED read as NATIVE and the exact
 *     FAILED_PRECONDITION copy; an update that names no harness keeps the
 *     stored one, used or not (a caller re-applying a session it created
 *     never resets the engine);
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
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
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
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError, type Store } from "../../../store/interface.js";
import {
  AgentExecutionTemporalConfig,
  DEFAULT_EXECUTION_TARGET_CLOUD,
  DEFAULT_EXECUTION_TARGET_LOCAL,
  ROUTING_GLOBAL,
  newConfigFromEnv,
} from "../../run/temporal/config.js";
import {
  newFilterByAgentStep,
  newValidateExecutionTargetImmutabilityStep,
} from "../steps.js";
import {
  seedOrganizations,
  type OrganizationIds,
} from "../../organization/__tests__/support.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "acme";
const OTHER_ORG = "globex";

const HARNESS_IMMUTABILITY_REFUSAL =
  "session harness cannot be changed after the first execution — each harness owns its conversation state independently";

let dir: string;
let server: ComposedServer;
let transport: Transport;
let agentCommand: Client<typeof AgentCommandController>;
let command: Client<typeof SessionCommandController>;
let query: Client<typeof SessionQueryController>;
let orgIds: OrganizationIds;

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
      // The skill artifact store + staging wipe must stay inside the
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
  orgIds = await seedOrganizations(transport, [ORG, OTHER_ORG]);
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

/** A same-organization reference to an agent, as a client writes it. */
function agentRef(slug: string, version = ""): ApiResourceReference {
  return create(ApiResourceReferenceSchema, {
    kind: ApiResourceKind.agent,
    org: ORG,
    slug,
    version,
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
  phase: RunPhase,
): Promise<string> {
  executionCounter += 1;
  const id = `aex_sessiontest_${executionCounter}`;
  const execution = create(RunSchema, {
    apiVersion: API_VERSION,
    kind: "Run",
    metadata: { id, name: `Execution ${executionCounter}`, org: ORG },
    spec: { target: { case: "sessionId", value: sessionId } },
    status: { phase },
  });
  await server.store.saveResource(
    ApiResourceKind.run,
    id,
    RunSchema,
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

describe("session create and update — the agent it names", () => {
  it("stores no agent_ref and no pin for the built-in assistant", async () => {
    const session = await createSession({});
    expect(session.spec?.agentRef).toBeUndefined();
    expect(session.status?.agentId ?? "").toBe("");
    expect(session.status?.agentVersionHash ?? "").toBe("");
    const fetched = await query.get({ value: session.metadata!.id });
    expect(fetched.spec?.agentRef).toBeUndefined();
    expect(fetched.status?.agentId ?? "").toBe("");
    await command.delete({ value: session.metadata!.id });
  });

  it("keeps the agent_ref as given and pins the agent's current version", async () => {
    const agent = await createAgent("Pinned agent");
    const session = await createSession({
      agentRef: agentRef(agent.metadata!.slug),
    });
    expect(session.spec?.agentRef?.slug).toBe(agent.metadata!.slug);
    expect(session.spec?.agentRef?.version).toBe("");
    expect(session.status?.agentId).toBe(agent.metadata!.id);
    expect(session.status?.agentVersionHash).toBe(
      agent.status?.versionHash ?? "",
    );
    expect(session.status?.agentVersionHash).not.toBe("");
    await command.delete({ value: session.metadata!.id });
  });

  it("lets a conversation gain an agent, change it and drop back to the assistant on update", async () => {
    const first = await createAgent("Gained agent");
    const second = await createAgent("Changed agent");
    const session = await createSession({});

    const withAgent = await command.update(
      updateInput(session, { agentRef: agentRef(first.metadata!.slug) }),
    );
    expect(withAgent.spec?.agentRef?.slug).toBe(first.metadata!.slug);
    expect(withAgent.status?.agentId).toBe(first.metadata!.id);

    const changed = await command.update(
      updateInput(withAgent, { agentRef: agentRef(second.metadata!.slug) }),
    );
    expect(changed.status?.agentId).toBe(second.metadata!.id);

    const dropped = await command.update(updateInput(changed, {}));
    expect(dropped.spec?.agentRef).toBeUndefined();
    expect(dropped.status?.agentId ?? "").toBe("");
    const fetched = await query.get({ value: session.metadata!.id });
    expect(fetched.status?.agentId ?? "").toBe("");

    await command.delete({ value: session.metadata!.id });
  });

  it("keeps the pin on an echo after the author saves, and moves it on latest, storing no version", async () => {
    const agent = await createAgent("Saved again agent");
    const session = await createSession({
      agentRef: agentRef(agent.metadata!.slug),
    });
    const firstHash = session.status!.agentVersionHash;

    const saved = await agentCommand.update({
      ...agent,
      spec: {
        ...agent.spec!,
        instructions: "You are the agent's second version.",
      },
    });
    const secondHash = saved.status?.versionHash ?? "";
    expect(secondHash).not.toBe("");
    expect(secondHash).not.toBe(firstHash);

    const echoed = await command.update(
      updateInput(session, {
        agentRef: agentRef(agent.metadata!.slug),
        subject: "echoed",
      }),
    );
    expect(echoed.status?.agentVersionHash).toBe(firstHash);

    const moved = await command.update(
      updateInput(echoed, {
        agentRef: agentRef(agent.metadata!.slug, "latest"),
        subject: "echoed",
      }),
    );
    expect(moved.status?.agentId).toBe(agent.metadata!.id);
    expect(moved.status?.agentVersionHash).toBe(secondHash);
    expect(moved.spec?.agentRef?.version).toBe("");
    const fetched = await query.get({ value: session.metadata!.id });
    expect(fetched.spec?.agentRef?.version).toBe("");
    expect(fetched.status?.agentVersionHash).toBe(secondHash);

    await command.delete({ value: session.metadata!.id });
  });
});

describe("session update — the reference rule", () => {
  async function expectRefusedAndUnchanged(
    session: Session,
    spec: Partial<Omit<SessionSpec, "$typeName">>,
    named: string,
  ): Promise<void> {
    const error = await grpcError(() =>
      command.update(updateInput(session, spec)),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toContain(named);
    const fetched = await query.get({ value: session.metadata!.id });
    expect(fetched.spec?.agentRef?.slug ?? "").toBe(
      session.spec?.agentRef?.slug ?? "",
    );
    expect(fetched.spec?.skillRefs ?? []).toEqual(
      session.spec?.skillRefs ?? [],
    );
    expect(fetched.status?.agentId ?? "").toBe(session.status?.agentId ?? "");
  }

  it("refuses repointing to an agent that does not exist", async () => {
    const agent = await createAgent("Kept by a refused update");
    const session = await createSession({
      agentRef: agentRef(agent.metadata!.slug),
    });
    await expectRefusedAndUnchanged(
      session,
      { agentRef: agentRef("no-such-agent") },
      "no-such-agent",
    );
    await command.delete({ value: session.metadata!.id });
  });

  it("refuses adding a skill that does not exist", async () => {
    const session = await createSession({});
    await expectRefusedAndUnchanged(
      session,
      {
        skillRefs: [
          create(ApiResourceReferenceSchema, {
            kind: ApiResourceKind.skill,
            org: ORG,
            slug: "no-such-skill",
          }),
        ],
      },
      "no-such-skill",
    );
    await command.delete({ value: session.metadata!.id });
  });

  it("refuses another organization's agent that is not platform-visible", async () => {
    const foreign = await agentCommand.create({
      apiVersion: API_VERSION,
      kind: "Agent",
      metadata: { name: "Foreign agent", org: OTHER_ORG },
      spec: { instructions: "You belong to another organization." },
    });
    const session = await createSession({});
    await expectRefusedAndUnchanged(
      session,
      {
        agentRef: create(ApiResourceReferenceSchema, {
          kind: ApiResourceKind.agent,
          org: OTHER_ORG,
          slug: foreign.metadata!.slug,
        }),
      },
      foreign.metadata!.slug,
    );
    await command.delete({ value: session.metadata!.id });
  });
});

describe("session update — references the stored row already carries", () => {
  it("passes an echo of a skill deleted since the session named it", async () => {
    const orgId = orgIds.get(ORG)!;
    await server.store.saveResource(
      ApiResourceKind.skill,
      "skl_session_echo",
      SkillSchema,
      create(SkillSchema, {
        apiVersion: API_VERSION,
        kind: "Skill",
        metadata: {
          id: "skl_session_echo",
          name: "echoed-skill",
          slug: "echoed-skill",
          org: orgId,
          visibility: ApiResourceVisibility.visibility_org,
        },
      }),
    );
    const skillRef = create(ApiResourceReferenceSchema, {
      kind: ApiResourceKind.skill,
      org: ORG,
      slug: "echoed-skill",
    });
    const session = await createSession({ skillRefs: [skillRef] });
    await server.store.deleteResource(
      ApiResourceKind.skill,
      "skl_session_echo",
    );

    const echoed = await command.update(
      updateInput(session, {
        skillRefs: [skillRef],
        harnessStateId: "thread-written-back",
      }),
    );
    expect(echoed.spec?.harnessStateId).toBe("thread-written-back");
    expect(echoed.spec?.skillRefs.map((ref) => ref.slug)).toEqual([
      "echoed-skill",
    ]);

    // The same missing skill, added by a write that did not carry it, is
    // refused.
    const fresh = await createSession({});
    const error = await grpcError(() =>
      command.update(updateInput(fresh, { skillRefs: [skillRef] })),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toContain("echoed-skill");

    await command.delete({ value: session.metadata!.id });
    await command.delete({ value: fresh.metadata!.id });
  });
});

describe("session listByAgent", () => {
  it("answers the sessions pinned to the agent, and none of another's", async () => {
    const listed = await createAgent("Listed agent");
    const other = await createAgent("Unlisted agent");
    const mine = await createSession({
      agentRef: agentRef(listed.metadata!.slug),
    });
    const theirs = await createSession({
      agentRef: agentRef(other.metadata!.slug),
    });
    const assistant = await createSession({});

    const page = await query.listByAgent({ agentId: listed.metadata!.id });
    expect(page.entries.map((s) => s.metadata?.id)).toEqual([
      mine.metadata!.id,
    ]);

    for (const session of [mine, theirs, assistant]) {
      await command.delete({ value: session.metadata!.id });
    }
  });

  it("refuses an empty agent_id as INVALID_ARGUMENT", async () => {
    const error = await grpcError(() => query.listByAgent({ agentId: "" }));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toContain("agent_id");
  });

  it("refuses an empty agent_id at the filter step too, before any read", async () => {
    // The chain's proto validation answers first; the step's own refusal
    // holds for any chain composed without it. The stand-in store has no
    // members, so a read would fail as something other than the refusal.
    const step = newFilterByAgentStep({} as Store, silentLogger, undefined);
    const ctx = new RequestContext(
      SessionQueryController.method.listByAgent.input,
      create(SessionQueryController.method.listByAgent.input, { agentId: "" }),
      testCallerIdentity(),
      ApiResourceKind.session,
    );
    const error = ConnectError.from(
      await Promise.resolve(step.execute(ctx)).then(
        () => undefined,
        (e: unknown) => e,
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe("agent_id is required");
  });
});

describe("session update — harness immutability", () => {
  it("allows a harness change while harness_state_id is empty (session not yet used)", async () => {
    const session = await createSession({
      harness: Harness.NATIVE,
    });

    const updated = await command.update(
      updateInput(session, {
        harness: Harness.CURSOR,
      }),
    );
    expect(updated.spec?.harness).toBe(Harness.CURSOR);
  });

  it("rejects a harness change after the first execution with the exact copy", async () => {
    const session = await createSession({
      harness: Harness.NATIVE,
    });
    await markSessionUsed(session.metadata!.id, "thread-1");

    const error = await grpcError(() =>
      command.update(
        updateInput(session, {
          harness: Harness.CURSOR,
        }),
      ),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(HARNESS_IMMUTABILITY_REFUSAL);
  });

  it("treats UNSPECIFIED as NATIVE: existing NATIVE + input UNSPECIFIED passes", async () => {
    const session = await createSession({
      harness: Harness.NATIVE,
    });
    await markSessionUsed(session.metadata!.id, "thread-3");

    const updated = await command.update(
      updateInput(session, {
        subject: "still native",
      }),
    );
    expect(updated.spec?.subject).toBe("still native");
  });

  it("an update naming no harness keeps a stored Cursor engine, before and after the first execution", async () => {
    const session = await createSession({ harness: Harness.CURSOR });

    const unused = await command.update(updateInput(session, { subject: "re-applied" }));
    expect(unused.spec?.harness).toBe(Harness.CURSOR);

    await markSessionUsed(session.metadata!.id, "thread-cursor");
    const used = await command.update(updateInput(session, { subject: "re-applied again" }));
    expect(used.spec?.harness).toBe(Harness.CURSOR);
  });

  it("treats UNSPECIFIED as NATIVE: existing UNSPECIFIED + input NATIVE passes; CURSOR is refused", async () => {
    const session = await createSession({});
    await markSessionUsed(session.metadata!.id, "thread-4");

    const updated = await command.update(
      updateInput(session, {
        harness: Harness.NATIVE,
      }),
    );
    expect(updated.spec?.harness).toBe(Harness.NATIVE);

    // Re-arm the sentinel (the passing update replaced the spec).
    await markSessionUsed(session.metadata!.id, "thread-4");
    const error = await grpcError(() =>
      command.update(
        updateInput(session, {
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
    const session = await createSession({});
    await markSessionUsed(session.metadata!.id, "thread-t1");

    const updated = await command.update(
      updateInput(session, { subject: "no move" }),
    );
    expect(updated.spec?.subject).toBe("no move");
  });

  it("passes unset→LOCAL on the local-default deployment (no dispatch change)", async () => {
    const session = await createSession({});
    await markSessionUsed(session.metadata!.id, "thread-t2");

    const updated = await command.update(
      updateInput(session, {
        executionTarget: ExecutionTarget.LOCAL,
      }),
    );
    expect(updated.spec?.executionTarget).toBe(ExecutionTarget.LOCAL);
  });

  it("refuses unset→CLOUD with the exact copy (Go enum names + the config default string)", async () => {
    const session = await createSession({});
    await markSessionUsed(session.metadata!.id, "thread-t3");

    const error = await grpcError(() =>
      command.update(
        updateInput(session, {
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
    const session = await createSession({});
    await markSessionUsed(session.metadata!.id, "hs-1");

    // Replace hs-1 with hs-2: the replaced id lands in the history.
    const first = await command.update(
      updateInput(session, {
        harnessStateId: "hs-2",
      }),
    );
    expect(first.spec?.harnessStateId).toBe("hs-2");
    expect(first.spec?.harnessStateIdHistory).toEqual(["hs-1"]);

    // Same id again, with client-forged history: no duplicate append and
    // the forged entry is discarded (server-owned field).
    const second = await command.update(
      updateInput(session, {
        harnessStateId: "hs-2",
        harnessStateIdHistory: ["client-forged"],
      }),
    );
    expect(second.spec?.harnessStateId).toBe("hs-2");
    expect(second.spec?.harnessStateIdHistory).toEqual(["hs-1"]);

    // A second replacement appends behind the first.
    const third = await command.update(
      updateInput(session, {
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
    const agent = await createAgent("Subject agent");
    const session = await createSession({
      agentRef: agentRef(agent.metadata!.slug),
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
    expect(updated.spec?.agentRef?.slug).toBe(agent.metadata!.slug);
    expect(updated.status?.agentId).toBe(agent.metadata!.id);
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
  const activePhases: ReadonlyArray<[string, RunPhase]> = [
    ["RUN_PENDING", RunPhase.RUN_PENDING],
    ["RUN_IN_PROGRESS", RunPhase.RUN_IN_PROGRESS],
    [
      "RUN_WAITING_FOR_APPROVAL",
      RunPhase.RUN_WAITING_FOR_APPROVAL,
    ],
    ["RUN_PAUSED", RunPhase.RUN_PAUSED],
  ];

  for (const [name, phase] of activePhases) {
    it(`blocks delete while an execution is ${name} (exact count copy)`, async () => {
      const session = await createSession({});
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
        ApiResourceKind.run,
        executionId,
      );
      await command.delete({ value: session.metadata!.id });
    });
  }

  it("terminal executions don't block; the cascade removes exactly the session's own executions", async () => {
    const doomed = await createSession({});
    const survivor = await createSession({});

    const completedId = await seedExecution(
      doomed.metadata!.id,
      RunPhase.RUN_COMPLETED,
    );
    const failedId = await seedExecution(
      doomed.metadata!.id,
      RunPhase.RUN_FAILED,
    );
    const survivorExecutionId = await seedExecution(
      survivor.metadata!.id,
      RunPhase.RUN_COMPLETED,
    );

    const deleted = await command.delete({ value: doomed.metadata!.id });
    expect(deleted.metadata?.id).toBe(doomed.metadata?.id);

    // The doomed session's executions are gone (children before parent)...
    await expect(
      server.store.getResource(
        ApiResourceKind.run,
        completedId,
        RunSchema,
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(
      server.store.getResource(
        ApiResourceKind.run,
        failedId,
        RunSchema,
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);

    // ...while the other session's execution is untouched.
    const untouched = await server.store.getResource(
      ApiResourceKind.run,
      survivorExecutionId,
      RunSchema,
    );
    expect(untouched.spec?.target).toEqual({
      case: "sessionId",
      value: survivor.metadata?.id,
    });

    await command.delete({ value: survivor.metadata!.id });
  });
});
