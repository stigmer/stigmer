// Pins for the docs YAML gate's hand-maintained proto registry. The gate
// reports "unknown kind" for any resource whose package is missing from the
// root list, so these cases hold the closure's shape (every file once, each
// after its dependencies) and that the run resource docs show as a manifest
// (AgentRun) resolves by its wire type name.
import { describe, expect, it } from "vitest";

import { allStigmerFiles, allStigmerMessages, stigmerRegistry } from "../stigmer-registry.js";

describe("allStigmerFiles", () => {
  it("lists every file once, each after all of its dependencies", () => {
    const files = allStigmerFiles();
    const names = files.map((f) => f.proto.name);
    expect(new Set(names).size).toBe(names.length);

    const position = new Map(names.map((name, i) => [name, i]));
    for (const [i, file] of files.entries()) {
      for (const dep of file.dependencies) {
        expect(position.get(dep.proto.name)).toBeLessThan(i);
      }
    }
  });

  it("carries the agent run API file", () => {
    const names = allStigmerFiles().map((f) => f.proto.name);
    expect(names).toContain("ai/stigmer/agentic/agentrun/v1/api.proto");
  });
});

describe("stigmerRegistry", () => {
  it("resolves the run resource by its wire type name", () => {
    const registry = stigmerRegistry();
    expect(registry.getMessage("ai.stigmer.agentic.agentrun.v1.AgentRun")?.name).toBe("AgentRun");
  });
});

describe("allStigmerMessages", () => {
  it("includes nested messages alongside their parents", () => {
    const typeNames = new Set(allStigmerMessages().map((m) => m.typeName));
    const nested = allStigmerFiles()
      .flatMap((f) => f.messages)
      .flatMap((m) => m.nestedMessages);
    expect(nested.length).toBeGreaterThan(0);
    for (const msg of nested) {
      expect(typeNames.has(msg.typeName)).toBe(true);
    }
    expect(typeNames.has("ai.stigmer.agentic.agentrun.v1.AgentRun")).toBe(true);
  });
});
