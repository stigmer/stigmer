/**
 * Pins the project reconciler against Go's reconcile/service_test.go
 * case-for-case (set difference, dry-run, prune-off, orphan resolution and
 * deletion with continue-on-failure) over a REAL sqlite store, plus the
 * toProtoSummary mapping (updated ALWAYS empty; an all-empty result is
 * still a present message) and the search extractor's field mapping.
 *
 * Go's nil-deleter stub arm and nil-options arm are deliberately absent —
 * both unreachable here (plan-gate decisions 2/3, tasks/T01_0_plan.md).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ProjectSchema } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";

import { createLogger } from "../../../boot/logger.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import {
  DEFAULT_RECONCILIATION_OPTIONS,
  newReconciliationService,
  referenceKey,
  toProtoSummary,
} from "../reconcile.js";
import type { OrphanDeleter, ReconciliationService } from "../reconcile.js";
import { projectSearchExtractor } from "../search-extractor.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

/** Records delete calls; throws for kinds listed in failKinds (Go's fake clients). */
class RecordingDeleter implements OrphanDeleter {
  readonly calls: Array<{ kind: ApiResourceKind; resourceId: string }> = [];
  constructor(private readonly failKinds: ReadonlySet<ApiResourceKind> = new Set()) {}

  async delete(kind: ApiResourceKind, resourceId: string): Promise<void> {
    this.calls.push({ kind, resourceId });
    if (this.failKinds.has(kind)) {
      throw new Error("permission denied");
    }
  }
}

let dir: string;
let store: SqliteStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "project-reconcile-test-"));
  store = SqliteStore.open(path.join(dir, "test.db"));
});

afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

function service(deleter: OrphanDeleter): ReconciliationService {
  return newReconciliationService({
    store,
    orphanDeleter: () => deleter,
    logger: silentLogger,
  });
}

function ref(kind: ApiResourceKind, slug: string): ApiResourceReference {
  return create(ApiResourceReferenceSchema, { org: "local", kind, slug });
}

async function seedAgent(id: string, slug: string): Promise<void> {
  await store.saveResource(
    ApiResourceKind.agent,
    id,
    AgentSchema,
    create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { id, name: slug, slug, org: "local" },
    }),
  );
}

async function seedWorkflow(id: string, slug: string): Promise<void> {
  await store.saveResource(
    ApiResourceKind.workflow,
    id,
    WorkflowSchema,
    create(WorkflowSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Workflow",
      metadata: { id, name: slug, slug, org: "local" },
    }),
  );
}

async function seedMcpServer(id: string, slug: string): Promise<void> {
  await store.saveResource(
    ApiResourceKind.mcp_server,
    id,
    McpServerSchema,
    create(McpServerSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "McpServer",
      metadata: { id, name: slug, slug, org: "local" },
    }),
  );
}

async function seedSkill(id: string, slug: string): Promise<void> {
  await store.saveResource(
    ApiResourceKind.skill,
    id,
    SkillSchema,
    create(SkillSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Skill",
      metadata: { id, name: slug, slug, org: "local" },
    }),
  );
}

describe("reconcile set difference (Go service_test.go)", () => {
  it("returns the empty result when both lists are empty", async () => {
    const deleter = new RecordingDeleter();
    const result = await service(deleter).reconcile([], [], DEFAULT_RECONCILIATION_OPTIONS);
    expect(result).toEqual({ added: [], removed: [], errors: [] });
    expect(deleter.calls).toHaveLength(0);
  });

  it("returns the empty result when previous == current", async () => {
    const deleter = new RecordingDeleter();
    const members = [ref(ApiResourceKind.agent, "my-agent")];
    const result = await service(deleter).reconcile(members, members, DEFAULT_RECONCILIATION_OPTIONS);
    expect(result).toEqual({ added: [], removed: [], errors: [] });
  });

  it("first apply: all current members are added, none removed", async () => {
    const deleter = new RecordingDeleter();
    const current = [
      ref(ApiResourceKind.agent, "agent-1"),
      ref(ApiResourceKind.workflow, "wf-1"),
    ];
    const result = await service(deleter).reconcile([], current, DEFAULT_RECONCILIATION_OPTIONS);
    expect(result.added).toHaveLength(2);
    expect(result.removed).toHaveLength(0);
    expect(deleter.calls).toHaveLength(0);
  });

  it("prune disabled: orphans are neither reported nor deleted", async () => {
    const deleter = new RecordingDeleter();
    const previous = [ref(ApiResourceKind.agent, "old-agent")];
    const result = await service(deleter).reconcile(previous, [], {
      pruneEnabled: false,
      dryRun: false,
    });
    expect(result.removed).toHaveLength(0);
    expect(deleter.calls).toHaveLength(0);
  });

  it("dry run: orphans are reported in removed WITHOUT deleting", async () => {
    const deleter = new RecordingDeleter();
    const previous = [ref(ApiResourceKind.agent, "orphan-agent")];
    const result = await service(deleter).reconcile(previous, [], {
      pruneEnabled: true,
      dryRun: true,
    });
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]?.slug).toBe("orphan-agent");
    expect(deleter.calls).toHaveLength(0);
  });

  it("dry run WINS over prune-disabled: orphans still reported (Go branch order)", async () => {
    // Go checks dryRun BEFORE pruneEnabled (service.go:61-67), so this
    // combination reports the orphan plan; prune-first ordering would
    // return an empty removed list — the one combination that pins the
    // branch precedence.
    const deleter = new RecordingDeleter();
    const previous = [ref(ApiResourceKind.agent, "orphan-agent")];
    const result = await service(deleter).reconcile(previous, [], {
      pruneEnabled: false,
      dryRun: true,
    });
    expect(result.removed.map((r) => r.slug)).toEqual(["orphan-agent"]);
    expect(deleter.calls).toHaveLength(0);
  });

  it("mixed change reports exactly the delta (Go MixedAddedAndRemoved)", async () => {
    await seedAgent("agent-id-old", "agent-old");
    const deleter = new RecordingDeleter();
    const previous = [
      ref(ApiResourceKind.agent, "agent-old"),
      ref(ApiResourceKind.agent, "agent-keep"),
    ];
    const current = [
      ref(ApiResourceKind.agent, "agent-keep"),
      ref(ApiResourceKind.workflow, "wf-new"),
    ];
    const result = await service(deleter).reconcile(previous, current, DEFAULT_RECONCILIATION_OPTIONS);
    expect(result.added.map((r) => r.slug)).toEqual(["wf-new"]);
    expect(result.removed.map((r) => r.slug)).toEqual(["agent-old"]);
  });
});

