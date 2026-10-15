/**
 * Pins the eval run steps' arms the composed lanes cannot reach (no
 * engine runs behind them), over a temp store:
 *
 *   - the create's question is can_edit on the agent, and a
 *     server-composed create asks none; a store fault reading the agent is
 *     INTERNAL;
 *   - the defaults refuse a request with no organization or no spec, and
 *     real servers asked for both beside the mocks and instead of them;
 *     an allow_tools entry naming an attached plugin's own MCP server is
 *     kept as written, the version is stamped as its hash and the id is
 *     minted;
 *   - a target naming a model the catalog does not run on its engine is
 *     refused, naming the target;
 *   - the plan refuses no spec and a case_glob that is not a glob; a
 *     plugin with no version to read is stamped "no eval cases at this
 *     version" without a read; a suite source's own refusal passes
 *     through while any other fault is INTERNAL; the limits count every
 *     plugin's cases together; filters that keep no case are refused;
 *   - after the eval is stored, an agent deleted meanwhile takes the eval
 *     with it (row and access) and the create answers NOT_FOUND for the
 *     agent; a fault reading the agent or removing the row is INTERNAL;
 *   - a failed start marks a pending eval failed with a fixed sentence,
 *     never overwrites a row the workflow already moved, answers NOT_FOUND
 *     for a row gone and INTERNAL for a store fault;
 *   - an eval that outlived its workflow is answered and stored failed by
 *     get, and a row its settle cannot find is answered as read;
 *   - cancel, every arm: a finished eval answered unchanged, an outlived
 *     one failed without asking, a cancel the workflow takes answered
 *     unchanged, no workflow failing a running eval and cancelling a
 *     pending one, no engine UNAVAILABLE, any other fault INTERNAL;
 *   - listByAgent keeps only the evals the caller may view (a
 *     server-composed caller sees them all), fails closed when the
 *     authorizer cannot answer, answers a store fault INTERNAL, and
 *     answers each eval without its tries, its summaries kept;
 *   - a chain built wrong (the agent, the version, the cancel's target or
 *     the delete's row never stashed) fails loudly as INTERNAL.
 */
