/**
 * Pins ResolveRunAgent (resolve-run-agent.ts) over a real SQLite store and
 * the real pipeline RequestContext.
 *
 * The create step:
 *   - a turn in an existing session takes the session's pin from the row
 *     ValidateSessionOrganization recorded (STORED_SESSION_KEY), never the
 *     agent's current version, and reads nothing else about the session;
 *   - a pinned agent since deleted refuses with FAILED_PRECONDITION naming
 *     the session and the agent;
 *   - a new conversation resolves session_spec.agent_ref through the ids
 *     ValidateReferences recorded (RESOLVED_REFERENCE_TARGETS_KEY): its
 *     current version, a live tag, and a refusal for a version the agent
 *     does not hold; a reference with no recorded targets is a chain built
 *     out of order (Internal);
 *   - the stamp is written even when empty (the built-in assistant, in a
 *     new conversation or a session pinning no agent), so nothing left in
 *     status survives it;
 *   - a session id that names no row stamps nothing (the loading steps own
 *     that refusal);
 *   - a store fault is Internal.
 *
 * The recover twins (newResolveRecoveredRunAgentStep, then
 * newStampRecoveredRunAgentStep):
 *   - a turn with no stamp records its session's pin, persisted on its row
 *     and handed on as the loaded execution;
 *   - a turn that recorded an agent, one naming no session, a session
 *     pinning none, and a skipped recover are left as they are;
 *   - running before the execution was loaded is Internal; a turn row gone
 *     before the stamp is written is NotFound, a failing write Internal.
 * And recover's AuthorizeRunAgent asks agent#can_execute on the turn's
 * stamp, or on the pin held for a turn that recorded none, before
 * anything is written; the built-in assistant and a skipped recover ask
 * nothing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RecoverRunInputSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import type { RunSpec } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import { LIST_INDEXES } from "../../../boot/list-indexes.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import {
  LOADED_EXECUTION_KEY,
  RequestContext,
} from "../../../pipeline/request-context.js";
import {
  loadReferenceTargets,
  RESOLVED_REFERENCE_TARGETS_KEY,
} from "../../../pipeline/steps/references.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";

import { sessionAgentGoneMessage } from "../constants.js";
import {
  newAuthorizeRecoveredRunAgentStep,
  newResolveRecoveredRunAgentStep,
  newResolveRunAgentStep,
  newStampRecoveredRunAgentStep,
} from "../resolve-run-agent.js";
import { STORED_SESSION_KEY } from "../session-binding.js";

/** Every caller may run every agent: the run gate is not this step's question. */
const ALLOW: Authorizer = {
  authorize: () => Promise.resolve({ kind: "allow" }),
};
const DENY: Authorizer = {
  authorize: () => Promise.resolve({ kind: "deny", reason: "" }),
};

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const HEAD = "c".repeat(64);
const PINNED = "d".repeat(64);

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

async function seedAgent(
  id: string,
  versionHash: string,
  tag = "",
): Promise<void> {
  await store.saveResource(
    ApiResourceKind.agent,
    id,
    AgentSchema,
    create(AgentSchema, {
      metadata: { id, org: "test-org", slug: id, version: { tag } },
      status: { versionHash },
    }),
  );
}

function pinnedSession(
  id: string,
  agentId: string,
  agentVersionHash: string,
): Session {
  return create(SessionSchema, {
    metadata: { id, org: "test-org", slug: id },
    spec:
      agentId === "" ? {} : { agentRef: { org: "test-org", slug: agentId } },
    status: { agentId, agentVersionHash },
  });
}

async function seedSession(session: Session): Promise<void> {
  const id = session.metadata?.id ?? "";
  await store.saveResource(ApiResourceKind.session, id, SessionSchema, session);
}

function turnContext(
  target: RunSpec["target"],
): RequestContext<typeof RunSchema> {
  return new RequestContext(
    RunSchema,
    create(RunSchema, {
      metadata: { name: "exec", org: "test-org" },
      spec: { target, message: "hi" },
    }),
    testCallerIdentity(),
    ApiResourceKind.run,
  );
}

/** A turn in an existing session, with the row ValidateSessionOrganization recorded. */
async function stampInSession(
  sessionId: string,
  stored: Session | undefined,
  run: Store = store,
): Promise<Run> {
  const ctx = turnContext({ case: "sessionId", value: sessionId });
  if (stored !== undefined) {
    ctx.set(STORED_SESSION_KEY, stored);
  }
  await newResolveRunAgentStep(run, silentLogger, ALLOW).execute(ctx);
  return ctx.newState;
}

