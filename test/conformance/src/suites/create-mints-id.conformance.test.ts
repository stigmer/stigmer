// Conformance suite for the server-minted id: a create, or an apply that
// creates, never keeps a `metadata.id` the caller sent.
// Domain: every open-source resource kind (the pipeline's BuildNewState).
//
// The contract under test (stigmer/stigmer#1489, building on #1266): a new
// resource's id is the server's, `{kind id_prefix}_{lowercase ULID}`, whatever
// the request carried. The chosen id is replaced, not refused, because an
// exported manifest applied again carries its id and must keep working. For a
// kind whose id other grants hang off, choosing the id would be choosing a
// grant, so the promise is held on every create and every creating apply.
// Organization is the one kind that derives its id from its slug after the id
// is minted (CopySlugToId), so its row asserts id equals slug instead of the
// minted shape. Memory mints its id early, and that early mint is still the
// server's, never the caller's.
//
// Each row sends the request with `metadata.id` set to a well-formed id of the
// kind's own shape (`foreignId`), so the refusal proven is of a plausible id,
// not only a malformed one, then reads the resource back by the answered id.
// The kind's id prefix is read from the proto's `kind_meta` at run time, never
// spelled here.
//
// The completeness case holds the table to the API: every create and apply the
// committed stubs declare on an open-source kind has a row here, or one of the
// stated exemptions (a kind no open-source edition serves, whose rows
// stigmer/stigmer-cloud#1026 asks for in the composition; an input with no
// metadata to carry an id, and IdentityAccount's create, which no wire caller
// may send). A new create RPC fails it until the row is added.
//
// Two rows depend on the edition. An execution create needs a Temporal engine
// behind the server: the plain local targets refuse it Unavailable before any
// id is minted (pinned by the agentexecution and workflowexecution suites), so
// those rows run where `scheduleFiring` (the engine-backed flag those suites
// gate the same boundary on) holds. On the open-source server the execution
// class pins the same rule for both creates, with an engine behind it
// ("create never keeps a metadata.id the caller sent" in each suite). Memory
// create is refused for the cloud's platform-client-minted caller
// (`firstPartyMemoryCapture`). Each gated group sits under its own
// `describe.skipIf` on the flag itself, so the skip names its reason.
//
// Deliberately out of scope: an update's id (an update addresses an existing
// row by its id), an apply that updates (it keeps the stored id, pinned by each
// kind's own suite), ids derived from a natural key (IdentityAccount,
// IamPolicy; the server's unit suites pin the derivation), and what each create
// does beyond the id (each kind's own suite).
import { getOption, hasOption } from "@bufbuild/protobuf";
import {
  ApiResourceKind,
  ApiResourceKindSchema,
  ResourceTier,
  kind_meta,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceKindMeta } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { declaredMethods } from "../inventory/rpc-contract";
import { makeSlackAgentChannel } from "../support/agentchannels";
import { makeAgentExecution } from "../support/agentexecutions";
import { makeAgentInstance } from "../support/agentinstances";
import { makeAgent } from "../support/agents";
import { makeAgentShare } from "../support/agentshares";
import { makeApiKey } from "../support/apikeys";
import { makeSlackChannelApp } from "../support/channelapps";
import { makeEnvironment } from "../support/environments";
import { makeExecutionContext } from "../support/executioncontexts";
import { makeMcpServer } from "../support/mcpservers";
import { enableOrganizationMemory, makeMemory } from "../support/memories";
import { foreignId, uniqueName, uniqueOrg } from "../support/naming";
import { makeOAuthApp } from "../support/oauthapps";
import { makeSchedule } from "../support/schedules";
import { makeSession } from "../support/sessions";
import { makeWorkflowExecution } from "../support/workflowexecutions";
import { makeWorkflowInstance } from "../support/workflowinstances";
import { makeWorkflow } from "../support/workflows";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
// Read at collection time so an edition without a capability reports its rows
// SKIPPED (the conformance guide's rule), never as passes that returned early.
const capabilities = createTarget().capabilities;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