describe("orphan deletion (Go service_test.go)", () => {
  it("resolves each of the four member kinds by slug and routes its delete", async () => {
    await seedAgent("agent-id-1", "orphan-agent");
    await seedWorkflow("wf-id-1", "orphan-wf");
    await seedMcpServer("mcps-id-1", "orphan-mcps");
    await seedSkill("skill-id-1", "orphan-skill");

    const deleter = new RecordingDeleter();
    const previous = [
      ref(ApiResourceKind.agent, "orphan-agent"),
      ref(ApiResourceKind.workflow, "orphan-wf"),
      ref(ApiResourceKind.mcp_server, "orphan-mcps"),
      ref(ApiResourceKind.skill, "orphan-skill"),
    ];
    const result = await service(deleter).reconcile(previous, [], DEFAULT_RECONCILIATION_OPTIONS);

    expect(result.removed).toHaveLength(4);
    expect(result.errors).toHaveLength(0);
    expect(deleter.calls).toEqual([
      { kind: ApiResourceKind.agent, resourceId: "agent-id-1" },
      { kind: ApiResourceKind.workflow, resourceId: "wf-id-1" },
      { kind: ApiResourceKind.mcp_server, resourceId: "mcps-id-1" },
      { kind: ApiResourceKind.skill, resourceId: "skill-id-1" },
    ]);
  });

  it("orphan lookup is slug-only, matching across orgs (pinned Go behavior)", async () => {
    // Seeded under org "local"; the orphan reference carries a DIFFERENT
    // org — resolution still matches, because Go's resolveResourceID
    // filters by slug alone (reconcile/service.go:126).
    await seedAgent("agent-id-x", "cross-org-agent");
    const deleter = new RecordingDeleter();
    const previous = [
      create(ApiResourceReferenceSchema, {
        org: "another-org",
        kind: ApiResourceKind.agent,
        slug: "cross-org-agent",
      }),
    ];
    const result = await service(deleter).reconcile(previous, [], DEFAULT_RECONCILIATION_OPTIONS);
    expect(result.removed).toHaveLength(1);
    expect(deleter.calls).toEqual([
      { kind: ApiResourceKind.agent, resourceId: "agent-id-x" },
    ]);
  });

  it("unresolvable slug: collected as an error, nothing deleted", async () => {
    const deleter = new RecordingDeleter();
    const previous = [ref(ApiResourceKind.agent, "ghost-agent")];
    const result = await service(deleter).reconcile(previous, [], DEFAULT_RECONCILIATION_OPTIONS);
    expect(result.removed).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.resourceKey).toBe("agent:ghost-agent");
    expect(result.errors[0]?.message).toBe("failed to resolve resource for deletion");
    expect(deleter.calls).toHaveLength(0);
  });

  it("unsupported member kind: an unsupported-kind resolution error", async () => {
    const deleter = new RecordingDeleter();
    const previous = [ref(ApiResourceKind.project, "nested-project")];
    const result = await service(deleter).reconcile(previous, [], DEFAULT_RECONCILIATION_OPTIONS);
    expect(result.removed).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.resourceKey).toBe("project:nested-project");
    expect((result.errors[0]?.cause as Error).message).toBe(
      "unsupported resource kind: project",
    );
    expect(deleter.calls).toHaveLength(0);
  });

  it("continues on failure: one failed delete never blocks the rest (Go PartialFailure)", async () => {
    await seedAgent("agent-ok", "good-agent");
    await seedWorkflow("wf-fail", "bad-workflow");
    await seedSkill("skill-ok", "good-skill");

    // Ordering matters: the failing workflow sits BETWEEN two successes,
    // proving the loop continues past a failure in both directions.
    const deleter = new RecordingDeleter(new Set([ApiResourceKind.workflow]));
    const previous = [
      ref(ApiResourceKind.agent, "good-agent"),
      ref(ApiResourceKind.workflow, "bad-workflow"),
      ref(ApiResourceKind.skill, "good-skill"),
    ];
    const result = await service(deleter).reconcile(previous, [], DEFAULT_RECONCILIATION_OPTIONS);

    expect(result.removed.map((r) => r.slug)).toEqual(["good-agent", "good-skill"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.resourceKey).toBe("workflow:bad-workflow");
    expect(result.errors[0]?.message).toBe("failed to delete orphaned resource");
    expect(deleter.calls).toHaveLength(3);
  });

  it("a seeded resource without an id is a resolution error, not a delete", async () => {
    // saveResource keys the row by the passed id, but the reconciler reads
    // metadata.id off the unmarshaled message — absent means unresolvable
    // (Go: "resource %s/%s has no ID").
    await store.saveResource(
      ApiResourceKind.agent,
      "row-key-only",
      AgentSchema,
      create(AgentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: { name: "no-id", slug: "no-id", org: "local" },
      }),
    );
    const deleter = new RecordingDeleter();
    const result = await service(deleter).reconcile(
      [ref(ApiResourceKind.agent, "no-id")],
      [],
      DEFAULT_RECONCILIATION_OPTIONS,
    );
    expect(result.errors).toHaveLength(1);
    expect((result.errors[0]?.cause as Error).message).toBe(
      "resource agent/no-id has no ID",
    );
    expect(deleter.calls).toHaveLength(0);
  });
});

