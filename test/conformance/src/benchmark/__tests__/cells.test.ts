// Unit arms for the cell planner: what the environment and the flags allow,
// refused by name, before anything boots.
// Domain: conformance benchmark.
//
// Pinned: the matrix is nine scenarios (seven on the bare agent, two on the
// working agent) by two harnesses, and the quality arm is one target per
// harness on its parity model; a missing Anthropic key refuses every native
// cell and both quality targets; a missing Cursor key refuses Cursor cells
// and the Cursor target alone; a missing `stigmer` CLI refuses the
// working-agent timing cells and nothing else (an eval run's try loads no
// memory); --only and --cells refuse with their own reasons; parity and
// working cells carry their harness's registry id and default cells none.
// --native-model moves every native pinned cell and the native quality target
// to its model and refuses the native default cells; a native cell asks for
// the key of its model's provider, derived in the runner's order, and a name
// the runner cannot place is refused; a thinking run refuses a native model
// that is not a catalog Claude model; the endpoint a report records is a
// host, never a key or a path.
import { describe, expect, it } from "vitest";
import {
  JUDGE_CALIBRATION_CELL,
  PARITY_MODEL,
  benchmarkCells,
  explicitProvider,
  globMatches,
  nativeApi,
  nativeEndpoint,
  nativeProvider,
  planCells,
  qualityTargets,
} from "../cells";

const ALL = { anthropicKey: true, openaiKey: true, cursorKey: true, stigmerCli: true };

describe("benchmarkCells", () => {
  it("is nine scenarios on two harnesses, parity and working cells pinned per harness", () => {
    const cells = benchmarkCells();
    expect(cells).toHaveLength(18);
    expect(cells.find((cell) => cell.id === "report-parity-simple/deep-agent")?.modelRequested).toBe("claude-sonnet-4.6");
    expect(cells.find((cell) => cell.id === "report-parity-simple/cursor")?.modelRequested).toBe("claude-sonnet-4-6");
    expect(cells.find((cell) => cell.id === "report-simple/cursor")?.modelRequested).toBeNull();
    expect(cells.find((cell) => cell.id === "report-parity-turn-2/deep-agent")?.scenario.prompts).toHaveLength(3);
    const working = cells.find((cell) => cell.id === "working-read-edit/cursor");
    expect(working?.scenario.agent).toBe("working");
    expect(working?.scenario.prompts).toHaveLength(3);
    expect(working?.modelRequested).toBe("claude-sonnet-4-6");
    const crossTurn = cells.find((cell) => cell.id === "working-cross-turn/deep-agent");
    expect(crossTurn?.scenario.agent).toBe("working");
    expect(crossTurn?.scenario.sessionShape).toBe("one-session-three-turns");
    expect(new Set(crossTurn?.scenario.prompts).size, "three different questions").toBe(3);
    expect(crossTurn?.modelRequested).toBe("claude-sonnet-4.6");
  });
});

