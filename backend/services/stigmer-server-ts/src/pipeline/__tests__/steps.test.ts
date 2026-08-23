/**
 * Pins the shared steps against their Go references (steps/*_test.go,
 * translated): slug generation (cloud-Java-identical, no truncation),
 * duplicate checking with the byte-pinned AlreadyExists copy, create/update
 * state building (status clearing, ULID minting, audit slots #540,
 * visibility default + oss#573 immutability), the loaders' error copy, the
 * best-effort search indexing, visibility validation with cloud-identical
 * copy, reference normalization/validation, and operator identity (#400).
 *
 * Uses the organization resource (the vertical slice) and agent (whose
 * spec carries ApiResourceReference fields) as vehicles.
 */
import { create, clone } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceIdSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import type { SearchIndexEntry } from "../../store/interface.js";
import { SqliteStore } from "../../store/sqlite/store.js";
import { RequestContext } from "../request-context.js";
import {
  newBuildNewStateStep,
  generateId,
  setOperatorIdentity,
  resetOperatorIdentityForTests,
  currentAuditActor,
} from "../steps/defaults.js";
import { newBuildUpdateStateStep } from "../steps/build-update-state.js";
import { newCheckDuplicateStep } from "../steps/duplicate.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
  RESOURCE_ID_KEY,
} from "../steps/delete.js";
import { compareCreatedAtDesc, matchesAllLabels } from "../steps/helpers.js";
import { newIndexSearchStep } from "../steps/index-search.js";
import { EXISTING_RESOURCE_KEY, newLoadExistingStep } from "../steps/load-existing.js";
import {
  EXISTS_IN_DATABASE_KEY,
  SHOULD_CREATE_KEY,
  newLoadForApplyStep,
} from "../steps/load-for-apply.js";
import { newLoadTargetStep, TARGET_RESOURCE_KEY } from "../steps/load-target.js";
import { newPersistStep } from "../steps/persist.js";
import {
  newNormalizeReferencesStep,
  newValidateReferencesStep,
} from "../steps/references.js";
import { generateSlug, newResolveSlugStep } from "../steps/slug.js";
import { newValidateProtoStep } from "../steps/validation.js";
import { newValidateVisibilityStep } from "../steps/validate-visibility.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** Awaits a step execution (sync or async) and returns its thrown error. */
async function captureError(run: () => void | Promise<void>): Promise<unknown> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return error;
  }
}

const ORG = ApiResourceKind.organization;

let dir: string;
let store: SqliteStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stigmer-steps-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
});

afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
  resetOperatorIdentityForTests();
});

function org(overrides?: { id?: string; name?: string; slug?: string; org?: string }) {
  return create(OrganizationSchema, {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: {
      id: overrides?.id ?? "",
      name: overrides?.name ?? "Acme",
      slug: overrides?.slug ?? "",
      org: overrides?.org ?? "",
    },
    spec: { description: "a test organization" },
  });
}

function orgCtx(input = org()): RequestContext<typeof OrganizationSchema> {
  return new RequestContext(OrganizationSchema, input, ORG);
}

describe("generateSlug (Go GenerateSlug, cloud-Java-identical)", () => {
  it.each([
    ["My Cool Agent", "my-cool-agent"],
    ["platform.sara", "platform-sara"],
    ["Hello, World!", "hello-world"],
    ["--already--hyphened--", "already-hyphened"],
    ["A  B", "a-b"],
    ["ünïcode stripped", "ncode-stripped"],
  ])("derives %j → %j", (name, expected) => {
    expect(generateSlug(name)).toBe(expected);
  });
});

describe("ResolveSlug", () => {
  it("derives the slug from the name and is idempotent when set", async () => {
    const ctx = orgCtx(org({ name: "My Org" }));
    await newResolveSlugStep<typeof OrganizationSchema>().execute(ctx);
    expect(ctx.newState.metadata?.slug).toBe("my-org");

    const preset = orgCtx(org({ name: "Other", slug: "kept" }));
    await newResolveSlugStep<typeof OrganizationSchema>().execute(preset);
    expect(preset.newState.metadata?.slug).toBe("kept");
  });

  it("rejects a nameless, slugless resource with InvalidArgument", async () => {
    const ctx = orgCtx(org({ name: "" }));
    const error = await Promise.resolve()
      .then(() => newResolveSlugStep<typeof OrganizationSchema>().execute(ctx))
      .catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.InvalidArgument);
    expect((error as ConnectError).rawMessage).toBe("resource name is required");
  });
});