/** A new conversation on org/slug@version, with the targets ValidateReferences recorded. */
async function stampNewConversation(
  slug: string,
  version: string,
  recordTargets = true,
  authorizer: Authorizer = ALLOW,
): Promise<Run> {
  const ref = { kind: ApiResourceKind.agent, org: "test-org", slug, version };
  const ctx = turnContext({
    case: "sessionSpec",
    value: create(SessionSpecSchema, { agentRef: ref }),
  });
  if (recordTargets) {
    ctx.set(
      RESOLVED_REFERENCE_TARGETS_KEY,
      await loadReferenceTargets(store, [ref], "test-org"),
    );
  }
  await newResolveRunAgentStep(store, silentLogger, authorizer).execute(ctx);
  return ctx.newState;
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectError);
  return error as ConnectError;
}

describe("ResolveRunAgent (create)", () => {
  it("takes the session's pin, not the agent's current version", async () => {
    await seedAgent("agt_1", HEAD);
    const session = pinnedSession("ses_1", "agt_1", PINNED);

    const execution = await stampInSession("ses_1", session);

    expect(execution.status?.agentId).toBe("agt_1");
    expect(execution.status?.agentVersionHash).toBe(PINNED);
  });

  it("reads the recorded session, never the stored row", async () => {
    await seedAgent("agt_recorded", HEAD);
    await seedAgent("agt_stored", HEAD);
    await seedSession(pinnedSession("ses_1", "agt_stored", HEAD));

    const execution = await stampInSession(
      "ses_1",
      pinnedSession("ses_1", "agt_recorded", PINNED),
    );

    expect(execution.status?.agentId).toBe("agt_recorded");
  });

  it("refuses a turn whose session pins an agent since deleted, naming both", async () => {
    const error = await refusal(
      stampInSession("ses_gone", pinnedSession("ses_gone", "agt_gone", HEAD)),
    );

    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(
      sessionAgentGoneMessage("ses_gone", "agt_gone"),
    );
  });

  it("stamps an empty agent for a session pinning none, over anything left in status", async () => {
    const ctx = turnContext({ case: "sessionId", value: "ses_4" });
    ctx.set(STORED_SESSION_KEY, pinnedSession("ses_4", "", ""));
    ctx.newState.status = create(RunStatusSchema, {
      agentId: "agt_forged",
      agentVersionHash: HEAD,
    });

    await newResolveRunAgentStep(store, silentLogger, ALLOW).execute(ctx);

    expect(ctx.newState.status?.agentId).toBe("");
    expect(ctx.newState.status?.agentVersionHash).toBe("");
  });

  it("stamps nothing for a session id that names no row", async () => {
    const execution = await stampInSession("ses_missing", undefined);

    expect(execution.status).toBeUndefined();
  });

  it("resolves a new conversation's agent_ref to the agent's current version", async () => {
    await seedAgent("agt_new", HEAD);

    for (const version of ["", "latest"]) {
      const execution = await stampNewConversation("agt_new", version);
      expect(execution.status?.agentId).toBe("agt_new");
      expect(execution.status?.agentVersionHash).toBe(HEAD);
    }
  });

  it("resolves a new conversation's live tag to the version it names", async () => {
    await seedAgent("agt_tagged", HEAD, "v2");

    const execution = await stampNewConversation("agt_tagged", "v2");

    expect(execution.status?.agentVersionHash).toBe(HEAD);
  });

  it("refuses a new conversation naming a version the agent does not hold", async () => {
    await seedAgent("agt_v", HEAD);

    const error = await refusal(stampNewConversation("agt_v", "no-such-tag"));

    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toContain("'test-org/agt_v'");
    expect(error.rawMessage).toContain("'no-such-tag'");
  });

  it("answers a caller who may not run the agent with the run gate's denial, not the version miss", async () => {
    await seedAgent("agt_v", HEAD);

    const error = await refusal(
      stampNewConversation("agt_v", "no-such-tag", true, DENY),
    );

    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe("unauthorized to run agent 'agt_v'");
  });

  it("is Internal when the reference rule recorded no targets", async () => {
    await seedAgent("agt_unrecorded", HEAD);

    const error = await refusal(
      stampNewConversation("agt_unrecorded", "", false),
    );

    expect(error.code).toBe(Code.Internal);
  });

  it("stamps an empty agent for a new conversation with the built-in assistant", async () => {
    const ctx = turnContext({ case: undefined });
    ctx.newState.status = create(RunStatusSchema, {
      agentId: "agt_forged",
    });

    await newResolveRunAgentStep(store, silentLogger, ALLOW).execute(ctx);

    expect(ctx.newState.status?.agentId).toBe("");
    expect(ctx.newState.status?.agentVersionHash).toBe("");
  });

  it("is Internal when the store fails, never a turn on an unchecked agent", async () => {
    const failing = {
      getResource: async () => {
        throw new Error("store is down");
      },
    } as unknown as Store;

    const error = await refusal(
      stampInSession(
        "ses_any",
        pinnedSession("ses_any", "agt_any", HEAD),
        failing,
      ),
    );

    expect(error.code).toBe(Code.Internal);
  });
});