describe("planCells", () => {
  it("with both keys runs every benchmark cell and both quality targets on their parity models", () => {
    const plan = planCells(ALL, {});
    expect(plan.cells).toHaveLength(18);
    expect(plan.quality).toEqual([
      { id: "quality/deep-agent", harness: "deep-agent", modelRequested: "claude-sonnet-4.6" },
      { id: "quality/cursor", harness: "cursor", modelRequested: "claude-sonnet-4-6" },
    ]);
    expect(plan.judge).toBe(false);
    expect(plan.refused).toEqual([{ cell: JUDGE_CALIBRATION_CELL, reason: "runs only when --cells names it" }]);
  });

  it("runs the judge cell alone when --cells names it, and refuses it without the Anthropic key or under --only cursor", () => {
    const plan = planCells(ALL, { cells: "judge/*" });
    expect(plan.judge).toBe(true);
    expect(plan.cells).toEqual([]);
    expect(plan.quality).toEqual([]);
    expect(planCells({ ...ALL, anthropicKey: false }, { cells: "judge/*" }).refused).toContainEqual({
      cell: JUDGE_CALIBRATION_CELL,
      reason: "missing ANTHROPIC_API_KEY",
    });
    expect(planCells(ALL, { cells: "judge/*", only: "cursor" }).refused).toContainEqual({
      cell: JUDGE_CALIBRATION_CELL,
      reason: "excluded by --only",
    });
    expect(planCells(ALL, { cells: "quality/*" }).refused).toContainEqual({
      cell: JUDGE_CALIBRATION_CELL,
      reason: "excluded by --cells",
    });
  });

  it("without the Anthropic key refuses every native cell and every quality cell by name", () => {
    const plan = planCells({ ...ALL, anthropicKey: false }, {});
    expect(plan.cells.every((cell) => cell.harness === "cursor")).toBe(true);
    expect(plan.quality).toEqual([]);
    expect(plan.refused.filter((r) => r.reason === "missing ANTHROPIC_API_KEY").map((r) => r.cell)).toEqual([
      "report-simple/deep-agent",
      "report-medium/deep-agent",
      "report-codegen/deep-agent",
      "report-parity-simple/deep-agent",
      "report-parity-medium/deep-agent",
      "report-parity-codegen/deep-agent",
      "report-parity-turn-2/deep-agent",
      "working-read-edit/deep-agent",
      "working-cross-turn/deep-agent",
      "quality/deep-agent",
      "quality/cursor",
    ]);
  });

  it("a thinking run refuses the cells on a harness's default model and keeps every pinned cell", () => {
    const plan = planCells(ALL, { thinking: "enabled" });
    expect(plan.cells.every((cell) => cell.modelRequested !== null)).toBe(true);
    expect(plan.cells).toHaveLength(12);
    expect(plan.refused.filter((r) => r.reason === "thinking needs a pinned model").map((r) => r.cell)).toEqual([
      "report-simple/deep-agent",
      "report-simple/cursor",
      "report-medium/deep-agent",
      "report-medium/cursor",
      "report-codegen/deep-agent",
      "report-codegen/cursor",
    ]);
    expect(plan.quality.map((cell) => cell.id)).toEqual(["quality/deep-agent", "quality/cursor"]);
  });

  it("without the Cursor key refuses the Cursor cells alone", () => {
    const plan = planCells({ ...ALL, cursorKey: false }, {});
    expect(plan.cells.every((cell) => cell.harness === "deep-agent")).toBe(true);
    expect(plan.quality.map((cell) => cell.id)).toEqual(["quality/deep-agent"]);
    const keyed = plan.refused.filter((r) => r.cell !== JUDGE_CALIBRATION_CELL);
    expect(keyed.every((r) => r.reason === "missing CURSOR_API_KEY")).toBe(true);
    expect(keyed).toHaveLength(10);
  });

  it("without the stigmer CLI refuses the working-agent timing cells alone, and keeps the quality targets", () => {
    const plan = planCells({ ...ALL, stigmerCli: false }, {});
    expect(plan.cells).toHaveLength(14);
    expect(plan.cells.every((cell) => cell.scenario.agent === "bare")).toBe(true);
    expect(plan.quality.map((cell) => cell.id)).toEqual(["quality/deep-agent", "quality/cursor"]);
    expect(plan.refused.filter((r) => r.cell !== JUDGE_CALIBRATION_CELL)).toEqual([
      { cell: "working-read-edit/deep-agent", reason: "missing stigmer CLI" },
      { cell: "working-read-edit/cursor", reason: "missing stigmer CLI" },
      { cell: "working-cross-turn/deep-agent", reason: "missing stigmer CLI" },
      { cell: "working-cross-turn/cursor", reason: "missing stigmer CLI" },
    ]);
  });

  it("--only and --cells refuse with their own reasons, flags before keys", () => {
    const plan = planCells({ ...ALL, anthropicKey: false }, { only: "cursor", cells: "report-parity-*" });
    expect(plan.cells.map((cell) => cell.id)).toEqual([
      "report-parity-simple/cursor",
      "report-parity-medium/cursor",
      "report-parity-codegen/cursor",
      "report-parity-turn-2/cursor",
    ]);
    expect(plan.refused.find((r) => r.cell === "report-simple/deep-agent")?.reason).toBe("excluded by --only");
    expect(plan.refused.find((r) => r.cell === "report-simple/cursor")?.reason).toBe("excluded by --cells");
  });
});

