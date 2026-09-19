// Pins the seedpack retire over a real Connect backend: a full seedpack
// Project is removed children-first (workflows, agents, skills, MCP servers)
// through the kinds' own delete RPCs, then the Project row, then the marker;
// a member some user agent references, in any org the identity sees, is kept
// and the report names the agent; a member a default plugin adopted (its row
// carries `stigmer.ai/plugin`) is reported as the plugin's and never deleted,
// the plugin's slug read once and its id standing in when the plugin row is
// gone; a seedpack agent referencing a seedpack server keeps nothing; a
// delete the server refuses is kept with the server's sentence; a member
// already gone is not an error; no Project means one read and a stale
// marker's removal; a second run is a no-op.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import {
  createServer as createHttp2Server,
  type Http2Server,
  type ServerHttp2Session,
} from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillCommandController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/command_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { SearchResponseSchema } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationsSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { ProjectSchema } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";
import { ProjectCommandController } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/command_pb";
import { ProjectQueryController } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/query_pb";
import { createNodeClient, normalizeEndpoint } from "@stigmer/sdk/node";
import type { Stigmer } from "@stigmer/sdk";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  SEEDPACK_MARKER_FILE,
  SEEDPACK_PROJECT_SLUG,
  type RetireResult,
  renderRetireReport,
  retireSeedpack,
} from "./seedpack-retire.js";

let backend: Http2Server;
let stigmer: Stigmer;
const openSessions = new Set<ServerHttp2Session>();
let markerDir: string;

// --- The backend's state: rows by "kind:org/slug", deletes in order ---------

interface Row {
  readonly kind: ApiResourceKind;
  readonly org: string;
  readonly slug: string;
  readonly message: MessageShape<DescMessage>;
}

let rows: Map<string, Row>;
let deletes: string[];
/** Rows whose delete the backend refuses, with the sentence it answers. */
let refusals: Map<string, string>;
let orgs: string[];
let projectReads: number;
let pluginReads: number;

function key(kind: ApiResourceKind, org: string, slug: string): string {
  return `${kind}:${org}/${slug}`;
}

function idOf(kind: ApiResourceKind, slug: string): string {
  return `${ApiResourceKind[kind]}_${slug}`;
}

function ref(
  kind: ApiResourceKind,
  slug: string,
  org = "stigmer",
): Pick<ApiResourceReference, "kind" | "org" | "slug"> {
  return { kind, org, slug };
}

function put(
  kind: ApiResourceKind,
  schema: DescMessage,
  org: string,
  slug: string,
  spec: Record<string, unknown> = {},
  labels: Record<string, string> = {},
): void {
  const message = create(schema, {
    metadata: { id: idOf(kind, slug), slug, org, labels },
    spec,
  } as never);
  rows.set(key(kind, org, slug), { kind, org, slug, message });
}

function seedProject(members: ReadonlyArray<ReturnType<typeof ref>>): void {
  rows.set(key(ApiResourceKind.project, "stigmer", SEEDPACK_PROJECT_SLUG), {
    kind: ApiResourceKind.project,
    org: "stigmer",
    slug: SEEDPACK_PROJECT_SLUG,
    message: create(ProjectSchema, {
      metadata: {
        id: idOf(ApiResourceKind.project, SEEDPACK_PROJECT_SLUG),
        slug: SEEDPACK_PROJECT_SLUG,
        org: "stigmer",
      },
      spec: { members: members.map((m) => ({ ...m })) },
    }),
  });
}

/** The full seedpack: one of each kind, the agent referencing the skill and the server. */
function seedFullSeedpack(): void {
  put(ApiResourceKind.mcp_server, McpServerSchema, "stigmer", "github");
  put(ApiResourceKind.skill, SkillSchema, "stigmer", "code-reviewer");
  put(ApiResourceKind.agent, AgentSchema, "stigmer", "code-review-agent", {
    mcpServerUsages: [
      { mcpServerRef: ref(ApiResourceKind.mcp_server, "github") },
    ],
    skillRefs: [ref(ApiResourceKind.skill, "code-reviewer")],
  });
  put(ApiResourceKind.workflow, WorkflowSchema, "stigmer", "content-review");
  seedProject([
    ref(ApiResourceKind.mcp_server, "github"),
    ref(ApiResourceKind.skill, "code-reviewer"),
    ref(ApiResourceKind.agent, "code-review-agent"),
    ref(ApiResourceKind.workflow, "content-review"),
  ]);
}

