/**
 * What a reinvocation carries over that is not a row (`turn-context.ts`):
 * the status's own outputs (artifacts, write-backs, usage) the server takes
 * as whole lists, and the memory selection an earlier invocation recorded,
 * replayed onto the turn's rows rather than selected again.
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { RunSchema, RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";

import { testConfig } from "../../__test-utils__/config-fixture.js";
import { resolveStandingContext, seedStatusOutputs, type ResolutionDeps } from "../turn-context.js";
import type { ResolvedBlueprint } from "../../shared/blueprint-resolver.js";
import { RecalledMemoriesReportSchema, TurnRowsSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

describe("seedStatusOutputs", () => {
  it("carries the persisted artifacts, write-backs and usage onto the turn's status, as copies", () => {
    const persisted = create(RunStatusSchema, {
      artifacts: [{ name: "report.md" }],
      workspaceWriteBacks: [{ workspaceEntryName: "repo" }],
      streamingUsage: { inputTokens: 7n },
    });
    const execution = create(RunSchema, { status: persisted });
    const status = create(RunStatusSchema, { artifacts: [{ name: "this-turn.md" }] });
    seedStatusOutputs(status, execution);
    expect(status.artifacts.map((a) => a.name)).toEqual(["this-turn.md", "report.md"]);
    expect(status.workspaceWriteBacks.map((w) => w.workspaceEntryName)).toEqual(["repo"]);
    expect(status.streamingUsage?.inputTokens).toBe(7n);
    expect(status.artifacts[1], "a copy, the input execution stays as it was").not.toBe(persisted.artifacts[0]);
  });

  it("carries nothing from an execution with no status, and keeps a usage the persisted status lacks", () => {
    const status = create(RunStatusSchema, { streamingUsage: { inputTokens: 3n } });
    seedStatusOutputs(status, create(RunSchema));
    seedStatusOutputs(status, create(RunSchema, { status: {} }));
    expect(status.artifacts).toEqual([]);
    expect(status.streamingUsage?.inputTokens).toBe(3n);
  });
});

describe("resolveStandingContext's memory selection", () => {
  const execution = create(RunSchema, {
    status: { recalledMemories: { enabled: true, facts: [{ memoryId: "mem-1", content: "Prefers tabs." }] } },
  });
  const deps = (rows = create(TurnRowsSchema)): ResolutionDeps =>
    ({ input: { executionId: "aex-memory", threadId: "", turnSeq: 0 }, config: testConfig(), rows }) as unknown as ResolutionDeps;
  const blueprint = { sessionSpec: { metadata: {} } } as unknown as ResolvedBlueprint;

  it("stamps the selection's report on the turn's rows, once", async () => {
    const rows = create(TurnRowsSchema);
    const standing = resolveStandingContext(deps(rows), { execution, spec: create(RunSpecSchema, { message: "hi" }), blueprint, priorReport: undefined });
    expect((await standing.selectRecalledMemories())?.facts).toEqual(["Prefers tabs."]);
    expect(rows.recalledMemoriesReport?.selectionActive).toBe(false);
  });

  it("replays the report an earlier invocation recorded rather than selecting again", async () => {
    const rows = create(TurnRowsSchema);
    const priorReport = create(RecalledMemoriesReportSchema, { selectionActive: true, injectedMemoryIds: ["mem-1"] });
    const standing = resolveStandingContext(deps(rows), { execution, spec: create(RunSpecSchema, { message: "hi" }), blueprint, priorReport });
    expect((await standing.selectRecalledMemories())?.facts).toEqual(["Prefers tabs."]);
    expect(rows.recalledMemoriesReport?.injectedMemoryIds).toEqual(["mem-1"]);
  });
});
