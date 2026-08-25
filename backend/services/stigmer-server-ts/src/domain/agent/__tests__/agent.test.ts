/**
 * Pins the agent domain against Go's pkg/domain/agent tests — through the
 * REAL stack: a composed server on an ephemeral port, a native gRPC
 * client, the full interceptor chain, and the DD-002 in-process
 * agentinstance edge (agent create applies its default instance through
 * the router transport, traversing the whole chain).
 *
 * The load-bearing pins:
 *   - default-agent resolution (stigmer/stigmer#356): NotFound copy when
 *     nothing is labeled; FailedPrecondition copy when labeled agents
 *     exist but none is public; incumbent-wins (LOWEST metadata.id) among
 *     public labeled candidates — an older non-public labeled agent never
 *     wins;
 *   - MCP env-merge semantics: agent-declared entries win, among servers
 *     first-encountered wins, only declaration fields are copied;
 *   - enabled-tools validation (#402): byte-pinned INVALID_ARGUMENT copy
 *     for unknown tools and for resource-template names; empty
 *     enabled_tools and unconnected servers skip validation;
 *   - cascade delete (oss#611): ALL instances of the agent are swept by
 *     spec.agent_id — including a cross-ORG instance — same-org shares are
 *     deleted, cross-org shares of the same agent SURVIVE, and a
 *     bystander agent's instances are untouched.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { AgentInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/command_pb";
import { AgentInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/query_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import {
  DEFAULT_AGENT_LABEL,
  DEFAULT_AGENT_LABEL_VALUE,
} from "../defaultagent.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "acme";

let dir: string;
let server: ComposedServer;
let transport: Transport;
let command: Client<typeof AgentCommandController>;
let query: Client<typeof AgentQueryController>;
let instanceCommand: Client<typeof AgentInstanceCommandController>;
let instanceQuery: Client<typeof AgentInstanceQueryController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "agent-domain-test-"));
  server = composeServer({
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
  command = createClient(AgentCommandController, transport);
  query = createClient(AgentQueryController, transport);
  instanceCommand = createClient(AgentInstanceCommandController, transport);
  instanceQuery = createClient(AgentInstanceQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

let agentCounter = 0;
function agentInput(overrides?: {
  name?: string;
  org?: string;
  visibility?: ApiResourceVisibility;
  labels?: Record<string, string>;
  usages?: Array<{ slug: string; enabledTools?: string[] }>;
  env?: Record<
    string,
    { description?: string; isSecret?: boolean; optional?: boolean }
  >;
}) {
  agentCounter += 1;
  return {
    apiVersion: API_VERSION,
    kind: "Agent",
    metadata: {
      name: overrides?.name ?? `Test Agent ${agentCounter}`,
      org: overrides?.org ?? ORG,
      visibility:
        overrides?.visibility ??
        ApiResourceVisibility.api_resource_visibility_unspecified,
      labels: overrides?.labels ?? {},
    },
    spec: {
      instructions: "You are a helpful agent used by the domain tests.",
      mcpServerUsages: (overrides?.usages ?? []).map((usage) => ({
        // The spec's CEL rule pins kind == mcp_server; org stays empty so
        // NormalizeReferences resolves it from the agent's own org.
        mcpServerRef: { kind: ApiResourceKind.mcp_server, slug: usage.slug },
        enabledTools: usage.enabledTools ?? [],
      })),
      env: overrides?.env ?? {},
    },
  };
}

/**
 * Seeds an MCP server straight into the store — the mcpserver controller
 * arrives with sub-project #9, and the agent pipelines only need the row.
 */