describe("CheckDuplicate (org-scoped)", () => {
  it("rejects a same-org duplicate with Go's exact copy and allows other orgs", async () => {
    const existing = org({ id: "org_1", slug: "acme", org: "tenant-a" });
    await store.saveResource(ORG, "org_1", OrganizationSchema, existing);

    const dup = orgCtx(org({ slug: "acme", org: "tenant-a" }));
    const error = await captureError(() =>
      newCheckDuplicateStep<typeof OrganizationSchema>(store).execute(dup),
    );
    expect((error as ConnectError).code).toBe(Code.AlreadyExists);
    expect((error as ConnectError).rawMessage).toBe(
      "Organization already exists: slug 'acme' in org 'tenant-a' (id: org_1)",
    );

    const otherOrg = orgCtx(org({ slug: "acme", org: "tenant-b" }));
    await expect(
      newCheckDuplicateStep<typeof OrganizationSchema>(store).execute(otherOrg),
    ).resolves.toBeUndefined();
  });
});

describe("BuildNewState", () => {
  it("clears client status, mints a prefixed ULID, stamps created audit, defaults visibility", async () => {
    // Client-provided status must be discarded (system-managed) — the
    // forged "attacker" audit event must never survive BuildNewState.
    const input = create(OrganizationSchema, {
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: "Acme" },
      spec: { description: "a test organization" },
      status: { audit: { specAudit: { event: "attacker" } } },
    });
    const ctx = orgCtx(input);
    await newBuildNewStateStep<typeof OrganizationSchema>().execute(ctx);

    const state = ctx.newState;
    expect(state.metadata?.id).toMatch(/^org_[0-9a-hjkmnp-tv-z]{26}$/);
    expect(state.status?.audit?.specAudit?.event).toBe("created");
    expect(state.status?.audit?.statusAudit?.event).toBe("created");
    expect(state.status?.audit?.specAudit?.createdBy?.id).toBe("system");
    // Organization is not a blueprint kind → private default.
    expect(state.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
  });

  it("keeps a client-provided id and explicit visibility (idempotent)", async () => {
    const ctx = orgCtx(org({ id: "acme" }));
    ctx.newState.metadata!.visibility = ApiResourceVisibility.visibility_org;
    await newBuildNewStateStep<typeof OrganizationSchema>().execute(ctx);
    expect(ctx.newState.metadata?.id).toBe("acme");
    expect(ctx.newState.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
  });
});

describe("generateId", () => {
  it("mints {prefix}_{lowercase 26-char Crockford ULID} (Go GenerateID format)", () => {
    const id = generateId("agt");
    expect(id).toMatch(/^agt_[0-9a-hjkmnp-tv-z]{26}$/);
    expect(generateId("agt")).not.toBe(id);
  });
});

describe("operator identity (#400)", () => {
  it("stamps the system placeholder when unconfigured and the operator when configured", () => {
    expect(currentAuditActor().id).toBe("system");

    setOperatorIdentity("op@example.test", "Op");
    const actor = currentAuditActor();
    expect(actor.id).toBe("op@example.test");
    expect(actor.email).toBe("op@example.test");
    expect(actor.displayName).toBe("Op");
  });

  it("a second install is a loud boot failure, not a silent overwrite", () => {
    setOperatorIdentity("op@example.test", "Op");
    expect(() => setOperatorIdentity("two@example.test", "Two")).toThrow(
      "operator identity already installed",
    );
  });
});

describe("BuildUpdateState", () => {
  it("preserves id/slug/org/visibility (oss#573), replaces spec, keeps creation audit", async () => {
    // The stored resource, created through the real create steps.
    const createCtx = orgCtx(org({ name: "Acme" }));
    await newResolveSlugStep<typeof OrganizationSchema>().execute(createCtx);
    await newBuildNewStateStep<typeof OrganizationSchema>().execute(createCtx);
    const existing = createCtx.newState;
    existing.metadata!.visibility = ApiResourceVisibility.visibility_org;
    const createdBy = existing.status!.audit!.specAudit!.createdBy;

    // The update request tries to change everything, including immutables.
    const request = org({ id: existing.metadata!.id, name: "Acme Renamed" });
    request.metadata!.slug = "attempted-new-slug";
    request.metadata!.org = "attempted-new-org";
    request.spec!.description = "updated description";

    const ctx = orgCtx(request);
    ctx.set(EXISTING_RESOURCE_KEY, clone(OrganizationSchema, existing));
    await newBuildUpdateStateStep<typeof OrganizationSchema>().execute(ctx);

    const updated = ctx.newState;
    expect(updated.metadata?.id).toBe(existing.metadata?.id);
    expect(updated.metadata?.slug).toBe(existing.metadata?.slug);
    expect(updated.metadata?.org).toBe(existing.metadata?.org);
    expect(updated.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
    expect(updated.metadata?.name).toBe("Acme Renamed");
    expect(updated.spec?.description).toBe("updated description");
    expect(updated.status?.audit?.specAudit?.event).toBe("updated");
    expect(updated.status?.audit?.specAudit?.createdBy?.id).toBe(createdBy?.id);
    expect(updated.status?.audit?.statusAudit?.event).toBe("updated");
  });
});

describe("loaders", () => {
  it("LoadExisting loads by id, falls back to slug (backfilling the id), and pins the NotFound copy", async () => {
    const existing = org({ id: "acme", slug: "acme" });
    await store.saveResource(ORG, "acme", OrganizationSchema, existing);

    const byId = orgCtx(org({ id: "acme" }));
    await newLoadExistingStep<typeof OrganizationSchema>(store).execute(byId);
    expect(byId.get(EXISTING_RESOURCE_KEY)).toBeDefined();

    const bySlug = orgCtx(org({ slug: "acme" }));
    await newLoadExistingStep<typeof OrganizationSchema>(store).execute(bySlug);
    expect(bySlug.newState.metadata?.id).toBe("acme");

    const missing = orgCtx(org({ id: "ghost" }));
    const error = await captureError(() =>
      newLoadExistingStep<typeof OrganizationSchema>(store).execute(missing),
    );
    expect((error as ConnectError).code).toBe(Code.NotFound);
    expect((error as ConnectError).rawMessage).toBe("Organization not found: ghost");

    const neither = orgCtx(org({ name: "" }));
    const iaError = await captureError(() =>
      newLoadExistingStep<typeof OrganizationSchema>(store).execute(neither),
    );
    expect((iaError as ConnectError).rawMessage).toBe(
      "resource id or slug is required for update",
    );
  });

  it("LoadForApply sets the create/update flags and never fails on not-found", async () => {
    const fresh = orgCtx(org({ slug: "new-org" }));
    await newLoadForApplyStep<typeof OrganizationSchema>(store).execute(fresh);
    expect(fresh.get(SHOULD_CREATE_KEY)).toBe(true);
    expect(fresh.get(EXISTS_IN_DATABASE_KEY)).toBe(false);

    await store.saveResource(ORG, "acme", OrganizationSchema, org({ id: "acme", slug: "acme" }));
    const found = orgCtx(org({ slug: "acme" }));
    await newLoadForApplyStep<typeof OrganizationSchema>(store).execute(found);
    expect(found.get(SHOULD_CREATE_KEY)).toBe(false);
    expect(found.newState.metadata?.id).toBe("acme");
  });

  it("LoadTarget loads by id-wrapper and rejects empty/unknown ids", async () => {
    await store.saveResource(ORG, "acme", OrganizationSchema, org({ id: "acme", slug: "acme" }));

    const ctx = new RequestContext(
      ApiResourceIdSchema,
      create(ApiResourceIdSchema, { value: "acme" }),
      ORG,
    );
    await newLoadTargetStep(store, OrganizationSchema).execute(ctx);
    expect(ctx.get(TARGET_RESOURCE_KEY)).toBeDefined();

    const empty = new RequestContext(
      ApiResourceIdSchema,
      create(ApiResourceIdSchema, { value: "" }),
      ORG,
    );
    const error = await captureError(() =>
      newLoadTargetStep(store, OrganizationSchema).execute(empty),
    );
    expect((error as ConnectError).rawMessage).toBe("resource id is required");
  });
});

describe("delete steps + persist", () => {
  it("Extract → LoadForDelete → Delete round-trips through the store", async () => {
    await store.saveResource(ORG, "acme", OrganizationSchema, org({ id: "acme", slug: "acme" }));

    const ctx = new RequestContext(
      ApiResourceIdSchema,
      create(ApiResourceIdSchema, { value: "acme" }),
      ORG,
    );
    await newExtractResourceIdStep<typeof ApiResourceIdSchema>().execute(ctx);
    expect(ctx.get(RESOURCE_ID_KEY)).toBe("acme");

    await newLoadExistingForDeleteStep(store, OrganizationSchema).execute(ctx);
    expect(ctx.get(EXISTING_RESOURCE_KEY)).toBeDefined();

    await newDeleteResourceStep<typeof ApiResourceIdSchema>(store).execute(ctx);
    await expect(
      store.getResource(ORG, "acme", OrganizationSchema),
    ).rejects.toThrow("resource not found");
  });

  it("Persist saves newState and requires an id", async () => {
    const ctx = orgCtx(org({ id: "acme", slug: "acme" }));
    await newPersistStep<typeof OrganizationSchema>(store).execute(ctx);
    const stored = await store.getResource(ORG, "acme", OrganizationSchema);
    expect(stored.metadata?.name).toBe("Acme");

    const noId = orgCtx(org());
    const error = await captureError(() =>
      newPersistStep<typeof OrganizationSchema>(store).execute(noId),
    );
    expect((error as ConnectError).code).toBe(Code.Internal);
  });
});

describe("IndexSearch (best-effort)", () => {
  const extractor = {
    getSearchIndexEntry(): SearchIndexEntry {
      return {
        name: "Acme",
        description: "a test organization",
        tags: "",
        org: "",
        visibility: "visibility_private",
        createdAt: 1,
      };
    },
  };

  it("indexes the persisted resource", async () => {
    const ctx = orgCtx(org({ id: "acme", slug: "acme" }));
    await newIndexSearchStep<typeof OrganizationSchema>(store, extractor, silentLogger).execute(ctx);

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(store.path());
    const row = db.prepare(`SELECT name FROM search_index WHERE resource_id = 'acme'`).get() as
      | { name: string }
      | undefined;
    db.close();
    expect(row?.name).toBe("Acme");
  });

  it("a store failure logs a warning and never fails the pipeline", async () => {
    await store.close(); // force the failure
    const warnings: string[] = [];
    const logger: Logger = {
      ...silentLogger,
      warn(message) {
        warnings.push(message);
      },
    };
    const ctx = orgCtx(org({ id: "acme" }));
    await expect(
      newIndexSearchStep<typeof OrganizationSchema>(store, extractor, logger).execute(ctx),
    ).resolves.toBeUndefined();
    expect(warnings.some((w) => w.includes("best-effort"))).toBe(true);
  });
});

describe("ValidateProto", () => {
  it("passes a valid resource and maps violations to InvalidArgument", async () => {
    await expect(
      Promise.resolve(newValidateProtoStep<typeof OrganizationSchema>().execute(orgCtx())),
    ).resolves.toBeUndefined();

    const bad = orgCtx(org({ slug: "BadSlug" }));
    const error = await Promise.resolve()
      .then(() => newValidateProtoStep<typeof OrganizationSchema>().execute(bad))
      .catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.InvalidArgument);
  });
});

describe("ValidateVisibility", () => {
  it("rejects an unsupported level with the cloud-identical copy", async () => {
    const input = org();
    input.metadata!.visibility = ApiResourceVisibility.visibility_platform;
    const ctx = orgCtx(input);
    const error = await Promise.resolve()
      .then(() => newValidateVisibilityStep<typeof OrganizationSchema>().execute(ctx))
      .catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.InvalidArgument);
    expect((error as ConnectError).rawMessage).toContain(
      "organization resources cannot be set to visibility_platform",
    );
    expect((error as ConnectError).rawMessage).toContain("Supported visibility levels:");
  });

  it("always accepts private and unspecified (no visibility grant)", async () => {
    await expect(
      Promise.resolve(newValidateVisibilityStep<typeof OrganizationSchema>().execute(orgCtx())),
    ).resolves.toBeUndefined();
  });
});