// ─── The kinds, as the proto declares them ─────────────────────────────────

function kindMetaOf(kind: ApiResourceKind): ApiResourceKindMeta {
  const value = ApiResourceKindSchema.values.find((candidate) => candidate.number === kind);
  if (value === undefined || !hasOption(value, kind_meta)) {
    throw new Error(`ApiResourceKind ${kind} carries no kind_meta option`);
  }
  return getOption(value, kind_meta);
}

// Every kind by its canonical name (`kind_meta.name`, the name its resource
// message carries), for resolving which kind a declared method creates.
function kindsByName(): Map<string, ApiResourceKind> {
  const byName = new Map<string, ApiResourceKind>();
  for (const value of ApiResourceKindSchema.values) {
    if (hasOption(value, kind_meta)) byName.set(getOption(value, kind_meta).name, value.number);
  }
  return byName;
}

// The shape BuildNewState mints: the kind's prefix, then a ULID lowercased,
// 26 characters of Crockford base-32 (no i, l, o or u).
function mintedIdPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}_[0-9a-hjkmnp-tv-z]{26}$`);
}

// ─── The rows ──────────────────────────────────────────────────────────────

interface Scope {
  readonly org: string;
}

interface Answer {
  readonly id: string;
  readonly slug: string;
}

interface Row {
  // The case's label: the RPC's tag, literal, then the kind.
  readonly title: string;
  // `<Service>.<method>`, as declaredMethods keys it.
  readonly key: string;
  readonly kind: ApiResourceKind;
  // "minted": the id is BuildNewState's. "slug": the kind derives its id from
  // its slug after the mint (Organization's CopySlugToId).
  readonly idRule: "minted" | "slug";
  // The edition the row needs, when not every target serves its RPC to this
  // caller: "engine" (an execution create), "memory" (first-party memory).
  readonly edition?: "engine" | "memory";
  // Creates what the request references, sends it with metadata.id set to
  // chosenId, defers the cleanup, and answers the resource's id and slug.
  send(scope: Scope, chosenId: string): Promise<Answer>;
  // Reads the resource back by id and answers the id the read carries.
  read(id: string): Promise<string | undefined>;
}

// The answer of a create: its id and slug, or a failure naming the RPC.
function answerOf(key: string, metadata: { id: string; slug: string } | undefined): Answer {
  if (metadata === undefined) throw new Error(`${key} answered no metadata`);
  return { id: metadata.id, slug: metadata.slug };
}

async function agentIn(org: string): Promise<{ id: string; slug: string; instanceId: string }> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("mint-agent") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  const instanceId = agent.status?.defaultInstanceId ?? "";
  if (instanceId === "") throw new Error(`agent ${agent.metadata!.id} was created without a default instance`);
  return { id: agent.metadata!.id, slug: agent.metadata!.slug, instanceId };
}

async function workflowIn(org: string): Promise<string> {
  const workflow = await clients.workflowCommand.create(makeWorkflow({ org, name: uniqueName("mint-wfl") }));
  fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));
  return workflow.metadata!.id;
}

// An execution create is authorized against the org's credits where billing
// gates run, so the org is funded there first.
async function fundedWhereMetered(org: string): Promise<void> {
  if (!target.capabilities.billingGates) return;
  if (target.fundTenancy === undefined) {
    throw new Error(`target ${target.name} declares billingGates but cannot fund a tenancy`);
  }
  await target.fundTenancy(org);
}

const ROWS: readonly Row[] = [
  {
    title: "[rpc:AgentCommandController.create] Agent",
    key: "AgentCommandController.create",
    kind: ApiResourceKind.agent,
    idRule: "minted",
    async send({ org }, chosenId) {
      const name = uniqueName("mint-agent");
      const created = await clients.agentCommand.create({ ...makeAgent({ org, name }), metadata: { id: chosenId, name, org } });
      fixtures.defer(() => clients.agentCommand.delete({ value: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.agentQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:AgentCommandController.apply] Agent (apply as a create)",
    key: "AgentCommandController.apply",
    kind: ApiResourceKind.agent,
    idRule: "minted",
    async send({ org }, chosenId) {
      const name = uniqueName("mint-agent");
      const applied = await clients.agentCommand.apply({ ...makeAgent({ org, name }), metadata: { id: chosenId, name, org } });
      fixtures.defer(() => clients.agentCommand.delete({ value: applied.metadata!.id }));
      return answerOf(this.key, applied.metadata);
    },
    async read(id) {
      return (await clients.agentQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:AgentChannelCommandController.create] AgentChannel",
    key: "AgentChannelCommandController.create",
    kind: ApiResourceKind.agent_channel,
    idRule: "minted",
    async send({ org }, chosenId) {
      const agent = await agentIn(org);
      const name = uniqueName("mint-channel");
      const created = await clients.agentChannelCommand.create({
        ...makeSlackAgentChannel(org, name, agent.slug),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.agentChannelCommand.delete({ value: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.agentChannelQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:AgentChannelCommandController.apply] AgentChannel (apply as a create)",
    key: "AgentChannelCommandController.apply",
    kind: ApiResourceKind.agent_channel,
    idRule: "minted",
    async send({ org }, chosenId) {
      const agent = await agentIn(org);
      const name = uniqueName("mint-channel");
      const applied = await clients.agentChannelCommand.apply({
        ...makeSlackAgentChannel(org, name, agent.slug),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.agentChannelCommand.delete({ value: applied.metadata!.id }));
      return answerOf(this.key, applied.metadata);
    },
    async read(id) {
      return (await clients.agentChannelQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:AgentExecutionCommandController.create] AgentExecution",
    key: "AgentExecutionCommandController.create",
    kind: ApiResourceKind.agent_execution,
    idRule: "minted",
    edition: "engine",
    async send({ org }, chosenId) {
      await fundedWhereMetered(org);
      const agent = await agentIn(org);
      const name = uniqueName("mint-aex");
      // No runner need pick the run up: the create's answer and a read of the
      // stored row are all this row judges.
      const created = await clients.agentExecutionCommand.create({
        ...makeAgentExecution({ org, name, agentId: agent.id }),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.agentExecutionQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:AgentInstanceCommandController.create] AgentInstance",
    key: "AgentInstanceCommandController.create",
    kind: ApiResourceKind.agent_instance,
    idRule: "minted",
    async send({ org }, chosenId) {
      const agent = await agentIn(org);
      const name = uniqueName("mint-ain");
      const created = await clients.agentInstanceCommand.create({
        ...makeAgentInstance({ org, name, agentId: agent.id }),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.agentInstanceCommand.delete({ value: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.agentInstanceQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:AgentInstanceCommandController.apply] AgentInstance (apply as a create)",
    key: "AgentInstanceCommandController.apply",
    kind: ApiResourceKind.agent_instance,
    idRule: "minted",
    async send({ org }, chosenId) {
      const agent = await agentIn(org);
      const name = uniqueName("mint-ain");
      const applied = await clients.agentInstanceCommand.apply({
        ...makeAgentInstance({ org, name, agentId: agent.id }),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.agentInstanceCommand.delete({ value: applied.metadata!.id }));
      return answerOf(this.key, applied.metadata);
    },
    async read(id) {
      return (await clients.agentInstanceQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:AgentShareCommandController.create] AgentShare",
    key: "AgentShareCommandController.create",
    kind: ApiResourceKind.agent_share,
    idRule: "minted",
    async send({ org }, chosenId) {
      const agent = await agentIn(org);
      const name = uniqueName("mint-share");
      const created = await clients.agentShareCommand.create({
        ...makeAgentShare(org, agent.slug, { name }),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.agentShareCommand.delete({ value: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.agentShareQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:AgentShareCommandController.apply] AgentShare (apply as a create)",
    key: "AgentShareCommandController.apply",
    kind: ApiResourceKind.agent_share,
    idRule: "minted",
    async send({ org }, chosenId) {
      const agent = await agentIn(org);
      const name = uniqueName("mint-share");
      const applied = await clients.agentShareCommand.apply({
        ...makeAgentShare(org, agent.slug, { name }),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.agentShareCommand.delete({ value: applied.metadata!.id }));
      return answerOf(this.key, applied.metadata);
    },
    async read(id) {
      return (await clients.agentShareQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:ChannelAppCommandController.create] ChannelApp",
    key: "ChannelAppCommandController.create",
    kind: ApiResourceKind.channel_app,
    idRule: "minted",
    async send({ org }, chosenId) {
      const name = uniqueName("mint-chapp");
      const created = await clients.channelAppCommand.create({
        ...makeSlackChannelApp(org, name),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.channelAppCommand.delete({ resourceId: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.channelAppQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:ChannelAppCommandController.apply] ChannelApp (apply as a create)",
    key: "ChannelAppCommandController.apply",
    kind: ApiResourceKind.channel_app,
    idRule: "minted",
    async send({ org }, chosenId) {
      const name = uniqueName("mint-chapp");
      const applied = await clients.channelAppCommand.apply({
        ...makeSlackChannelApp(org, name),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.channelAppCommand.delete({ resourceId: applied.metadata!.id }));
      return answerOf(this.key, applied.metadata);
    },
    async read(id) {
      return (await clients.channelAppQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:EnvironmentCommandController.create] Environment",
    key: "EnvironmentCommandController.create",
    kind: ApiResourceKind.environment,
    idRule: "minted",
    async send({ org }, chosenId) {
      const name = uniqueName("mint-env");
      const created = await clients.environmentCommand.create({
        ...makeEnvironment({ org, name }),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.environmentCommand.delete({ resourceId: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.environmentQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:EnvironmentCommandController.apply] Environment (apply as a create)",
    key: "EnvironmentCommandController.apply",
    kind: ApiResourceKind.environment,
    idRule: "minted",
    async send({ org }, chosenId) {
      const name = uniqueName("mint-env");
      const applied = await clients.environmentCommand.apply({
        ...makeEnvironment({ org, name }),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.environmentCommand.delete({ resourceId: applied.metadata!.id }));
      return answerOf(this.key, applied.metadata);
    },
    async read(id) {
      return (await clients.environmentQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:ExecutionContextCommandController.create] ExecutionContext",
    key: "ExecutionContextCommandController.create",
    kind: ApiResourceKind.execution_context,
    idRule: "minted",
    async send({ org }, chosenId) {
      const name = uniqueName("mint-ectx");
      // A unique parent execution id: a context is looked up by it, so two
      // rows must never share one.
      const created = await clients.executionContextCommand.create({
        ...makeExecutionContext({ org, name, executionId: uniqueName("aex") }),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.executionContextCommand.delete({ resourceId: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.executionContextQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:ExecutionContextCommandController.apply] ExecutionContext (apply as a create)",
    key: "ExecutionContextCommandController.apply",
    kind: ApiResourceKind.execution_context,
    idRule: "minted",
    async send({ org }, chosenId) {
      const name = uniqueName("mint-ectx");
      const applied = await clients.executionContextCommand.apply({
        ...makeExecutionContext({ org, name, executionId: uniqueName("aex") }),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.executionContextCommand.delete({ resourceId: applied.metadata!.id }));
      return answerOf(this.key, applied.metadata);
    },
    async read(id) {
      return (await clients.executionContextQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:McpServerCommandController.create] McpServer",
    key: "McpServerCommandController.create",
    kind: ApiResourceKind.mcp_server,
    idRule: "minted",
    async send({ org }, chosenId) {
      const name = uniqueName("mint-mcp");
      const created = await clients.mcpServerCommand.create({
        ...makeMcpServer({ org, name }),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.mcpServerQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:McpServerCommandController.apply] McpServer (apply as a create)",
    key: "McpServerCommandController.apply",
    kind: ApiResourceKind.mcp_server,
    idRule: "minted",
    async send({ org }, chosenId) {
      const name = uniqueName("mint-mcp");
      const applied = await clients.mcpServerCommand.apply({
        ...makeMcpServer({ org, name }),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: applied.metadata!.id }));
      return answerOf(this.key, applied.metadata);
    },
    async read(id) {
      return (await clients.mcpServerQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:MemoryCommandController.create] Memory",
    key: "MemoryCommandController.create",
    kind: ApiResourceKind.memory,
    idRule: "minted",
    edition: "memory",
    async send({ org }, chosenId) {
      // Memory create fails closed while the organization's switch is off.
      await enableOrganizationMemory(clients, org);
      const name = uniqueName("mint-mem");
      const created = await clients.memoryCommand.create({ ...makeMemory(org, { name }), metadata: { id: chosenId, name, org } });
      fixtures.defer(() => clients.memoryCommand.delete({ value: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.memoryQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:ScheduleCommandController.create] Schedule",
    key: "ScheduleCommandController.create",
    kind: ApiResourceKind.schedule,
    idRule: "minted",
    async send({ org }, chosenId) {
      const agent = await agentIn(org);
      const name = uniqueName("mint-sched");
      const created = await clients.scheduleCommand.create({
        ...makeSchedule(org, name, agent.slug),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.scheduleCommand.delete({ value: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.scheduleQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:ScheduleCommandController.apply] Schedule (apply as a create)",
    key: "ScheduleCommandController.apply",
    kind: ApiResourceKind.schedule,
    idRule: "minted",
    async send({ org }, chosenId) {
      const agent = await agentIn(org);
      const name = uniqueName("mint-sched");
      const applied = await clients.scheduleCommand.apply({
        ...makeSchedule(org, name, agent.slug),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.scheduleCommand.delete({ value: applied.metadata!.id }));
      return answerOf(this.key, applied.metadata);
    },
    async read(id) {
      return (await clients.scheduleQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:SessionCommandController.create] Session",
    key: "SessionCommandController.create",
    kind: ApiResourceKind.session,
    idRule: "minted",
    async send({ org }, chosenId) {
      const agent = await agentIn(org);
      const name = uniqueName("mint-ses");
      const created = await clients.sessionCommand.create({
        ...makeSession({ org, name, agentInstanceId: agent.instanceId }),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.sessionCommand.delete({ value: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.sessionQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:SessionCommandController.apply] Session (apply as a create)",
    key: "SessionCommandController.apply",
    kind: ApiResourceKind.session,
    idRule: "minted",
    async send({ org }, chosenId) {
      const agent = await agentIn(org);
      const name = uniqueName("mint-ses");
      const applied = await clients.sessionCommand.apply({
        ...makeSession({ org, name, agentInstanceId: agent.instanceId }),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.sessionCommand.delete({ value: applied.metadata!.id }));
      return answerOf(this.key, applied.metadata);
    },
    async read(id) {
      return (await clients.sessionQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:WorkflowCommandController.create] Workflow",
    key: "WorkflowCommandController.create",
    kind: ApiResourceKind.workflow,
    idRule: "minted",
    async send({ org }, chosenId) {
      const name = uniqueName("mint-wfl");
      const created = await clients.workflowCommand.create({ ...makeWorkflow({ org, name }), metadata: { id: chosenId, name, org } });
      fixtures.defer(() => clients.workflowCommand.delete({ value: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.workflowQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:WorkflowCommandController.apply] Workflow (apply as a create)",
    key: "WorkflowCommandController.apply",
    kind: ApiResourceKind.workflow,
    idRule: "minted",
    async send({ org }, chosenId) {
      const name = uniqueName("mint-wfl");
      const applied = await clients.workflowCommand.apply({ ...makeWorkflow({ org, name }), metadata: { id: chosenId, name, org } });
      fixtures.defer(() => clients.workflowCommand.delete({ value: applied.metadata!.id }));
      return answerOf(this.key, applied.metadata);
    },
    async read(id) {
      return (await clients.workflowQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:WorkflowExecutionCommandController.create] WorkflowExecution",
    key: "WorkflowExecutionCommandController.create",
    kind: ApiResourceKind.workflow_execution,
    idRule: "minted",
    edition: "engine",
    async send({ org }, chosenId) {
      await fundedWhereMetered(org);
      const workflowId = await workflowIn(org);
      const name = uniqueName("mint-wex");
      // As with the agent execution: the answer and the stored row are judged,
      // not the run.
      const created = await clients.workflowExecutionCommand.create({
        ...makeWorkflowExecution({ org, name, workflowId }),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.workflowExecutionQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:WorkflowInstanceCommandController.create] WorkflowInstance",
    key: "WorkflowInstanceCommandController.create",
    kind: ApiResourceKind.workflow_instance,
    idRule: "minted",
    async send({ org }, chosenId) {
      const workflowId = await workflowIn(org);
      const name = uniqueName("mint-win");
      const created = await clients.workflowInstanceCommand.create({
        ...makeWorkflowInstance({ org, name, workflowId }),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.workflowInstanceCommand.delete({ value: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.workflowInstanceQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:WorkflowInstanceCommandController.apply] WorkflowInstance (apply as a create)",
    key: "WorkflowInstanceCommandController.apply",
    kind: ApiResourceKind.workflow_instance,
    idRule: "minted",
    async send({ org }, chosenId) {
      const workflowId = await workflowIn(org);
      const name = uniqueName("mint-win");
      const applied = await clients.workflowInstanceCommand.apply({
        ...makeWorkflowInstance({ org, name, workflowId }),
        metadata: { id: chosenId, name, org },
      });
      fixtures.defer(() => clients.workflowInstanceCommand.delete({ value: applied.metadata!.id }));
      return answerOf(this.key, applied.metadata);
    },
    async read(id) {
      return (await clients.workflowInstanceQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:ApiKeyCommandController.create] ApiKey",
    key: "ApiKeyCommandController.create",
    kind: ApiResourceKind.api_key,
    idRule: "minted",
    async send({ org }, chosenId) {
      const name = uniqueName("mint-key");
      const created = await clients.apiKeyCommand.create({ ...makeApiKey({ org, name }), metadata: { id: chosenId, name, org } });
      fixtures.defer(() => clients.apiKeyCommand.delete({ value: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.apiKeyQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:OAuthAppCommandController.create] OAuthApp",
    key: "OAuthAppCommandController.create",
    kind: ApiResourceKind.oauth_app,
    idRule: "minted",
    async send({ org }, chosenId) {
      const name = uniqueName("mint-oapp");
      const created = await clients.oauthAppCommand.create({ ...makeOAuthApp(org, name), metadata: { id: chosenId, name, org } });
      fixtures.defer(() => clients.oauthAppCommand.delete({ resourceId: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.oauthAppQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:OAuthAppCommandController.apply] OAuthApp (apply as a create)",
    key: "OAuthAppCommandController.apply",
    kind: ApiResourceKind.oauth_app,
    idRule: "minted",
    async send({ org }, chosenId) {
      const name = uniqueName("mint-oapp");
      const applied = await clients.oauthAppCommand.apply({ ...makeOAuthApp(org, name), metadata: { id: chosenId, name, org } });
      fixtures.defer(() => clients.oauthAppCommand.delete({ resourceId: applied.metadata!.id }));
      return answerOf(this.key, applied.metadata);
    },
    async read(id) {
      return (await clients.oauthAppQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:PlatformClientCommandController.create] PlatformClient",
    key: "PlatformClientCommandController.create",
    kind: ApiResourceKind.platform_client,
    idRule: "minted",
    async send({ org }, chosenId) {
      // Built here rather than through support/platformclients.ts, whose
      // builder sends no id: the request is the support module's, plus the id.
      const name = uniqueName("mint-pcl");
      const created = await clients.platformClientCommand.create({
        apiVersion: "iam.stigmer.ai/v1",
        kind: "PlatformClient",
        metadata: { id: chosenId, name, org },
        spec: { autoProvisionAccounts: true, autoGrantOnOrg: false, allowedOrigins: [] },
      });
      // Create answers the client beside its one-time secret.
      const answer = answerOf(this.key, created.platformClient?.metadata);
      fixtures.defer(() => clients.platformClientCommand.delete({ resourceId: answer.id }));
      return answer;
    },
    async read(id) {
      return (await clients.platformClientQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:OrganizationCommandController.create] Organization",
    key: "OrganizationCommandController.create",
    kind: ApiResourceKind.organization,
    idRule: "slug",
    async send(_scope, chosenId) {
      // The organization is the scope itself, so the provisioned one goes
      // unused: the row founds its own.
      const created = await clients.organizationCommand.create({
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { id: chosenId, name: uniqueOrg() },
      });
      fixtures.defer(() => clients.organizationCommand.delete({ value: created.metadata!.id }));
      return answerOf(this.key, created.metadata);
    },
    async read(id) {
      return (await clients.organizationQuery.get({ value: id })).metadata?.id;
    },
  },
  {
    title: "[rpc:OrganizationCommandController.apply] Organization (apply as a create)",
    key: "OrganizationCommandController.apply",
    kind: ApiResourceKind.organization,
    idRule: "slug",
    async send(_scope, chosenId) {
      const applied = await clients.organizationCommand.apply({
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { id: chosenId, name: uniqueOrg() },
      });
      fixtures.defer(() => clients.organizationCommand.delete({ value: applied.metadata!.id }));
      return answerOf(this.key, applied.metadata);
    },
    async read(id) {
      return (await clients.organizationQuery.get({ value: id })).metadata?.id;
    },
  },
];

// Exempt by name: a create the API declares on an open-source kind that no
// caller over the wire may send.
const EXEMPT_BY_NAME: ReadonlyMap<string, string> = new Map([
  [
    "IdentityAccountCommandController.create",
    "create is internal: every wire caller is refused PermissionDenied on every edition (suites/identityaccount.conformance.test.ts)",
  ],
]);

// The row's three assertions: the caller's id replaced, the answered id the
// kind's shape (or its slug), and a read-back under the answered id.
async function assertMintsItsOwnId(row: Row): Promise<void> {
  const prefix = kindMetaOf(row.kind).idPrefix;
  const chosenId = foreignId(prefix);
  const context = await target.provisionTenancy();
  fixtures.defer(() => target.cleanupTenancy(context));

  const answered = await row.send({ org: context.org }, chosenId);

  expect(answered.id, `${row.key} kept the caller's id ${chosenId}; the server must assign its own`).not.toBe(chosenId);
  if (row.idRule === "slug") {
    expect(answered.id, `${row.key} answered id ${answered.id}, expected the slug ${answered.slug}`).toBe(answered.slug);
  } else {
    expect(answered.id, `${row.key} answered id ${answered.id}, not a ${prefix}_ id the server minted`).toMatch(
      mintedIdPattern(prefix),
    );
  }
  const read = await row.read(answered.id);
  expect(read, `${row.key}: a read of ${answered.id} answered id ${read ?? "(none)"}`).toBe(answered.id);
}