describe("--native-model", () => {
  it("moves every native pinned cell and the native quality target to its model, and leaves Cursor and the default cells as they are", () => {
    const cells = benchmarkCells("openai:gpt-5.5");
    expect(cells.filter((cell) => cell.harness === "deep-agent" && cell.scenario.mode !== "default").map((cell) => cell.modelRequested)).toEqual(
      Array(6).fill("openai:gpt-5.5"),
    );
    expect(cells.filter((cell) => cell.scenario.mode === "default").every((cell) => cell.modelRequested === null)).toBe(true);
    expect(cells.find((cell) => cell.id === "working-read-edit/cursor")?.modelRequested).toBe(PARITY_MODEL.cursor);
    expect(qualityTargets("openai:gpt-5.5")).toEqual([
      { id: "quality/deep-agent", harness: "deep-agent", modelRequested: "openai:gpt-5.5" },
      { id: "quality/cursor", harness: "cursor", modelRequested: PARITY_MODEL.cursor },
    ]);
    expect(benchmarkCells()).toEqual(benchmarkCells(PARITY_MODEL["deep-agent"]));
  });

  it("refuses the native default cells by name, and plans the rest on the pinned model", () => {
    const plan = planCells(ALL, { nativeModel: "openai:gpt-5.5", only: "deep-agent" });
    expect(plan.nativeModel).toBe("openai:gpt-5.5");
    expect(plan.cells.map((cell) => cell.id)).toEqual([
      "report-parity-simple/deep-agent",
      "report-parity-medium/deep-agent",
      "report-parity-codegen/deep-agent",
      "report-parity-turn-2/deep-agent",
      "working-read-edit/deep-agent",
      "working-cross-turn/deep-agent",
    ]);
    expect(plan.cells.every((cell) => cell.modelRequested === "openai:gpt-5.5")).toBe(true);
    expect(plan.quality).toEqual([{ id: "quality/deep-agent", harness: "deep-agent", modelRequested: "openai:gpt-5.5" }]);
    expect(plan.refused.filter((r) => r.reason === "the native model is pinned by --native-model").map((r) => r.cell)).toEqual([
      "report-simple/deep-agent",
      "report-medium/deep-agent",
      "report-codegen/deep-agent",
    ]);
  });

  it("without a flag the native arm is the parity pin", () => {
    expect(planCells(ALL, {}).nativeModel).toBe(PARITY_MODEL["deep-agent"]);
  });

  it("an OpenAI-provider model needs OPENAI_API_KEY, and its quality target the Anthropic key too, for the judge", () => {
    const noOpenai = planCells({ ...ALL, openaiKey: false }, { nativeModel: "openai:gemini-3-pro", only: "deep-agent" });
    expect(noOpenai.cells).toEqual([]);
    expect(noOpenai.quality).toEqual([]);
    expect(noOpenai.refused.filter((r) => r.reason === "missing OPENAI_API_KEY").map((r) => r.cell)).toEqual([
      "report-parity-simple/deep-agent",
      "report-parity-medium/deep-agent",
      "report-parity-codegen/deep-agent",
      "report-parity-turn-2/deep-agent",
      "working-read-edit/deep-agent",
      "working-cross-turn/deep-agent",
      "quality/deep-agent",
    ]);
    const noAnthropic = planCells({ ...ALL, anthropicKey: false }, { nativeModel: "openai:gemini-3-pro", only: "deep-agent" });
    expect(noAnthropic.cells, "the timing cells need no Anthropic key").toHaveLength(6);
    expect(noAnthropic.refused).toContainEqual({ cell: "quality/deep-agent", reason: "missing ANTHROPIC_API_KEY" });
  });

  it("a Claude model needs the Anthropic key alone, and a name the runner cannot place is refused as unknown", () => {
    const claude = planCells({ ...ALL, openaiKey: false }, { nativeModel: "anthropic:claude-x", only: "deep-agent" });
    expect(claude.cells).toHaveLength(6);
    const unknown = planCells(ALL, { nativeModel: "gemini-3-pro", only: "deep-agent" });
    expect(unknown.cells).toEqual([]);
    expect(unknown.quality).toEqual([]);
    expect(unknown.refused.filter((r) => r.reason === "model provider unknown")).toHaveLength(7);
  });

  it("a thinking run refuses a native model that is not a catalog Claude model, and keeps a catalog Claude one", () => {
    for (const model of ["openai:gpt-5.5", "anthropic:claude-sonnet-4-6", "gpt-4o"]) {
      const plan = planCells(ALL, { nativeModel: model, only: "deep-agent", thinking: "enabled" });
      expect(plan.cells, model).toEqual([]);
      expect(plan.refused.filter((r) => r.reason === "thinking needs a catalog Claude model"), model).toHaveLength(6);
      expect(plan.quality, "the eval run asks for no thinking").toHaveLength(1);
    }
    expect(planCells(ALL, { nativeModel: "claude-opus-4.7", only: "deep-agent", thinking: "enabled" }).cells).toHaveLength(6);
  });
});