describe("references (agent spec as the vehicle)", () => {
  function agent(skillOrg: string) {
    return create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name: "Helper", org: "acme" },
      spec: {
        instructions: "help the user with their tasks",
        skillRefs: [
          { kind: ApiResourceKind.skill, slug: "writing", org: skillOrg },
        ],
      },
    });
  }

  it("NormalizeReferences fills EMPTY ref orgs from metadata.org and preserves explicit ones", async () => {
    const ctx = new RequestContext(AgentSchema, agent(""), ApiResourceKind.agent);
    await newNormalizeReferencesStep<typeof AgentSchema>().execute(ctx);
    expect(ctx.newState.spec?.skillRefs[0]?.org).toBe("acme");

    const explicit = new RequestContext(AgentSchema, agent("other-org"), ApiResourceKind.agent);
    await newNormalizeReferencesStep<typeof AgentSchema>().execute(explicit);
    expect(explicit.newState.spec?.skillRefs[0]?.org).toBe("other-org");
  });

  it("ValidateReferences rejects a missing MCP server with FailedPrecondition and Go's copy", async () => {
    const withMcp = create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name: "Helper", org: "acme" },
      spec: {
        instructions: "help the user with their tasks",
        mcpServerUsages: [
          { mcpServerRef: { kind: ApiResourceKind.mcp_server, slug: "ghost", org: "acme" } },
        ],
      },
    });
    const ctx = new RequestContext(AgentSchema, withMcp, ApiResourceKind.agent);
    const error = await captureError(() =>
      newValidateReferencesStep<typeof AgentSchema>(store).execute(ctx),
    );
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toContain(
      "referenced MCP server(s) not found: 'ghost' (org: acme)",
    );
  });
});

