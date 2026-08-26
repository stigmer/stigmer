/**
 * Pins the search query store against Go's
 * sqlite_search_query_store_test.go (the escaping / kind-parsing /
 * score-normalization tables) and
 * sqlite_search_query_store_query_test.go (the end-to-end
 * write→index→query pins: session list mode, the #440 emptiness arm, the
 * #439 newly-searchable-kind arm), plus the scope-filter matrix
 * (org strict / crossOrgPublic / excludePublic) and RebuildIndex —
 * including the DD-D proof: rebuilding over an ADOPTED Go-created
 * database re-indexes its project rows.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ProjectSchema } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";

import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { createLogger } from "../../../boot/logger.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import {
  materializeGoFixture,
  tempStore,
  type TempStore,
} from "../../../store/sqlite/__tests__/support.js";
import { SearchCriteria } from "../criteria.js";
import {
  SqliteSearchQueryStore,
  escapeFTS5Query,
  normalizeScore,
  parseKind,
} from "../query-store.js";
import { newSearchableResourceRegistry } from "../registry.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => undefined,
});
const registry = newSearchableResourceRegistry();

let temp: TempStore;
let queryStore: SqliteSearchQueryStore;

beforeEach(() => {
  temp = tempStore();
  queryStore = new SqliteSearchQueryStore(temp.store, registry, silentLogger);
});

afterEach(async () => {
  await temp.cleanup();
});

/**
 * Writes through the same seams production writes use: saveResource for
 * the document, the kind's extractor + upsertSearchIndex for the FTS
 * entry (Go's newSeededSQLiteStore).
 */
async function seed<Desc extends DescMessage>(
  kind: ApiResourceKind,
  id: string,
  schema: Desc,
  msg: MessageShape<Desc>,
): Promise<void> {
  await temp.store.saveResource(kind, id, schema, msg);
  const extractor = registry.getExtractor(kind);
  if (extractor === undefined) {
    throw new Error(`no extractor for kind ${ApiResourceKind[kind]}`);
  }
  const entry = extractor.getSearchIndexEntry(msg);
  if (entry === undefined) {
    throw new Error(`extractor for ${ApiResourceKind[kind]} returned no entry`);
  }
  await temp.store.upsertSearchIndex(kind, id, entry);
}

function newSession(
  id: string,
  org: string,
  subject: string,
  opts?: { visibility?: ApiResourceVisibility; createdAtSeconds?: number },
) {
  return create(SessionSchema, {
    metadata: {
      id,
      name: id,
      slug: id,
      org,
      visibility: opts?.visibility ?? ApiResourceVisibility.visibility_private,
    },
    spec: { subject, agentInstanceId: "agi_test" },
    status: {
      audit: {
        specAudit: {
          createdAt: { seconds: BigInt(opts?.createdAtSeconds ?? 1_700_000_000) },
        },
      },
    },
  });
}

function newAgent(id: string, org: string, description: string) {
  return create(AgentSchema, {
    metadata: { id, name: id, slug: id, org },
    spec: { description, instructions: "do things" },
    status: {
      audit: { specAudit: { createdAt: { seconds: 1_700_000_000n } } },
    },
  });
}

function criteria(overrides: {
  kinds?: ApiResourceKind[];
  query?: string;
  org?: string;
  excludePublic?: boolean;
  crossOrgPublic?: boolean;
  pageNumber?: number;
  pageSize?: number;
}): SearchCriteria {
  return SearchCriteria.create(
    overrides.kinds ?? [],
    overrides.query ?? "",
    overrides.org ?? "",
    overrides.excludePublic ?? false,
    overrides.crossOrgPublic ?? false,
    overrides.pageNumber ?? 1,
    overrides.pageSize ?? 20,
  );
}