import { clone, create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PluginFiles } from "@stigmer/plugin-package";
import { inMemoryPluginFiles } from "@stigmer/plugin-package";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentMcpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { EvalRunSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import type { EvalRun } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import {
  EvalRunIdSchema,
  ListEvalRunsByAgentRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/io_pb";
import type { EvalRunList } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/io_pb";
import { EvalRunPluginSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import { EvalSchema } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { EvalRunCaseSourceSchema, EvalRunTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/spec_pb";
import {
  EvalRunArmSchema,
  EvalRunCaseSchema,
  EvalRunCaseTargetSchema,
  EvalRunPartialReason,
  EvalRunPhase,
  EvalRunTryState,
  EvalRunTrySchema,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../../boot/logger.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import type {
  ResourceAuthorizationLifecycle,
  ResourceDeletedEvent,
} from "../../../extensions/resource-authorization.js";
import { newModelCatalogProviderFromDocument } from "../../../modelcatalog/document-catalog.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { TARGET_RESOURCE_KEY } from "../../../pipeline/steps/load-target.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import {
  EVAL_RUN_NO_ENGINE_MESSAGE,
  EVAL_RUN_NOT_STARTED_ERROR,
  EVAL_RUN_REAL_SERVERS_CONFLICT_MESSAGE,
  EVAL_RUN_WORKFLOW_ENDED_ERROR,
  evalRunCaseGlobMessage,
  evalRunTooLargeMessage,
} from "../constants.js";
import type { EvalSuiteSource } from "../suite.js";
import { EvalRunEngineUnavailableError } from "../workflows.js";
import type { EvalRunWorkflows } from "../workflows.js";
import {
  EVAL_RUN_AGENT_DENIED_MESSAGE,
  EVAL_RUN_COMPARED_DENIED_MESSAGE,
  EVAL_RUN_NO_SUBJECT_MESSAGE,
  PLUGIN_NO_CASES_REASON,
  evalRunUnloadedCaseSourceMessage,
} from "../constants.js";
import {
  EVAL_RUN_RESULT_KEY,
  EVAL_RUN_SUBJECT_KEY,
  EVAL_RUN_LOAD_KEY,
  newCancelEvalRunStep,
  newEnsureEvalRunSubjectStillExistsStep,
  newListEvalRunsBySubjectStep,
  newLoadEvalRunSubjectStep,
  newPlanEvalRunStep,
  newRefuseActiveEvalRunDeleteStep,
  newResolveEvalRunDefaultsStep,
  newSettleEndedEvalRunStep,
  newStartEvalRunWorkflowStep,
  newValidateEvalRunTargetsStep,
  resolveEvalRunCreateTargets,
  settleEndedEvalRun,
} from "../steps.js";
import type { EvaluatedLoad, LoadedSubject } from "../steps.js";
import { namingSaves } from "../../../store/__tests__/named-saves.js";

const ORG = "org_1";
const AGENT_ID = "agt_1";
const AGENT_HASH = "a".repeat(64);
const DIGEST = "d".repeat(64);
const OTHER_DIGEST = "e".repeat(64);
const DAY_MS = 24 * 60 * 60 * 1000;

/** An authorizer that allows every question: the create's own steps ask none in these arms. */
const ALLOW_ALL: Authorizer = { authorize: () => Promise.resolve({ kind: "allow" }) };

const catalog = newModelCatalogProviderFromDocument(
  JSON.stringify({ models: [{ id: "native-model", harness: "native" }] }),
);

let temp: TempStore;

beforeEach(() => {
  // Rows seeded straight into the store hold their names, as their chains would.
  const opened = tempStore();
  temp = { ...opened, store: namingSaves(opened.store) };
});

afterEach(async () => {
  await temp.cleanup();
});

function evalRow(id: string, phase: EvalRunPhase): EvalRun {
  return create(EvalRunSchema, {
    metadata: { id, name: id, org: ORG },
    spec: { subject: { case: "agentId", value: AGENT_ID }, maxCostUsd: 5 },
    status: { phase },
  });
}

async function saved(row: EvalRun): Promise<EvalRun> {
  await temp.store.saveResource(ApiResourceKind.eval_run, row.metadata!.id, EvalRunSchema, row);
  return row;
}

async function stored(id: string): Promise<EvalRun> {
  return temp.store.getResource(ApiResourceKind.eval_run, id, EvalRunSchema);
}

const AGENT: Agent = create(AgentSchema, {
  metadata: { id: AGENT_ID, org: ORG, slug: "support-desk", name: "support-desk" },
  spec: {
    instructions: "You answer support tickets.",
    plugins: [{ kind: ApiResourceKind.plugin, slug: "thermos" }],
  },
  status: { versionHash: AGENT_HASH },
});

const THERMOS: Plugin = create(PluginSchema, {
  metadata: { id: "plg_1", org: ORG, slug: "thermos", name: "thermos" },
  spec: { name: "thermos" },
  status: { digest: DIGEST, mcpServers: [{ name: "github" }] },
});

async function seedAgent(): Promise<void> {
  await temp.store.saveResource(ApiResourceKind.agent, AGENT_ID, AgentSchema, AGENT);
}

function failing<M extends keyof Store>(store: Store, method: M): Store {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === method) {
        return () => Promise.reject(new Error("disk unavailable"));
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function workflows(answers: Partial<EvalRunWorkflows> = {}): EvalRunWorkflows & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    start: async (id) => {
      calls.push(`start ${id}`);
      await answers.start?.(id);
    },
    cancel: async (id) => {
      calls.push(`cancel ${id}`);
      return answers.cancel === undefined ? "requested" : answers.cancel(id);
    },
  };
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

function warnings(): { logger: Logger; warned: Array<{ message: string; fields: unknown }> } {
  const warned: Array<{ message: string; fields: unknown }> = [];
  return { warned, logger: { ...silentLogger, warn: (message, fields) => warned.push({ message, fields }) } };
}

function createCtx(row: EvalRun, caller = testCallerIdentity()) {
  return new RequestContext(EvalRunSchema, row, caller, ApiResourceKind.eval_run);
}

function bareIdCtx(id = "evr_1") {
  return new RequestContext(
    EvalRunIdSchema,
    create(EvalRunIdSchema, { value: id }),
    testCallerIdentity(),
    ApiResourceKind.eval_run,
  );
}

function idCtx(target: EvalRun) {
  const ctx = bareIdCtx(target.metadata!.id);
  ctx.set(TARGET_RESOURCE_KEY, target);
  return ctx;
}

async function failure(run: () => unknown): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a failure");
}

describe("the create's question and the agent's read", () => {
  it("asks can_edit on the agent, and nothing for a server-composed create", () => {
    const row = evalRow("", EvalRunPhase.unspecified);
    expect(resolveEvalRunCreateTargets(createCtx(row))).toEqual([
      {
        permission: IamPermission.can_edit,
        resourceKind: ApiResourceKind.agent,
        resourceId: AGENT_ID,
        deniedMessage: EVAL_RUN_AGENT_DENIED_MESSAGE,
      },
    ]);
    expect(resolveEvalRunCreateTargets(createCtx(row, testCallerIdentity({ origin: "in-process" })))).toEqual([]);
  });

  it("stashes the agent it reads, and is INTERNAL when the store cannot read it", async () => {
    await seedAgent();
    const ctx = createCtx(evalRow("", EvalRunPhase.unspecified));
    await newLoadEvalRunSubjectStep(temp.store).execute(ctx);
    expect((ctx.get(EVAL_RUN_SUBJECT_KEY) as LoadedSubject).row.metadata?.id).toBe(AGENT_ID);

    const fault = await failure(() =>
      newLoadEvalRunSubjectStep(failing(temp.store, "getResource")).execute(
        createCtx(evalRow("", EvalRunPhase.unspecified)),
      ),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to load the agent to evaluate");
  });
});

describe("ResolveEvalRunDefaults on an agent", () => {
  function evaluated(row: EvalRun) {
    const ctx = createCtx(row);
    ctx.set(EVAL_RUN_SUBJECT_KEY, { kind: "agent", org: ORG, row: AGENT } satisfies LoadedSubject);
    return ctx;
  }

  it("refuses a request that names no organization, or carries no spec", async () => {
    const noOrg = evalRow("", EvalRunPhase.unspecified);
    noOrg.metadata!.org = "";
    const orgRefusal = await failure(() => newResolveEvalRunDefaultsStep(temp.store, ALLOW_ALL).execute(evaluated(noOrg)));
    expect(orgRefusal.code).toBe(Code.InvalidArgument);
    expect(orgRefusal.rawMessage).toBe("metadata.org is required for an eval run");

    const noMetadata = evalRow("", EvalRunPhase.unspecified);
    noMetadata.metadata = undefined;
    expect((await failure(() => newResolveEvalRunDefaultsStep(temp.store, ALLOW_ALL).execute(evaluated(noMetadata)))).rawMessage).toBe(
      "metadata.org is required for an eval run",
    );

    const noSpec = evalRow("", EvalRunPhase.unspecified);
    noSpec.spec = undefined;
    const specRefusal = await failure(() => newResolveEvalRunDefaultsStep(temp.store, ALLOW_ALL).execute(evaluated(noSpec)));
    expect(specRefusal.code).toBe(Code.InvalidArgument);
    expect(specRefusal.rawMessage).toBe("spec is required for an eval run");
  });

  it("refuses real servers asked for both beside the mocks and instead of them", async () => {
    const row = evalRow("", EvalRunPhase.unspecified);
    row.spec!.allowRealServers = true;
    row.spec!.realMcpServers = true;
    const refused = await failure(() => newResolveEvalRunDefaultsStep(temp.store, ALLOW_ALL).execute(evaluated(row)));
    expect(refused.code).toBe(Code.InvalidArgument);
    expect(refused.rawMessage).toBe(EVAL_RUN_REAL_SERVERS_CONFLICT_MESSAGE);
  });

  it("keeps an entry naming one of the version's own servers and refuses one naming a server it does not write", async () => {
    const withServer = clone(AgentSchema, AGENT);
    withServer.spec!.mcpServers = [create(AgentMcpServerSchema, { name: "zendesk", url: "https://acme-co.zendesk.com/mcp" })];
    await temp.store.saveResource(ApiResourceKind.agent, AGENT_ID, AgentSchema, withServer);
    await temp.store.saveResource(ApiResourceKind.plugin, "plg_1", PluginSchema, THERMOS);
    const kept = evalRow("", EvalRunPhase.unspecified);
    kept.spec!.allowTools = ["mcp__zendesk__search", "mcp__plugin_thermos_github__*"];
    const ctx = evaluated(kept);
    await newResolveEvalRunDefaultsStep(temp.store, ALLOW_ALL).execute(ctx);
    expect(ctx.newState.spec?.allowTools).toEqual(["mcp__zendesk__search", "mcp__plugin_thermos_github__*"]);
    const other = evalRow("", EvalRunPhase.unspecified);
    other.spec!.allowTools = ["mcp__github__*"];
    const refused = await failure(() => newResolveEvalRunDefaultsStep(temp.store, ALLOW_ALL).execute(evaluated(other)));
    expect(refused.code).toBe(Code.InvalidArgument);
    expect(refused.rawMessage).toBe(
      "allow_tools entry 'mcp__github__*' names MCP server 'github', which is none of the servers the agent or its subagents write",
    );
  });

  it("keeps an entry naming an attached plugin's own server, stamps the version's hash and mints the id", async () => {
    await seedAgent();
    await temp.store.saveResource(ApiResourceKind.plugin, "plg_1", PluginSchema, THERMOS);
    const row = evalRow("", EvalRunPhase.unspecified);
    const tools = ["Read", "mcp__plugin_thermos_github__search_issues"];
    row.spec!.allowTools = [...tools];
    const ctx = evaluated(row);
    await newResolveEvalRunDefaultsStep(temp.store, ALLOW_ALL).execute(ctx);
    expect(ctx.newState.spec?.allowTools).toEqual(tools);
    expect(ctx.newState.spec?.agentVersion).toBe(AGENT_HASH);
    expect(ctx.newState.metadata?.id).toMatch(/^evr_/);
    expect(ctx.newState.metadata?.name).toBe(ctx.newState.metadata?.id);
    const version = ctx.get(EVAL_RUN_LOAD_KEY) as EvaluatedLoad;
    expect(version.plugins.map((entry) => [entry.plugin.metadata?.id, entry.attached, entry.compared])).toEqual([["plg_1", true, false]]);
    expect([...version.selected]).toEqual(["plg_1"]);
  });
});

describe("ResolveEvalRunDefaults with a compared plugin", () => {
  const CANDIDATE: Plugin = create(PluginSchema, {
    metadata: { id: "plg_candidate", org: ORG, slug: "candidate", name: "candidate" },
    status: { digest: OTHER_DIGEST },
  });

  function comparing(pluginId: string) {
    const row = evalRow("", EvalRunPhase.unspecified);
    row.spec!.comparedPluginId = pluginId;
    const ctx = createCtx(row);
    ctx.set(EVAL_RUN_SUBJECT_KEY, { kind: "agent", org: ORG, row: AGENT } satisfies LoadedSubject);
    return ctx;
  }

  it("asks can_view on a compared plugin the agent does not attach, and stamps it last, unattached", async () => {
    await seedAgent();
    await temp.store.saveResource(ApiResourceKind.plugin, "plg_1", PluginSchema, THERMOS);
    await temp.store.saveResource(ApiResourceKind.plugin, "plg_candidate", PluginSchema, CANDIDATE);
    const asked: string[] = [];
    const viewing: Authorizer = {
      authorize: (_caller, check) => {
        asked.push(`${IamPermission[check.permission]} ${check.resourceId}`);
        return Promise.resolve({ kind: "allow" });
      },
    };
    const ctx = comparing("plg_candidate");
    await newResolveEvalRunDefaultsStep(temp.store, viewing).execute(ctx);
    expect(asked).toEqual(["can_view plg_candidate"]);
    const load = ctx.get(EVAL_RUN_LOAD_KEY) as EvaluatedLoad;
    expect(load.plugins.map((entry) => [entry.plugin.metadata?.id, entry.digest, entry.attached, entry.compared])).toEqual([
      ["plg_1", DIGEST, true, false],
      ["plg_candidate", OTHER_DIGEST, false, true],
    ]);
    expect([...load.selected]).toEqual(["plg_candidate"]);
  });

  it("refuses a compared plugin the creator may not view, and is INTERNAL when the authorizer cannot answer", async () => {
    await seedAgent();
    await temp.store.saveResource(ApiResourceKind.plugin, "plg_1", PluginSchema, THERMOS);
    await temp.store.saveResource(ApiResourceKind.plugin, "plg_candidate", PluginSchema, CANDIDATE);
    const deny: Authorizer = { authorize: () => Promise.resolve({ kind: "deny", reason: "not a viewer" }) };
    const refused = await failure(() => newResolveEvalRunDefaultsStep(temp.store, deny).execute(comparing("plg_candidate")));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(EVAL_RUN_COMPARED_DENIED_MESSAGE);
    const down: Authorizer = { authorize: () => Promise.resolve({ kind: "unavailable", cause: new Error("engine down") }) };
    const fault = await failure(() => newResolveEvalRunDefaultsStep(temp.store, down).execute(comparing("plg_candidate")));
    expect(fault.code).toBe(Code.Internal);
  });

  it("asks nothing for a compared plugin the agent attaches, and answers NOT_FOUND for one that does not exist", async () => {
    await seedAgent();
    await temp.store.saveResource(ApiResourceKind.plugin, "plg_1", PluginSchema, THERMOS);
    const deny: Authorizer = { authorize: () => Promise.resolve({ kind: "deny", reason: "" }) };
    const ctx = comparing("plg_1");
    await newResolveEvalRunDefaultsStep(temp.store, deny).execute(ctx);
    expect((ctx.get(EVAL_RUN_LOAD_KEY) as EvaluatedLoad).plugins.map((entry) => entry.compared)).toEqual([true]);
    const missing = await failure(() => newResolveEvalRunDefaultsStep(temp.store, ALLOW_ALL).execute(comparing("plg_gone")));
    expect(missing.code).toBe(Code.NotFound);
  });
});

describe("an eval run that names no subject", () => {
  it("is INVALID_ARGUMENT at the create's question and at the subject's read, whatever the proto's rules let through", async () => {
    const row = evalRow("", EvalRunPhase.unspecified);
    row.spec!.subject = { case: undefined };
    expect(() => resolveEvalRunCreateTargets(createCtx(row))).toThrow(EVAL_RUN_NO_SUBJECT_MESSAGE);
    const refused = await failure(() => newLoadEvalRunSubjectStep(temp.store).execute(createCtx(row)));
    expect(refused.code).toBe(Code.InvalidArgument);
    expect(refused.rawMessage).toBe(EVAL_RUN_NO_SUBJECT_MESSAGE);
  });
});

describe("ResolveEvalRunDefaults' case sources and store faults", () => {
  const CANDIDATE: Plugin = create(PluginSchema, {
    metadata: { id: "plg_candidate", org: ORG, slug: "candidate", name: "candidate" },
    status: { digest: OTHER_DIGEST },
  });

  /** The store, but a read of plugin `id` fails. */
  function failingRead(id: string): Store {
    return new Proxy(temp.store, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver);
        if (property === "getResource") {
          return (kind: ApiResourceKind, resourceId: string, ...rest: unknown[]) =>
            resourceId === id
              ? Promise.reject(new Error("disk unavailable"))
              : (target.getResource as (...args: unknown[]) => unknown).call(target, kind, resourceId, ...rest);
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  function withSources(ids: ReadonlyArray<string | undefined>, compared = "") {
    const row = evalRow("", EvalRunPhase.unspecified);
    row.spec!.comparedPluginId = compared;
    row.spec!.cases = ids.map((id) =>
      create(EvalRunCaseSourceSchema, id === undefined ? {} : { source: { case: "plugin", value: { kind: ApiResourceKind.plugin, id } } }),
    );
    const ctx = createCtx(row);
    ctx.set(EVAL_RUN_SUBJECT_KEY, { kind: "agent", org: ORG, row: AGENT } satisfies LoadedSubject);
    return ctx;
  }

  beforeEach(async () => {
    await seedAgent();
    await temp.store.saveResource(ApiResourceKind.plugin, "plg_1", PluginSchema, THERMOS);
  });

  it("matches a case source named by organization and slug, and refuses one the try would not load by that slug", async () => {
    const bySlug = (slug: string) => {
      const ctx = withSources([]);
      ctx.newState.spec!.cases = [
        create(EvalRunCaseSourceSchema, { source: { case: "plugin", value: { kind: ApiResourceKind.plugin, org: ORG, slug } } }),
      ];
      return ctx;
    };
    const ctx = bySlug("thermos");
    await newResolveEvalRunDefaultsStep(temp.store, ALLOW_ALL).execute(ctx);
    expect([...(ctx.get(EVAL_RUN_LOAD_KEY) as EvaluatedLoad).selected]).toEqual(["plg_1"]);
    const refused = await failure(() => newResolveEvalRunDefaultsStep(temp.store, ALLOW_ALL).execute(bySlug("elsewhere")));
    expect(refused.rawMessage).toBe(evalRunUnloadedCaseSourceMessage("elsewhere"));
  });

  it("matches a case source named by id, and passes over one that names no source", async () => {
    const ctx = withSources([undefined, "plg_1"]);
    await newResolveEvalRunDefaultsStep(temp.store, ALLOW_ALL).execute(ctx);
    expect([...(ctx.get(EVAL_RUN_LOAD_KEY) as EvaluatedLoad).selected]).toEqual(["plg_1"]);
  });

  it("refuses an id the try would not load, naming the plugin by the slug its row holds, else by the id", async () => {
    await temp.store.saveResource(ApiResourceKind.plugin, "plg_candidate", PluginSchema, CANDIDATE);
    const named = await failure(() => newResolveEvalRunDefaultsStep(temp.store, ALLOW_ALL).execute(withSources(["plg_candidate"])));
    expect(named.code).toBe(Code.InvalidArgument);
    expect(named.rawMessage).toBe(evalRunUnloadedCaseSourceMessage("candidate"));
    const gone = await failure(() => newResolveEvalRunDefaultsStep(temp.store, ALLOW_ALL).execute(withSources(["plg_gone"])));
    expect(gone.rawMessage).toBe(evalRunUnloadedCaseSourceMessage("plg_gone"));
  });

  it("names a case source the caller cannot view by the id it sent, never the slug its row holds", async () => {
    await temp.store.saveResource(ApiResourceKind.plugin, "plg_candidate", PluginSchema, CANDIDATE);
    const asked: string[] = [];
    const viewerOfNothing: Authorizer = {
      authorize: (_caller, check) => {
        asked.push(`${ApiResourceKind[check.resourceKind]}:${check.resourceId}`);
        return Promise.resolve({ kind: "deny", reason: "" });
      },
    };
    const hidden = await failure(() =>
      newResolveEvalRunDefaultsStep(temp.store, viewerOfNothing).execute(withSources(["plg_candidate"])),
    );
    expect(hidden.code).toBe(Code.InvalidArgument);
    expect(hidden.rawMessage).toBe(evalRunUnloadedCaseSourceMessage("plg_candidate"));
    expect(asked).toEqual(["plugin:plg_candidate"]);
    const down: Authorizer = { authorize: () => Promise.resolve({ kind: "unavailable", cause: new Error("engine down") }) };
    const fault = await failure(() => newResolveEvalRunDefaultsStep(temp.store, down).execute(withSources(["plg_candidate"])));
    expect(fault.code).toBe(Code.Internal);
  });

  it("is INTERNAL when the store cannot read a refused case source, or the compared plugin", async () => {
    const source = await failure(() =>
      newResolveEvalRunDefaultsStep(failingRead("plg_broken"), ALLOW_ALL).execute(withSources(["plg_broken"])),
    );
    expect(source.code).toBe(Code.Internal);
    expect(source.rawMessage).toBe("failed to read a case source plugin");
    const compared = await failure(() =>
      newResolveEvalRunDefaultsStep(failingRead("plg_candidate"), ALLOW_ALL).execute(withSources([], "plg_candidate")),
    );
    expect(compared.code).toBe(Code.Internal);
    expect(compared.rawMessage).toBe("failed to load the compared plugin");
  });
});

describe("ValidateEvalRunTargets on an agent", () => {
  it("passes a target the catalog runs, and refuses one naming a model it does not, naming the target", async () => {
    const row = evalRow("", EvalRunPhase.unspecified);
    row.spec!.targets = [
      create(EvalRunTargetSchema, { harness: Harness.NATIVE, modelName: "native-model" }),
      create(EvalRunTargetSchema, { harness: Harness.NATIVE, modelName: "no-such-model" }),
    ];
    const refused = await failure(() => newValidateEvalRunTargetsStep(catalog).execute(createCtx(row)));
    expect(refused.code).toBe(Code.InvalidArgument);
    expect(refused.rawMessage).toContain("spec.targets[1].model_name");
    expect(refused.rawMessage).toContain("no-such-model");

    row.spec!.targets = [row.spec!.targets[0]!];
    await newValidateEvalRunTargetsStep(catalog).execute(createCtx(row));
  });
});

describe("PlanEvalRun on an agent", () => {
  /** `count` cases, each with one regex grader. */
  function suiteOf(count: number, prefix = "case"): PluginFiles {
    return inMemoryPluginFiles(
      new Map(
        Array.from({ length: count }, (_, index) => index).flatMap((index): Array<[string, string]> => [
          [`evals/${prefix}-${index}/prompt.md`, "Say yes.\n"],
          [`evals/${prefix}-${index}/graders/says-yes.md`, "---\ntype: regex\npattern: yes\n---\n"],
        ]),
      ),
    );
  }

  /** A source answering each digest's files, counting the reads by digest. */
  function source(byDigest: Readonly<Record<string, PluginFiles>>): EvalSuiteSource & { reads: string[] } {
    const reads: string[] = [];
    return {
      reads,
      readArchive: ({ digest }) => {
        reads.push(digest);
        const files = byDigest[digest];
        return files === undefined ? Promise.reject(new Error(`no archive ${digest}`)) : Promise.resolve(files);
      },
    };
  }

  function plugin(id: string, slug: string, digest: string): Plugin {
    return create(PluginSchema, { metadata: { id, slug, name: slug, org: ORG }, status: { digest } });
  }

  function planCtx(
    row: EvalRun,
    plugins: ReadonlyArray<Plugin>,
    selected?: ReadonlyArray<string>,
    evals: EvaluatedLoad["evals"] = [],
  ) {
    const ctx = createCtx(row);
    ctx.set(EVAL_RUN_LOAD_KEY, {
      agentSpec: AGENT.spec,
      plugins: plugins.map((entry) => ({ plugin: entry, digest: entry.status?.digest ?? "", attached: true, compared: false })),
      selected: new Set(selected ?? plugins.map((entry) => entry.metadata?.id ?? "")),
      evals,
    } satisfies EvaluatedLoad);
    return ctx;
  }

  function anEval(id: string, slug: string, digest: string): EvaluatedLoad["evals"][number] {
    return { eval: create(EvalSchema, { metadata: { id, slug, name: slug, org: ORG }, status: { digest } }), digest };
  }

  function planRow(spec: Partial<{ caseGlob: string; runs: number }> = {}): EvalRun {
    const row = evalRow("evr_1", EvalRunPhase.unspecified);
    row.spec!.agentVersion = AGENT_HASH;
    row.spec!.runs = spec.runs ?? 1;
    row.spec!.caseGlob = spec.caseGlob ?? "";
    return row;
  }

  it("refuses an eval with no spec, and a case_glob that is not a glob, before reading any suite", async () => {
    const files = source({ [DIGEST]: suiteOf(1) });
    const noSpec = planRow();
    noSpec.spec = undefined;
    const specRefusal = await failure(() =>
      newPlanEvalRunStep(files, catalog).execute(planCtx(noSpec, [plugin("plg_1", "thermos", DIGEST)])),
    );
    expect(specRefusal.code).toBe(Code.InvalidArgument);
    expect(specRefusal.rawMessage).toBe("spec is required for an eval run");

    const badGlob = await failure(() =>
      newPlanEvalRunStep(files, catalog).execute(
        planCtx(planRow({ caseGlob: "review-[z-a]" }), [plugin("plg_1", "thermos", DIGEST)]),
      ),
    );
    expect(badGlob.code).toBe(Code.InvalidArgument);
    expect(badGlob.rawMessage).toBe(evalRunCaseGlobMessage("review-[z-a]", "range 'z-a' is reversed"));
    expect(files.reads).toEqual([]);
  });

  it("stamps a plugin with no version to read as having no cases, without reading it", async () => {
    const files = source({ [DIGEST]: suiteOf(2) });
    const ctx = planCtx(planRow(), [plugin("plg_0", "unbuilt", ""), plugin("plg_1", "thermos", DIGEST)]);
    await newPlanEvalRunStep(files, catalog).execute(ctx);
    expect(files.reads).toEqual([DIGEST]);
    const status = ctx.newState.status;
    expect(status?.plugins.map((entry) => [entry.pluginSlug, entry.pluginDigest, entry.notRunReason])).toEqual([
      ["unbuilt", "", PLUGIN_NO_CASES_REASON],
      ["thermos", DIGEST, ""],
    ]);
    expect(status?.phase).toBe(EvalRunPhase.pending);
    expect(status?.agentVersionHash).toBe(AGENT_HASH);
    expect(status?.triesTotal).toBe(2);
  });

  it("passes a suite source's own refusal through, and makes any other fault INTERNAL", async () => {
    const thermos = [plugin("plg_1", "thermos", DIGEST)];
    const notFound = await failure(() =>
      newPlanEvalRunStep(
        { readArchive: () => Promise.reject(new ConnectError("plugin version not found", Code.NotFound)) },
        catalog,
      ).execute(planCtx(planRow(), thermos)),
    );
    expect(notFound.code).toBe(Code.NotFound);
    expect(notFound.rawMessage).toBe("plugin version not found");

    const broken = await failure(() =>
      newPlanEvalRunStep({ readArchive: () => Promise.reject(new Error("disk")) }, catalog).execute(
        planCtx(planRow(), thermos),
      ),
    );
    expect(broken.code).toBe(Code.Internal);
    expect(broken.rawMessage).toBe("failed to read the plugins' evals");
  });

  it("counts every plugin's cases together against the limits, though each alone fits", async () => {
    const files = source({ [DIGEST]: suiteOf(120, "a"), [OTHER_DIGEST]: suiteOf(120, "b") });
    const tooLarge = await failure(() =>
      newPlanEvalRunStep(files, catalog).execute(
        planCtx(planRow(), [plugin("plg_1", "thermos", DIGEST), plugin("plg_2", "refunds", OTHER_DIGEST)]),
      ),
    );
    expect(tooLarge.code).toBe(Code.FailedPrecondition);
    expect(tooLarge.rawMessage).toBe(evalRunTooLargeMessage(240, 240));
  });

  it("stamps each Eval after the plugins, reads its suite by its kind, and counts its cases with theirs", async () => {
    const files = source({ [DIGEST]: suiteOf(2), [OTHER_DIGEST]: suiteOf(3, "e") });
    const reads: string[] = [];
    const kinds = { readArchive: (ref: Parameters<EvalSuiteSource["readArchive"]>[0]) => (reads.push(ref.kind), files.readArchive(ref)) };
    const ctx = planCtx(planRow(), [plugin("plg_1", "thermos", DIGEST)], undefined, [anEval("evs_1", "support", OTHER_DIGEST)]);
    await newPlanEvalRunStep(kinds, catalog).execute(ctx);
    expect(reads).toEqual(["plugin", "eval"]);
    const status = ctx.newState.status;
    expect(status?.evals.map((entry) => [entry.evalId, entry.evalSlug, entry.evalDigest, entry.notRunReason])).toEqual([
      ["evs_1", "support", OTHER_DIGEST, ""],
    ]);
    expect(status?.triesTotal).toBe(5);
  });

  it("stamps an Eval with no version or no case to read as not run, and runs on with the plugins", async () => {
    const files = source({ [DIGEST]: suiteOf(1), [OTHER_DIGEST]: suiteOf(0) });
    const ctx = planCtx(planRow(), [plugin("plg_1", "thermos", DIGEST)], undefined, [
      anEval("evs_0", "unbuilt", ""),
      anEval("evs_1", "empty", OTHER_DIGEST),
    ]);
    await newPlanEvalRunStep(files, catalog).execute(ctx);
    expect(ctx.newState.status?.evals.map((entry) => entry.notRunReason)).toEqual([PLUGIN_NO_CASES_REASON, PLUGIN_NO_CASES_REASON]);
    expect(ctx.newState.status?.triesTotal).toBe(1);
  });

  it("passes an Eval suite source's own refusal through, and makes any other fault INTERNAL", async () => {
    const support = [anEval("evs_1", "support", OTHER_DIGEST)];
    const failing = (error: Error): EvalSuiteSource => ({
      readArchive: (ref) => (ref.kind === "eval" ? Promise.reject(error) : Promise.resolve(suiteOf(1))),
    });
    const notFound = await failure(() =>
      newPlanEvalRunStep(failing(new ConnectError("eval version not found", Code.NotFound)), catalog).execute(
        planCtx(planRow(), [], undefined, support),
      ),
    );
    expect(notFound.code).toBe(Code.NotFound);
    const broken = await failure(() =>
      newPlanEvalRunStep(failing(new Error("disk")), catalog).execute(planCtx(planRow(), [], undefined, support)),
    );
    expect(broken.code).toBe(Code.Internal);
    expect(broken.rawMessage).toBe("failed to read the evals' cases");
  });

  it("refuses filters that keep no case of any plugin", async () => {
    const files = source({ [DIGEST]: suiteOf(2) });
    const refused = await failure(() =>
      newPlanEvalRunStep(files, catalog).execute(
        planCtx(planRow({ caseGlob: "nothing-*" }), [plugin("plg_1", "thermos", DIGEST)]),
      ),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe("no eval case matches case_glob and case_tags");
  });
});

describe("EnsureEvaluatedAgentStillExists", () => {
  function storedCtx(row: EvalRun) {
    return createCtx(row);
  }

  it("leaves everything as it is while the agent is there", async () => {
    await seedAgent();
    const row = await saved(evalRow("evr_1", EvalRunPhase.pending));
    const access = lifecycle();
    await newEnsureEvalRunSubjectStillExistsStep(temp.store, access, silentLogger).execute(storedCtx(row));
    expect((await stored("evr_1")).metadata?.id).toBe("evr_1");
    expect(access.cleaned).toEqual([]);
  });

  it("removes the eval and its access when the agent was deleted meanwhile, and answers NOT_FOUND for the agent", async () => {
    const row = await saved(evalRow("evr_1", EvalRunPhase.pending));
    const access = lifecycle();
    const { logger, warned } = warnings();
    const refused = await failure(() =>
      newEnsureEvalRunSubjectStillExistsStep(temp.store, access, logger).execute(storedCtx(row)),
    );
    expect(refused.code).toBe(Code.NotFound);
    expect(refused.rawMessage).toContain(AGENT_ID);
    await expect(stored("evr_1")).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(access.cleaned).toEqual([`eval_run evr_1 ${ORG}`]);
    expect(warned).toEqual([
      {
        message: "an eval run's subject was deleted while it was created; removing the eval run",
        fields: { evalRunId: "evr_1", subject: `agent ${AGENT_ID}` },
      },
    ]);
  });

  it("is INTERNAL when the agent cannot be read, or the eval of a deleted agent cannot be removed", async () => {
    const row = await saved(evalRow("evr_1", EvalRunPhase.pending));
    const unread = await failure(() =>
      newEnsureEvalRunSubjectStillExistsStep(failing(temp.store, "getResource"), undefined, silentLogger).execute(
        storedCtx(row),
      ),
    );
    expect(unread.code).toBe(Code.Internal);
    expect(unread.rawMessage).toBe("failed to read the agent to evaluate again");

    const access = lifecycle();
    const unremoved = await failure(() =>
      newEnsureEvalRunSubjectStillExistsStep(failing(temp.store, "deleteResource"), access, silentLogger).execute(
        storedCtx(row),
      ),
    );
    expect(unremoved.code).toBe(Code.Internal);
    expect(unremoved.rawMessage).toBe("failed to remove the eval run of a deleted subject");
    expect(access.cleaned).toEqual([]);
    expect((await stored("evr_1")).metadata?.id).toBe("evr_1");
  });
});

describe("StartEvalRunWorkflow on an agent", () => {
  it("leaves the pending row as it is when the workflow starts", async () => {
    const row = await saved(evalRow("evr_1", EvalRunPhase.pending));
    const port = workflows();
    const ctx = createCtx(row);
    await newStartEvalRunWorkflowStep(temp.store, port, silentLogger).execute(ctx);
    expect(port.calls).toEqual(["start evr_1"]);
    expect(ctx.newState.status?.phase).toBe(EvalRunPhase.pending);
    expect((await stored("evr_1")).status?.phase).toBe(EvalRunPhase.pending);
  });

  it("marks a pending eval failed with a fixed sentence when the start fails, and logs the engine's error", async () => {
    const row = await saved(evalRow("evr_1", EvalRunPhase.pending));
    const ctx = createCtx(row);
    const { logger, warned } = warnings();
    await newStartEvalRunWorkflowStep(
      temp.store,
      workflows({ start: () => Promise.reject(new Error("dial tcp 10.0.0.7:7233: connection refused")) }),
      logger,
    ).execute(ctx);
    expect(ctx.newState.status?.phase).toBe(EvalRunPhase.failed);
    expect(ctx.newState.status?.error).toBe(EVAL_RUN_NOT_STARTED_ERROR);
    expect(ctx.newState.status?.finishedAt).toBeDefined();
    expect((await stored("evr_1")).status?.phase).toBe(EvalRunPhase.failed);
    expect(warned).toEqual([
      {
        message: "an eval run's workflow could not start; marking it failed",
        fields: { evalRunId: "evr_1", cause: "dial tcp 10.0.0.7:7233: connection refused" },
      },
    ]);
  });

  it("never overwrites a row the workflow already moved to running", async () => {
    const pending = evalRow("evr_1", EvalRunPhase.pending);
    await saved(evalRow("evr_1", EvalRunPhase.running));
    const ctx = createCtx(pending);
    await newStartEvalRunWorkflowStep(
      temp.store,
      workflows({ start: () => Promise.reject(new Error("deadline exceeded")) }),
      silentLogger,
    ).execute(ctx);
    expect(ctx.newState.status?.phase).toBe(EvalRunPhase.running);
    expect(ctx.newState.status?.error).toBe("");
    expect((await stored("evr_1")).status?.phase).toBe(EvalRunPhase.running);
  });

  it("answers NOT_FOUND for a row gone, and INTERNAL when the store cannot save the failure", async () => {
    const failingStart = workflows({ start: () => Promise.reject(new Error("no engine")) });
    const gone = await failure(() =>
      newStartEvalRunWorkflowStep(temp.store, failingStart, silentLogger).execute(
        createCtx(evalRow("evr_gone", EvalRunPhase.pending)),
      ),
    );
    expect(gone.code).toBe(Code.NotFound);
    expect(gone.rawMessage).toContain("evr_gone");

    const fault = await failure(() =>
      newStartEvalRunWorkflowStep(failing(temp.store, "updateResource"), failingStart, silentLogger).execute(
        createCtx(evalRow("evr_1", EvalRunPhase.pending)),
      ),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to save the eval run");
  });
});

describe("an eval run whose workflow ended without finishing", () => {
  function outlived(id: string, phase: EvalRunPhase): EvalRun {
    const row = evalRow(id, phase);
    row.status!.startedAt = timestampFromMs(Date.now() - 31 * DAY_MS);
    return row;
  }

  it("is answered failed by get and stored so, while a live one is answered as it is", async () => {
    const stale = await saved(outlived("evr_stale", EvalRunPhase.running));
    const ctx = idCtx(stale);
    await newSettleEndedEvalRunStep(temp.store).execute(ctx);
    const answered = ctx.get(TARGET_RESOURCE_KEY) as EvalRun;
    expect(answered.status?.phase).toBe(EvalRunPhase.failed);
    expect(answered.status?.error).toBe(EVAL_RUN_WORKFLOW_ENDED_ERROR);
    expect(answered.status?.finishedAt).toBeDefined();
    expect((await stored("evr_stale")).status?.phase).toBe(EvalRunPhase.failed);

    const live = await saved(evalRow("evr_live", EvalRunPhase.running));
    const liveCtx = idCtx(live);
    await newSettleEndedEvalRunStep(temp.store).execute(liveCtx);
    expect(liveCtx.get(TARGET_RESOURCE_KEY)).toBe(live);
  });

  it("is answered as read when its row is gone before the settle", async () => {
    const gone = outlived("evr_gone", EvalRunPhase.pending);
    expect(await settleEndedEvalRun(temp.store, gone)).toBe(gone);
    expect(gone.status?.phase).toBe(EvalRunPhase.pending);
  });
});

describe("CancelEvalRun on an agent", () => {
  function result(ctx: ReturnType<typeof idCtx>): EvalRun {
    return ctx.get(EVAL_RUN_RESULT_KEY) as EvalRun;
  }

  it("answers a finished eval unchanged without asking the workflow", async () => {
    const finished = await saved(evalRow("evr_1", EvalRunPhase.completed));
    const port = workflows();
    const ctx = idCtx(finished);
    await newCancelEvalRunStep(temp.store, port).execute(ctx);
    expect(port.calls).toEqual([]);
    expect(result(ctx)).toBe(finished);
  });

  it("fails an eval that outlived its workflow without asking it", async () => {
    const stale = evalRow("evr_1", EvalRunPhase.running);
    stale.status!.startedAt = timestampFromMs(Date.now() - 31 * DAY_MS);
    await saved(stale);
    const port = workflows();
    const ctx = idCtx(stale);
    await newCancelEvalRunStep(temp.store, port).execute(ctx);
    expect(port.calls).toEqual([]);
    expect(result(ctx).status?.phase).toBe(EvalRunPhase.failed);
    expect(result(ctx).status?.error).toBe(EVAL_RUN_WORKFLOW_ENDED_ERROR);
  });

  it("answers the row unchanged when the workflow takes the cancel", async () => {
    const running = await saved(evalRow("evr_1", EvalRunPhase.running));
    const port = workflows();
    const ctx = idCtx(running);
    await newCancelEvalRunStep(temp.store, port).execute(ctx);
    expect(port.calls).toEqual(["cancel evr_1"]);
    expect(result(ctx)).toBe(running);
    expect((await stored("evr_1")).status?.phase).toBe(EvalRunPhase.running);
  });

  it("with no workflow, fails a running eval and cancels a pending one", async () => {
    const none = workflows({ cancel: () => Promise.resolve("not-found") });
    const running = await saved(evalRow("evr_running", EvalRunPhase.running));
    const runningCtx = idCtx(running);
    await newCancelEvalRunStep(temp.store, none).execute(runningCtx);
    expect(result(runningCtx).status?.phase).toBe(EvalRunPhase.failed);
    expect(result(runningCtx).status?.error).toBe(EVAL_RUN_WORKFLOW_ENDED_ERROR);

    const pending = await saved(evalRow("evr_pending", EvalRunPhase.pending));
    const pendingCtx = idCtx(pending);
    await newCancelEvalRunStep(temp.store, none).execute(pendingCtx);
    expect(result(pendingCtx).status?.phase).toBe(EvalRunPhase.partial);
    expect(result(pendingCtx).status?.partialReason).toBe(EvalRunPartialReason.cancelled);
    expect(result(pendingCtx).status?.finishedAt).toBeDefined();
    expect((await stored("evr_pending")).status?.phase).toBe(EvalRunPhase.partial);
  });

  it("is UNAVAILABLE with no engine connection and INTERNAL on any other fault", async () => {
    const running = await saved(evalRow("evr_1", EvalRunPhase.running));
    const noEngine = await failure(() =>
      newCancelEvalRunStep(
        temp.store,
        workflows({ cancel: () => Promise.reject(new EvalRunEngineUnavailableError()) }),
      ).execute(idCtx(running)),
    );
    expect(noEngine.code).toBe(Code.Unavailable);
    expect(noEngine.rawMessage).toBe(EVAL_RUN_NO_ENGINE_MESSAGE);

    const fault = await failure(() =>
      newCancelEvalRunStep(temp.store, workflows({ cancel: () => Promise.reject(new Error("transport")) })).execute(
        idCtx(running),
      ),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to cancel the eval run");
    expect((await stored("evr_1")).status?.phase).toBe(EvalRunPhase.running);
  });
});

describe("ListEvalRunsByAgent", () => {
  function listCtx(caller = testCallerIdentity()) {
    return new RequestContext(
      ListEvalRunsByAgentRequestSchema,
      create(ListEvalRunsByAgentRequestSchema, { agentId: AGENT_ID }),
      caller,
      ApiResourceKind.agent,
    );
  }

  function listed(ctx: ReturnType<typeof listCtx>): EvalRunList {
    return ctx.get(EVAL_RUN_RESULT_KEY) as EvalRunList;
  }

  it("keeps only the evals the caller may view, and every one for a server-composed caller", async () => {
    await saved(evalRow("evr_a", EvalRunPhase.completed));
    await saved(evalRow("evr_b", EvalRunPhase.completed));
    const asked: string[] = [];
    const onlyA: Authorizer = {
      authorize: (_caller, check) => {
        asked.push(`${IamPermission[check.permission]} ${ApiResourceKind[check.resourceKind]} ${check.resourceId}`);
        return Promise.resolve(check.resourceId === "evr_a" ? { kind: "allow" } : { kind: "deny", reason: "" });
      },
    };
    const ctx = listCtx();
    await newListEvalRunsBySubjectStep<typeof ListEvalRunsByAgentRequestSchema>("agent", temp.store, onlyA, silentLogger).execute(ctx);
    expect(listed(ctx).entries.map((row) => row.metadata?.id)).toEqual(["evr_a"]);
    expect(listed(ctx).entries).toHaveLength(1);
    expect(asked.sort()).toEqual(["can_view eval_run evr_a", "can_view eval_run evr_b"]);

    asked.length = 0;
    const serverCtx = listCtx(testCallerIdentity({ origin: "in-process" }));
    await newListEvalRunsBySubjectStep<typeof ListEvalRunsByAgentRequestSchema>("agent", temp.store, onlyA, silentLogger).execute(serverCtx);
    expect(listed(serverCtx).entries).toHaveLength(2);
    expect(asked).toEqual([]);
  });

  it("walks only the agent's evals carrying every label named, a page at a time", async () => {
    const labels = { suite: "nightly-agent", tier: "gold" };
    const labelled = (id: string, rowLabels: Record<string, string>) => {
      const row = evalRow(id, EvalRunPhase.completed);
      row.metadata!.labels = rowLabels;
      return saved(row);
    };
    await labelled("evr_lbl_0", {});
    await labelled("evr_lbl_1", labels);
    await labelled("evr_lbl_2", { suite: "nightly-agent" });
    await labelled("evr_lbl_3", { ...labels, extra: "x" });
    const allow: Authorizer = { authorize: () => Promise.resolve({ kind: "allow" }) };

    const walked: string[] = [];
    let pageToken = "";
    do {
      const ctx = new RequestContext(
        ListEvalRunsByAgentRequestSchema,
        create(ListEvalRunsByAgentRequestSchema, { agentId: AGENT_ID, labels, pageSize: 1, pageToken }),
        testCallerIdentity(),
        ApiResourceKind.agent,
      );
      await newListEvalRunsBySubjectStep<typeof ListEvalRunsByAgentRequestSchema>("agent", temp.store, allow, silentLogger).execute(ctx);
      expect(listed(ctx).entries.length).toBeLessThanOrEqual(1);
      walked.push(...listed(ctx).entries.map((row) => row.metadata!.id));
      pageToken = listed(ctx).nextPageToken;
    } while (pageToken !== "");
    expect(new Set(walked)).toEqual(new Set(["evr_lbl_1", "evr_lbl_3"]));
    expect(walked).toHaveLength(2);
  });

  it("fails closed when the authorizer cannot answer, and answers a store fault INTERNAL", async () => {
    await saved(evalRow("evr_a", EvalRunPhase.completed));
    const down: Authorizer = {
      authorize: () => Promise.resolve({ kind: "unavailable", cause: new Error("engine down") }),
    };
    const unanswered = await failure(() => newListEvalRunsBySubjectStep<typeof ListEvalRunsByAgentRequestSchema>("agent", temp.store, down, silentLogger).execute(listCtx()));
    expect(unanswered.code).toBe(Code.Internal);
    expect(unanswered.rawMessage).toBe("failed to authorize the agent's eval runs");

    const allow: Authorizer = { authorize: () => Promise.resolve({ kind: "allow" }) };
    const fault = await failure(() =>
      newListEvalRunsBySubjectStep<typeof ListEvalRunsByAgentRequestSchema>("agent", failing(temp.store, "queryResources"), allow, silentLogger).execute(listCtx()),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to list the agent's eval runs");
  });

  it("answers each eval without its tries, keeping every summary, and leaves the stored row whole", async () => {
    const row = evalRow("evr_tries", EvalRunPhase.completed);
    row.status!.plugins = [
      create(EvalRunPluginSchema, {
        pluginId: "plg_1",
        pluginSlug: "thermos",
        pluginDigest: DIGEST,
        cases: [
          create(EvalRunCaseSchema, {
            caseName: "a",
            notes: ["a note"],
            targets: [
              create(EvalRunCaseTargetSchema, {
                withPlugin: create(EvalRunArmSchema, {
                  score: 1,
                  gradedTries: 2,
                  tries: [
                    create(EvalRunTrySchema, { index: 1, state: EvalRunTryState.graded, score: 1 }),
                    create(EvalRunTrySchema, { index: 2, state: EvalRunTryState.graded, score: 1 }),
                  ],
                }),
              }),
              create(EvalRunCaseTargetSchema, { notRunReason: "not run: model 'x' is not in Stigmer's catalog" }),
            ],
          }),
        ],
      }),
    ];
    await saved(row);
    const ctx = listCtx(testCallerIdentity({ origin: "in-process" }));
    await newListEvalRunsBySubjectStep<typeof ListEvalRunsByAgentRequestSchema>("agent", temp.store, { authorize: () => Promise.resolve({ kind: "allow" }) }, silentLogger).execute(
      ctx,
    );
    const evalCase = listed(ctx).entries[0]?.status?.plugins[0]?.cases[0];
    expect(evalCase?.targets[0]?.withPlugin?.tries).toEqual([]);
    expect(evalCase?.targets[0]?.withPlugin?.score).toBe(1);
    expect(evalCase?.targets[0]?.withPlugin?.gradedTries).toBe(2);
    expect(evalCase?.targets[1]?.notRunReason).toContain("not in Stigmer's catalog");
    expect(evalCase?.notes).toEqual(["a note"]);
    expect((await stored("evr_tries")).status?.plugins[0]?.cases[0]?.targets[0]?.withPlugin?.tries).toHaveLength(2);
  });
});

describe("a chain built wrong", () => {
  it("fails loudly when the agent, the version, the cancel's target or the delete's row was never stashed", async () => {
    const noAgent = await failure(() =>
      newResolveEvalRunDefaultsStep(temp.store, ALLOW_ALL).execute(createCtx(evalRow("", EvalRunPhase.unspecified))),
    );
    expect(noAgent.code).toBe(Code.Internal);
    expect(noAgent.rawMessage).toBe("eval run subject not found in context");

    const noVersion = await failure(() =>
      newPlanEvalRunStep({ readArchive: () => Promise.reject(new Error("unread")) }, catalog).execute(
        createCtx(evalRow("evr_1", EvalRunPhase.unspecified)),
      ),
    );
    expect(noVersion.code).toBe(Code.Internal);
    expect(noVersion.rawMessage).toBe("eval run load not found in context");

    const noTarget = await failure(() => newCancelEvalRunStep(temp.store, workflows()).execute(bareIdCtx()));
    expect(noTarget.code).toBe(Code.Internal);
    expect(noTarget.rawMessage).toBe("eval run not found in context");

    const noExisting = await failure(() => newRefuseActiveEvalRunDeleteStep().execute(bareIdCtx()));
    expect(noExisting.code).toBe(Code.Internal);
    expect(noExisting.rawMessage).toBe("existing eval run not found in context");
  });

  it("lets a finished eval's delete through", () => {
    const ctx = bareIdCtx();
    ctx.set(EXISTING_RESOURCE_KEY, evalRow("evr_1", EvalRunPhase.completed));
    expect(() => newRefuseActiveEvalRunDeleteStep().execute(ctx)).not.toThrow();
  });
});
