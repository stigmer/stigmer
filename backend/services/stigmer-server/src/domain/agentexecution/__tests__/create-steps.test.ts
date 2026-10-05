/**
 * Create pipeline step tests — ports create_session_bootstrap_test.go,
 * compose_declared_preferences_step_test.go,
 * compose_recalled_memories_step_test.go, and
 * create_execution_context_workflow_refs_test.go case-for-case, over a
 * real SQLite store and the real pipeline RequestContext (the same
 * direct-step shape as Go). Go's nil-client skip proofs map to throwing
 * providers — reaching the client would fail the test just as a nil
 * dereference would panic Go.
 *
 * CreateSessionIfNeeded forwards the caller's session_spec (its agent_ref
 * included), points the turn at the created session through the target
 * oneof and re-takes the turn's agent stamp from that session's pin. The
 * compose steps write their snapshots to status, over anything a caller
 * left there. StartWorkflow feeds the workflow input its agent from the
 * stamp, its callback token and signal target from the vouched parent
 * link, and its queue from the link's workflow run (that run's wfexec
 * queue under execution routing, none under global routing), never from
 * the request.
 *
 * The two compose steps are also pinned where callers are persons
 * (stigmer#1387, stigmer#1397): recall is the run's person's own
 * confirmed facts, behind the first-party gate, the org switch and the
 * person's own, and user_context is that person's standing context — the
 * retired Java steps' gates, in their order. The organization's half is
 * pinned against the composed visitor classifier (stigmer/stigmer#1401):
 * every lane keeps it but a visitor, whose run never reads the
 * organization, and a classifier that throws withholds it.
 */
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type { VisitorClassifier } from "../../../extensions/visitor-classifier.js";
import type { AccountsByCaller } from "../../identityaccount/resolve.js";
import { fakeIdentityAccountStore } from "../../identityaccount/__tests__/support.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, clone, toJson } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { JsonObject } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  DeclaredPreferencesSchema,
  RecalledMemoriesSchema,
  WorkflowParentSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryLifecycleState } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/enum_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { SessionSpec } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { SessionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/status_pb";
import {
  ExecutionTarget,
  Harness,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { createLogger } from "../../../boot/logger.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { LIST_INDEXES } from "../../../boot/list-indexes.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";

import { agentCallTaskEnvironmentRefs } from "../create-execution-context-step.js";
import {
  AUTO_CREATED_SESSION_SUBJECT,
  CREATED_SESSION_ID_KEY,
  buildAutoCreateSessionSpec,
  newComposeDeclaredPreferencesStep,
  newComposeRecalledMemoriesStep,
  newCreateSessionIfNeededStep,
  newStartWorkflowStep,
} from "../create-steps.js";
import type { SessionCreatorProvider } from "../create-steps.js";
import type { AgentExecutionStatusTransition } from "../../../extensions/status-hooks.js";
import type {
  ExecutionEngineState,
  StartInvokeWorkflowInput,
} from "../engine.js";
import {
  WORKFLOW_ROUTING_EXECUTION,
  WORKFLOW_ROUTING_GLOBAL,
  WorkflowExecutionTemporalConfig,
} from "../../workflowexecution/temporal/config.js";
import { newWorkflowRunQueue } from "../../../temporal/workflowexecution/dispatch.js";
import { formatWfExecTaskQueue } from "../../../temporal/workflowexecution/names.js";
import { stubConnectedEngine } from "./engine-stub.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let dir: string;
let store: Store;

/** A workflow-execution config under the given activity routing. */
function routing(workflowActivityRouting: string): WorkflowExecutionTemporalConfig {
  return new WorkflowExecutionTemporalConfig(
    "workflow_execution_stigmer",
    "stigmer_runner",
    workflowActivityRouting,
    "local",
  );
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aexec-create-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, {
    listIndexes: LIST_INDEXES,
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function newExecution(sessionId: string): AgentExecution {
  return create(AgentExecutionSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "AgentExecution",
    metadata: { name: "exec", org: "test-org" },
    spec: {
      target:
        sessionId === ""
          ? { case: undefined }
          : { case: "sessionId", value: sessionId },
      message: "hi",
    },
  });
}

function newContext(
  execution: AgentExecution,
  caller: CallerIdentity = testCallerIdentity(),
): RequestContext<typeof AgentExecutionSchema> {
  return new RequestContext(
    AgentExecutionSchema,
    execution,
    caller,
    ApiResourceKind.agent_execution,
  );
}

async function expectCode(
  fn: () => Promise<unknown> | unknown,
  code: Code,
): Promise<ConnectError> {
  try {
    await fn();
  } catch (error) {
    const connectError = ConnectError.from(error);
    expect(connectError.code).toBe(code);
    return connectError;
  }
  throw new Error(`expected code ${Code[code]}, call succeeded`);
}

/**
 * A session creator that records the session it was asked for and answers
 * it under `id` with the pin a session chain would have written.
 */
function recordingSessionCreator(
  id: string,
  pin: { agentId: string; agentVersionHash: string } = {
    agentId: "",
    agentVersionHash: "",
  },
): { creator: SessionCreatorProvider; created: () => Session | undefined } {
  let created: Session | undefined;
  return {
    creator: () => ({
      createAsCaller: async (session) => {
        created = clone(SessionSchema, session);
        const answered = clone(SessionSchema, session);
        answered.metadata!.id = id;
        answered.status = create(SessionStatusSchema, pin);
        return answered;
      },
    }),
    created: () => created,
  };
}

// The built-in assistant's shape through CreateSessionIfNeeded: an
// execution naming no session and no session_spec is legal
// (agentexecution/v1/spec.proto), so the session is created with no agent
// and the turn's stamp is the empty one.
describe("the built-in assistant (no session and no session_spec named)", () => {
  it("createSessionIfNeeded creates the session with no agent and points the turn at it", async () => {
    const sessions = recordingSessionCreator("ses_assistant");
    const step = newCreateSessionIfNeededStep({
      logger: silentLogger,
      sessionCreator: sessions.creator,
    });
    const execution = newExecution("");
    execution.metadata!.org = "acme";
    const ctx = newContext(execution);

    await step.execute(ctx);

    const created = sessions.created();
    expect(created?.spec?.agentRef).toBeUndefined();
    expect(created?.spec?.subject).toBe(AUTO_CREATED_SESSION_SUBJECT);
    expect(created?.metadata?.org).toBe("acme");
    expect(ctx.newState.spec?.target).toEqual({
      case: "sessionId",
      value: "ses_assistant",
    });
    expect(ctx.newState.status?.agentId).toBe("");
    expect(ctx.newState.status?.agentVersionHash).toBe("");
    expect(ctx.get(CREATED_SESSION_ID_KEY)).toBe("ses_assistant");
  });

  it("createSessionIfNeeded forwards a caller session_spec that names no agent", async () => {
    const sessions = recordingSessionCreator("ses_assistant_tools");
    const step = newCreateSessionIfNeededStep({
      logger: silentLogger,
      sessionCreator: sessions.creator,
    });
    const execution = newExecution("");
    execution.spec!.target = {
      case: "sessionSpec",
      value: create(SessionSpecSchema, {
        mcpServerUsages: [{ mcpServerRef: { org: "acme", slug: "github" } }],
      }),
    };
    const ctx = newContext(execution);

    await step.execute(ctx);

    const created = sessions.created();
    expect(created?.spec?.agentRef).toBeUndefined();
    expect(created?.spec?.mcpServerUsages.map((u) => u.mcpServerRef?.slug)).toEqual(["github"]);
  });
});

// A new conversation on an agent: the caller's session_spec, agent_ref
// included, is the created session's; the turn is pointed at the created
// session through the oneof (never a second copy of the spec), and its
// stamp is re-taken from the pin the session's own chain wrote, whatever
// ResolveRunAgent stamped earlier.
describe("a new conversation on an agent", () => {
  it("createSessionIfNeeded forwards agent_ref and re-takes the stamp from the created session", async () => {
    const sessions = recordingSessionCreator("ses_agent", {
      agentId: "agt_reviewer",
      agentVersionHash: "e".repeat(64),
    });
    const step = newCreateSessionIfNeededStep({
      logger: silentLogger,
      sessionCreator: sessions.creator,
    });
    const execution = newExecution("");
    execution.spec!.target = {
      case: "sessionSpec",
      value: create(SessionSpecSchema, {
        agentRef: {
          kind: ApiResourceKind.agent,
          org: "acme",
          slug: "reviewer",
          version: "v2",
        },
      }),
    };
    // What ResolveRunAgent stamped from the turn's own resolution; the
    // created session's pin replaces it.
    execution.status = create(AgentExecutionStatusSchema, {
      agentId: "agt_reviewer",
      agentVersionHash: "d".repeat(64),
    });
    const ctx = newContext(execution);

    await step.execute(ctx);

    const ref = sessions.created()?.spec?.agentRef;
    expect(ref?.org).toBe("acme");
    expect(ref?.slug).toBe("reviewer");
    expect(ref?.version).toBe("v2");
    expect(ctx.newState.spec?.target).toEqual({
      case: "sessionId",
      value: "ses_agent",
    });
    expect(ctx.newState.status?.agentId).toBe("agt_reviewer");
    expect(ctx.newState.status?.agentVersionHash).toBe("e".repeat(64));
  });
});

// Go wraps the in-process create with %w — the inner status code reaches
// the wire (a session_spec failing session validation answers
// InvalidArgument, never Internal), with the wrapped #852 message shape.
it("createSessionIfNeeded surfaces the inner status code of a failed session create", async () => {
  const step = newCreateSessionIfNeededStep({
    logger: silentLogger,
    sessionCreator: () => ({
      createAsCaller: async () => {
        throw new ConnectError(
          "session subject too long",
          Code.InvalidArgument,
        );
      },
    }),
  });
  const ctx = newContext(newExecution(""));
  const err = await expectCode(() => step.execute(ctx), Code.InvalidArgument);
  expect(err.rawMessage).toBe(
    "failed to create session: rpc error: code = InvalidArgument desc = session subject too long",
  );
});

// The unchanged skip contract: an existing session_id bypasses
// auto-creation entirely, and leaves the stamp ResolveRunAgent wrote.
it("createSessionIfNeeded skips when a session is provided", async () => {
  const step = newCreateSessionIfNeededStep({
    logger: silentLogger,
    sessionCreator: () => {
      throw new Error("session creator must not be reached");
    },
  });
  const execution = newExecution("ses_existing");
  execution.status = create(AgentExecutionStatusSchema, {
    agentId: "agt_pinned",
  });
  const ctx = newContext(execution);
  await step.execute(ctx);
  expect(ctx.newState.spec?.target).toEqual({
    case: "sessionId",
    value: "ses_existing",
  });
  expect(ctx.newState.status?.agentId).toBe("agt_pinned");
});

// The spec-forwarding contract of the one-call session bootstrap
// (stigmer/stigmer#249): caller fields survive, the subject default fills
// only a gap, and the caller's message is never mutated.
describe("buildAutoCreateSessionSpec", () => {
  const workspaceEntries = [
    {
      name: "repo",
      source: {
        source: {
          case: "localPath" as const,
          value: { path: "/home/user/repo" },
        },
      },
    },
  ];

  const cases: Array<{
    name: string;
    callerSpec: SessionSpec | undefined;
    want: SessionSpec;
  }> = [
    {
      name: "undefined spec -> the built-in assistant with the default subject",
      callerSpec: undefined,
      want: create(SessionSpecSchema, {
        subject: AUTO_CREATED_SESSION_SUBJECT,
      }),
    },
    {
      name: "full bootstrap spec -> forwarded verbatim, no defaults applied",
      callerSpec: create(SessionSpecSchema, {
        agentRef: {
          kind: ApiResourceKind.agent,
          org: "acme",
          slug: "reviewer",
          version: "latest",
        },
        subject: "Customize the landing page",
        workspaceEntries,
        harness: Harness.NATIVE,
        executionTarget: ExecutionTarget.LOCAL,
      }),
      want: create(SessionSpecSchema, {
        agentRef: {
          kind: ApiResourceKind.agent,
          org: "acme",
          slug: "reviewer",
          version: "latest",
        },
        subject: "Customize the landing page",
        workspaceEntries,
        harness: Harness.NATIVE,
        executionTarget: ExecutionTarget.LOCAL,
      }),
    },
    {
      name: "spec without a subject -> subject defaulted, rest forwarded",
      callerSpec: create(SessionSpecSchema, {
        workspaceEntries,
        executionTarget: ExecutionTarget.CLOUD,
      }),
      want: create(SessionSpecSchema, {
        subject: AUTO_CREATED_SESSION_SUBJECT,
        workspaceEntries,
        executionTarget: ExecutionTarget.CLOUD,
      }),
    },
  ];

  for (const tt of cases) {
    it(tt.name, () => {
      const got = buildAutoCreateSessionSpec(tt.callerSpec);
      expect(toJson(SessionSpecSchema, got)).toEqual(
        toJson(SessionSpecSchema, tt.want),
      );
    });
  }

  it("returns a deep clone: mutation never writes through to the caller", () => {
    const callerSpec = create(SessionSpecSchema, { workspaceEntries });
    const original = clone(SessionSpecSchema, callerSpec);

    const got = buildAutoCreateSessionSpec(callerSpec);
    got.workspaceEntries[0]!.name = "mutated";
    got.subject = "mutated";

    expect(toJson(SessionSpecSchema, callerSpec)).toEqual(
      toJson(SessionSpecSchema, original),
    );
  });
});

// ---------------------------------------------------------------------------
// ComposeDeclaredPreferences (compose_declared_preferences_step_test.go).
// ---------------------------------------------------------------------------

async function seedOrg(orgId: string, standingContext: string): Promise<void> {
  await store.saveResource(
    ApiResourceKind.organization,
    orgId,
    OrganizationSchema,
    create(OrganizationSchema, {
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { id: orgId, name: orgId, org: orgId },
      spec:
        standingContext !== ""
          ? { preferences: { standingContext } }
          : undefined,
    }),
  );
}

/** Wraps the real store but fails every getResource (the store-fault arm). */
function failingGetStore(): Store {
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "getResource") {
        return async () => {
          throw new Error("simulated store fault");
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/** Wraps the real store but fails every queryResources (the read-fault arm). */
function failingQueryStore(): Store {
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "queryResources") {
        return async () => {
          throw new Error("simulated store fault");
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

describe("newComposeDeclaredPreferencesStep", () => {
  const cases: Array<{
    name: string;
    orgId: string;
    seedContext?: string;
    seedOrg?: boolean;
    failingStore?: boolean;
    wantOrgContext: string;
  }> = [
    {
      name: "org with standing context -> snapshotted verbatim",
      orgId: "test-org",
      seedOrg: true,
      seedContext: "We deploy to us-east-1.",
      wantOrgContext: "We deploy to us-east-1.",
    },
    {
      name: "org without preferences -> empty snapshot",
      orgId: "test-org",
      seedOrg: true,
      wantOrgContext: "",
    },
    {
      name: "org not found -> empty snapshot, create unaffected",
      orgId: "ghost-org",
      wantOrgContext: "",
    },
    {
      name: "no org on metadata -> empty snapshot, create unaffected",
      orgId: "",
      wantOrgContext: "",
    },
    {
      name: "store fault -> empty snapshot, create unaffected (best-effort)",
      orgId: "test-org",
      seedOrg: true,
      seedContext: "never reached",
      failingStore: true,
      wantOrgContext: "",
    },
  ];

  for (const tt of cases) {
    it(tt.name, async () => {
      if (tt.seedOrg) {
        await seedOrg(tt.orgId, tt.seedContext ?? "");
      }
      const step = newComposeDeclaredPreferencesStep(
        tt.failingStore ? failingGetStore() : store,
        silentLogger,
      );

      const execution = newExecution("ses_1");
      execution.metadata!.org = tt.orgId;
      // The injection attempt: a caller-supplied value must never survive
      // — the field is server-owned.
      execution.status = create(AgentExecutionStatusSchema);
      execution.status.declaredPreferences = create(DeclaredPreferencesSchema, {
        orgContext: "injected org context",
        userContext: "injected user context",
      });
      const ctx = newContext(execution);

      await step.execute(ctx);

      const got = ctx.newState.status?.declaredPreferences;
      expect(
        got,
        "server-owned field must be stamped on every path",
      ).toBeDefined();
      expect(got?.orgContext).toBe(tt.wantOrgContext);
      // user_context stays empty under the single-operator posture.
      expect(got?.userContext).toBe("");
    });
  }
});

describe("newComposeDeclaredPreferencesStep for visitors", () => {
  const ORG_CONTEXT = "We deploy to us-east-1.";
  const channelSender = testCallerIdentity({ callerClass: "channel" });
  const member = testCallerIdentity();

  /** The hosted edition's shape: a visitor is a caller of a visitor class. */
  const channelIsVisitor: VisitorClassifier = {
    isVisitor: (caller) => caller.callerClass === "channel",
  };

  /** Wraps the real store, counting organization reads. */
  function countingStore(): { store: Store; orgReads: () => number } {
    let reads = 0;
    const counted = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === "getResource") {
          return (kind: ApiResourceKind, ...rest: unknown[]) => {
            if (kind === ApiResourceKind.organization) {
              reads += 1;
            }
            return Reflect.apply(target.getResource, target, [kind, ...rest]);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    return { store: counted, orgReads: () => reads };
  }

  async function compose(
    caller: CallerIdentity,
    classifier: VisitorClassifier | undefined,
    options: { store?: Store; logger?: typeof silentLogger } = {},
  ) {
    await seedOrg("test-org", ORG_CONTEXT);
    const step = newComposeDeclaredPreferencesStep(
      options.store ?? store,
      options.logger ?? silentLogger,
      undefined,
      classifier,
    );
    const execution = newExecution("ses_1");
    // The injection attempt: the field is server-owned on this path too.
    execution.status = create(AgentExecutionStatusSchema);
    execution.status.declaredPreferences = create(DeclaredPreferencesSchema, {
      orgContext: "injected org context",
    });
    const ctx = newContext(execution, caller);
    await step.execute(ctx);
    return ctx.newState.status?.declaredPreferences;
  }

  it("composes no organization context for a visitor, and never reads the organization", async () => {
    const counted = countingStore();
    const got = await compose(channelSender, channelIsVisitor, {
      store: counted.store,
    });
    expect(got, "server-owned field stamped for a visitor").toBeDefined();
    expect(got?.orgContext).toBe("");
    expect(counted.orgReads()).toBe(0);
  });

  it("keeps the organization's context for a member when a classifier is composed", async () => {
    const got = await compose(member, channelIsVisitor);
    expect(got?.orgContext).toBe(ORG_CONTEXT);
  });

  it("keeps the organization's context for every caller when no classifier is composed", async () => {
    const got = await compose(channelSender, undefined);
    expect(got?.orgContext).toBe(ORG_CONTEXT);
  });

  it("classifies a propagated visitor as a visitor (in-process keeps the class)", async () => {
    const got = await compose(
      testCallerIdentity({ callerClass: "channel", origin: "in-process" }),
      channelIsVisitor,
    );
    expect(got?.orgContext).toBe("");
  });

  it("withholds the organization's context when the classifier throws, and logs it at ERROR", async () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "error",
      pretty: false,
      write: (line) => lines.push(line),
    });
    const got = await compose(
      member,
      {
        isVisitor: () => {
          throw new Error("classifier fault");
        },
      },
      { logger },
    );
    expect(got?.orgContext).toBe("");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Visitor classifier failed");
    expect(lines[0]).toContain("classifier fault");
  });
});

// ---------------------------------------------------------------------------
// ComposeRecalledMemories (compose_recalled_memories_step_test.go).
// ---------------------------------------------------------------------------

async function seedMemoryOrg(
  orgId: string,
  memoryEnabled: boolean,
): Promise<void> {
  await store.saveResource(
    ApiResourceKind.organization,
    orgId,
    OrganizationSchema,
    create(OrganizationSchema, {
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { id: orgId, name: orgId, org: orgId },
      spec: { preferences: { memoryEnabled } },
    }),
  );
}

async function seedMemory(init: {
  id: string;
  orgId: string;
  subject?: string;
  content: string;
  state: MemoryLifecycleState;
  createdAt: Date | undefined;
}): Promise<void> {
  await store.saveResource(
    ApiResourceKind.memory,
    init.id,
    MemorySchema,
    create(MemorySchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Memory",
      metadata: { id: init.id, name: init.id, org: init.orgId },
      spec: {
        content: init.content,
        subjectIdentityAccountId: init.subject ?? "",
      },
      status: {
        lifecycleState: init.state,
        audit:
          init.createdAt === undefined
            ? undefined
            : {
                specAudit: { createdAt: timestampFromDate(init.createdAt) },
              },
      },
    }),
  );
}

describe("newComposeRecalledMemoriesStep", () => {
  const baseTime = new Date("2026-08-22T10:00:00Z");
  const minutes = (n: number) => new Date(baseTime.getTime() + n * 60_000);

  interface SeededMemory {
    id: string;
    subject?: string;
    content: string;
    state: MemoryLifecycleState;
    /** undefined = untimestamped row (sorts first, Go's nil-first). */
    offsetMinutes: number | undefined;
  }

  const cases: Array<{
    name: string;
    orgId: string;
    seedOrg?: boolean;
    memoryEnabled?: boolean;
    memories?: SeededMemory[];
    failingGet?: boolean;
    failingQuery?: boolean;
    wantEnabled: boolean;
    wantMemoryIds: string[];
  }> = [
    {
      name: "confirmed memories recalled oldest-first, verbatim",
      orgId: "test-org",
      seedOrg: true,
      memoryEnabled: true,
      memories: [
        // Seeded newest-first to prove the sort does the ordering.
        {
          id: "mem_newer",
          content: "Prefers OpenTofu.",
          state: MemoryLifecycleState.lifecycle_state_confirmed,
          offsetMinutes: 60,
        },
        {
          id: "mem_older",
          content: "Deploys to us-east-1.",
          state: MemoryLifecycleState.lifecycle_state_confirmed,
          offsetMinutes: 0,
        },
      ],
      wantEnabled: true,
      wantMemoryIds: ["mem_older", "mem_newer"],
    },
    {
      name: "untimestamped memory sorts first even when seeded after a timestamped one",
      // Exercises the (timestamped, untimestamped) comparator arm — Go's
      // nil-first ordering is symmetric.
      orgId: "test-org",
      seedOrg: true,
      memoryEnabled: true,
      memories: [
        {
          id: "mem_stamped",
          content: "stamped",
          state: MemoryLifecycleState.lifecycle_state_confirmed,
          offsetMinutes: 0,
        },
        {
          id: "mem_unstamped",
          content: "unstamped",
          state: MemoryLifecycleState.lifecycle_state_confirmed,
          offsetMinutes: undefined,
        },
      ],
      wantEnabled: true,
      wantMemoryIds: ["mem_unstamped", "mem_stamped"],
    },
    {
      name: "proposed and rejected records are never injected",
      orgId: "test-org",
      seedOrg: true,
      memoryEnabled: true,
      memories: [
        {
          id: "mem_proposed",
          content: "unconfirmed",
          state: MemoryLifecycleState.lifecycle_state_proposed,
          offsetMinutes: 0,
        },
        {
          id: "mem_rejected",
          content: "rejected",
          state: MemoryLifecycleState.lifecycle_state_rejected,
          offsetMinutes: 1,
        },
        {
          id: "mem_confirmed",
          content: "confirmed",
          state: MemoryLifecycleState.lifecycle_state_confirmed,
          offsetMinutes: 2,
        },
      ],
      wantEnabled: true,
      wantMemoryIds: ["mem_confirmed"],
    },
    {
      name: "other org's and non-sentinel-subject records are filtered out",
      orgId: "test-org",
      seedOrg: true,
      memoryEnabled: true,
      memories: [
        {
          id: "mem_mine",
          content: "mine",
          state: MemoryLifecycleState.lifecycle_state_confirmed,
          offsetMinutes: 0,
        },
        // A cloud-style subject-keyed record (e.g. from a restored backup)
        // must not leak into the OSS sentinel's recall.
        {
          id: "mem_subject",
          subject: "ia_someone",
          content: "not mine",
          state: MemoryLifecycleState.lifecycle_state_confirmed,
          offsetMinutes: 1,
        },
      ],
      wantEnabled: true,
      wantMemoryIds: ["mem_mine"],
    },
    {
      name: "org flag on with zero confirmed facts -> enabled=true, no facts (remember-tool signal)",
      orgId: "test-org",
      seedOrg: true,
      memoryEnabled: true,
      wantEnabled: true,
      wantMemoryIds: [],
    },
    {
      name: "org flag off -> disabled snapshot (default-off design)",
      orgId: "test-org",
      seedOrg: true,
      memories: [
        {
          id: "mem_confirmed",
          content: "confirmed",
          state: MemoryLifecycleState.lifecycle_state_confirmed,
          offsetMinutes: 0,
        },
      ],
      wantEnabled: false,
      wantMemoryIds: [],
    },
    {
      name: "org not found -> disabled snapshot, create unaffected",
      orgId: "ghost-org",
      wantEnabled: false,
      wantMemoryIds: [],
    },
    {
      name: "no org on metadata -> disabled snapshot, create unaffected",
      orgId: "",
      wantEnabled: false,
      wantMemoryIds: [],
    },
    {
      name: "org load fault -> disabled snapshot, create unaffected (best-effort)",
      orgId: "test-org",
      seedOrg: true,
      memoryEnabled: true,
      failingGet: true,
      wantEnabled: false,
      wantMemoryIds: [],
    },
    {
      name: "memory read fault -> DISABLED, never enabled-with-zero-facts",
      orgId: "test-org",
      seedOrg: true,
      memoryEnabled: true,
      failingQuery: true,
      wantEnabled: false,
      wantMemoryIds: [],
    },
  ];

  for (const tt of cases) {
    it(tt.name, async () => {
      if (tt.seedOrg) {
        await seedMemoryOrg(tt.orgId, tt.memoryEnabled ?? false);
      }
      for (const m of tt.memories ?? []) {
        await seedMemory({
          id: m.id,
          orgId: tt.orgId,
          subject: m.subject ?? "",
          content: m.content,
          state: m.state,
          createdAt:
            m.offsetMinutes === undefined
              ? undefined
              : minutes(m.offsetMinutes),
        });
      }
      let stepStore = store;
      if (tt.failingGet) {
        stepStore = failingGetStore();
      }
      if (tt.failingQuery) {
        stepStore = failingQueryStore();
      }
      const step = newComposeRecalledMemoriesStep(stepStore, silentLogger);

      const execution = newExecution("ses_1");
      execution.metadata!.org = tt.orgId;
      // The injection attempt: caller-supplied recalled_memories never
      // survive — the field is server-owned.
      execution.status = create(AgentExecutionStatusSchema);
      execution.status.recalledMemories = create(RecalledMemoriesSchema, {
        enabled: true,
        facts: [{ memoryId: "mem_injected", content: "injected fact" }],
      });
      const ctx = newContext(execution);

      await step.execute(ctx);

      // The step writes the snapshot alone: status.recalled_memories_report
      // is runner-owned with a single writer.
      expect(
        ctx.newState.status?.recalledMemoriesReport,
        "the compose step must never write status.recalled_memories_report",
      ).toBeUndefined();

      const got = ctx.newState.status?.recalledMemories;
      expect(
        got,
        "server-owned field must be stamped on every path",
      ).toBeDefined();
      expect(got?.enabled).toBe(tt.wantEnabled);
      expect(got?.facts.map((f) => f.memoryId)).toEqual(tt.wantMemoryIds);
      for (const fact of got?.facts ?? []) {
        expect(fact.content).not.toBe("");
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Where callers are persons (stigmer#1387, stigmer#1397).
// ---------------------------------------------------------------------------

describe("the compose steps where callers are persons", () => {
  const CAROL = "ida_carol";
  const DAVE = "ida_dave";

  /** Carol at the console: a wire user whose identity is her account id. */
  const carol = testCallerIdentity({ identityId: CAROL });

  function directory(preferences: {
    memoryEnabled?: boolean;
    standingContext?: string;
  }): AccountsByCaller {
    const accounts = fakeIdentityAccountStore();
    accounts.rows.set(
      CAROL,
      create(IdentityAccountSchema, {
        metadata: { id: CAROL, name: "Carol" },
        spec: { idpId: "auth0|carol", preferences },
      }),
    );
    return accounts;
  }

  const faultingDirectory: AccountsByCaller = {
    findById: async () => {
      throw new Error("simulated store fault");
    },
    findDirectByIdpId: async () => {
      throw new Error("simulated store fault");
    },
  };

  /** A JWT carrying `payload`, unsigned: the gate reads, never verifies. */
  function jwtWith(payload: Record<string, unknown>): string {
    const segment = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${segment({ alg: "RS256", typ: "JWT" })}.${segment(payload)}.signature`;
  }

  /** Every lane that is not a person speaking for themselves. */
  const notFirstParty: Array<[string, CallerIdentity]> = [
    [
      "a runner acting as Carol",
      testCallerIdentity({ identityId: CAROL, callerClass: "runner" }),
    ],
    [
      "a machine account",
      testCallerIdentity({ identityId: CAROL, callerClass: "machine" }),
    ],
    [
      "a cloud channel sender",
      testCallerIdentity({ identityId: CAROL, callerClass: "channel" }),
    ],
    [
      "the schedule fire acting as Carol (in-process)",
      testCallerIdentity({ identityId: CAROL, origin: "in-process" }),
    ],
    [
      "Carol through a PlatformClient user token",
      testCallerIdentity({
        identityId: CAROL,
        issuer: "stigmer",
        rawToken: jwtWith({
          iss: "stigmer",
          sub: CAROL,
          platform_client_id: "pc_1",
        }),
      }),
    ],
  ];

  async function seedRecallRows(): Promise<void> {
    await seedMemoryOrg("test-org", true);
    const confirmed = MemoryLifecycleState.lifecycle_state_confirmed;
    await seedMemory({
      id: "mem_carol",
      orgId: "test-org",
      subject: CAROL,
      content: "Carol's",
      state: confirmed,
      createdAt: new Date("2026-09-01T00:00:00Z"),
    });
    await seedMemory({
      id: "mem_dave",
      orgId: "test-org",
      subject: DAVE,
      content: "Dave's",
      state: confirmed,
      createdAt: new Date("2026-09-02T00:00:00Z"),
    });
    await seedMemory({
      id: "mem_sentinel",
      orgId: "test-org",
      subject: "",
      content: "nobody's",
      state: confirmed,
      createdAt: new Date("2026-09-03T00:00:00Z"),
    });
    await seedMemory({
      id: "mem_carol_proposed",
      orgId: "test-org",
      subject: CAROL,
      content: "unconfirmed",
      state: MemoryLifecycleState.lifecycle_state_proposed,
      createdAt: new Date("2026-09-04T00:00:00Z"),
    });
    // Carol's own confirmed fact in another organization: the subject key
    // reads her rows everywhere, and the org narrows them (stigmer#1405).
    await seedMemory({
      id: "mem_carol_elsewhere",
      orgId: "other-org",
      subject: CAROL,
      content: "Carol's, elsewhere",
      state: confirmed,
      createdAt: new Date("2026-08-15T00:00:00Z"),
    });
    // Seeded last and dated first: recall's order is created_at, not the
    // index's newest-first read or the write order.
    await seedMemory({
      id: "mem_carol_first",
      orgId: "test-org",
      subject: CAROL,
      content: "Carol's first",
      state: confirmed,
      createdAt: new Date("2026-08-31T00:00:00Z"),
    });
  }

  async function recall(
    accounts: AccountsByCaller | undefined,
    caller: CallerIdentity,
  ) {
    const step = newComposeRecalledMemoriesStep(store, silentLogger, accounts);
    const ctx = newContext(newExecution("ses_1"), caller);
    await step.execute(ctx);
    return ctx.newState.status?.recalledMemories;
  }

  it("recalls exactly the run's person's confirmed facts in its organization, oldest first", async () => {
    await seedRecallRows();
    const got = await recall(directory({ memoryEnabled: true }), carol);
    expect(got?.enabled).toBe(true);
    expect(got?.facts.map((f) => f.memoryId)).toEqual([
      "mem_carol_first",
      "mem_carol",
    ]);
  });

  it("recalls nothing and offers no remember tool when the person's own switch is off", async () => {
    await seedRecallRows();
    const got = await recall(directory({ memoryEnabled: false }), carol);
    expect(got?.enabled).toBe(false);
    expect(got?.facts).toEqual([]);
  });

  it("recalls nothing when the organization's switch is off, whatever the person's", async () => {
    await seedMemoryOrg("test-org", false);
    const got = await recall(directory({ memoryEnabled: true }), carol);
    expect(got?.enabled).toBe(false);
  });

  it("recalls nothing for a caller no account stands for", async () => {
    await seedRecallRows();
    const got = await recall(
      directory({ memoryEnabled: true }),
      testCallerIdentity({ identityId: "auth0|stranger" }),
    );
    expect(got?.enabled).toBe(false);
  });

  it("degrades to disabled on a directory fault (best-effort)", async () => {
    await seedRecallRows();
    const got = await recall(faultingDirectory, carol);
    expect(got?.enabled).toBe(false);
  });

  for (const [name, caller] of notFirstParty) {
    it(`recalls nothing for ${name}`, async () => {
      await seedRecallRows();
      const got = await recall(directory({ memoryEnabled: true }), caller);
      expect(got?.enabled).toBe(false);
      expect(got?.facts).toEqual([]);
    });
  }

  async function declared(
    accounts: AccountsByCaller | undefined,
    caller: CallerIdentity,
    classifier?: VisitorClassifier,
  ) {
    await seedOrg("test-org", "We deploy to us-east-1.");
    const step = newComposeDeclaredPreferencesStep(
      store,
      silentLogger,
      accounts,
      classifier,
    );
    const execution = newExecution("ses_1");
    execution.status = create(AgentExecutionStatusSchema);
    execution.status.declaredPreferences = create(DeclaredPreferencesSchema, {
      userContext: "injected user context",
    });
    const ctx = newContext(execution, caller);
    await step.execute(ctx);
    return ctx.newState.status?.declaredPreferences;
  }

  it("composes the run's person's standing context beside the organization's", async () => {
    const got = await declared(
      directory({ standingContext: "Call me Carol." }),
      carol,
    );
    expect(got?.orgContext).toBe("We deploy to us-east-1.");
    expect(got?.userContext).toBe("Call me Carol.");
  });

  it("keeps the organization's context and composes no person's on a directory fault", async () => {
    const got = await declared(faultingDirectory, carol);
    expect(got?.orgContext).toBe("We deploy to us-east-1.");
    expect(got?.userContext).toBe("");
  });

  it("composes no person's context under the single-operator posture", async () => {
    const got = await declared(undefined, carol);
    expect(got?.orgContext).toBe("We deploy to us-east-1.");
    expect(got?.userContext).toBe("");
  });

  for (const [name, caller] of notFirstParty) {
    it(`composes no person's context for ${name}, and keeps the organization's`, async () => {
      const got = await declared(
        directory({ standingContext: "Call me Carol." }),
        caller,
      );
      expect(got?.orgContext).toBe("We deploy to us-east-1.");
      expect(got?.userContext).toBe("");
    });
  }

  // The hosted edition's classifier composed beside the person directory:
  // the channel sender is its one visitor here, so it alone loses the
  // organization's half; every other lane keeps it (stigmer/stigmer#1401).
  const hostedClassifier: VisitorClassifier = {
    isVisitor: (caller) => caller.callerClass === "channel",
  };
  for (const [name, caller] of notFirstParty) {
    const visitor = hostedClassifier.isVisitor(caller);
    it(`${visitor ? "withholds" : "keeps"} the organization's context for ${name} under a visitor classifier`, async () => {
      const got = await declared(
        directory({ standingContext: "Call me Carol." }),
        caller,
        hostedClassifier,
      );
      expect(got?.orgContext).toBe(visitor ? "" : "We deploy to us-east-1.");
      expect(got?.userContext).toBe("");
    });
  }

  it("keeps both halves for Carol herself under a visitor classifier", async () => {
    const got = await declared(
      directory({ standingContext: "Call me Carol." }),
      carol,
      hostedClassifier,
    );
    expect(got?.orgContext).toBe("We deploy to us-east-1.");
    expect(got?.userContext).toBe("Call me Carol.");
  });
});

// ---------------------------------------------------------------------------
// agentCallTaskEnvironmentRefs (create_execution_context_workflow_refs_test.go).
// ---------------------------------------------------------------------------

describe("agentCallTaskEnvironmentRefs", () => {
  function makeWorkflow(
    taskName: string,
    kind: WorkflowTaskKind,
    config: JsonObject,
  ): Workflow {
    return create(WorkflowSchema, {
      spec: { tasks: [{ name: taskName, kind, taskConfig: config }] },
    });
  }

  const agentCallConfig: JsonObject = {
    agent: "triage",
    message: "classify",
    environment_refs: [
      { slug: "shared-secrets" },
      { org: "acme", slug: "other" },
    ],
  };

  it("returns the named task's refs", () => {
    const workflow = makeWorkflow(
      "review",
      WorkflowTaskKind.agent_call,
      agentCallConfig,
    );
    const refs = agentCallTaskEnvironmentRefs(silentLogger, workflow, "review");
    expect(refs).toHaveLength(2);
    expect(refs[0]?.slug).toBe("shared-secrets");
    expect(refs[1]?.org).toBe("acme");
  });

  it("renamed task answers empty", () => {
    const workflow = makeWorkflow(
      "review",
      WorkflowTaskKind.agent_call,
      agentCallConfig,
    );
    expect(
      agentCallTaskEnvironmentRefs(silentLogger, workflow, "old_name"),
    ).toHaveLength(0);
  });

  it("same-named non-agent_call task answers empty", () => {
    const workflow = makeWorkflow("review", WorkflowTaskKind.llm_call, {
      model: "some-model",
      prompt: "classify",
    });
    expect(
      agentCallTaskEnvironmentRefs(silentLogger, workflow, "review"),
    ).toHaveLength(0);
  });

  it("unparsable config answers empty", () => {
    // A config with a key the current proto does not declare no longer
    // parses (strict JSON) — the binding degrades rather than failing
    // the run.
    const workflow = makeWorkflow("review", WorkflowTaskKind.agent_call, {
      agent: "triage",
      message: "classify",
      legacy_knob: true,
    });
    expect(
      agentCallTaskEnvironmentRefs(silentLogger, workflow, "review"),
    ).toHaveLength(0);
  });

  it("task without refs answers empty", () => {
    const workflow = makeWorkflow("review", WorkflowTaskKind.agent_call, {
      agent: "triage",
      message: "classify",
    });
    expect(
      agentCallTaskEnvironmentRefs(silentLogger, workflow, "review"),
    ).toHaveLength(0);
  });
});

// The StartWorkflow failure arm's
// PENDING→FAILED stamp is notify site 3 of 5 — an execution that consumed
// its create-gate side effects and then never started still reaches the
// composed observers (a billing composition settles its reservation on
// exactly this).
describe("newStartWorkflowStep — start-failure FAILED stamp", () => {
  it("persists FAILED and notifies the observers before surfacing Internal", async () => {
    const observed: AgentExecutionStatusTransition[] = [];
    const step = newStartWorkflowStep({
      store,
      logger: silentLogger,
      engineState: () =>
        ({
          connected: true,
          engine: stubConnectedEngine({
            startInvokeWorkflow: async () => {
              throw new Error("temporal exploded");
            },
          }),
        }) as ExecutionEngineState,
      statusObservers: [
        (t: AgentExecutionStatusTransition): void => void observed.push(t),
      ],
      workflowRunQueue: newWorkflowRunQueue(routing(WORKFLOW_ROUTING_GLOBAL)),
    });

    const execution = newExecution("ses_sw");
    execution.metadata!.id = "aexec_sw_fail";
    // The chain stamps PENDING at SetInitialPhase before this step runs.
    execution.status = create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_PENDING,
    });

    const err = await expectCode(
      () => step.execute(newContext(execution)),
      Code.Internal,
    );
    expect(err.rawMessage).toBe("failed to start workflow");

    expect(observed).toHaveLength(1);
    expect(observed[0]?.oldPhase).toBe(ExecutionPhase.EXECUTION_PENDING);
    expect(observed[0]?.newPhase).toBe(ExecutionPhase.EXECUTION_FAILED);

    const persisted = await store.getResource(
      ApiResourceKind.agent_execution,
      "aexec_sw_fail",
      AgentExecutionSchema,
    );
    expect(persisted.status?.phase).toBe(ExecutionPhase.EXECUTION_FAILED);
    expect(persisted.status?.error).toContain("temporal exploded");
  });
});

// The workflow input StartWorkflow builds: the agent is the stamp
// ResolveRunAgent (or CreateSessionIfNeeded) wrote, and every parent
// coordinate comes from the vouched link (vouch-workflow-parent.ts). The
// queue is derived from the link's workflow run, so no request names one.
describe("newStartWorkflowStep — the workflow input", () => {
  async function started(
    execution: AgentExecution,
    workflowActivityRouting: string,
  ): Promise<StartInvokeWorkflowInput | undefined> {
    let input: StartInvokeWorkflowInput | undefined;
    const step = newStartWorkflowStep({
      store,
      logger: silentLogger,
      engineState: () =>
        ({
          connected: true,
          engine: stubConnectedEngine({
            startInvokeWorkflow: async (got) => {
              input = got;
            },
          }),
        }) as ExecutionEngineState,
      statusObservers: [],
      workflowRunQueue: newWorkflowRunQueue(routing(workflowActivityRouting)),
    });
    execution.metadata!.id = "aexec_input";
    await step.execute(newContext(execution));
    return input;
  }

  function childTurn(): AgentExecution {
    const execution = newExecution("ses_child");
    execution.status = create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_PENDING,
      agentId: "agt_called",
      agentVersionHash: "e".repeat(64),
    });
    execution.spec!.parent = create(WorkflowParentSchema, {
      workflowExecutionId: "wfx_parent",
      signalWorkflowId: "wf-signal-target",
      callbackToken: new Uint8Array([1, 2, 3]),
    });
    return execution;
  }

  it("takes the agent from the stamp and the parent coordinates from the link", async () => {
    const input = await started(childTurn(), WORKFLOW_ROUTING_EXECUTION);

    expect(input?.executionId).toBe("aexec_input");
    expect(input?.sessionId).toBe("ses_child");
    expect(input?.agentId).toBe("agt_called");
    expect(input?.callbackToken).toEqual(new Uint8Array([1, 2, 3]));
    expect(input?.parentWorkflowId).toBe("wf-signal-target");
  });

  it("routes a child turn to its workflow run's queue under execution routing", async () => {
    const input = await started(childTurn(), WORKFLOW_ROUTING_EXECUTION);

    expect(input?.activityTaskQueueOverride).toBe(
      formatWfExecTaskQueue("wfx_parent"),
    );
  });

  it("names no queue for a child turn under global routing", async () => {
    const input = await started(childTurn(), WORKFLOW_ROUTING_GLOBAL);

    expect(input?.activityTaskQueueOverride).toBe("");
  });

  it("starts a turn with no link with no parent coordinates and no queue", async () => {
    const execution = newExecution("ses_plain");
    execution.status = create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_PENDING,
    });

    const input = await started(execution, WORKFLOW_ROUTING_EXECUTION);

    expect(input?.agentId).toBe("");
    expect(input?.callbackToken).toEqual(new Uint8Array());
    expect(input?.parentWorkflowId).toBe("");
    expect(input?.activityTaskQueueOverride).toBe("");
  });
});
