// Unit arms for the cell planner: what the environment and the flags allow,
// refused by name, before anything boots.
// Domain: conformance benchmark.
//
// Pinned: the matrix is twelve scenarios (seven on the bare agent, five on the
// working agent, two of them the single-turn background cells over their
// overlay, with checks of their work) by three harnesses (native, Cursor and
// Claude), and the quality arm is one target per harness on its parity model,
// Claude's the native arm's served model under the Claude engine's row; a
// missing Anthropic key refuses every native and Claude cell and every
// quality target; a missing Cursor key refuses Cursor cells
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
  BACKGROUND_DEV_SERVER_PROMPT,
  BACKGROUND_SERVER_PORT,
  JUDGE_CALIBRATION_CELL,
  PARITY_MODEL,
  SCENARIOS,
  benchmarkCells,
  doneChecksHold,
  explicitProvider,
  globMatches,
  nativeApi,
  nativeEndpoint,
  nativeProvider,
  planCells,
  qualityTargets,
} from "../cells";

const ALL = { anthropicKey: true, openaiKey: true, cursorKey: true, stigmerCli: true };

/** Every scenario's cell id on `harnesses`, in the planner's order: scenario by scenario, each harness in turn. */
const idsOn = (harnesses: readonly string[], scenarios = SCENARIOS.map((scenario) => scenario.name)): string[] =>
  scenarios.flatMap((scenario) => harnesses.map((harness) => `${scenario}/${harness}`));

describe("benchmarkCells", () => {
  it("is twelve scenarios on three harnesses, parity and working cells pinned per harness", () => {
    const cells = benchmarkCells();
    expect(cells).toHaveLength(36);
    expect(cells.find((cell) => cell.id === "report-parity-simple/claude")?.modelRequested, "the native arm's model under the Claude engine's row").toBe("claude-sonnet-4.6");
    expect(cells.find((cell) => cell.id === "report-simple/claude")?.modelRequested, "Claude's default cells run its catalog default").toBeNull();
    expect(cells.find((cell) => cell.id === "working-read-edit/claude")?.modelRequested).toBe(PARITY_MODEL.claude);
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
    const longLog = cells.find((cell) => cell.id === "working-long-log/deep-agent");
    expect(longLog?.scenario).toMatchObject({ agent: "working", mode: "working-agent", sessionShape: "one-session-three-turns" });
    expect(longLog?.scenario.prompts[1], "the sampled turn asks about the long log").toContain("logs/sync-2026-10-20.log");
    expect(longLog?.modelRequested).toBe("claude-sonnet-4.6");
  });

  it("has two single-turn background cells on the working agent's overlay, each checking its work, neither prompt naming the background", () => {
    for (const name of ["background-slow-suite", "background-dev-server"]) {
      const cell = benchmarkCells().find((candidate) => candidate.id === `${name}/deep-agent`);
      expect(cell?.scenario.agent, name).toBe("working");
      expect(cell?.scenario.sessionShape, name).toBe("fresh-per-execution");
      expect(cell?.scenario.overlay, name).toBe("background");
      expect(cell?.scenario.doneChecks?.length, name).toBeGreaterThan(0);
      expect(cell?.modelRequested, name).toBe("claude-sonnet-4.6");
      expect(cell?.scenario.prompts[0], name).not.toMatch(/background|meanwhile|while|tool/i);
    }
    expect(BACKGROUND_DEV_SERVER_PROMPT).toContain(`127.0.0.1:${BACKGROUND_SERVER_PORT}`);
    expect(benchmarkCells().filter((cell) => cell.scenario.overlay !== undefined).map((cell) => cell.scenario.name)).toEqual([
      "background-slow-suite",
      "background-slow-suite",
      "background-slow-suite",
      "background-dev-server",
      "background-dev-server",
      "background-dev-server",
    ]);
  });
});