describe("nativeProvider", () => {
  // The runner's order (shared/llm-proxy.ts inferProvider), row for row.
  it.each([
    ["openai:claude-in-disguise", "openai"],
    ["anthropic:gpt-like", "anthropic"],
    ["OpenAI:gemini-3-pro", "openai"],
    ["claude-sonnet-4.6", "anthropic"],
    ["Claude-Opus", "anthropic"],
    ["gpt-5.5", "openai"],
    ["o1-mini", "openai"],
    ["o3", "openai"],
    ["o4-mini", "openai"],
    ["chatgpt-4o-latest", "openai"],
    ["gemini-3-pro", undefined],
    ["mistral:large", undefined],
    ["openai:", undefined],
    [":gpt", undefined],
    ["", undefined],
  ] as const)("%s -> %s", (model, provider) => {
    expect(nativeProvider(model)).toBe(provider);
  });

  it("only the two explicit prefixes, with a name after the colon, count as explicit", () => {
    expect(explicitProvider("openai:gpt-5.5")).toBe("openai");
    expect(explicitProvider("ANTHROPIC:claude")).toBe("anthropic");
    expect(explicitProvider("gpt-5.5")).toBeUndefined();
    expect(explicitProvider("openai:")).toBeUndefined();
    expect(explicitProvider("google:gemini")).toBeUndefined();
  });
});

describe("nativeApi", () => {
  it("is Messages for Claude, the Responses API for the names LangChain sends there, and Chat Completions otherwise", () => {
    expect(nativeApi("claude-sonnet-4.6")).toBe("messages");
    expect(nativeApi("anthropic:claude-x")).toBe("messages");
    expect(nativeApi("openai:gpt-5.5")).toBe("chat-completions");
    expect(nativeApi("openai:gemini-3-pro")).toBe("chat-completions");
    expect(nativeApi("openai:gpt-5.5-pro")).toBe("responses");
    expect(nativeApi("openai:gpt-5.2-pro")).toBe("responses");
    expect(nativeApi("openai:gpt-5.4-pro-2026")).toBe("responses");
    expect(nativeApi("openai:gpt-5.3-codex")).toBe("responses");
    expect(nativeApi("openai:gpt-5-pro"), "a -pro name LangChain does not list").toBe("chat-completions");
    expect(nativeApi("gemini-3-pro")).toBeUndefined();
  });
});

describe("nativeEndpoint", () => {
  it("records OPENAI_BASE_URL's host for an OpenAI-provider model, never its path or a key", () => {
    expect(nativeEndpoint("openai:gemini-3-pro", { OPENAI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai/" })).toBe(
      "generativelanguage.googleapis.com",
    );
    expect(nativeEndpoint("openai:x", { OPENAI_BASE_URL: "http://127.0.0.1:8080/v1" })).toBe("127.0.0.1:8080");
    expect(nativeEndpoint("openai:gpt-5.5", {})).toBe("api.openai.com");
    expect(nativeEndpoint("gpt-5.5", { OPENAI_BASE_URL: "  " })).toBe("api.openai.com");
    expect(nativeEndpoint("openai:x", { OPENAI_BASE_URL: "not a url" })).toBe("invalid OPENAI_BASE_URL");
  });

  it("records the Anthropic backend's name when it is not public, else ANTHROPIC_BASE_URL's host", () => {
    expect(nativeEndpoint("claude-sonnet-4.6", {})).toBe("api.anthropic.com");
    expect(nativeEndpoint("claude-sonnet-4.6", { STIGMER_ANTHROPIC_BACKEND: "public", ANTHROPIC_BASE_URL: "https://gw.example/anthropic" })).toBe(
      "gw.example",
    );
    expect(nativeEndpoint("claude-sonnet-4.6", { STIGMER_ANTHROPIC_BACKEND: "vertex", ANTHROPIC_BASE_URL: "https://gw.example" })).toBe("vertex");
    expect(nativeEndpoint("anthropic:claude-x", { OPENAI_BASE_URL: "https://elsewhere.example" })).toBe("api.anthropic.com");
    expect(nativeEndpoint("gemini-3-pro", {})).toBe("unknown");
  });
});

describe("globMatches", () => {
  it("treats * as any run of characters and everything else literally", () => {
    expect(globMatches("report-parity-*", "report-parity-simple/cursor")).toBe(true);
    expect(globMatches("*/cursor", "report-simple/cursor")).toBe(true);
    expect(globMatches("report-simple/cursor", "report-simple/deep-agent")).toBe(false);
    expect(globMatches("report.simple/cursor", "reportXsimple/cursor")).toBe(false);
  });
});
