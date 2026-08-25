/**
 * Pins the project domain against Go's controller tests — through the REAL
 * stack: a composed server on an ephemeral port, a native gRPC client, the
 * full interceptor chain, and REAL orphan deletes through the in-process
 * command clients' full pipelines.
 *
 * The load-bearing pins the conformance suite does NOT cover (it never
 * touches spec.members or last_reconciliation):
 *   - every successful apply response carries status.last_reconciliation,
 *     even as a present-but-EMPTY message — and it is NEVER persisted;
 *   - apply→prune end to end: a dropped member is actually deleted through
 *     its owning domain's pipeline; an unresolvable member is silently
 *     absent from `deleted` while apply still succeeds;
 *   - members referencing nonexistent resources persist silently (no
 *     ValidateReferences in any project chain);
 *   - the create/update pipeline ASYMMETRY: ValidateVisibility and
 *     NormalizeReferences run on create only;
 *   - project delete never cascades to members.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ProjectCommandController } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/command_pb";
import { ProjectQueryController } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/query_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

let dir: string;
let server: ComposedServer;
let transport: Transport;
let command: Client<typeof ProjectCommandController>;
let query: Client<typeof ProjectQueryController>;
let agentQuery: Client<typeof AgentQueryController>;
let mcpServerQuery: Client<typeof McpServerQueryController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "project-domain-test-"));
  server = composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: 127.0.0.1:1 is deterministically
      // closed, so boots fail the non-fatal connect fast and can never touch
      // a live local Temporal (the conformance CRUD harness does the same).
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      // Everything filesystem-backed stays inside the test dir — the
      // defaults resolve into ~/.stigmer, which tests must never touch.
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  command = createClient(ProjectCommandController, transport);
  query = createClient(ProjectQueryController, transport);
  agentQuery = createClient(AgentQueryController, transport);
  mcpServerQuery = createClient(McpServerQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const API_VERSION = "tenancy.stigmer.ai/v1";
const KIND = "Project";
const ORG = "local";

let seq = 0;
function uniqueName(prefix: string): string {
  seq += 1;
  return `${prefix} ${seq}`;
}

interface MemberInit {
  kind: ApiResourceKind;
  slug: string;
  org?: string;
}

function projectInput(
  name: string,
  extras?: { members?: MemberInit[]; visibility?: ApiResourceVisibility },
) {
  return {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: {
      name,
      org: ORG,
      ...(extras?.visibility !== undefined ? { visibility: extras.visibility } : {}),
    },
    spec: {
      description: "created by the domain test",
      members: (extras?.members ?? []).map((m) => ({
        kind: m.kind,
        slug: m.slug,
        org: m.org ?? ORG,
      })),
    },
  };
}

async function seedAgent(id: string, slug: string): Promise<void> {
  await server.store.saveResource(
    ApiResourceKind.agent,
    id,
    AgentSchema,
    create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { id, name: slug, slug, org: ORG },
    }),
  );
}

async function seedMcpServer(id: string, slug: string): Promise<void> {
  await server.store.saveResource(
    ApiResourceKind.mcp_server,
    id,
    McpServerSchema,
    create(McpServerSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "McpServer",
      metadata: { id, name: slug, slug, org: ORG },
    }),
  );
}

async function grpcCode(run: () => Promise<unknown>): Promise<ConnectError> {
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

describe("apply reconciliation summary (Go apply_test.go)", () => {
  it("first apply reports all members as created and the prj_ id shape", async () => {
    const applied = await command.apply(
      projectInput(uniqueName("Members Project"), {
        members: [
          { kind: ApiResourceKind.agent, slug: "member-a" },
          { kind: ApiResourceKind.workflow, slug: "member-b" },
        ],
      }),
    );

    expect(applied.metadata?.id).toMatch(/^prj_[0-9a-z]{26}$/);
    expect(applied.status?.audit?.specAudit?.event).toBe("created");
    expect(applied.status?.lastReconciliation).toBeDefined();
    expect(
      applied.status?.lastReconciliation?.created.map((r) => r.slug),
    ).toEqual(["member-a", "member-b"]);
    expect(applied.status?.lastReconciliation?.updated).toEqual([]);
    expect(applied.status?.lastReconciliation?.deleted).toEqual([]);
  });

  it("a no-change apply still carries a PRESENT (empty) summary — and it is never persisted", async () => {
    const name = uniqueName("Summary Presence");
    const first = await command.apply(projectInput(name));
    // No members at all: the summary message must still be present.
    expect(first.status?.lastReconciliation).toBeDefined();
    expect(first.status?.lastReconciliation?.created).toEqual([]);
    expect(first.status?.lastReconciliation?.deleted).toEqual([]);

    // Response-only: the persisted resource has NO last_reconciliation.
    const fetched = await query.get({ value: first.metadata!.id });
    expect(fetched.status?.lastReconciliation).toBeUndefined();

    // And the second apply's summary is computed fresh from the delta.
    const second = await command.apply(projectInput(name));
    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(second.status?.audit?.specAudit?.event).toBe("updated");
    expect(second.status?.lastReconciliation).toBeDefined();
    expect(second.status?.lastReconciliation?.created).toEqual([]);
  });

  it("prunes a dropped member FOR REAL through its domain's delete pipeline", async () => {
    await seedAgent("agt_prune_keep", "prune-keep-agent");
    await seedMcpServer("mcps_prune_drop", "prune-drop-mcps");
    const name = uniqueName("Orphan Prune");

    await command.apply(
      projectInput(name, {
        members: [
          { kind: ApiResourceKind.agent, slug: "prune-keep-agent" },
          { kind: ApiResourceKind.mcp_server, slug: "prune-drop-mcps" },
        ],
      }),
    );

    // The second apply both DROPS the mcpserver and INTRODUCES a new
    // member, so one wire summary carries created and deleted together.
    const second = await command.apply(
      projectInput(name, {
        members: [
          { kind: ApiResourceKind.agent, slug: "prune-keep-agent" },
          { kind: ApiResourceKind.workflow, slug: "prune-new-member" },
        ],
      }),
    );

    expect(
      second.status?.lastReconciliation?.deleted.map((r) => r.slug),
    ).toEqual(["prune-drop-mcps"]);
    expect(
      second.status?.lastReconciliation?.created.map((r) => r.slug),
    ).toEqual(["prune-new-member"]);

    // The orphan is GONE (deleted through mcpserver's own pipeline)…
    const gone = await grpcCode(() =>
      mcpServerQuery.get({ value: "mcps_prune_drop" }),
    );
    expect(gone.code).toBe(Code.NotFound);
    // …and the retained member is untouched.
    const kept = await agentQuery.get({ value: "agt_prune_keep" });
    expect(kept.metadata?.slug).toBe("prune-keep-agent");
  });

  it("an id-carrying apply captures previous members and prunes on the update path", async () => {
    await seedAgent("agt_idpath", "idpath-agent");
    const name = uniqueName("Id Carrying Apply");

    const first = await command.apply(
      projectInput(name, {
        members: [{ kind: ApiResourceKind.agent, slug: "idpath-agent" }],
      }),
    );

    // Second apply addresses the project by its ID (the CLI's steady-state
    // shape) with the member dropped — previousMembers must still be
    // captured from the loaded existing resource.
    const second = await command.apply({
      ...projectInput(name),
      metadata: { id: first.metadata!.id, name, org: ORG },
    });

    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(
      second.status?.lastReconciliation?.deleted.map((r) => r.slug),
    ).toEqual(["idpath-agent"]);
    const gone = await grpcCode(() => agentQuery.get({ value: "agt_idpath" }));
    expect(gone.code).toBe(Code.NotFound);
  });

  it("a member dropped via plain UPDATE is stranded — the next apply prunes nothing", async () => {
    // Update runs NO reconciliation, and apply diffs against the STORED
    // members: dropping a member through update shrinks the stored list
    // first, so the later apply computes no orphan and the resource
    // survives. User-visible Go behavior (update strands, apply prunes).
    await seedAgent("agt_stranded", "stranded-agent");
    const name = uniqueName("Update Strands");

    await command.apply(
      projectInput(name, {
        members: [{ kind: ApiResourceKind.agent, slug: "stranded-agent" }],
      }),
    );
    await command.update(projectInput(name));

    const applied = await command.apply(projectInput(name));
    expect(applied.status?.lastReconciliation?.deleted).toEqual([]);
    const survivor = await agentQuery.get({ value: "agt_stranded" });
    expect(survivor.metadata?.slug).toBe("stranded-agent");
  });

  it("an unresolvable orphan is silently absent from deleted; apply still succeeds", async () => {
    const name = uniqueName("Ghost Member");
    // No ValidateReferences in any project chain: a member that points at
    // nothing persists silently (pinned Go behavior).
    const first = await command.apply(
      projectInput(name, {
        members: [{ kind: ApiResourceKind.agent, slug: "ghost-agent" }],
      }),
    );
    expect(first.spec?.members.map((m) => m.slug)).toEqual(["ghost-agent"]);

    const second = await command.apply(projectInput(name));
    // Resolution failed (nothing to delete) → collected log-only, absent
    // from the wire's deleted list, and apply SUCCEEDS.
    expect(second.status?.lastReconciliation).toBeDefined();
    expect(second.status?.lastReconciliation?.deleted).toEqual([]);
  });
});

describe("create/update pipeline asymmetry (create.go vs update.go)", () => {
  it("create rejects an unsupported visibility level; update IGNORES the carried level", async () => {
    // Project's kind_meta has no VisibilityConfig → private-only.
    const rejected = await grpcCode(() =>
      command.create(
        projectInput(uniqueName("Visibility Reject"), {
          visibility: ApiResourceVisibility.visibility_org,
        }),
      ),
    );
    expect(rejected.code).toBe(Code.InvalidArgument);

    // Update has NO ValidateVisibility step; the carried level is ignored
    // (visibility is update-immutable, oss#573) — never rejected.
    const name = uniqueName("Visibility Ignore");
    const created = await command.create(projectInput(name));
    const updated = await command.update(
      projectInput(name, { visibility: ApiResourceVisibility.visibility_org }),
    );
    expect(updated.metadata?.id).toBe(created.metadata?.id);
    expect(updated.metadata?.visibility).toBe(
      ApiResourceVisibility.visibility_private,
    );
  });

  it("create normalizes empty member orgs; update persists them EMPTY", async () => {
    const name = uniqueName("Normalize Asymmetry");
    const created = await command.create(
      projectInput(name, {
        members: [{ kind: ApiResourceKind.agent, slug: "norm-a", org: "" }],
      }),
    );
    // NormalizeReferences filled the empty org from metadata.org.
    expect(created.spec?.members[0]?.org).toBe(ORG);

    const updated = await command.update(
      projectInput(name, {
        members: [{ kind: ApiResourceKind.agent, slug: "norm-b", org: "" }],
      }),
    );
    // Update runs NO NormalizeReferences: the empty org persists as-is.
    expect(updated.spec?.members[0]?.slug).toBe("norm-b");
    expect(updated.spec?.members[0]?.org).toBe("");
  });
});

describe("delete has no member cascade (delete.go)", () => {
  it("returns the pre-delete resource and leaves members untouched", async () => {
    await seedAgent("agt_cascade_safe", "cascade-safe-agent");
    const created = await command.create(
      projectInput(uniqueName("No Cascade"), {
        members: [{ kind: ApiResourceKind.agent, slug: "cascade-safe-agent" }],
      }),
    );

    const deleted = await command.delete({ value: created.metadata!.id });
    expect(deleted.metadata?.id).toBe(created.metadata?.id);
    expect(deleted.spec?.members.map((m) => m.slug)).toEqual([
      "cascade-safe-agent",
    ]);

    const notFound = await grpcCode(() =>
      query.get({ value: created.metadata!.id }),
    );
    expect(notFound.code).toBe(Code.NotFound);
    // The member survives: delete removes ONLY the project entity.
    const survivor = await agentQuery.get({ value: "agt_cascade_safe" });
    expect(survivor.metadata?.slug).toBe("cascade-safe-agent");
  });
});