function byReference(kind: ApiResourceKind) {
  return (r: ApiResourceReference) => {
    const row = rows.get(key(kind, r.org, r.slug));
    if (row === undefined) {
      throw new ConnectError(`${r.org}/${r.slug} not found`, Code.NotFound);
    }
    return row.message as never;
  };
}

function byId(kind: ApiResourceKind) {
  return (id: { value: string }) => {
    const row = [...rows.values()].find(
      (r) => r.kind === kind && idOf(kind, r.slug) === id.value,
    );
    if (row === undefined) {
      throw new ConnectError(`${id.value} not found`, Code.NotFound);
    }
    return row.message as never;
  };
}

function deleteById(kind: ApiResourceKind) {
  return (id: { value: string } | { resourceId: string }) => {
    const value = "value" in id ? id.value : id.resourceId;
    const row = [...rows.values()].find(
      (r) => r.kind === kind && idOf(kind, r.slug) === value,
    );
    if (row === undefined) {
      throw new ConnectError(`${value} not found`, Code.NotFound);
    }
    const k = key(kind, row.org, row.slug);
    const refusal = refusals.get(k);
    if (refusal !== undefined) {
      throw new ConnectError(refusal, Code.FailedPrecondition);
    }
    rows.delete(k);
    deletes.push(k);
    return row.message as never;
  };
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(OrganizationQueryController, {
      findMyOrganizations: () =>
        create(OrganizationsSchema, {
          entries: orgs.map((slug) =>
            create(OrganizationSchema, { metadata: { slug, org: slug } }),
          ),
        }),
    });
    router.service(ProjectQueryController, {
      getByReference: (r) => {
        projectReads += 1;
        return byReference(ApiResourceKind.project)(r);
      },
    });
    router.service(ProjectCommandController, {
      delete: deleteById(ApiResourceKind.project),
    });
    router.service(SearchService, {
      search: (req) => {
        const entries = [...rows.values()].filter(
          (r) => r.kind === ApiResourceKind.agent && r.org === req.org,
        );
        return create(SearchResponseSchema, {
          entries: entries.map((r) => ({
            kind: r.kind,
            id: idOf(r.kind, r.slug),
            slug: r.slug,
            org: r.org,
          })),
          totalCount: entries.length,
          totalPages: 1,
        });
      },
    });
    router.service(AgentQueryController, {
      get: byId(ApiResourceKind.agent),
      getByReference: byReference(ApiResourceKind.agent),
    });
    router.service(AgentCommandController, {
      delete: deleteById(ApiResourceKind.agent),
    });
    router.service(SkillQueryController, {
      getByReference: byReference(ApiResourceKind.skill),
    });
    router.service(SkillCommandController, {
      delete: deleteById(ApiResourceKind.skill),
    });
    router.service(McpServerQueryController, {
      getByReference: byReference(ApiResourceKind.mcp_server),
    });
    router.service(McpServerCommandController, {
      delete: deleteById(ApiResourceKind.mcp_server),
    });
    router.service(WorkflowQueryController, {
      getByReference: byReference(ApiResourceKind.workflow),
    });
    router.service(WorkflowCommandController, {
      delete: deleteById(ApiResourceKind.workflow),
    });
    router.service(PluginQueryController, {
      get: (id) => {
        pluginReads += 1;
        return byId(ApiResourceKind.plugin)(id);
      },
    });
  };
  backend = createHttp2Server(connectNodeAdapter({ routes }));
  backend.on("session", (session) => {
    openSessions.add(session);
    session.on("close", () => openSessions.delete(session));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const port = (backend.address() as AddressInfo).port;
  stigmer = createNodeClient({
    baseUrl: normalizeEndpoint(`127.0.0.1:${port}`),
  });
});