describe("list helpers (consolidated from the per-domain Go copies)", () => {
  function ts(seconds: number, nanos = 0) {
    return create(TimestampSchema, { seconds: BigInt(seconds), nanos });
  }

  describe("compareCreatedAtDesc", () => {
    it("answers 0 when both timestamps are missing", () => {
      expect(compareCreatedAtDesc(undefined, undefined)).toBe(0);
    });

    it("orders a timestamped entry before an untimestamped one", () => {
      expect(compareCreatedAtDesc(ts(1), undefined)).toBe(-1);
      expect(compareCreatedAtDesc(undefined, ts(1))).toBe(1);
    });

    it("orders by seconds descending (newest first)", () => {
      expect(compareCreatedAtDesc(ts(20), ts(10))).toBe(-1);
      expect(compareCreatedAtDesc(ts(10), ts(20))).toBe(1);
    });

    it("breaks a seconds tie by nanos descending", () => {
      expect(compareCreatedAtDesc(ts(10, 500), ts(10, 100))).toBe(-1);
      expect(compareCreatedAtDesc(ts(10, 100), ts(10, 500))).toBe(1);
    });

    it("answers 0 on a full tie", () => {
      expect(compareCreatedAtDesc(ts(10, 100), ts(10, 100))).toBe(0);
    });
  });

  describe("matchesAllLabels", () => {
    it("matches everything when the filter is empty", () => {
      expect(matchesAllLabels({}, {})).toBe(true);
      expect(matchesAllLabels({ a: "1" }, {})).toBe(true);
    });

    it("requires EVERY filter entry to match (AND semantics)", () => {
      const labels = { a: "1", b: "2" };
      expect(matchesAllLabels(labels, { a: "1", b: "2" })).toBe(true);
      expect(matchesAllLabels(labels, { a: "1", c: "3" })).toBe(false);
    });

    it("rejects a value mismatch on a present key", () => {
      expect(matchesAllLabels({ a: "1" }, { a: "2" })).toBe(false);
    });
  });
});