// Each case is a [title, row] pair so `%s` prints the title verbatim: a
// `$title` placeholder quotes and truncates it, cutting the tag the call
// verdict reads from the test's name.
function casesFor(edition: Row["edition"]): ReadonlyArray<readonly [string, Row]> {
  return ROWS.filter((row) => row.edition === edition).map((row) => [row.title, row] as const);
}

const CASE_TITLE = "%s: the caller's id is replaced by the server's, and the resource reads back under it";

describe("A create never keeps the id the caller sent", () => {
  it.for(casesFor(undefined))(CASE_TITLE, async ([, row]) => {
    await assertMintsItsOwnId(row);
  });

  // An execution create needs a Temporal engine behind the server: the plain
  // local targets refuse it Unavailable before an id is minted, and the
  // execution class pins the rule there instead.
  describe.skipIf(!capabilities.scheduleFiring)("with an engine behind the server", () => {
    it.for(casesFor("engine"))(CASE_TITLE, async ([, row]) => {
      await assertMintsItsOwnId(row);
    });
  });

  // Memory create is refused for the cloud's platform-client-minted caller.
  describe.skipIf(!capabilities.firstPartyMemoryCapture)("where first-party memory capture is served", () => {
    it.for(casesFor("memory"))(CASE_TITLE, async ([, row]) => {
      await assertMintsItsOwnId(row);
    });
  });

  it("every declared create and apply on an open-source kind has a row or a stated exemption", async () => {
    const byName = kindsByName();
    const needingRow = new Map<string, ApiResourceKind>();
    const exemptions: string[] = [];
    const exemptedByName: string[] = [];
    const unresolved: string[] = [];
    for (const { key, method } of await declaredMethods()) {
      if (method.name !== "create" && method.name !== "apply") continue;
      const kind = byName.get(method.output.name) ?? byName.get(method.input.name);
      if (kind === undefined) {
        unresolved.push(`${key} (input ${method.input.typeName}, output ${method.output.typeName})`);
        continue;
      }
      if (kindMetaOf(kind).tier !== ResourceTier.open_source) {
        exemptions.push(`${key}: served only by Stigmer Cloud or Enterprise; pinned where its controller lives, in stigmer-cloud (stigmer/stigmer-cloud#1026)`);
      } else if (method.input.fields.every((field) => field.name !== "metadata")) {
        exemptions.push(`${key}: the input carries no id a caller could choose`);
      } else if (EXEMPT_BY_NAME.has(key)) {
        exemptions.push(`${key}: ${EXEMPT_BY_NAME.get(key)}`);
        exemptedByName.push(key);
      } else {
        needingRow.set(key, kind);
      }
    }
    const report = `exemptions:\n  ${exemptions.join("\n  ")}`;
    expect(unresolved, `no kind resolves from these methods' output or input message names:\n  ${unresolved.join("\n  ")}`).toEqual([]);

    expect(
      exemptedByName,
      "a by-name exemption names an RPC that is not a declared create or apply on an open-source kind; drop it",
    ).toEqual([...EXEMPT_BY_NAME.keys()]);

    const rowKeys = ROWS.map((row) => row.key);
    const duplicated = rowKeys.filter((key, index) => rowKeys.indexOf(key) !== index);
    expect(duplicated, `rows repeated for ${duplicated.join(", ")}`).toEqual([]);
    const missing = [...needingRow.keys()].filter((key) => !rowKeys.includes(key)).sort();
    const extra = rowKeys.filter((key) => !needingRow.has(key)).sort();
    expect(
      { missing, extra },
      `the row table and the declared RPCs disagree: missing rows for [${missing.join(", ")}]; rows for an undeclared or exempt RPC [${extra.join(", ")}]\n${report}`,
    ).toEqual({ missing: [], extra: [] });

    for (const row of ROWS) {
      expect(row.title.startsWith(`[rpc:${row.key}]`), `row ${row.key} is titled "${row.title}"; its tag must be [rpc:${row.key}]`).toBe(true);
      const created = needingRow.get(row.key);
      expect(row.kind, `row ${row.key} names kind ${ApiResourceKind[row.kind]}; the RPC creates ${created === undefined ? "(none)" : ApiResourceKind[created]}`).toBe(created);
    }
  });
});
