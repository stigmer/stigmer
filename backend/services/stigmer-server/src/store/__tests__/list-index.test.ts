/**
 * Pins the list index's one derivation (../list-index.ts), the pieces
 * both drivers share: a declaration refuses a key its schema cannot
 * answer at load; a row's facts are its organization, its creation
 * instant as fixed-width text and every key it names; the instant sorts
 * as text exactly as `compareCreatedAtDesc` orders timestamps (absent
 * last); the query predicate and the merge the drivers finish with; and
 * the registry's refusals. The drivers' SQL is pinned per driver by the
 * list-index arms of store-contract.ts.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { compareCreatedAtDesc } from "../../pipeline/steps/helpers.js";
import {
  ListIndexRegistry,
  compareListIndexOrder,
  declareListIndex,
  field,
  label,
  listIndexFactsOf,
  listIndexInstant,
  listIndexInstantOfMillis,
  matchesListIndexQuery,
  mergeListIndexRows,
  sameListKeyRows,
} from "../list-index.js";
import type { ListIndexFacts, ListIndexRow } from "../list-index.js";

const sessions = declareListIndex({
  kind: ApiResourceKind.session,
  schema: SessionSchema,
  revision: 1,
  keys: {
    agent_instance: field("spec.agent_instance_id"),
    channel: label("stigmer.ai/channel-id"),
  },
});

function row(createdAt: string, id: string): ListIndexRow {
  return { id, data: new Uint8Array(), cursor: { createdAt, id } };
}

function facts(overrides: Partial<ListIndexFacts> = {}): ListIndexFacts {
  return {
    org: "acme",
    createdAt: "2026-09-23T10:00:00.000000000Z",
    revision: 1,
    keys: [],
    ...overrides,
  };
}

describe("declareListIndex", () => {
  it("refuses a path with no such field", () => {
    expect(() =>
      declareListIndex({
        kind: ApiResourceKind.session,
        schema: SessionSchema,
        revision: 1,
        keys: { wrong: field("spec.agent_instance") },
      }),
    ).toThrow(
      "list index for session, key 'wrong': 'spec.agent_instance' has no field 'agent_instance'",
    );
  });

  it("refuses a path that ends on a message, not a string", () => {
    expect(() =>
      declareListIndex({
        kind: ApiResourceKind.session,
        schema: SessionSchema,
        revision: 1,
        keys: { spec: field("spec") },
      }),
    ).toThrow("'spec' is not a string field");
  });

  it("refuses a path that walks through a scalar", () => {
    expect(() =>
      declareListIndex({
        kind: ApiResourceKind.session,
        schema: SessionSchema,
        revision: 1,
        keys: { deep: field("spec.agent_instance_id.nested") },
      }),
    ).toThrow(
      "'agent_instance_id' in 'spec.agent_instance_id.nested' is not a message",
    );
  });

  it("refuses a revision that is not a positive integer", () => {
    expect(() =>
      declareListIndex({
        kind: ApiResourceKind.session,
        schema: SessionSchema,
        revision: 0,
        keys: {},
      }),
    ).toThrow("revision must be a positive integer");
  });
});

describe("listIndexFactsOf", () => {
  it("reads the organization, the creation instant and every named key", () => {
    const session = create(SessionSchema, {
      metadata: {
        id: "ses_1",
        org: "acme",
        labels: { "stigmer.ai/channel-id": "ach_1" },
      },
      spec: { agentInstanceId: "ain_1" },
      status: {
        audit: {
          specAudit: { createdAt: { seconds: 1_790_000_000n, nanos: 5 } },
        },
      },
    });
    expect(listIndexFactsOf(sessions, session)).toEqual({
      org: "acme",
      createdAt: "2026-09-21T14:13:20.000000005Z",
      revision: 1,
      keys: [
        { key: "agent_instance", value: "ain_1" },
        { key: "channel", value: "ach_1" },
      ],
    });
  });

  it("leaves out a key the row does not name, and reads absences as empty", () => {
    expect(listIndexFactsOf(sessions, create(SessionSchema, {}))).toEqual({
      org: "",
      createdAt: "",
      revision: 1,
      keys: [],
    });
  });

  it("follows a nested field path", () => {
    const artifacts = declareListIndex({
      kind: ApiResourceKind.artifact,
      schema: ArtifactSchema,
      revision: 1,
      keys: { agent_execution: field("spec.source.agent_execution_id") },
    });
    const artifact = create(ArtifactSchema, {
      spec: { source: { agentExecutionId: "aex_1" } },
    });
    expect(listIndexFactsOf(artifacts, artifact).keys).toEqual([
      { key: "agent_execution", value: "aex_1" },
    ]);
  });

  it("refuses a declaration that was not made by declareListIndex", () => {
    expect(() =>
      listIndexFactsOf(
        {
          kind: ApiResourceKind.agent_execution,
          schema: AgentExecutionSchema,
          revision: 1,
          keys: {},
        },
        create(AgentExecutionSchema, {}),
      ),
    ).toThrow("was not made by declareListIndex");
  });
});

describe("listIndexInstant", () => {
  it("is fixed-width UTC text to the nanosecond", () => {
    expect(listIndexInstant({ seconds: 0n, nanos: 0 })).toBe(
      "1970-01-01T00:00:00.000000000Z",
    );
    expect(listIndexInstantOfMillis(1_500)).toBe(
      "1970-01-01T00:00:01.500000000Z",
    );
  });

  it("is empty for an absent or unrepresentable stamp", () => {
    expect(listIndexInstant(undefined)).toBe("");
    expect(listIndexInstant({ seconds: 300_000_000_000n, nanos: 0 })).toBe("");
  });

  it("sorts as text exactly as compareCreatedAtDesc orders the timestamps", () => {
    const stamps = [
      { seconds: 10n, nanos: 2 },
      undefined,
      { seconds: 10n, nanos: 10 },
      { seconds: 9n, nanos: 999_999_999 },
      { seconds: 1_790_000_000n, nanos: 0 },
    ];
    const byTimestamp = [...stamps].sort((a, b) =>
      compareCreatedAtDesc(a as never, b as never),
    );
    const byText = [...stamps].sort((a, b) =>
      compareListIndexOrder(
        { createdAt: listIndexInstant(a), id: "" },
        { createdAt: listIndexInstant(b), id: "" },
      ),
    );
    expect(byText).toEqual(byTimestamp);
  });
});

describe("matchesListIndexQuery", () => {
  const withChannel = facts({ keys: [{ key: "channel", value: "ach_1" }] });

  it("matches an organization only exactly, and every organization when absent or empty", () => {
    expect(matchesListIndexQuery("x", withChannel, { org: "acme" })).toBe(true);
    expect(matchesListIndexQuery("x", withChannel, { org: "other" })).toBe(
      false,
    );
    expect(matchesListIndexQuery("x", withChannel, { org: "" })).toBe(true);
  });

  it("matches any one of the listed keys", () => {
    expect(
      matchesListIndexQuery("x", withChannel, {
        anyKey: [
          { name: "agent_instance", value: "ain_9" },
          { name: "channel", value: "ach_1" },
        ],
      }),
    ).toBe(true);
    expect(
      matchesListIndexQuery("x", withChannel, {
        anyKey: [{ name: "channel", value: "ach_2" }],
      }),
    ).toBe(false);
  });

  it("keeps rows created at or after the bound, and rows with no stamp", () => {
    const bound = "2026-09-23T10:00:00.000000000Z";
    expect(
      matchesListIndexQuery("x", facts(), { createdAtOrAfter: bound }),
    ).toBe(true);
    expect(
      matchesListIndexQuery(
        "x",
        facts({ createdAt: "2026-09-22T00:00:00.000000000Z" }),
        {
          createdAtOrAfter: bound,
        },
      ),
    ).toBe(false);
    expect(
      matchesListIndexQuery("x", facts({ createdAt: "" }), {
        createdAtOrAfter: bound,
      }),
    ).toBe(true);
  });

  it("keeps only rows strictly after the cursor in newest-first order", () => {
    const at = "2026-09-23T10:00:00.000000000Z";
    const after = { createdAt: at, id: "m" };
    expect(
      matchesListIndexQuery("a", facts({ createdAt: at }), { after }),
    ).toBe(true);
    expect(
      matchesListIndexQuery("m", facts({ createdAt: at }), { after }),
    ).toBe(false);
    expect(
      matchesListIndexQuery("z", facts({ createdAt: at }), { after }),
    ).toBe(false);
    expect(
      matchesListIndexQuery(
        "z",
        facts({ createdAt: "2026-09-22T00:00:00.000000000Z" }),
        { after },
      ),
    ).toBe(true);
  });
});

describe("mergeListIndexRows", () => {
  it("merges in order, keeps one row per id and cuts to the limit", () => {
    const merged = mergeListIndexRows(
      [row("2026-09-23", "b"), row("2026-09-21", "d")],
      [row("2026-09-22", "c"), row("2026-09-23", "b"), row("", "e")],
      3,
    );
    expect(merged.map((r) => r.id)).toEqual(["b", "c", "d"]);
    expect(
      mergeListIndexRows(
        [row("", "e")],
        [row("2026-09-23", "a")],
        undefined,
      ).map((r) => r.id),
    ).toEqual(["a", "e"]);
  });
});

describe("sameListKeyRows", () => {
  it("is equal only when the instant and every key agree", () => {
    const a = facts({ keys: [{ key: "channel", value: "ach_1" }] });
    expect(
      sameListKeyRows(a, facts({ keys: [{ key: "channel", value: "ach_1" }] })),
    ).toBe(true);
    expect(
      sameListKeyRows(a, facts({ keys: [{ key: "channel", value: "ach_2" }] })),
    ).toBe(false);
    expect(sameListKeyRows(a, facts({ createdAt: "", keys: a.keys }))).toBe(
      false,
    );
  });
});

describe("ListIndexRegistry", () => {
  it("refuses a kind declared twice", () => {
    expect(() => new ListIndexRegistry([sessions, sessions])).toThrow(
      "list index for session is declared twice",
    );
  });

  it("refuses a read through a declaration it was not opened with", () => {
    const other = declareListIndex({ ...sessions, keys: {} });
    const registry = new ListIndexRegistry([sessions]);
    expect(() => registry.require(sessions)).not.toThrow();
    expect(() => registry.require(other)).toThrow(
      "list index for session is not registered with this store",
    );
  });
});
