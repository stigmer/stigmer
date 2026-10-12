/**
 * Pins how the agent eval's shared read and the agent-delete cascade
 * answer when something under them fails, over a real store opened with
 * the server's list indexes:
 *   - an eval row that does not decode is skipped and logged, so one bad
 *     record never takes an agent's evals down, and another agent's eval
 *     is never answered;
 *   - the cascade does nothing in a composition that serves no evals,
 *     fails loudly when the chain never loaded the agent, answers a store
 *     fault listing or deleting an eval INTERNAL, naming the eval and the
 *     agent, and otherwise removes each eval with its tries and its access;
 *   - the eval's vault attachers are read from and written onto its
 *     status, the one place the attachments step keeps them.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Logger } from "../../../boot/logger.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type {
  ResourceAuthorizationLifecycle,
  ResourceDeletedEvent,
} from "../../../extensions/resource-authorization.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import type { Store } from "../../../store/interface.js";
import type { ListIndexRow } from "../../../store/list-index.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { PLUGIN_EVAL_LABEL } from "../../plugin-eval/constants.js";
import type { TrySessionDeleter } from "../../plugin-eval/tries.js";
import { newCascadeDeleteAgentEvalsStep } from "../cascade.js";
import { listAgentEvals } from "../queries.js";
import { AGENT_EVAL_VAULT_ATTACHMENTS } from "../vault-attachments.js";

const ORG = "org_1";
const AGENT_ID = "agt_1";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

interface LoggedLine {
  readonly level: string;
  readonly message: string;
  readonly [field: string]: unknown;
}

function recordingLogger(): { logger: Logger; lines: LoggedLine[] } {
  const lines: LoggedLine[] = [];
  return {
    lines,
    logger: createLogger({
      level: "warn",
      pretty: false,
      write: (line) => lines.push(JSON.parse(line) as LoggedLine),
    }),
  };
}

async function saveEval(id: string, phase: PluginEvalPhase, agentId = AGENT_ID): Promise<AgentEval> {
  const row = create(AgentEvalSchema, {
    metadata: { id, name: id, org: ORG },
    spec: { agentId },
    status: { phase },
  });
  await temp.store.saveResource(ApiResourceKind.agent_eval, id, AgentEvalSchema, row);
  return row;
}

async function saveTry(id: string, evalId: string): Promise<void> {
  await temp.store.saveResource(
    ApiResourceKind.session,
    id,
    SessionSchema,
    create(SessionSchema, { metadata: { id, name: id, org: ORG, labels: { [PLUGIN_EVAL_LABEL]: evalId } } }),
  );
}

async function exists(kind: ApiResourceKind.agent_eval | ApiResourceKind.session, id: string): Promise<boolean> {
  const read =
    kind === ApiResourceKind.agent_eval
      ? temp.store.getResource(kind, id, AgentEvalSchema)
      : temp.store.getResource(kind, id, SessionSchema);
  return read.then(
    () => true,
    () => false,
  );
}

/** The store, with an undecodable row put first in every query's answer. */
function withBadRow(id: string): Store {
  return new Proxy(temp.store, {
    get(target, property, receiver) {
      if (property === "queryResources") {
        return async (...args: Parameters<Store["queryResources"]>) => {
          const rows: ListIndexRow[] = await target.queryResources(...args);
          const bad: ListIndexRow = { id, data: new Uint8Array([0xff, 0xff, 0xff]), cursor: { createdAt: "", id } };
          return [bad, ...rows];
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function storeFailing(method: keyof Store): Store {
  return new Proxy(temp.store, {
    get(target, property, receiver) {
      if (property === method) {
        return () => Promise.reject(new Error("disk unavailable"));
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** A lifecycle that records each deleted resource's cleanup. */
function lifecycle(): ResourceAuthorizationLifecycle & { cleaned: string[] } {
  const cleaned: string[] = [];
  return {
    cleaned,
    onResourceCreated: () => Promise.resolve(),
    onResourceDeleted: (event: ResourceDeletedEvent) => {
      cleaned.push(`${ApiResourceKind[event.kind]} ${event.resourceId} ${event.orgId}`);
      return Promise.resolve();
    },
    onVisibilityChanged: () => Promise.resolve(),
  };
}

/** The session domain's delete, as the cascade reaches it. */
function sessionDeleter(store: Store): TrySessionDeleter & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    delete: async (id) => {
      deleted.push(id);
      await store.deleteResource(ApiResourceKind.session, id);
    },
  };
}

async function failure(run: () => unknown): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a failure");
}

describe("the shared read", () => {
  it("skips and logs an agent eval row that does not decode, and keeps only the agent's evals", async () => {
    await saveEval("aev_a", PluginEvalPhase.completed);
    await saveEval("aev_other", PluginEvalPhase.completed, "agt_2");
    const { logger, lines } = recordingLogger();

    const evals = await listAgentEvals(withBadRow("aev_bad"), logger, AGENT_ID);

    expect(evals.map((row) => row.metadata?.id)).toEqual(["aev_a"]);
    expect(lines).toEqual([
      expect.objectContaining({
        level: "warn",
        message: "skipped an agent eval row that does not decode",
        evalId: "aev_bad",
        agentId: AGENT_ID,
      }),
    ]);
  });
});

describe("the agent-delete cascade", () => {
  type AgentDelete = typeof AgentCommandController.method.delete.input;

  function deleteCtx(loaded = true): RequestContext<AgentDelete> {
    const input = AgentCommandController.method.delete.input;
    const ctx = new RequestContext(input, create(input, { value: AGENT_ID }), testCallerIdentity(), ApiResourceKind.agent);
    if (loaded) {
      ctx.set(EXISTING_RESOURCE_KEY, create(AgentSchema, { metadata: { id: AGENT_ID, org: ORG } }));
    }
    return ctx;
  }

  function deps(store: Store, access?: ResourceAuthorizationLifecycle) {
    const sessions = sessionDeleter(store);
    return { store, logger: silentLogger, authorizationLifecycle: access, sessions: () => sessions };
  }

  it("does nothing in a composition that serves no evals", async () => {
    await saveEval("aev_a", PluginEvalPhase.running);
    await newCascadeDeleteAgentEvalsStep<AgentDelete>(undefined).execute(deleteCtx(false));
    expect(await exists(ApiResourceKind.agent_eval, "aev_a")).toBe(true);
  });

  it("fails loudly when the chain never loaded the agent", async () => {
    const fault = await failure(() => newCascadeDeleteAgentEvalsStep<AgentDelete>(deps(temp.store)).execute(deleteCtx(false)));
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("agent not found in context (LoadExistingForDelete must run first)");
  });

  it("answers a store fault listing the agent's evals INTERNAL", async () => {
    const fault = await failure(() =>
      newCascadeDeleteAgentEvalsStep<AgentDelete>(deps(storeFailing("queryResources"))).execute(deleteCtx()),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to list the agent's evals for cascade delete");
  });

  it("answers a store fault deleting an eval INTERNAL, naming the eval and the agent", async () => {
    await saveEval("aev_a", PluginEvalPhase.completed);
    const fault = await failure(() =>
      newCascadeDeleteAgentEvalsStep<AgentDelete>(deps(storeFailing("deleteResource"))).execute(deleteCtx()),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe(`failed to cascade-delete agent eval aev_a of agent ${AGENT_ID}`);
  });

  it("removes each eval with its tries and its access, and leaves another agent's", async () => {
    await saveEval("aev_a", PluginEvalPhase.completed);
    await saveEval("aev_b", PluginEvalPhase.failed);
    await saveEval("aev_other", PluginEvalPhase.completed, "agt_2");
    await saveTry("ses_a", "aev_a");
    const access = lifecycle();
    const wired = deps(temp.store, access);

    await newCascadeDeleteAgentEvalsStep<AgentDelete>(wired).execute(deleteCtx());

    expect(await exists(ApiResourceKind.agent_eval, "aev_a")).toBe(false);
    expect(await exists(ApiResourceKind.agent_eval, "aev_b")).toBe(false);
    expect(await exists(ApiResourceKind.agent_eval, "aev_other")).toBe(true);
    expect(await exists(ApiResourceKind.session, "ses_a")).toBe(false);
    expect(wired.sessions().deleted).toEqual(["ses_a"]);
    expect(access.cleaned.sort()).toEqual([`agent_eval aev_a ${ORG}`, `agent_eval aev_b ${ORG}`]);
  });
});

describe("the eval's vault attachers", () => {
  it("are read from and written onto the eval's status", () => {
    const row = create(AgentEvalSchema, {});
    expect(AGENT_EVAL_VAULT_ATTACHMENTS.attachers.get(row)).toBeUndefined();

    AGENT_EVAL_VAULT_ATTACHMENTS.attachers.set(row, { vlt_1: "ida_creator" });

    expect(row.status?.vaultAttachers).toEqual({ vlt_1: "ida_creator" });
    expect(AGENT_EVAL_VAULT_ATTACHMENTS.attachers.get(row)).toEqual({ vlt_1: "ida_creator" });
    expect(AGENT_EVAL_VAULT_ATTACHMENTS.allowsOwnersMyVault).toBe(false);
  });
});
