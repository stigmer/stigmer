/**
 * Pins the agent domain against Go's pkg/domain/agent tests — through the
 * REAL stack: a composed server on an ephemeral port, a native gRPC
 * client and the full interceptor chain.
 *
 * The load-bearing pins:
 *   - MCP env-merge semantics: agent-declared entries win, among servers
 *     first-encountered wins, only declaration fields are copied;
 *   - tool lists at apply: an entry whose shape is malformed is refused
 *     by the proto's per-item pattern, on the agent and on a sub-agent;
 *     well-formed lists are accepted and read back as written, and their
 *     names are never checked against a server's discovered tools, so an
 *     entry naming a tool no connected server exposes still applies;
 *   - cascade delete (oss#611): same-org shares are deleted, cross-org
 *     shares of the same agent SURVIVE, and a bystander agent's share is
 *     untouched;
 *   - the server assigns a new agent's id (stigmer#1266): an id the
 *     request carries is replaced, on create and on an apply that
 *     creates, and the chosen id addresses nothing.
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
  organizationId,
  seedOrganizations,
} from "../../organization/__tests__/support.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const API_VERSION = "agentic.stigmer.ai/v1";
// Requests name the organizations by slug, which the serving chain turns
// into the minted id; rows written straight to the store, stored
// references and error copies carry the id.
const ORG = "acme";
let ORG_ID: string;
let GLOBEX_ID: string;

let dir: string;
let server: ComposedServer;
let transport: Transport;
let command: Client<typeof AgentCommandController>;
let query: Client<typeof AgentQueryController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "agent-domain-test-"));
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
  const organizationIds = await seedOrganizations(transport, [ORG, "globex"]);
  ORG_ID = organizationId(organizationIds, ORG);
  GLOBEX_ID = organizationId(organizationIds, "globex");
  command = createClient(AgentCommandController, transport);
  query = createClient(AgentQueryController, transport);
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
  usages?: Array<{ slug: string }>;
  tools?: string[];
  disallowedTools?: string[];
  subAgents?: Array<{
    name: string;
    tools?: string[];
    disallowedTools?: string[];
  }>;
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
      })),
      env: overrides?.env ?? {},
      tools: overrides?.tools ?? [],
      disallowedTools: overrides?.disallowedTools ?? [],
      subAgents: (overrides?.subAgents ?? []).map((subAgent) => ({
        name: subAgent.name,
        instructions: "You are a sub-agent used by the domain tests.",
        tools: subAgent.tools ?? [],
        disallowedTools: subAgent.disallowedTools ?? [],
      })),
    },
  };
}

/**
 * Seeds an MCP server straight into the store — the agent pipelines only
 * need the row. Org-visible, the level the mcpserver create chain would
 * have stamped: an org-visible agent may reference it under the reference
 * floor, as it would a server created through the API.
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
}): Promise<void> {
  const mcpServer = create(McpServerSchema, {
    apiVersion: API_VERSION,
    kind: "McpServer",
    metadata: {
      id: opts.id,
      name: opts.slug,
      slug: opts.slug,
      org: opts.org ?? ORG_ID,
      visibility: ApiResourceVisibility.visibility_org,
    },
    spec: { env: opts.env ?? {} },
    status:
      opts.tools !== undefined
        ? {
            discoveredCapabilities: {
              tools: opts.tools.map((name) => ({ name })),
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

describe("agent tool lists at apply", () => {
  beforeAll(async () => {
    // Connected, and exposing no tool the lists below name: names are
    // resolved at run time, never against discovery at apply.
    await seedMcpServer({
      id: "mcp_lists",
      slug: "zendesk",
      tools: ["search_tickets"],
    });
  });

  // Each one breaks the shape the pattern admits: an MCP entry with no
  // server slug, an unclosed specifier, surrounding whitespace, and a
  // native engine name where Claude Code's name belongs.
  const MALFORMED = ["mcp__", "Bash(git push *", " Read", "read_file"];

  it.each(MALFORMED)(
    "refuses the agent entry %j with InvalidArgument",
    async (entry) => {
      const error = await grpcError(() =>
        command.apply(
          agentInput({ name: "Malformed Agent List", tools: ["Read", entry] }),
        ),
      );
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toContain("spec.tools[1]");
    },
  );

  it.each(MALFORMED)(
    "refuses the sub-agent entry %j in disallowed_tools",
    async (entry) => {
      const error = await grpcError(() =>
        command.apply(
          agentInput({
            name: "Malformed Sub-agent List",
            subAgents: [{ name: "helper", disallowedTools: [entry] }],
          }),
        ),
      );
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toContain(
        "spec.sub_agents[0].disallowed_tools[0]",
      );
    },
  );

  it("accepts well-formed lists on the agent and a sub-agent and reads them back as written", async () => {
    const applied = await command.apply(
      agentInput({
        name: "Support Bot",
        usages: [{ slug: "zendesk" }],
        tools: ["Read", "Grep", "mcp__zendesk"],
        disallowedTools: ["Bash"],
        subAgents: [
          {
            name: "triage",
            tools: ["Read", "mcp__zendesk__search_tickets", "Agent(explore)"],
            disallowedTools: ["Bash(git push *)", "mcp__*"],
          },
        ],
      }),
    );

    const fetched = await query.get({ value: applied.metadata!.id });
    for (const agent of [applied, fetched]) {
      expect(agent.spec?.tools).toEqual(["Read", "Grep", "mcp__zendesk"]);
      expect(agent.spec?.disallowedTools).toEqual(["Bash"]);
      expect(agent.spec?.subAgents[0]?.tools).toEqual([
        "Read",
        "mcp__zendesk__search_tickets",
        "Agent(explore)",
      ]);
      expect(agent.spec?.subAgents[0]?.disallowedTools).toEqual([
        "Bash(git push *)",
        "mcp__*",
      ]);
    }
  });

  it("accepts entries naming tools no server exposes (portable agents apply anywhere)", async () => {
    const applied = await command.apply(
      agentInput({
        name: "Portable Agent",
        usages: [{ slug: "zendesk" }],
        tools: ["mcp__zendesk__close_ticket", "mcp__github", "NotebookEdit"],
      }),
    );
    expect(applied.spec?.tools).toEqual([
      "mcp__zendesk__close_ticket",
      "mcp__github",
      "NotebookEdit",
    ]);
  });
});

describe("agent cascade delete (oss#611)", () => {
  it("deletes same-org shares, keeps a stored cross-org share, and leaves a bystander agent's share", async () => {
    const agent = await command.create(
      agentInput({
        name: "Cascade Target",
        visibility: ApiResourceVisibility.visibility_org,
      }),
    );
    const agentId = agent.metadata!.id;
    const agentSlug = agent.metadata!.slug;

    // A bystander agent whose share must survive the sweep untouched.
    const bystander = await command.create(agentInput({ name: "Bystander" }));

    // Shares are seeded directly into the store; the cascade matches
    // spec.agent_ref.
    const sameOrgShare = create(AgentShareSchema, {
      metadata: { id: "ash_same_org", name: "same-org-share", org: ORG_ID },
      spec: {
        agentRef: { kind: ApiResourceKind.agent, org: ORG_ID, slug: agentSlug },
      },
    });
    await server.store.saveResource(
      ApiResourceKind.agent_share,
      "ash_same_org",
      AgentShareSchema,
      sameOrgShare,
    );
    // A share in another organization is a row no create admits any more
    // (a share's agent lives in the share's organization); one written
    // before that rule is still another organization's row, and the
    // cascade leaves it as it always did.
    const crossOrgShare = create(AgentShareSchema, {
      metadata: {
        id: "ash_cross_org",
        name: "cross-org-share",
        org: GLOBEX_ID,
      },
      spec: {
        agentRef: { kind: ApiResourceKind.agent, org: ORG_ID, slug: agentSlug },
      },
    });
    await server.store.saveResource(
      ApiResourceKind.agent_share,
      "ash_cross_org",
      AgentShareSchema,
      crossOrgShare,
    );

    const bystanderShare = create(AgentShareSchema, {
      metadata: { id: "ash_bystander", name: "bystander-share", org: ORG_ID },
      spec: {
        agentRef: {
          kind: ApiResourceKind.agent,
          org: ORG_ID,
          slug: bystander.metadata!.slug,
        },
      },
    });
    await server.store.saveResource(
      ApiResourceKind.agent_share,
      "ash_bystander",
      AgentShareSchema,
      bystanderShare,
    );

    const deleted = await command.delete({ value: agentId });
    expect(deleted.metadata?.id).toBe(agentId);

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

    // The bystander agent's share was not swept.
    const untouched = await server.store.getResource(
      ApiResourceKind.agent_share,
      "ash_bystander",
      AgentShareSchema,
    );
    expect(untouched.metadata?.id).toBe("ash_bystander");
  });
});

describe("agent create — the server assigns the id (stigmer#1266)", () => {
  const CHOSEN_ID = "agt_01hzzzzzzzzzzzzzzzzzzzzzzz";

  async function expectMintedNotChosen(created: {
    metadata?: { id: string };
  }): Promise<void> {
    const id = created.metadata?.id ?? "";
    expect(id).toMatch(/^agt_[0-9a-hjkmnp-tv-z]{26}$/);
    expect(id).not.toBe(CHOSEN_ID);
    const fetched = await query.get({ value: id });
    expect(fetched.metadata?.id).toBe(id);
    const missing = await grpcError(() => query.get({ value: CHOSEN_ID }));
    expect(missing.code).toBe(Code.NotFound);
  }

  it("create replaces a client-supplied id with a minted one", async () => {
    const input = agentInput();
    const created = await command.create({
      ...input,
      metadata: { ...input.metadata, id: CHOSEN_ID },
    });
    await expectMintedNotChosen(created);
    await command.delete({ value: created.metadata?.id ?? "" });
  });

  it("an apply that creates (an exported manifest re-applied) replaces the id too", async () => {
    const input = agentInput();
    const applied = await command.apply({
      ...input,
      metadata: { ...input.metadata, id: CHOSEN_ID },
    });
    await expectMintedNotChosen(applied);
    await command.delete({ value: applied.metadata?.id ?? "" });
  });
});
