/**
 * Pins the enabled-tools classification (enabledtools.ts, ports
 * pkg/domain/mcpserver/enabledtools): discovered tools pass, discovered
 * resource-template names are classified SEPARATELY from plainly unknown
 * names (the two get different error copy at the call sites, #402), and
 * both partitions preserve the requested order so error messages are
 * deterministic.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { DiscoveredCapabilitiesSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";

import {
  classify,
  isValidClassification,
  quoteJoin,
  toolNames,
} from "../enabledtools.js";

const caps = create(DiscoveredCapabilitiesSchema, {
  tools: [{ name: "search_docs" }, { name: "create_ticket" }],
  resourceTemplates: [{ name: "customer-record" }, { name: "invoice" }],
});

describe("classify", () => {
  it("passes names that resolve to discovered tools", () => {
    const c = classify(caps, ["search_docs", "create_ticket"]);
    expect(c.unknown).toEqual([]);
    expect(c.resourceTemplates).toEqual([]);
    expect(isValidClassification(c)).toBe(true);
  });

  it("classifies resource-template names separately from unknown names", () => {
    const c = classify(caps, ["customer-record"]);
    expect(c.resourceTemplates).toEqual(["customer-record"]);
    expect(c.unknown).toEqual([]);
    expect(isValidClassification(c)).toBe(false);
  });

  it("collects plainly unknown names", () => {
    const c = classify(caps, ["serach_docs"]);
    expect(c.unknown).toEqual(["serach_docs"]);
    expect(c.resourceTemplates).toEqual([]);
    expect(isValidClassification(c)).toBe(false);
  });

  it("preserves the requested order within each partition", () => {
    const c = classify(caps, [
      "zzz-unknown",
      "invoice",
      "search_docs",
      "aaa-unknown",
      "customer-record",
    ]);
    expect(c.unknown).toEqual(["zzz-unknown", "aaa-unknown"]);
    expect(c.resourceTemplates).toEqual(["invoice", "customer-record"]);
  });

  it("matching is exact and case-sensitive", () => {
    const c = classify(caps, ["Search_Docs"]);
    expect(c.unknown).toEqual(["Search_Docs"]);
  });
});

describe("error-message helpers", () => {
  it("toolNames returns discovered tool names in discovery order", () => {
    expect(toolNames(caps)).toEqual(["search_docs", "create_ticket"]);
  });

  it("quoteJoin renders 'a', 'b', 'c'", () => {
    expect(quoteJoin(["a", "b", "c"])).toBe("'a', 'b', 'c'");
    expect(quoteJoin([])).toBe("");
  });
});