describe("doneChecksHold", () => {
  const slowSuite = SCENARIOS.find((scenario) => scenario.name === "background-slow-suite")!.doneChecks!;
  const devServer = SCENARIOS.find((scenario) => scenario.name === "background-dev-server")!.doneChecks!;
  const testFile = new Map([["duration/duration_test.go", 'cases := []struct{ in string }{{"90s"}}']]);

  it("holds when the suite's ok line is in any command's output and the seconds case is in the test file", () => {
    const outputs = ["--- go vet ok", "ok  \texample.com/orders-sync/integration\t60.8s\n"];
    expect(doneChecksHold(slowSuite, { reply: "", commandOutputs: outputs, files: testFile })).toBe(true);
  });

  it("fails when the suite never printed ok, or the test file has no seconds case, or is not there", () => {
    expect(doneChecksHold(slowSuite, { reply: "the tests pass", commandOutputs: ["FAIL\texample.com/orders-sync/integration"], files: testFile })).toBe(false);
    const outputs = ["ok  \texample.com/orders-sync/integration\t60.8s"];
    expect(doneChecksHold(slowSuite, { reply: "", commandOutputs: outputs, files: new Map([["duration/duration_test.go", '{"1h30m", 90}']]) })).toBe(false);
    expect(doneChecksHold(slowSuite, { reply: "", commandOutputs: outputs, files: new Map() })).toBe(false);
  });

  it("reads the server's two answers from the reply", () => {
    const files = new Map<string, string | undefined>();
    expect(doneChecksHold(devServer, { reply: "1h30m returns 90; 90s returns 400: unknown unit 's'.", commandOutputs: [], files })).toBe(true);
    expect(doneChecksHold(devServer, { reply: "The server did not start.", commandOutputs: ["90"], files })).toBe(false);
  });
});