describe("escapeFTS5Query (Go's table, case-for-case)", () => {
  const cases: Array<[name: string, input: string, expected: string]> = [
    ["empty query", "", ""],
    ["single word", "kubernetes", `"kubernetes"*`],
    ["multiple words", "kubernetes deployment", `"kubernetes" "deployment"`],
    ["whitespace trimmed", "  hello  ", `"hello"*`],
    ["AND treated as literal", "foo AND bar", `"foo" "AND" "bar"`],
    ["OR treated as literal", "foo OR bar", `"foo" "OR" "bar"`],
    ["NOT treated as literal", "foo NOT bar", `"foo" "NOT" "bar"`],
    ["NEAR treated as literal", "foo NEAR bar", `"foo" "NEAR" "bar"`],
    ["colon in single token", "server:skill-creator", `"server:skill-creator"*`],
    ["colon with simple term", "name:kubernetes", `"name:kubernetes"*`],
    [
      "colon in multi-word query",
      "find server:something here",
      `"find" "server:something" "here"`,
    ],
    ["dash in token", "mcp-server", `"mcp-server"*`],
    ["leading dash", "-excluded", `"-excluded"*`],
    ["dash in multi-word", "mcp-server deployment", `"mcp-server" "deployment"`],
    ["asterisk in token", "kube*", `"kube*"*`],
    ["parentheses", "NEAR(a b)", `"NEAR(a" "b)"`],
    ["brackets", "test[0]", `"test[0]"*`],
    ["caret", "^boost", `"^boost"*`],
    ["embedded quotes stripped", `foo"bar`, `"foobar"*`],
    ["only quotes", `"""`, ""],
    [
      "mixed specials multi-word",
      `server:x mcp-server kube*`,
      `"server:x" "mcp-server" "kube*"`,
    ],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(escapeFTS5Query(input)).toBe(expected);
    });
  }
});

describe("parseKind (Go's table)", () => {
  it("parses known kind names and rejects unknown ones", () => {
    expect(parseKind("agent")).toBe(ApiResourceKind.agent);
    expect(parseKind("skill")).toBe(ApiResourceKind.skill);
    expect(parseKind("mcp_server")).toBe(ApiResourceKind.mcp_server);
    expect(parseKind("workflow")).toBe(ApiResourceKind.workflow);
    expect(parseKind("invalid_kind")).toBeUndefined();
    expect(parseKind("")).toBeUndefined();
  });
});

describe("normalizeScore (Go's table)", () => {
  const cases: Array<[bm25: number, min: number, max: number]> = [
    [0, 1.0, 1.0],
    [1.0, 1.0, 1.0],
    [-1.0, 0.8, 1.0],
    [-5.0, 0.4, 0.6],
    [-15.0, 0, 0.1],
  ];
  for (const [bm25, min, max] of cases) {
    it(`bm25 ${bm25} → [${min}, ${max}]`, () => {
      const score = normalizeScore(bm25);
      expect(score).toBeGreaterThanOrEqual(min);
      expect(score).toBeLessThanOrEqual(max);
    });
  }
});

describe("write→index→query pins (Go's query_test.go)", () => {
  it("session list mode returns the indexed session with the subject as description (#310 class)", async () => {
    await seed(
      ApiResourceKind.session,
      "ses-acme-1",
      SessionSchema,
      newSession("ses-acme-1", "acme", "Fix the deploy pipeline"),
    );
    await seed(
      ApiResourceKind.session,
      "ses-other-1",
      SessionSchema,
      newSession("ses-other-1", "otherorg", "Unrelated thread"),
    );
    await seed(
      ApiResourceKind.agent,
      "agt-acme-1",
      AgentSchema,
      newAgent("agt-acme-1", "acme", "An agent in the same org"),
    );

    const result = await queryStore.search(
      criteria({ kinds: [ApiResourceKind.session], org: "acme" }),
    );

    expect(result.totalCount).toBe(1);
    expect(result.results[0]?.kind).toBe(ApiResourceKind.session);
    expect(result.results[0]?.id).toBe("ses-acme-1");
    expect(result.results[0]?.description).toBe("Fix the deploy pipeline");
    // List mode pins the score to exactly 1.0.
    expect(result.results[0]?.score).toBe(1);
  });

  it("ONLY non-searchable kinds answers emptiness in both modes (#440)", async () => {
    await seed(
      ApiResourceKind.session,
      "ses-acme-1",
      SessionSchema,
      newSession("ses-acme-1", "acme", "Fix the deploy pipeline"),
    );
    await seed(
      ApiResourceKind.agent,
      "agt-acme-1",
      AgentSchema,
      newAgent("agt-acme-1", "acme", "An agent in the same org"),
    );

    for (const query of ["", "acme"]) {
      const result = await queryStore.search(
        criteria({
          kinds: [ApiResourceKind.agent_channel],
          query,
          org: "acme",
        }),
      );
      expect(result.totalCount).toBe(0);
      expect(result.results).toEqual([]);
    }
  });

  it("a newly-searchable kind serves list AND query mode (#439)", async () => {
    const newExecution = (id: string, org: string) =>
      create(AgentExecutionSchema, {
        metadata: { id, name: id, slug: id, org },
        status: {
          audit: { specAudit: { createdAt: { seconds: 1_700_000_000n } } },
        },
      });
    await seed(
      ApiResourceKind.agent_execution,
      "exe-acme-1",
      AgentExecutionSchema,
      newExecution("exe-acme-1", "acme"),
    );
    await seed(
      ApiResourceKind.agent_execution,
      "exe-other-1",
      AgentExecutionSchema,
      newExecution("exe-other-1", "otherorg"),
    );
    await seed(
      ApiResourceKind.session,
      "ses-acme-1",
      SessionSchema,
      newSession("ses-acme-1", "acme", "Fix the deploy pipeline"),
    );

    // Executions index their name (no description field), so the
    // query-mode term matches the seeded name.
    for (const query of ["", "exe-acme-1"]) {
      const result = await queryStore.search(
        criteria({
          kinds: [ApiResourceKind.agent_execution],
          query,
          org: "acme",
        }),
      );
      expect(result.totalCount).toBe(1);
      expect(result.results[0]?.kind).toBe(ApiResourceKind.agent_execution);
      expect(result.results[0]?.id).toBe("exe-acme-1");
    }
  });
});