describe("referenceKey (Go TestReferenceKey)", () => {
  it("renders the kind's enum NAME, exactly Go's %s", () => {
    expect(referenceKey(ref(ApiResourceKind.agent, "my-agent"))).toBe("agent:my-agent");
    expect(referenceKey(ref(ApiResourceKind.mcp_server, "tools"))).toBe("mcp_server:tools");
  });
});

describe("toProtoSummary (Go ToProtoSummary)", () => {
  it("maps added → created and removed → deleted; updated is ALWAYS empty", () => {
    const added = [ref(ApiResourceKind.agent, "a1")];
    const removed = [ref(ApiResourceKind.workflow, "w1")];
    const summary = toProtoSummary({ added, removed, errors: [] });
    expect(summary.created.map((r) => r.slug)).toEqual(["a1"]);
    expect(summary.updated).toEqual([]);
    expect(summary.deleted.map((r) => r.slug)).toEqual(["w1"]);
  });

  it("an all-empty result still yields a message (wire-visible presence)", () => {
    const summary = toProtoSummary({ added: [], removed: [], errors: [] });
    expect(summary.created).toEqual([]);
    expect(summary.deleted).toEqual([]);
  });

  it("a failed orphan is simply absent from deleted (errors never map)", () => {
    const summary = toProtoSummary({
      added: [],
      removed: [ref(ApiResourceKind.agent, "deleted-ok")],
      errors: [
        { resourceKey: "workflow:failed", message: "failed to delete orphaned resource", cause: new Error("x") },
      ],
    });
    expect(summary.deleted.map((r) => r.slug)).toEqual(["deleted-ok"]);
  });
});

describe("project search extractor (Go project_extractor.go)", () => {
  it("extracts name/description/tags/org/visibility-name/createdAt-seconds", () => {
    const createdAt = timestampFromDate(new Date(1_700_000_000_000));
    const project = create(ProjectSchema, {
      metadata: {
        id: "prj_x",
        name: "Data Platform",
        slug: "data-platform",
        org: "acme",
        tags: ["infra", "data"],
        visibility: ApiResourceVisibility.visibility_private,
      },
      spec: { description: "the data platform project" },
      status: { audit: { specAudit: { createdAt } } },
    });
    expect(projectSearchExtractor.getSearchIndexEntry(project)).toEqual({
      name: "Data Platform",
      description: "the data platform project",
      tags: "infra data",
      org: "acme",
      visibility: "visibility_private",
      createdAt: 1_700_000_000,
    });
  });

  it("summary is empty without a spec; extraction skips without metadata (Go nil arms)", () => {
    const noSpec = create(ProjectSchema, { metadata: { name: "n", org: "o" } });
    expect(projectSearchExtractor.getSearchIndexEntry(noSpec)?.description).toBe("");
    expect(
      projectSearchExtractor.getSearchIndexEntry(create(ProjectSchema)),
    ).toBeUndefined();
  });
});
