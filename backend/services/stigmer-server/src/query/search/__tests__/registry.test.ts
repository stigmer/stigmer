/**
 * Pins the extractor registry against Go's registry_test.go — duplicate
 * rejection, lookup, name-sorted supportedKinds, both validateExpectedKinds
 * arms — plus THE invariant test (Go's
 * TestSearchableKinds_CoverSearchIndexedProtoKinds, #439): the production
 * registry serves exactly the kind_meta-derived searchable set. A kind may
 * join or leave search only by flipping its proto annotation AND its
 * registry entry together; this test fails until both move.
 */
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../../boot/logger.js";
import { agentSearchExtractor } from "../../../domain/agent/search-extractor.js";
import { searchIndexedKinds } from "../criteria.js";
import {
  SearchableResourceRegistry,
  newSearchableResourceRegistry,
} from "../registry.js";

interface CapturingLogger extends Logger {
  readonly warns: Array<Record<string, unknown> | undefined>;
  readonly infos: Array<Record<string, unknown> | undefined>;
}

function testLogger(): CapturingLogger {
  const warns: Array<Record<string, unknown> | undefined> = [];
  const infos: Array<Record<string, unknown> | undefined> = [];
  return {
    debug: () => undefined,
    info: (_message, fields) => {
      infos.push(fields);
    },
    warn: (_message, fields) => {
      warns.push(fields);
    },
    error: () => undefined,
    warns,
    infos,
  };
}

describe("the #439 invariant", () => {
  it("registers an extractor for EXACTLY the kind_meta-derived searchable set", () => {
    const registry = newSearchableResourceRegistry();
    const registered = [...registry.supportedKinds()].sort((a, b) => a - b);
    const derived = [...searchIndexedKinds()].sort((a, b) => a - b);
    expect(registered).toEqual(derived);
  });

  it("every extractor's kind field matches its registry slot", () => {
    const registry = newSearchableResourceRegistry();
    for (const kind of registry.supportedKinds()) {
      expect(registry.getExtractor(kind)?.kind).toBe(kind);
    }
  });
});

describe("SearchableResourceRegistry (Go registry_test.go)", () => {
  it("rejects duplicate registration at construction (Go's init panic)", () => {
    expect(
      () =>
        new SearchableResourceRegistry([
          agentSearchExtractor,
          agentSearchExtractor,
        ]),
    ).toThrowError("duplicate SearchableExtractor for kind agent");
  });

  it("returns the extractor for a registered kind, undefined otherwise", () => {
    const registry = new SearchableResourceRegistry([agentSearchExtractor]);
    expect(registry.getExtractor(ApiResourceKind.agent)).toBe(
      agentSearchExtractor,
    );
    expect(registry.getExtractor(ApiResourceKind.skill)).toBeUndefined();
  });

  it("supportedKinds sorts by the kind NAME string (Go's kind.String() sort)", () => {
    const registry = newSearchableResourceRegistry();
    const names = registry.supportedKinds().map((kind) => ApiResourceKind[kind]);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("validateExpectedKinds warns with the missing kinds (never throws)", () => {
    const logger = testLogger();
    new SearchableResourceRegistry([agentSearchExtractor]).validateExpectedKinds(
      logger,
    );
    expect(logger.warns).toHaveLength(1);
    const missing = logger.warns[0]?.missing_kinds as string[];
    expect(missing).toContain("skill");
    expect(missing).not.toContain("agent");
  });

  it("validateExpectedKinds logs the healthy roster when complete", () => {
    const logger = testLogger();
    newSearchableResourceRegistry().validateExpectedKinds(logger);
    expect(logger.warns).toHaveLength(0);
    expect(logger.infos).toHaveLength(1);
    expect(logger.infos[0]?.count).toBe(searchIndexedKinds().length);
  });
});