async function seedMcpServer(opts: {
  id: string;
  slug: string;
  org?: string;
  env?: Record<
    string,
    { description?: string; isSecret?: boolean; optional?: boolean }
  >;
  tools?: string[];
  resourceTemplates?: string[];
}): Promise<void> {
  const connected =
    opts.tools !== undefined || opts.resourceTemplates !== undefined;
  const mcpServer = create(McpServerSchema, {
    apiVersion: API_VERSION,
    kind: "McpServer",
    metadata: {
      id: opts.id,
      name: opts.slug,
      slug: opts.slug,
      org: opts.org ?? ORG,
    },
    spec: { env: opts.env ?? {} },
    status: connected
      ? {
          discoveredCapabilities: {
            tools: (opts.tools ?? []).map((name) => ({ name })),
            resourceTemplates: (opts.resourceTemplates ?? []).map((name) => ({
              name,
            })),
          },
        }
      : undefined,
  });
  await server.store.saveResource(
    ApiResourceKind.mcp_server,
    opts.id,
    McpServerSchema,
    mcpServer,
  );
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

// The getDefault tests are order-dependent within this describe: the
// platform default is a GLOBAL singleton, so the empty state must be
// asserted before any labeled agent exists.
describe("agent getDefault (platform default resolution, #356)", () => {
  it("answers NotFound with the configured-hint copy when nothing carries the label", async () => {
    // org is required for authorization scoping only; resolution is global.
    const error = await grpcError(() => query.getDefault({ org: ORG }));
    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(
      "No default agent available. Ensure an agent with label " +
        "stigmer.ai/default-agent=true and visibility_public exists: " +
        "no agent labeled stigmer.ai/default-agent=true",
    );
  });

  it("answers FailedPrecondition when labeled agents exist but none is public", async () => {
    await command.create(
      agentInput({
        name: "Labeled But Org Visible",
        labels: { [DEFAULT_AGENT_LABEL]: DEFAULT_AGENT_LABEL_VALUE },
      }),
    );

    const error = await grpcError(() => query.getDefault({ org: ORG }));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(
      "Default agent exists but is not visibility_public: agents labeled " +
        "stigmer.ai/default-agent=true exist but none is visibility_public",
    );
  });

  it("serves the incumbent — the LOWEST metadata.id among PUBLIC labeled candidates", async () => {
    const first = await command.create(
      agentInput({
        name: "Public Default One",
        visibility: ApiResourceVisibility.visibility_public,
        labels: { [DEFAULT_AGENT_LABEL]: DEFAULT_AGENT_LABEL_VALUE },
      }),
    );
    const second = await command.create(
      agentInput({
        name: "Public Default Two",
        visibility: ApiResourceVisibility.visibility_public,
        labels: { [DEFAULT_AGENT_LABEL]: DEFAULT_AGENT_LABEL_VALUE },
      }),
    );

    const firstId = first.metadata!.id;
    const secondId = second.metadata!.id;
    const incumbentId = firstId < secondId ? firstId : secondId;

    // The older NON-public labeled agent (previous test) has a lower id
    // than both public candidates; incumbent-wins must skip it.
    // A DIFFERENT org resolves the same singleton — resolution is global.
    const resolved = await query.getDefault({ org: "globex" });
    expect(resolved.metadata?.id).toBe(incumbentId);
  });
});

describe("agent MCP env merge (merge_mcp_env_specs)", () => {
  it("merges declarations: agent-declared wins, first-encountered server wins, declaration fields copied", async () => {
    await seedMcpServer({
      id: "mcp_env_one",
      slug: "env-srv-one",
      env: {
        SHARED_VAR: { description: "shared from one", isSecret: true },
        ONLY_ONE: { description: "one only", optional: true },
      },
    });
    await seedMcpServer({
      id: "mcp_env_two",
      slug: "env-srv-two",
      env: {
        SHARED_VAR: { description: "shared from two" },
        ONLY_TWO: { description: "two only" },
      },
    });

    const created = await command.create(
      agentInput({
        name: "Env Merge Agent",
        usages: [{ slug: "env-srv-one" }, { slug: "env-srv-two" }],
        env: {
          AGENT_VAR: { description: "declared on the agent", isSecret: true },
          ONLY_TWO: {
            description: "agent wins",
            isSecret: true,
            optional: true,
          },
        },
      }),
    );

    const env = created.spec!.env;
    // Agent-declared entries always win over server declarations.
    expect(env.AGENT_VAR?.description).toBe("declared on the agent");
    expect(env.ONLY_TWO?.description).toBe("agent wins");
    expect(env.ONLY_TWO?.isSecret).toBe(true);
    expect(env.ONLY_TWO?.optional).toBe(true);
    // Among servers, first-encountered (usage order) wins for overlaps.
    expect(env.SHARED_VAR?.description).toBe("shared from one");
    expect(env.SHARED_VAR?.isSecret).toBe(true);
    // Declaration fields are copied verbatim from the server's spec.
    expect(env.ONLY_ONE?.description).toBe("one only");
    expect(env.ONLY_ONE?.isSecret).toBe(false);
    expect(env.ONLY_ONE?.optional).toBe(true);
  });
});

describe("agent enabled-tools validation (#402)", () => {
  beforeAll(async () => {
    await seedMcpServer({
      id: "mcp_connected",
      slug: "conn-srv",
      tools: ["search_docs", "create_ticket"],
      resourceTemplates: ["customer-record"],
    });
    await seedMcpServer({ id: "mcp_unconnected", slug: "unconn-srv" });
  });

  it("rejects an unknown tool with the byte-pinned copy listing discovered tools", async () => {
    const error = await grpcError(() =>
      command.create(
        agentInput({
          name: "Unknown Tool Agent",
          usages: [{ slug: "conn-srv", enabledTools: ["serach_docs"] }],
        }),
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(
      "MCP server 'conn-srv' (org: acme): enabled_tools names tool(s) the " +
        "server does not expose: 'serach_docs'. Discovered tools: " +
        "'search_docs', 'create_ticket'. If the server's toolset changed, " +
        "run 'stigmer connect' on it to refresh discovered capabilities.",
    );
  });

  it("rejects a resource-template name with the template-specific copy", async () => {
    const error = await grpcError(() =>
      command.create(
        agentInput({
          name: "Template Tool Agent",
          usages: [{ slug: "conn-srv", enabledTools: ["customer-record"] }],
        }),
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(
      "MCP server 'conn-srv' (org: acme): enabled_tools names resource " +
        "template(s): 'customer-record' — resource templates are read-only " +
        "data endpoints, not callable tools, and must not appear in " +
        "enabled_tools. Discovered tools: 'search_docs', 'create_ticket'. " +
        "If the server's toolset changed, run 'stigmer connect' on it to " +
        "refresh discovered capabilities.",
    );
  });

  it("skips validation for empty enabled_tools (use the server's defaults)", async () => {
    const created = await command.create(
      agentInput({
        name: "Empty Tools Agent",
        usages: [{ slug: "conn-srv" }],
      }),
    );
    expect(created.metadata?.id).not.toBe("");
  });

  it("skips validation for a server without discovered capabilities (not yet connected)", async () => {
    const created = await command.create(
      agentInput({
        name: "Unconnected Server Agent",
        usages: [{ slug: "unconn-srv", enabledTools: ["anything-goes"] }],
      }),
    );
    expect(created.metadata?.id).not.toBe("");
  });
});

describe("agent cascade delete (oss#611)", () => {
  it("sweeps ALL instances by spec.agent_id (cross-org included), deletes same-org shares, keeps cross-org shares", async () => {
    const agent = await command.create(
      agentInput({
        name: "Cascade Target",
        visibility: ApiResourceVisibility.visibility_public,
      }),
    );
    const agentId = agent.metadata!.id;
    const agentSlug = agent.metadata!.slug;
    // Agent create provisioned the default instance through the
    // in-process edge and recorded the pointer (DD-002 choreography).
    const defaultInstanceId = agent.status!.defaultInstanceId;
    expect(defaultInstanceId).not.toBe("");

    const personal = await instanceCommand.create({
      apiVersion: API_VERSION,
      kind: "AgentInstance",
      metadata: { name: "Cascade Personal", org: ORG },
      spec: { agentId },
    });
    // Cross-org instance of the same agent — allowed by design in OSS
    // (an agent is a shareable blueprint; no same-org rule on create).
    const crossOrg = await instanceCommand.create({
      apiVersion: API_VERSION,
      kind: "AgentInstance",
      metadata: { name: "Cascade Cross Org", org: "globex" },
      spec: { agentId },
    });

    // A bystander agent whose instance must survive the sweep untouched.
    const bystander = await command.create(agentInput({ name: "Bystander" }));

    // Shares are seeded directly (the agentshare controller arrives with
    // its own sub-project); the cascade matches spec.agent_ref.
    const sameOrgShare = create(AgentShareSchema, {
      metadata: { id: "ash_same_org", name: "same-org-share", org: ORG },
      spec: {
        agentRef: { kind: ApiResourceKind.agent, org: ORG, slug: agentSlug },
      },
    });
    await server.store.saveResource(
      ApiResourceKind.agent_share,
      "ash_same_org",
      AgentShareSchema,
      sameOrgShare,
    );
    const crossOrgShare = create(AgentShareSchema, {
      metadata: { id: "ash_cross_org", name: "cross-org-share", org: "globex" },
      spec: {
        agentRef: { kind: ApiResourceKind.agent, org: ORG, slug: agentSlug },
      },
    });
    await server.store.saveResource(
      ApiResourceKind.agent_share,
      "ash_cross_org",
      AgentShareSchema,
      crossOrgShare,
    );

    const before = await instanceQuery.getByAgent({ agentId, org: "" });
    expect(before.totalCount).toBe(3); // default + personal + cross-org

    const deleted = await command.delete({ value: agentId });
    expect(deleted.metadata?.id).toBe(agentId);

    // Every instance of the agent is gone — the cross-ORG one included.
    const after = await instanceQuery.getByAgent({ agentId, org: "" });
    expect(after.totalCount).toBe(0);
    for (const instanceId of [
      defaultInstanceId,
      personal.metadata!.id,
      crossOrg.metadata!.id,
    ]) {
      const error = await grpcError(() =>
        instanceQuery.get({ value: instanceId }),
      );
      expect(error.code).toBe(Code.NotFound);
    }

    // Same-org share deleted; the cross-org share of the SAME agent
    // survives — it is another org's resource and fails closed instead.
    await expect(
      server.store.getResource(
        ApiResourceKind.agent_share,
        "ash_same_org",
        AgentShareSchema,
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    const survivor = await server.store.getResource(
      ApiResourceKind.agent_share,
      "ash_cross_org",
      AgentShareSchema,
    );
    expect(survivor.metadata?.id).toBe("ash_cross_org");

    // The bystander agent's default instance was not swept.
    const bystanderInstances = await instanceQuery.getByAgent({
      agentId: bystander.metadata!.id,
      org: "",
    });
    expect(bystanderInstances.totalCount).toBe(1);
  });
});

describe("agent create — CreateDefaultInstance failure wire contract (oss#852)", () => {
  it("answers the inner code with Go's %w-wrapped transport-formatted message", async () => {
    // Pre-occupy the deterministic default-instance slug with an instance
    // bound to a DIFFERENT (nonexistent) agent: the in-process Apply
    // routes to UPDATE and ValidateInstanceUpdate fires the immutability
    // guard. Go wraps that FailedPrecondition with fmt.Errorf("%w"), so
    // the wire message embeds grpc-go's `rpc error: code = X desc = ...`
    // rendering of the inner error — the leak filed as stigmer/stigmer#852,
    // mirrored byte-for-byte until the both-editions post-cutover fix.
    const occupier = create(AgentInstanceSchema, {
      apiVersion: API_VERSION,
      kind: "AgentInstance",
      metadata: {
        id: "ain_wrap_occupier",
        name: "wrapped-error-agent-default",
        slug: "wrapped-error-agent-default",
        org: ORG,
      },
      spec: { agentId: "agt_wrap_nonexistent" },
    });
    await server.store.saveResource(
      ApiResourceKind.agent_instance,
      "ain_wrap_occupier",
      AgentInstanceSchema,
      occupier,
    );

    const error = await grpcError(() =>
      command.create(agentInput({ name: "Wrapped Error Agent" })),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(
      "failed to apply default instance: rpc error: " +
        "code = FailedPrecondition desc = spec.agent_id is immutable " +
        "(instance instantiates agent agt_wrap_nonexistent) — create a new " +
        "instance for a different agent",
    );
  });
});
