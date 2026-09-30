// Unit arms for the RPC ledger: its line format, the served set read from a
// server log in both of its shapes, the four coverage classes and the stop
// count, and the report. Pure: fixture strings only.
// Domain: conformance inventory (the RPC contract).
import { describe, expect, it } from "vitest";
import { formatLedgerReport, parseLedger, servedRpcs, summarizeLedger, type RpcLedgerLine } from "../rpc-ledger";

const DECLARED = ["AgentCommandController.create", "AgentQueryController.get", "AgentQueryController.list", "AgentExecutionCommandController.updateStatus", "SkillQueryController.get"];

function line(target: string, test: string | null, rpc: string, file = "src/suites/agent.conformance.test.ts"): RpcLedgerLine {
  return { target, file, test, rpc };
}

describe("parseLedger", () => {
  it("reads one JSON line per call site and skips blank lines", () => {
    const text = `${JSON.stringify(line("local", "t", "AgentQueryController.get"))}\n\n${JSON.stringify(line("cloud", null, "AgentCommandController.create"))}\n`;
    const { lines, problems } = parseLedger(text, "1.jsonl");
    expect(problems).toEqual([]);
    expect(lines).toHaveLength(2);
  });

  it("names a line that is not JSON or not a ledger line, by file and line number", () => {
    const { problems } = parseLedger(`not json\n{"target":"local","file":"f","rpc":"A.b"}\n`, "2.jsonl");
    expect(problems).toHaveLength(2);
    expect(problems[0]).toBe("2.jsonl:1: not JSON");
    expect(problems[1]).toMatch(/^2\.jsonl:2: /);
  });
});

describe("servedRpcs", () => {
  it("reads the procedure of every outcome line, NDJSON and console shapes alike", () => {
    const log = [
      JSON.stringify({ level: "info", time: "t", message: "rpc completed", procedure: "/ai.stigmer.agentic.agent.v1.AgentQueryController/get", durationMs: 1 }),
      `12:00:00 WRN rpc client error {"procedure":"/ai.stigmer.agentic.agentexecution.v1.AgentExecutionCommandController/updateStatus","code":"InvalidArgument"}`,
      `12:00:01 DBG rpc completed {"procedure":"/grpc.health.v1.Health/Check","durationMs":0}`,
      "a line with no procedure",
    ].join("\n");
    expect([...servedRpcs(log)].sort()).toEqual([
      "AgentExecutionCommandController.updateStatus",
      "AgentQueryController.get",
      "Health.Check",
    ]);
  });
});

describe("summarizeLedger", () => {
  const lines = [
    line("local", "creates", "AgentCommandController.create"),
    line("cloud", "creates", "AgentCommandController.create"),
    line("local", null, "AgentQueryController.get"),
    line("local", null, "Health.Check"),
  ];

  it("sorts every declared RPC into one class, and counts the stop threshold's set", () => {
    const summary = summarizeLedger(DECLARED, lines, new Set(["AgentExecutionCommandController.updateStatus", "AgentQueryController.get"]));
    const coverage = Object.fromEntries(summary.entries.map((entry) => [entry.key, entry.coverage]));
    expect(coverage).toEqual({
      "AgentCommandController.create": "in-test",
      "AgentExecutionCommandController.updateStatus": "served-only",
      "AgentQueryController.get": "hook-only",
      "AgentQueryController.list": "unexercised",
      "SkillQueryController.get": "unexercised",
    });
    expect(summary.counts).toEqual({ "in-test": 1, "hook-only": 1, "served-only": 1, unexercised: 2 });
    // A hook's send never counts as tested; a hook-only RPC the log shows served is not in the stop count.
    expect(summary.neitherTestedNorServed).toBe(2);
    expect(summary.targets).toEqual(["cloud", "local"]);
    expect(summary.outsideContract).toEqual(["Health.Check"]);
  });

  it("without a server log, counts a hook-only RPC in the stop count and measures no served class", () => {
    const summary = summarizeLedger(DECLARED, lines, undefined);
    expect(summary.servedMeasured).toBe(false);
    expect(summary.counts["served-only"]).toBe(0);
    expect(summary.neitherTestedNorServed).toBe(4);
  });

  it("names each sending test per target as <file> > <test>", () => {
    const entry = summarizeLedger(DECLARED, lines, undefined).entries.find((e) => e.key === "AgentCommandController.create");
    expect(Object.fromEntries(entry?.testsByTarget ?? [])).toEqual({
      cloud: ["src/suites/agent.conformance.test.ts > creates"],
      local: ["src/suites/agent.conformance.test.ts > creates"],
    });
  });
});

describe("formatLedgerReport", () => {
  it("prints the counts, a row per RPC and the edition matrix", () => {
    const report = formatLedgerReport(
      summarizeLedger(DECLARED, [line("local", "a | b", "AgentCommandController.create"), line("cloud", null, "AgentQueryController.get")], undefined),
    );
    expect(report).toContain("- sent in a test: 1");
    expect(report).toContain("- served, sent by no suite client: 0 (not measured: no server log given)");
    expect(report).toContain("- sent in no test and served by no log (the stop count): 4");
    expect(report).toContain("| AgentCommandController.create | in-test | local 1 | src/suites/agent.conformance.test.ts > a \\| b |");
    expect(report).toContain("| RPC | cloud | local |");
    expect(report).toContain("| AgentCommandController.create | · | T |");
    expect(report).toContain("| AgentQueryController.get | h | · |");
  });
});