afterAll(async () => {
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

beforeEach(() => {
  rows = new Map();
  deletes = [];
  refusals = new Map();
  orgs = ["stigmer", "acme"];
  projectReads = 0;
  pluginReads = 0;
  markerDir = mkdtempSync(join(tmpdir(), "stigmer-retire-"));
  writeFileSync(join(markerDir, SEEDPACK_MARKER_FILE), "sha256:abc\n");
});

afterEach(() => {
  rmSync(markerDir, { recursive: true, force: true });
});

function run(): Promise<RetireResult> {
  return retireSeedpack(stigmer, { markerDir });
}

function report(result: RetireResult): string[] {
  const lines: string[] = [];
  renderRetireReport(result, (line) => lines.push(line));
  return lines;
}

const projectKey = key(ApiResourceKind.project, "stigmer", SEEDPACK_PROJECT_SLUG);

describe("retireSeedpack", () => {
  it("removes a full seedpack children-first, then the Project row, then the marker", async () => {
    seedFullSeedpack();
    const result = await run();
    expect(result.present).toBe(true);
    if (!result.present) return;
    expect(result.outcomes.map((o) => o.action)).toEqual([
      "removed",
      "removed",
      "removed",
      "removed",
    ]);
    expect(deletes).toEqual([
      key(ApiResourceKind.workflow, "stigmer", "content-review"),
      key(ApiResourceKind.agent, "stigmer", "code-review-agent"),
      key(ApiResourceKind.skill, "stigmer", "code-reviewer"),
      key(ApiResourceKind.mcp_server, "stigmer", "github"),
      projectKey,
    ]);
    expect(result.projectRemoved).toBe(true);
    expect(existsSync(join(markerDir, SEEDPACK_MARKER_FILE))).toBe(false);
    expect(report(result)).toEqual([
      "Retired the system content an older release installed: removed 4 resources.",
    ]);
  });

  it("keeps a member a user's agent in another org references, and names the agent", async () => {
    seedFullSeedpack();
    put(ApiResourceKind.agent, AgentSchema, "acme", "my-reviewer", {
      mcpServerUsages: [
        { mcpServerRef: ref(ApiResourceKind.mcp_server, "github") },
      ],
    });
    const result = await run();
    if (!result.present) throw new Error("expected a project");
    const github = result.outcomes.find(
      (o) => o.member.slug === "github",
    );
    expect(github?.action).toBe("kept-referenced");
    expect(github?.action === "kept-referenced" && github.by).toEqual([
      "agent 'acme/my-reviewer'",
    ]);
    expect(deletes).not.toContain(
      key(ApiResourceKind.mcp_server, "stigmer", "github"),
    );
    // The seedpack's own agent referenced the same server and the skill; it kept neither.
    expect(deletes).toContain(key(ApiResourceKind.skill, "stigmer", "code-reviewer"));
    expect(deletes).toContain(projectKey);
    // The user's agent is not a seedpack member and is never touched.
    expect(rows.has(key(ApiResourceKind.agent, "acme", "my-reviewer"))).toBe(true);
    expect(report(result)).toEqual([
      "Retired the system content an older release installed: removed 3 resources, kept 1 resource.",
      "  kept mcpserver 'stigmer/github': referenced by agent 'acme/my-reviewer'",
      "  A kept resource's icon no longer resolves. Once its referrer is edited, remove it with 'stigmer delete <kind> <org>/<slug>'.",
    ]);
  });

  it("reports a member a default plugin adopted as the plugin's, never deletes it, and reads the plugin once", async () => {
    seedFullSeedpack();
    put(ApiResourceKind.plugin, PluginSchema, "stigmer", "assistant");
    const pluginId = idOf(ApiResourceKind.plugin, "assistant");
    // The bootstrap ran first and its push adopted two rows in place.
    put(
      ApiResourceKind.agent,
      AgentSchema,
      "stigmer",
      "code-review-agent",
      {},
      { "stigmer.ai/plugin": pluginId, "stigmer.ai/system": "true" },
    );
    put(
      ApiResourceKind.mcp_server,
      McpServerSchema,
      "stigmer",
      "github",
      {},
      { "stigmer.ai/plugin": pluginId },
    );
    const result = await run();
    if (!result.present) throw new Error("expected a project");
    expect(result.outcomes.map((o) => [o.member.slug, o.action])).toEqual([
      ["content-review", "removed"],
      ["code-review-agent", "adopted"],
      ["code-reviewer", "removed"],
      ["github", "adopted"],
    ]);
    expect(
      result.outcomes
        .filter((o) => o.action === "adopted")
        .map((o) => o.action === "adopted" && o.byPlugin),
    ).toEqual(["assistant", "assistant"]);
    expect(pluginReads).toBe(1);
    expect(deletes).toEqual([
      key(ApiResourceKind.workflow, "stigmer", "content-review"),
      key(ApiResourceKind.skill, "stigmer", "code-reviewer"),
      projectKey,
    ]);
    expect(rows.has(key(ApiResourceKind.agent, "stigmer", "code-review-agent"))).toBe(true);
    expect(report(result)).toEqual([
      "Retired the system content an older release installed: removed 2 resources, 2 resources now managed by a plugin.",
      "  agent 'stigmer/code-review-agent' is now managed by plugin 'assistant'; its instances and conversations continue",
      "  mcpserver 'stigmer/github' is now managed by plugin 'assistant'; its instances and conversations continue",
    ]);
  });

  it("names the adopting plugin by id when its row is gone", async () => {
    seedFullSeedpack();
    put(
      ApiResourceKind.agent,
      AgentSchema,
      "stigmer",
      "code-review-agent",
      {},
      { "stigmer.ai/plugin": "plg_vanished" },
    );
    const result = await run();
    if (!result.present) throw new Error("expected a project");
    const agent = result.outcomes.find((o) => o.member.slug === "code-review-agent");
    expect(agent).toMatchObject({ action: "adopted", byPlugin: "plg_vanished" });
    expect(deletes).not.toContain(
      key(ApiResourceKind.agent, "stigmer", "code-review-agent"),
    );
  });

  it("keeps a member whose delete the server refuses, with the server's sentence", async () => {
    seedFullSeedpack();
    refusals.set(
      key(ApiResourceKind.skill, "stigmer", "code-reviewer"),
      "skill 'code-reviewer' is managed by plugin 'reviewer'",
    );
    const result = await run();
    if (!result.present) throw new Error("expected a project");
    const skill = result.outcomes.find((o) => o.member.slug === "code-reviewer");
    expect(skill?.action).toBe("kept-refused");
    expect(skill?.action === "kept-refused" && skill.reason).toMatch(
      /managed by plugin 'reviewer'/,
    );
    expect(deletes).toContain(key(ApiResourceKind.mcp_server, "stigmer", "github"));
    expect(report(result)[1]).toMatch(
      /^ {2}kept skill 'stigmer\/code-reviewer': .*managed by plugin 'reviewer'/,
    );
  });

  it("counts a member that is already gone without an error", async () => {
    seedFullSeedpack();
    rows.delete(key(ApiResourceKind.workflow, "stigmer", "content-review"));
    const result = await run();
    if (!result.present) throw new Error("expected a project");
    expect(result.outcomes[0]).toMatchObject({
      action: "already-gone",
      member: { slug: "content-review" },
    });
    expect(result.outcomes.slice(1).map((o) => o.action)).toEqual([
      "removed",
      "removed",
      "removed",
    ]);
  });

  it("does nothing but one read and the marker's removal when there is no Project", async () => {
    const result = await run();
    expect(result).toEqual({ present: false });
    expect(projectReads).toBe(1);
    expect(deletes).toEqual([]);
    expect(existsSync(join(markerDir, SEEDPACK_MARKER_FILE))).toBe(false);
    expect(report(result)).toEqual([]);
  });

  it("is a no-op the second time", async () => {
    seedFullSeedpack();
    await run();
    deletes = [];
    const again = await run();
    expect(again).toEqual({ present: false });
    expect(deletes).toEqual([]);
  });

  it("reports a Project row the server would not delete and keeps the marker's removal", async () => {
    seedFullSeedpack();
    refusals.set(projectKey, "project is locked");
    const result = await run();
    if (!result.present) throw new Error("expected a project");
    expect(result.projectRemoved).toBe(false);
    expect(result.projectRefusal).toMatch(/project is locked/);
    expect(report(result).at(-1)).toMatch(
      /project row could not be removed: .*project is locked.* Run 'stigmer up' again to retry\./,
    );
  });
});