describe("planCells", () => {
  it("with every key runs every benchmark cell and every quality target on its parity model", () => {
    const plan = planCells(ALL, {});
    expect(plan.cells).toHaveLength(36);
    expect(plan.quality).toEqual([
      { id: "quality/deep-agent", harness: "deep-agent", modelRequested: "claude-sonnet-4.6" },
      { id: "quality/cursor", harness: "cursor", modelRequested: "claude-sonnet-4-6" },
      { id: "quality/claude", harness: "claude", modelRequested: "claude-sonnet-4.6" },
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

  it("without the Anthropic key refuses every native and Claude cell and every quality cell by name", () => {
    const plan = planCells({ ...ALL, anthropicKey: false }, {});
    expect(plan.cells.every((cell) => cell.harness === "cursor")).toBe(true);
    expect(plan.quality).toEqual([]);
    expect(plan.refused.filter((r) => r.reason === "missing ANTHROPIC_API_KEY").map((r) => r.cell)).toEqual([
      ...idsOn(["deep-agent", "claude"]),
      "quality/deep-agent",
      "quality/cursor",
      "quality/claude",
    ]);
  });

  it("--only claude plans the Claude cells and target alone, each needing the Anthropic key whatever its model", () => {
    const plan = planCells({ ...ALL, cursorKey: false, openaiKey: false }, { only: "claude" });
    expect(plan.cells.map((cell) => cell.id)).toEqual(idsOn(["claude"]));
    expect(plan.quality).toEqual([{ id: "quality/claude", harness: "claude", modelRequested: PARITY_MODEL.claude }]);
    expect(plan.refused.filter((r) => r.reason === "excluded by --only").map((r) => r.cell)).toEqual([
      ...idsOn(["deep-agent", "cursor"]),
      "quality/deep-agent",
      "quality/cursor",
      JUDGE_CALIBRATION_CELL,
    ]);
  });

  it("a thinking run refuses the cells on a harness's default model and keeps every pinned cell", () => {
    const plan = planCells(ALL, { thinking: "enabled" });
    expect(plan.cells.every((cell) => cell.modelRequested !== null)).toBe(true);
    expect(plan.cells).toHaveLength(27);
    expect(plan.refused.filter((r) => r.reason === "thinking needs a pinned model").map((r) => r.cell)).toEqual(
      idsOn(["deep-agent", "cursor", "claude"], ["report-simple", "report-medium", "report-codegen"]),
    );
    expect(plan.quality.map((cell) => cell.id)).toEqual(["quality/deep-agent", "quality/cursor", "quality/claude"]);
  });

  it("without the Cursor key refuses the Cursor cells alone", () => {
    const plan = planCells({ ...ALL, cursorKey: false }, {});
    expect(plan.cells.every((cell) => cell.harness !== "cursor")).toBe(true);
    expect(plan.quality.map((cell) => cell.id)).toEqual(["quality/deep-agent", "quality/claude"]);
    const keyed = plan.refused.filter((r) => r.cell !== JUDGE_CALIBRATION_CELL);
    expect(keyed.every((r) => r.reason === "missing CURSOR_API_KEY")).toBe(true);
    expect(keyed).toHaveLength(13);
  });

  it("without the stigmer CLI refuses the working-agent timing cells alone, and keeps the quality targets", () => {
    const plan = planCells({ ...ALL, stigmerCli: false }, {});
    expect(plan.cells).toHaveLength(21);
    expect(plan.cells.every((cell) => cell.scenario.agent === "bare")).toBe(true);
    expect(plan.quality.map((cell) => cell.id)).toEqual(["quality/deep-agent", "quality/cursor", "quality/claude"]);
    expect(plan.refused.filter((r) => r.cell !== JUDGE_CALIBRATION_CELL)).toEqual(
      idsOn(["deep-agent", "cursor", "claude"], ["working-read-edit", "working-cross-turn", "working-long-log", "background-slow-suite", "background-dev-server"]).map((cell) => ({
        cell,
        reason: "missing stigmer CLI",
      })),
    );
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
  it("moves every native pinned cell and the native quality target to its model, and leaves Cursor, Claude and the default cells as they are", () => {
    const cells = benchmarkCells("openai:gpt-5.5");
    expect(cells.filter((cell) => cell.harness === "deep-agent" && cell.scenario.mode !== "default").map((cell) => cell.modelRequested)).toEqual(
      Array(9).fill("openai:gpt-5.5"),
    );
    expect(cells.filter((cell) => cell.scenario.mode === "default").every((cell) => cell.modelRequested === null)).toBe(true);
    expect(cells.find((cell) => cell.id === "working-read-edit/cursor")?.modelRequested).toBe(PARITY_MODEL.cursor);
    expect(cells.find((cell) => cell.id === "working-read-edit/claude")?.modelRequested).toBe(PARITY_MODEL.claude);
    expect(qualityTargets("openai:gpt-5.5")).toEqual([
      { id: "quality/deep-agent", harness: "deep-agent", modelRequested: "openai:gpt-5.5" },
      { id: "quality/cursor", harness: "cursor", modelRequested: PARITY_MODEL.cursor },
      { id: "quality/claude", harness: "claude", modelRequested: PARITY_MODEL.claude },
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
      "working-long-log/deep-agent",
      "background-slow-suite/deep-agent",
      "background-dev-server/deep-agent",
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
      "working-long-log/deep-agent",
      "background-slow-suite/deep-agent",
      "background-dev-server/deep-agent",
      "quality/deep-agent",
    ]);
    const noAnthropic = planCells({ ...ALL, anthropicKey: false }, { nativeModel: "openai:gemini-3-pro", only: "deep-agent" });
    expect(noAnthropic.cells, "the timing cells need no Anthropic key").toHaveLength(9);
    expect(noAnthropic.refused).toContainEqual({ cell: "quality/deep-agent", reason: "missing ANTHROPIC_API_KEY" });
  });

  it("a Claude model needs the Anthropic key alone, and a name the runner cannot place is refused as unknown", () => {
    const claude = planCells({ ...ALL, openaiKey: false }, { nativeModel: "anthropic:claude-x", only: "deep-agent" });
    expect(claude.cells).toHaveLength(9);
    const unknown = planCells(ALL, { nativeModel: "gemini-3-pro", only: "deep-agent" });
    expect(unknown.cells).toEqual([]);
    expect(unknown.quality).toEqual([]);
    expect(unknown.refused.filter((r) => r.reason === "model provider unknown")).toHaveLength(10);
  });

  it("a thinking run refuses a native model that is not a catalog Claude model, and keeps a catalog Claude one", () => {
    for (const model of ["openai:gpt-5.5", "anthropic:claude-sonnet-4-6", "gpt-4o"]) {
      const plan = planCells(ALL, { nativeModel: model, only: "deep-agent", thinking: "enabled" });
      expect(plan.cells, model).toEqual([]);
      expect(plan.refused.filter((r) => r.reason === "thinking needs a catalog Claude model"), model).toHaveLength(9);
      expect(plan.quality, "the eval run asks for no thinking").toHaveLength(1);
    }
    expect(planCells(ALL, { nativeModel: "claude-opus-4.7", only: "deep-agent", thinking: "enabled" }).cells).toHaveLength(9);
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