describe("scope-filter matrix (Go buildScopeFilter)", () => {
  beforeEach(async () => {
    await seed(
      ApiResourceKind.session,
      "ses-a-private",
      SessionSchema,
      newSession("ses-a-private", "org-a", "a private", {
        createdAtSeconds: 1_700_000_003,
      }),
    );
    await seed(
      ApiResourceKind.session,
      "ses-b-private",
      SessionSchema,
      newSession("ses-b-private", "org-b", "b private", {
        createdAtSeconds: 1_700_000_002,
      }),
    );
    await seed(
      ApiResourceKind.session,
      "ses-b-public",
      SessionSchema,
      newSession("ses-b-public", "org-b", "b public", {
        visibility: ApiResourceVisibility.visibility_public,
        createdAtSeconds: 1_700_000_001,
      }),
    );
  });

  const ids = (result: { results: readonly { id: string }[] }) =>
    result.results.map((entry) => entry.id);

  it("a strict org filter returns only that org's rows", async () => {
    const result = await queryStore.search(
      criteria({ kinds: [ApiResourceKind.session], org: "org-a" }),
    );
    expect(ids(result)).toEqual(["ses-a-private"]);
  });

  it("crossOrgPublic widens to OTHER orgs' public rows only", async () => {
    const result = await queryStore.search(
      criteria({
        kinds: [ApiResourceKind.session],
        org: "org-a",
        crossOrgPublic: true,
      }),
    );
    expect(new Set(ids(result))).toEqual(
      new Set(["ses-a-private", "ses-b-public"]),
    );
  });

  it("excludePublic subtracts public rows from any scope", async () => {
    const unscoped = await queryStore.search(
      criteria({ kinds: [ApiResourceKind.session], excludePublic: true }),
    );
    expect(new Set(ids(unscoped))).toEqual(
      new Set(["ses-a-private", "ses-b-private"]),
    );

    const widened = await queryStore.search(
      criteria({
        kinds: [ApiResourceKind.session],
        org: "org-a",
        crossOrgPublic: true,
        excludePublic: true,
      }),
    );
    expect(ids(widened)).toEqual(["ses-a-private"]);
  });

  it("no org filter returns every row, newest first (list mode ordering)", async () => {
    const result = await queryStore.search(
      criteria({ kinds: [ApiResourceKind.session] }),
    );
    expect(ids(result)).toEqual([
      "ses-a-private",
      "ses-b-private",
      "ses-b-public",
    ]);
  });
});

