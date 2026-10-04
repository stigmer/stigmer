/**
 * Pins ResolveRunAgent (resolve-run-agent.ts) over a real SQLite store and
 * the real pipeline RequestContext:
 *   - a turn on a session bound to an agent records that agent's id and
 *     its head version hash;
 *   - the instance the default-instance step resolved wins over the
 *     session's (the agent_id request shape);
 *   - an agent with no recorded version records its id alone;
 *   - the built-in assistant (a session with no instance) records nothing;
 *   - a row that cannot be found, or a turn with no session, records
 *     nothing and leaves the refusal to the context build that follows;
 *   - a failing store is Internal.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { LIST_INDEXES } from "../../../boot/list-indexes.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";

import { DEFAULT_INSTANCE_ID_KEY } from "../create-steps.js";
import { newResolveRunAgentStep } from "../resolve-run-agent.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const HASH = "c".repeat(64);

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "resolve-run-agent-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, {
    listIndexes: LIST_INDEXES,
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function seedAgent(id: string, versionHash: string): Promise<void> {
  await store.saveResource(
    ApiResourceKind.agent,
    id,
    AgentSchema,
    create(AgentSchema, {
      metadata: { id, org: "test-org", slug: id },
      status: { versionHash },
    }),
  );
}

async function seedInstance(id: string, agentId: string): Promise<void> {
  await store.saveResource(
    ApiResourceKind.agent_instance,
    id,
    AgentInstanceSchema,
    create(AgentInstanceSchema, {
      metadata: { id, org: "test-org", slug: id },
      spec: { agentId },
    }),
  );
}

async function seedSession(id: string, agentInstanceId: string): Promise<void> {
  await store.saveResource(
    ApiResourceKind.session,
    id,
    SessionSchema,
    create(SessionSchema, {
      metadata: { id, org: "test-org", slug: id },
      spec: { agentInstanceId },
    }),
  );
}

async function stampFor(
  sessionId: string,
  preResolvedInstanceId?: string,
): Promise<AgentExecution> {
  const ctx = new RequestContext(
    AgentExecutionSchema,
    create(AgentExecutionSchema, {
      metadata: { name: "exec", org: "test-org" },
      spec: { sessionId, message: "hi" },
    }),
    testCallerIdentity(),
    ApiResourceKind.agent_execution,
  );
  if (preResolvedInstanceId !== undefined) {
    ctx.set(DEFAULT_INSTANCE_ID_KEY, preResolvedInstanceId);
  }
  await newResolveRunAgentStep(store, silentLogger).execute(ctx);
  return ctx.newState;
}

describe("ResolveRunAgent", () => {
  it("records the session's agent and its head version", async () => {
    await seedAgent("agt_1", HASH);
    await seedInstance("agi_1", "agt_1");
    await seedSession("ses_1", "agi_1");

    const execution = await stampFor("ses_1");

    expect(execution.status?.agentId).toBe("agt_1");
    expect(execution.status?.agentVersionHash).toBe(HASH);
  });

  it("takes the instance the default-instance step resolved over the session's", async () => {
    await seedAgent("agt_a", HASH);
    await seedAgent("agt_b", "d".repeat(64));
    await seedInstance("agi_a", "agt_a");
    await seedInstance("agi_b", "agt_b");
    await seedSession("ses_2", "agi_b");

    const execution = await stampFor("ses_2", "agi_a");

    expect(execution.status?.agentId).toBe("agt_a");
  });

  it("records an agent with no version by its id alone", async () => {
    await seedAgent("agt_old", "");
    await seedInstance("agi_old", "agt_old");
    await seedSession("ses_3", "agi_old");

    const execution = await stampFor("ses_3");

    expect(execution.status?.agentId).toBe("agt_old");
    expect(execution.status?.agentVersionHash).toBe("");
  });

  it("records nothing for the built-in assistant", async () => {
    await seedSession("ses_4", "");

    const execution = await stampFor("ses_4");

    expect(execution.status?.agentId ?? "").toBe("");
    expect(execution.status?.agentVersionHash ?? "").toBe("");
  });

  it("records nothing when a row is missing, leaving the refusal to the context build", async () => {
    await seedSession("ses_5", "agi_missing");
    expect((await stampFor("ses_5")).status?.agentId ?? "").toBe("");

    await seedInstance("agi_orphan", "agt_gone");
    await seedSession("ses_6", "agi_orphan");
    expect((await stampFor("ses_6")).status?.agentId ?? "").toBe("");
  });

  it("records nothing for a turn with neither a resolved instance nor a session", async () => {
    expect((await stampFor("")).status?.agentId ?? "").toBe("");
  });

  it("is Internal when the store fails, never a turn on an unrecorded agent", async () => {
    const failing = {
      getResource: async () => {
        throw new Error("store is down");
      },
    } as unknown as Store;
    const ctx = new RequestContext(
      AgentExecutionSchema,
      create(AgentExecutionSchema, {
        metadata: { name: "exec", org: "test-org" },
        spec: { sessionId: "ses_any", message: "hi" },
      }),
      testCallerIdentity(),
      ApiResourceKind.agent_execution,
    );

    const error = await Promise.resolve(newResolveRunAgentStep(failing, silentLogger).execute(ctx)).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Internal);
  });
});
