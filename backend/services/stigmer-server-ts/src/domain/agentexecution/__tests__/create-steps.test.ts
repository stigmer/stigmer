/**
 * Create pipeline step tests — ports create_target_resolution_test.go,
 * create_session_bootstrap_test.go, compose_declared_preferences_step_test.go,
 * compose_recalled_memories_step_test.go, and
 * create_execution_context_workflow_refs_test.go case-for-case, over a
 * real SQLite store and the real pipeline RequestContext (the same
 * direct-step shape as Go). Go's nil-client skip proofs map to throwing
 * providers — reaching the client would fail the test just as a nil
 * dereference would panic Go.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, clone, toJson } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { JsonObject } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  DeclaredPreferencesSchema,
  RecalledMemoriesSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryLifecycleState } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/enum_pb";
import type { SessionSpec } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import {
  ExecutionTarget,
  Harness,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { createLogger } from "../../../boot/logger.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";

import { agentCallTaskEnvironmentRefs } from "../create-execution-context-step.js";
import {
  AUTO_CREATED_SESSION_SUBJECT,
  DEFAULT_INSTANCE_ID_KEY,
  buildAutoCreateSessionSpec,
  newComposeDeclaredPreferencesStep,
  newComposeRecalledMemoriesStep,
  newCreateDefaultInstanceIfNeededStep,
  newCreateSessionIfNeededStep,
  newEnsureSessionOrAgentResolvedStep,
  newResolveDefaultAgentStep,
} from "../create-steps.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aexec-create-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function newExecution(sessionId: string, agentId: string): AgentExecution {
  return create(AgentExecutionSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "AgentExecution",
    metadata: { name: "exec", org: "test-org" },
    spec: { sessionId, agentId, message: "hi" },
  });
}

function newContext(
  execution: AgentExecution,
): RequestContext<typeof AgentExecutionSchema> {
  return new RequestContext(
    AgentExecutionSchema,
    execution,
    ApiResourceKind.agent_execution,
  );
}

async function seedDefaultAgent(
  id: string,
  visibility: ApiResourceVisibility,
): Promise<void> {
  await store.saveResource(
    ApiResourceKind.agent,
    id,
    AgentSchema,
    create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: {
        id,
        name: "assistant",
        org: "stigmer",
        visibility,
        labels: { "stigmer.ai/default-agent": "true" },
      },
    }),
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

// The post-resolution invariant guard: a resolved reference passes; an
// unresolved one is an Internal invariant violation (never
// InvalidArgument — issue #196).
describe("newEnsureSessionOrAgentResolvedStep", () => {
  const step = newEnsureSessionOrAgentResolvedStep(silentLogger);

  const cases: Array<{
    name: string;
    sessionId?: string;
    agentId?: string;
    specInstanceId?: string;
    wantCode?: Code;
  }> = [
    { name: "session_id resolved -> pass", sessionId: "ses_1" },
    { name: "agent_id resolved -> pass", agentId: "agt_1" },
    {
      name: "both resolved -> pass",
      sessionId: "ses_1",
      agentId: "agt_1",
    },
    {
      name: "session_spec instance resolved -> pass",
      specInstanceId: "inst_1",
    },
    {
      name: "none resolved -> Internal invariant violation",
      wantCode: Code.Internal,
    },
  ];

  for (const tt of cases) {
    it(tt.name, async () => {
      const execution = newExecution(tt.sessionId ?? "", tt.agentId ?? "");
      if (tt.specInstanceId !== undefined) {
        execution.spec!.sessionSpec = create(SessionSpecSchema, {
          agentInstanceId: tt.specInstanceId,
        });
      }
      const ctx = newContext(execution);
      if (tt.wantCode === undefined) {
        await step.execute(ctx);
      } else {
        await expectCode(() => step.execute(ctx), tt.wantCode);
      }
    });
  }
});

// The reachable contract of default-agent resolution: NotFound when
// unseeded, resolution onto newState when a public default exists, and
// FailedPrecondition when the default is not visibility_public.
describe("newResolveDefaultAgentStep", () => {
  it("no default agent seeded -> NotFound", async () => {
    const step = newResolveDefaultAgentStep(store, silentLogger);
    await expectCode(
      () => step.execute(newContext(newExecution("", ""))),
      Code.NotFound,
    );
  });

  it("public default agent -> resolves agent_id onto newState", async () => {
    await seedDefaultAgent("agt_default", ApiResourceVisibility.visibility_public);
    const step = newResolveDefaultAgentStep(store, silentLogger);
    const ctx = newContext(newExecution("", ""));

    await step.execute(ctx);

    expect(ctx.newState.spec?.agentId).toBe("agt_default");
    // The original request must remain immutable.
    expect(ctx.input.spec?.agentId).toBe("");
  });

  it("non-public default agent -> FailedPrecondition", async () => {
    await seedDefaultAgent(
      "agt_private",
      ApiResourceVisibility.visibility_private,
    );
    const step = newResolveDefaultAgentStep(store, silentLogger);
    await expectCode(
      () => step.execute(newContext(newExecution("", ""))),
      Code.FailedPrecondition,
    );
  });

  // The oss#356 defect through this step's lens: a first-match lookup
  // could land on the non-public labeled agent and fail even though a
  // valid public default existed. Both insertion orders must resolve the
  // public agent.
  for (const [name, ids] of Object.entries({
    "private inserted first": ["agt_0private", "agt_1public"],
    "public inserted first": ["agt_1public", "agt_0private"],
  })) {
    it(`non-public labeled agent alongside a public one -> public wins (${name})`, async () => {
      for (const id of ids) {
        await seedDefaultAgent(
          id,
          id === "agt_1public"
            ? ApiResourceVisibility.visibility_public
            : ApiResourceVisibility.visibility_private,
        );
      }
      const step = newResolveDefaultAgentStep(store, silentLogger);
      const ctx = newContext(newExecution("", ""));
      await step.execute(ctx);
      expect(ctx.newState.spec?.agentId).toBe("agt_1public");
    });
  }

  it("reference already provided -> no-op", async () => {
    const step = newResolveDefaultAgentStep(store, silentLogger);
    const ctx = newContext(newExecution("", "agt_explicit"));
    await step.execute(ctx);
    expect(ctx.newState.spec?.agentId).toBe("agt_explicit");
  });

  it("session_spec instance provided -> no-op even with a seeded default agent", async () => {
    // A one-call bootstrap naming an explicit instance must NOT resolve
    // the platform default agent: doing so would stamp misleading
    // metadata pointing at an agent the session does not run against.
    await seedDefaultAgent("agt_default", ApiResourceVisibility.visibility_public);
    const step = newResolveDefaultAgentStep(store, silentLogger);
    const execution = newExecution("", "");
    execution.spec!.sessionSpec = create(SessionSpecSchema, {
      agentInstanceId: "inst_explicit",
    });
    const ctx = newContext(execution);
    await step.execute(ctx);
    expect(ctx.newState.spec?.agentId).toBe("");
  });
});

// The one-call bootstrap skip: when session_spec names an instance, the
// step must return before any agent lookup — the throwing providers
// prove it (Go's nil clients would panic).
it("createDefaultInstanceIfNeeded skips for a bootstrap instance", async () => {
  const step = newCreateDefaultInstanceIfNeededStep({
    store,
    logger: silentLogger,
    agentLoader: () => {
      throw new Error("agent loader must not be reached");
    },
    agentInstanceCreator: () => {
      throw new Error("instance creator must not be reached");
    },
  });
  const execution = newExecution("", "");
  execution.spec!.sessionSpec = create(SessionSpecSchema, {
    agentInstanceId: "inst_explicit",
  });
  const ctx = newContext(execution);
  await step.execute(ctx);
  expect(ctx.get(DEFAULT_INSTANCE_ID_KEY)).toBeUndefined();
});

// Go wraps the in-process create with %w — the inner status code reaches
// the wire (a session_spec failing session validation answers
// InvalidArgument, never Internal), with the wrapped #852 message shape.
it("createSessionIfNeeded surfaces the inner status code of a failed session create", async () => {
  const step = newCreateSessionIfNeededStep({
    logger: silentLogger,
    sessionCreator: () => ({
      create: async () => {
        throw new ConnectError(
          "session subject too long",
          Code.InvalidArgument,
        );
      },
    }),
  });
  const execution = newExecution("", "agt_1");
  const ctx = newContext(execution);
  ctx.set(DEFAULT_INSTANCE_ID_KEY, "inst_1");
  const err = await expectCode(() => step.execute(ctx), Code.InvalidArgument);
  expect(err.rawMessage).toBe(
    "failed to create session: rpc error: code = InvalidArgument desc = session subject too long",
  );
});

// The unchanged skip contract: an existing session_id bypasses
// auto-creation entirely.
it("createSessionIfNeeded skips when a session is provided", async () => {
  const step = newCreateSessionIfNeededStep({
    logger: silentLogger,
    sessionCreator: () => {
      throw new Error("session creator must not be reached");
    },
  });
  const ctx = newContext(newExecution("ses_existing", ""));
  await step.execute(ctx);
  expect(ctx.newState.spec?.sessionId).toBe("ses_existing");
});

// The spec-forwarding contract of the one-call session bootstrap
// (stigmer/stigmer#249): caller fields survive, defaults fill only gaps,
// and the caller's message is never mutated.
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
    defaultInstanceId: string;
    want: SessionSpec;
  }> = [
    {
      name: "undefined spec -> minimal default (pre-bootstrap behavior)",
      callerSpec: undefined,
      defaultInstanceId: "inst_default",
      want: create(SessionSpecSchema, {
        agentInstanceId: "inst_default",
        subject: AUTO_CREATED_SESSION_SUBJECT,
      }),
    },
    {
      name: "full bootstrap spec -> forwarded verbatim, no defaults applied",
      callerSpec: create(SessionSpecSchema, {
        agentInstanceId: "inst_explicit",
        subject: "Customize the landing page",
        workspaceEntries,
        harness: Harness.NATIVE,
        executionTarget: ExecutionTarget.LOCAL,
      }),
      // defaultInstanceId intentionally empty: CreateDefaultInstanceIfNeeded
      // skips resolution when the spec names an instance.
      defaultInstanceId: "",
      want: create(SessionSpecSchema, {
        agentInstanceId: "inst_explicit",
        subject: "Customize the landing page",
        workspaceEntries,
        harness: Harness.NATIVE,
        executionTarget: ExecutionTarget.LOCAL,
      }),
    },
    {
      name: "spec without instance or subject -> both defaulted, rest forwarded",
      callerSpec: create(SessionSpecSchema, {
        workspaceEntries,
        executionTarget: ExecutionTarget.CLOUD,
      }),
      defaultInstanceId: "inst_resolved",
      want: create(SessionSpecSchema, {
        agentInstanceId: "inst_resolved",
        subject: AUTO_CREATED_SESSION_SUBJECT,
        workspaceEntries,
        executionTarget: ExecutionTarget.CLOUD,
      }),
    },
  ];

  for (const tt of cases) {
    it(tt.name, () => {
      const got = buildAutoCreateSessionSpec(
        tt.callerSpec,
        tt.defaultInstanceId,
      );
      expect(toJson(SessionSpecSchema, got)).toEqual(
        toJson(SessionSpecSchema, tt.want),
      );
    });
  }

  it("returns a deep clone: mutation never writes through to the caller", () => {
    const callerSpec = create(SessionSpecSchema, { workspaceEntries });
    const original = clone(SessionSpecSchema, callerSpec);

    const got = buildAutoCreateSessionSpec(callerSpec, "inst_resolved");
    got.workspaceEntries[0]!.name = "mutated";

    expect(toJson(SessionSpecSchema, callerSpec)).toEqual(
      toJson(SessionSpecSchema, original),
    );
    expect(callerSpec.agentInstanceId).toBe("");
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

/** Wraps the real store but fails every listResources (the scan-fault arm). */
function failingListStore(): Store {
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "listResources") {
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

      const execution = newExecution("ses_1", "agt_1");
      execution.metadata!.org = tt.orgId;
      // The injection attempt: a caller-supplied value must never survive
      // — the field is server-owned (DD-002 D2).
      execution.spec!.declaredPreferences = create(
        DeclaredPreferencesSchema,
        {
          orgContext: "injected org context",
          userContext: "injected user context",
        },
      );
      const ctx = newContext(execution);

      await step.execute(ctx);

      const got = ctx.newState.spec?.declaredPreferences;
      expect(got, "server-owned field must be stamped on every path").toBeDefined();
      expect(got?.orgContext).toBe(tt.wantOrgContext);
      // user_context must stay empty in OSS (no per-request user identity).
      expect(got?.userContext).toBe("");
    });
  }
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
    failingList?: boolean;
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
      name: "memory scan fault -> DISABLED, never enabled-with-zero-facts",
      orgId: "test-org",
      seedOrg: true,
      memoryEnabled: true,
      failingList: true,
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
      if (tt.failingList) {
        stepStore = failingListStore();
      }
      const step = newComposeRecalledMemoriesStep(stepStore, silentLogger);

      const execution = newExecution("ses_1", "agt_1");
      execution.metadata!.org = tt.orgId;
      // The injection attempt: caller-supplied recalled_memories never
      // survive — the field is server-owned (DD-006 D2).
      execution.spec!.recalledMemories = create(RecalledMemoriesSchema, {
        enabled: true,
        facts: [{ memoryId: "mem_injected", content: "injected fact" }],
      });
      const ctx = newContext(execution);

      await step.execute(ctx);

      // The step's contract is SPEC-ONLY: status.recalled_memories_report
      // is runner-owned with a single writer (DD-008 D5).
      expect(
        ctx.newState.status?.recalledMemoriesReport,
        "the compose step must never write status.recalled_memories_report",
      ).toBeUndefined();

      const got = ctx.newState.spec?.recalledMemories;
      expect(got, "server-owned field must be stamped on every path").toBeDefined();
      expect(got?.enabled).toBe(tt.wantEnabled);
      expect(got?.facts.map((f) => f.memoryId)).toEqual(tt.wantMemoryIds);
      for (const fact of got?.facts ?? []) {
        expect(fact.content).not.toBe("");
      }
    });
  }
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