describe("pagination through the store", () => {
  it("pages partition the result set with full counts on every page", async () => {
    for (let i = 0; i < 3; i++) {
      await seed(
        ApiResourceKind.session,
        `ses-${i}`,
        SessionSchema,
        newSession(`ses-${i}`, "acme", `subject ${i}`, {
          createdAtSeconds: 1_700_000_000 + i,
        }),
      );
    }

    const first = await queryStore.search(
      criteria({
        kinds: [ApiResourceKind.session],
        org: "acme",
        pageNumber: 1,
        pageSize: 2,
      }),
    );
    const second = await queryStore.search(
      criteria({
        kinds: [ApiResourceKind.session],
        org: "acme",
        pageNumber: 2,
        pageSize: 2,
      }),
    );

    expect(first.totalCount).toBe(3);
    expect(first.totalPages).toBe(2);
    expect(first.results).toHaveLength(2);
    expect(second.results).toHaveLength(1);
    const seen = new Set(
      [...first.results, ...second.results].map((entry) => entry.id),
    );
    expect(seen.size).toBe(3);
  });
});

describe("stale-index resilience", () => {
  it("skips a hit whose resource was deleted (warn, never fail)", async () => {
    await seed(
      ApiResourceKind.session,
      "ses-1",
      SessionSchema,
      newSession("ses-1", "acme", "kept"),
    );
    await seed(
      ApiResourceKind.session,
      "ses-2",
      SessionSchema,
      newSession("ses-2", "acme", "stale"),
    );
    // Delete the resource but leave its index row — the stale-row state.
    await temp.store.deleteResource(ApiResourceKind.session, "ses-2");

    const result = await queryStore.search(
      criteria({ kinds: [ApiResourceKind.session], org: "acme" }),
    );

    // Counts come from the index (still 2 — Go's shape); the page skips
    // the unloadable row.
    expect(result.totalCount).toBe(2);
    expect(result.results.map((entry) => entry.id)).toEqual(["ses-1"]);
  });
});

describe("rebuildIndex", () => {
  it("repopulates a wiped index from the resources table", async () => {
    await seed(
      ApiResourceKind.session,
      "ses-1",
      SessionSchema,
      newSession("ses-1", "acme", "rebuild me"),
    );
    await temp.store.clearSearchIndex();

    const before = await queryStore.search(
      criteria({ kinds: [ApiResourceKind.session], org: "acme" }),
    );
    expect(before.totalCount).toBe(0);

    const indexed = await queryStore.rebuildIndex();
    expect(indexed).toBe(1);

    const after = await queryStore.search(
      criteria({ kinds: [ApiResourceKind.session], org: "acme" }),
    );
    expect(after.totalCount).toBe(1);
    expect(after.results[0]?.id).toBe("ses-1");
  });

  it("re-indexes project rows on an ADOPTED Go-created database (DD-D)", async () => {
    // The committed Go-v6 fixture, opened through the driver (migrates
    // v6→v7 — real adoption), then given a project row the way a Go
    // server would have written one: raw resource bytes.
    const fixture = materializeGoFixture();
    const adopted = SqliteStore.open(fixture.dbPath);
    try {
      const project = create(ProjectSchema, {
        metadata: { id: "prj_1", name: "billing", slug: "billing", org: "acme" },
        spec: { description: "the billing project" },
        status: {
          audit: { specAudit: { createdAt: { seconds: 1_700_000_000n } } },
        },
      });
      await adopted.saveResource(
        ApiResourceKind.project,
        "prj_1",
        ProjectSchema,
        project,
      );
      // Boot state: the TS server wipes and rebuilds — a 12-kind registry
      // would erase this row from search forever.
      const adoptedQueryStore = new SqliteSearchQueryStore(
        adopted,
        registry,
        silentLogger,
      );
      await adoptedQueryStore.rebuildIndex();

      const result = await adoptedQueryStore.search(
        criteria({ kinds: [ApiResourceKind.project], org: "acme" }),
      );
      expect(result.totalCount).toBe(1);
      expect(result.results[0]?.id).toBe("prj_1");
      expect(result.results[0]?.description).toBe("the billing project");

      // toBinary sanity: the row loaded back is byte-equal to what a Go
      // server holds (protobuf wire format is shared).
      const raw = await adopted.getResource(
        ApiResourceKind.project,
        "prj_1",
        ProjectSchema,
      );
      expect(toBinary(ProjectSchema, raw)).toEqual(
        toBinary(ProjectSchema, project),
      );
    } finally {
      await adopted.close();
      fixture.cleanup();
    }
  });
});
