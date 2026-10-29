/**
 * Pins the search query store: the kind-parsing table, the end-to-end
 * write→index→query pins (session list mode, the #440 emptiness arm, the
 * #439 newly-searchable-kind arm), plus the scope filter (org strict:
 * visibility never widens or narrows it) and RebuildIndex. The escaping and
 * score-normalization tables live with their code in the sqlite driver:
 * see store/sqlite/__tests__/fts5.test.ts.
 * These tests still run the REAL driver through tempStore — the
 * two-layer service→driver integration proof.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";

import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { createLogger } from "../../../boot/logger.js";
import {
  tempStore,
  type TempStore,
} from "../../../store/sqlite/__tests__/support.js";
import { SearchCriteria } from "../criteria.js";
import { SqliteSearchQueryStore, parseKind } from "../query-store.js";
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
 * entry.
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
    spec: { subject },
    status: {
      audit: {
        specAudit: {
          createdAt: {
            seconds: BigInt(opts?.createdAtSeconds ?? 1_700_000_000),
          },
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
  offset?: number;
  pageSize?: number;
}): SearchCriteria {
  return SearchCriteria.create(
    overrides.kinds ?? [],
    overrides.query ?? "",
    overrides.org ?? "",
    overrides.offset ?? 0,
    overrides.pageSize ?? 20,
  );
}

describe("parseKind (its table)", () => {
  it("parses known kind names and rejects unknown ones", () => {
    expect(parseKind("agent")).toBe(ApiResourceKind.agent);
    expect(parseKind("skill")).toBe(ApiResourceKind.skill);
    expect(parseKind("channel_app")).toBe(ApiResourceKind.channel_app);
    // A name no kind carries resolves to nothing; its index rows are skipped.
    expect(parseKind("mcp_server")).toBeUndefined();
    expect(parseKind("invalid_kind")).toBeUndefined();
    expect(parseKind("")).toBeUndefined();
  });
});

describe("write→index→query pins", () => {
  it("session list mode returns the indexed session with the subject as description (#310 class)", async () => {
    await seed(
      ApiResourceKind.session,
      "ses_acme-1",
      SessionSchema,
      newSession("ses_acme-1", "acme", "Fix the deploy pipeline"),
    );
    await seed(
      ApiResourceKind.session,
      "ses_other-1",
      SessionSchema,
      newSession("ses_other-1", "otherorg", "Unrelated thread"),
    );
    await seed(
      ApiResourceKind.agent,
      "agt_acme-1",
      AgentSchema,
      newAgent("agt_acme-1", "acme", "An agent in the same org"),
    );

    const result = await queryStore.search(
      criteria({ kinds: [ApiResourceKind.session], org: "acme" }),
    );

    expect(result.totalCount).toBe(1);
    expect(result.results[0]?.kind).toBe(ApiResourceKind.session);
    expect(result.results[0]?.id).toBe("ses_acme-1");
    expect(result.results[0]?.description).toBe("Fix the deploy pipeline");
    // List mode pins the score to exactly 1.0.
    expect(result.results[0]?.score).toBe(1);
  });

  it("ONLY non-searchable kinds answers emptiness in both modes (#440)", async () => {
    await seed(
      ApiResourceKind.session,
      "ses_acme-1",
      SessionSchema,
      newSession("ses_acme-1", "acme", "Fix the deploy pipeline"),
    );
    await seed(
      ApiResourceKind.agent,
      "agt_acme-1",
      AgentSchema,
      newAgent("agt_acme-1", "acme", "An agent in the same org"),
    );

    for (const query of ["", "acme"]) {
      const result = await queryStore.search(
        criteria({
          kinds: [ApiResourceKind.channel],
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
      create(RunSchema, {
        metadata: { id, name: id, slug: id, org },
        status: {
          audit: { specAudit: { createdAt: { seconds: 1_700_000_000n } } },
        },
      });
    await seed(
      ApiResourceKind.run,
      "exe-acme-1",
      RunSchema,
      newExecution("exe-acme-1", "acme"),
    );
    await seed(
      ApiResourceKind.run,
      "exe-other-1",
      RunSchema,
      newExecution("exe-other-1", "otherorg"),
    );
    await seed(
      ApiResourceKind.session,
      "ses_acme-1",
      SessionSchema,
      newSession("ses_acme-1", "acme", "Fix the deploy pipeline"),
    );

    // Executions index their name (no description field), so the
    // query-mode term matches the seeded name.
    for (const query of ["", "exe-acme-1"]) {
      const result = await queryStore.search(
        criteria({
          kinds: [ApiResourceKind.run],
          query,
          org: "acme",
        }),
      );
      expect(result.totalCount).toBe(1);
      expect(result.results[0]?.kind).toBe(ApiResourceKind.run);
      expect(result.results[0]?.id).toBe("exe-acme-1");
    }
  });
});

describe("scope filter (the org filter is strict)", () => {
  beforeEach(async () => {
    await seed(
      ApiResourceKind.session,
      "ses_a-private",
      SessionSchema,
      newSession("ses_a-private", "org-a", "a private", {
        createdAtSeconds: 1_700_000_003,
      }),
    );
    await seed(
      ApiResourceKind.session,
      "ses_b-private",
      SessionSchema,
      newSession("ses_b-private", "org-b", "b private", {
        createdAtSeconds: 1_700_000_002,
      }),
    );
    await seed(
      ApiResourceKind.session,
      "ses_b-org",
      SessionSchema,
      newSession("ses_b-org", "org-b", "b org", {
        visibility: ApiResourceVisibility.visibility_org,
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
    expect(ids(result)).toEqual(["ses_a-private"]);
  });

  it("another org's rows stay out of an org filter whatever their visibility", async () => {
    const result = await queryStore.search(
      criteria({ kinds: [ApiResourceKind.session], org: "org-b" }),
    );
    expect(new Set(ids(result))).toEqual(
      new Set(["ses_b-private", "ses_b-org"]),
    );
  });

  it("no org filter returns every row, newest first (list mode ordering)", async () => {
    const result = await queryStore.search(
      criteria({ kinds: [ApiResourceKind.session] }),
    );
    expect(ids(result)).toEqual([
      "ses_a-private",
      "ses_b-private",
      "ses_b-org",
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
        offset: 0,
        pageSize: 2,
      }),
    );
    const second = await queryStore.search(
      criteria({
        kinds: [ApiResourceKind.session],
        org: "acme",
        offset: 2,
        pageSize: 2,
      }),
    );

    expect(first.totalCount).toBe(3);
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
      "ses_1",
      SessionSchema,
      newSession("ses_1", "acme", "kept"),
    );
    await seed(
      ApiResourceKind.session,
      "ses_2",
      SessionSchema,
      newSession("ses_2", "acme", "stale"),
    );
    // Delete the resource but leave its index row — the stale-row state.
    await temp.store.deleteResource(ApiResourceKind.session, "ses_2");

    const result = await queryStore.search(
      criteria({ kinds: [ApiResourceKind.session], org: "acme" }),
    );

    // Counts come from the index (still 2); the page skips
    // the unloadable row.
    expect(result.totalCount).toBe(2);
    expect(result.results.map((entry) => entry.id)).toEqual(["ses_1"]);
  });
});

describe("rebuildIndex", () => {
  it("repopulates a wiped index from the resources table", async () => {
    await seed(
      ApiResourceKind.session,
      "ses_1",
      SessionSchema,
      newSession("ses_1", "acme", "rebuild me"),
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
    expect(after.results[0]?.id).toBe("ses_1");
  });
});