describe("ResolveRunAgent (recover)", () => {
  async function seedTurn(
    id: string,
    sessionId: string,
    agentId = "",
  ): Promise<Run> {
    const turn = create(RunSchema, {
      metadata: { id, org: "test-org", slug: id },
      spec: { target: { case: "sessionId", value: sessionId } },
      status: { agentId },
    });
    await store.saveResource(
      ApiResourceKind.run,
      id,
      RunSchema,
      turn,
    );
    return turn;
  }

  async function recover(
    loaded: Run | undefined,
    skip = false,
    run: Store = store,
  ): Promise<RequestContext<typeof RecoverRunInputSchema>> {
    const ctx = new RequestContext(
      RecoverRunInputSchema,
      create(RecoverRunInputSchema, {
        id: loaded?.metadata?.id ?? "aex_none",
      }),
      testCallerIdentity(),
      ApiResourceKind.run,
    );
    if (loaded !== undefined) {
      ctx.set(LOADED_EXECUTION_KEY, loaded);
    }
    await newResolveRecoveredRunAgentStep(run, () => skip).execute(ctx);
    await newStampRecoveredRunAgentStep(run, silentLogger, () => skip).execute(
      ctx,
    );
    return ctx;
  }

  async function storedTurn(id: string): Promise<Run> {
    return store.getResource(
      ApiResourceKind.run,
      id,
      RunSchema,
    );
  }

  it("records the session's pin on a turn with no stamp, persisted and handed on", async () => {
    await seedSession(pinnedSession("ses_r", "agt_r", PINNED));
    const turn = await seedTurn("aex_r", "ses_r");

    const ctx = await recover(turn);

    const persisted = await storedTurn("aex_r");
    expect(persisted.status?.agentId).toBe("agt_r");
    expect(persisted.status?.agentVersionHash).toBe(PINNED);
    const handedOn = ctx.get(LOADED_EXECUTION_KEY) as Run;
    expect(handedOn.status?.agentId).toBe("agt_r");
    expect(handedOn.status?.agentVersionHash).toBe(PINNED);
  });

  it("leaves a turn that recorded its agent as it is", async () => {
    await seedSession(pinnedSession("ses_moved", "agt_now", HEAD));
    const turn = await seedTurn("aex_stamped", "ses_moved", "agt_then");

    const ctx = await recover(turn);

    expect((await storedTurn("aex_stamped")).status?.agentId).toBe("agt_then");
    expect(ctx.get(LOADED_EXECUTION_KEY)).toBe(turn);
  });

  it("leaves a turn whose session pins no agent as it is", async () => {
    await seedSession(pinnedSession("ses_builtin", "", ""));
    const turn = await seedTurn("aex_builtin", "ses_builtin");

    await recover(turn);

    expect((await storedTurn("aex_builtin")).status?.agentId ?? "").toBe("");
  });

  it("leaves a turn that names no session as it is: there is no pin to record", async () => {
    const turn = create(RunSchema, {
      metadata: {
        id: "aex_no_session",
        org: "test-org",
        slug: "aex_no_session",
      },
      spec: {},
    });
    await store.saveResource(
      ApiResourceKind.run,
      "aex_no_session",
      RunSchema,
      turn,
    );

    const ctx = await recover(turn);

    expect((await storedTurn("aex_no_session")).status?.agentId ?? "").toBe("");
    expect(ctx.get(LOADED_EXECUTION_KEY)).toBe(turn);
  });

  it("does nothing when the recover is skipped", async () => {
    await seedSession(pinnedSession("ses_skip", "agt_skip", HEAD));
    const turn = await seedTurn("aex_skip", "ses_skip");

    await recover(turn, true);

    expect((await storedTurn("aex_skip")).status?.agentId ?? "").toBe("");
  });

  it("asks about the session's pin for a turn that recorded none, and a refusal writes nothing", async () => {
    await seedSession(pinnedSession("ses_gated", "agt_gated", PINNED));
    const turn = await seedTurn("aex_gated", "ses_gated");
    const ctx = new RequestContext(
      RecoverRunInputSchema,
      create(RecoverRunInputSchema, { id: "aex_gated" }),
      testCallerIdentity(),
      ApiResourceKind.run,
    );
    ctx.set(LOADED_EXECUTION_KEY, turn);
    await newResolveRecoveredRunAgentStep(store, () => false).execute(ctx);

    const error = await refusal(
      newAuthorizeRecoveredRunAgentStep(DENY, () => false).execute(
        ctx,
      ) as Promise<void>,
    );

    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe("unauthorized to run agent 'agt_gated'");
    expect((await storedTurn("aex_gated")).status?.agentId ?? "").toBe("");
    expect(ctx.get(LOADED_EXECUTION_KEY)).toBe(turn);
  });

  it("is Internal when it runs before the execution was loaded", async () => {
    const error = await refusal(recover(undefined));

    expect(error.code).toBe(Code.Internal);
  });

  it("is NotFound when the turn's row is gone before the stamp is written", async () => {
    await seedSession(pinnedSession("ses_gone", "agt_gone", HEAD));
    const turn = create(RunSchema, {
      metadata: { id: "aex_gone", org: "test-org", slug: "aex_gone" },
      spec: { target: { case: "sessionId", value: "ses_gone" } },
    });

    const error = await refusal(recover(turn));

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toContain("aex_gone");
  });

  it("is Internal when the stamp cannot be written", async () => {
    await seedSession(pinnedSession("ses_down", "agt_down", HEAD));
    const turn = await seedTurn("aex_down", "ses_down");
    const failing: Store = new Proxy(store, {
      get(target, property, receiver) {
        if (property === "updateResource") {
          return () => Promise.reject(new Error("store is down"));
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    const error = await refusal(recover(turn, false, failing));

    expect(error.code).toBe(Code.Internal);
    expect((await storedTurn("aex_down")).status?.agentId ?? "").toBe("");
  });
});

describe("AuthorizeRunAgent (recover)", () => {
  function recoverContext(
    loaded: Run,
  ): RequestContext<typeof RecoverRunInputSchema> {
    const ctx = new RequestContext(
      RecoverRunInputSchema,
      create(RecoverRunInputSchema, {
        id: loaded.metadata?.id ?? "",
      }),
      testCallerIdentity(),
      ApiResourceKind.run,
    );
    ctx.set(LOADED_EXECUTION_KEY, loaded);
    return ctx;
  }

  function turnRunning(agentId: string): Run {
    return create(RunSchema, {
      metadata: { id: "aex_rerun", org: "test-org" },
      status: { agentId, agentVersionHash: HEAD },
    });
  }

  it("refuses a rerun by a caller who may no longer run the turn's agent", async () => {
    const error = await refusal(
      newAuthorizeRecoveredRunAgentStep(DENY, () => false).execute(
        recoverContext(turnRunning("agt_gated")),
      ) as Promise<void>,
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe("unauthorized to run agent 'agt_gated'");
  });

  it("admits a caller who may run it", async () => {
    await newAuthorizeRecoveredRunAgentStep(ALLOW, () => false).execute(
      recoverContext(turnRunning("agt_gated")),
    );
  });

  it("asks nothing for a turn of the built-in assistant, or a skipped recover", async () => {
    const untouched: Authorizer = {
      authorize: () => Promise.reject(new Error("must not be asked")),
    };
    await newAuthorizeRecoveredRunAgentStep(untouched, () => false).execute(
      recoverContext(turnRunning("")),
    );
    await newAuthorizeRecoveredRunAgentStep(untouched, () => true).execute(
      recoverContext(turnRunning("agt_gated")),
    );
  });
});
