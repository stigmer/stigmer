// Pins the `agent quality` dispatch against a fake server: the agent is
// resolved by slug or id and its report read in the active organization
// for the days asked; the table prints the window's totals (the health and
// judge rates with their counts, each rubric's, the thumbs) and one row per
// version named by its tag, else its short hash, else "unversioned"; a
// metric graded by two evaluator versions shows the current one and says
// older ones exist; `-o json` prints the report undecorated with no history
// read; `--flagged` follows a short page that carries a token up to the
// limit and names the failed criteria, never a reason; `--agreement` prints
// one table per judge rubric version, the current one first, with the runs
// disliked where no rubric failed, and its entries undecorated under -o
// json; and the flags are refused out of range, or combined where they do
// not apply, before any request.

import { create, toJson } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ScoreSchema, type Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { CriterionResult } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import {
  AgentQualityReportSchema,
  JudgeAgreementSchema,
  ScoreListSchema,
  type AgentQualityReport,
  type GetAgentQualityReportRequest,
  type ListFlaggedScoresByAgentRequest,
  type ScoreList,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import { UsageError } from "../../../errors/index.js";
import {
  readAgentQualityOptions,
  renderAgreement,
  renderQualityReport,
  showAgentQuality,
  type AgentQualityOptions,
} from "../quality.js";

const HASH_V3 = "3f2a9c1e0b7d55aa11bb22cc33dd44ee";
const HASH_OLD = "9e8d7c6b5a4f33221100ffeeddccbbaa";

const agent = create(AgentSchema, { metadata: { id: "agt_1", org: "org_acme", slug: "support-desk" } });

const report = create(AgentQualityReportSchema, {
  fromDate: "2026-09-13",
  toDate: "2026-10-12",
  total: {
    runs: 42,
    metrics: [
      { metric: "feedback", passed: 5, failed: 1 },
      {
        metric: "judge",
        evaluatorVersion: "r2",
        passed: 10,
        failed: 2,
        pending: 1,
        criteria: [
          { name: "accurate", passed: 9, failed: 3 },
          { name: "polite", passed: 12, failed: 0, notApplicable: 2 },
        ],
      },
      { metric: "judge", evaluatorVersion: "r1", passed: 4, failed: 4 },
      { metric: "run-health", evaluatorVersion: "c1", passed: 199, failed: 1, notGraded: 2 },
    ],
  },
  versions: [
    {
      agentVersionHash: HASH_V3,
      firstDate: "2026-10-01",
      lastDate: "2026-10-12",
      summary: {
        runs: 20,
        metrics: [
          { metric: "feedback", passed: 3, failed: 1 },
          { metric: "judge", evaluatorVersion: "r2", passed: 5, failed: 1 },
          { metric: "run-health", evaluatorVersion: "c1", passed: 19, failed: 1 },
        ],
      },
    },
    {
      agentVersionHash: HASH_OLD,
      firstDate: "2026-09-20",
      lastDate: "2026-09-30",
      summary: {
        runs: 15,
        metrics: [
          { metric: "judge", evaluatorVersion: "r2", passed: 5, failed: 1 },
          { metric: "judge", evaluatorVersion: "r1", passed: 4, failed: 4 },
        ],
      },
    },
    {
      agentVersionHash: "",
      firstDate: "2026-09-14",
      lastDate: "2026-09-14",
      summary: { runs: 7, metrics: [{ metric: "run-health", evaluatorVersion: "c1", passed: 7, failed: 0 }] },
    },
  ],
  agreement: [
    {
      evaluatorVersion: "e6b2728dfc4b352a7bc30bd4",
      runs: 14,
      thumbsDownNoneFailed: 3,
      rules: [
        { name: "acted-only-as-asked", failedThumbsDown: 1, failedThumbsUp: 6, passedThumbsDown: 0, passedThumbsUp: 7 },
        { name: "did-the-task", failedThumbsDown: 2, failedThumbsUp: 0, passedThumbsDown: 4, passedThumbsUp: 8 },
      ],
    },
    {
      evaluatorVersion: "8191b6ca352b050221ccb7b3",
      runs: 1,
      thumbsDownNoneFailed: 0,
      rules: [{ name: "did-the-task", failedThumbsDown: 0, failedThumbsUp: 0, passedThumbsDown: 0, passedThumbsUp: 1 }],
    },
  ],
});

function flagged(runId: string, metric: string, minute: number, failed: string[] = []): Score {
  return create(ScoreSchema, {
    spec: {
      runId,
      metric,
      value: { case: "passed", value: false },
      comment: "the reply quoted a secret",
      criteria: [
        ...failed.map((name) => ({ name, result: CriterionResult.failed, reason: `reason for ${name}` })),
        { name: "stayed-on-topic", result: CriterionResult.passed, reason: "fine" },
      ],
    },
    status: {
      agentVersionHash: HASH_V3,
      audit: { specAudit: { createdAt: timestampFromDate(new Date(Date.UTC(2026, 9, 12, 14, minute))) } },
    },
  });
}

/** A server whose flagged list answers each of `pages` in turn. */
function fakeServer(opts: { pages?: ScoreList[]; historyError?: Error; singleOrg?: boolean } = {}) {
  const calls: string[] = [];
  const reportRequests: GetAgentQualityReportRequest[] = [];
  const flaggedRequests: ListFlaggedScoresByAgentRequest[] = [];
  let page = 0;
  const client = {
    platform: { getServerInfo: async () => ({ singleOrg: opts.singleOrg === true }) },
    agent: {
      get: async (id: string) => {
        calls.push(`agent.get ${id}`);
        return agent;
      },
      getByReference: async (ref: { org: string; slug: string }) => {
        calls.push(`agent.ref ${ref.org}/${ref.slug}`);
        return agent;
      },
      listVersions: async (input: { org: string; slug: string }) => {
        calls.push(`versions ${input.org}/${input.slug}`);
        if (opts.historyError !== undefined) throw opts.historyError;
        return { entries: [{ versionHash: HASH_V3, tag: "v3" }, { versionHash: HASH_OLD, tag: "" }], nextPageToken: "" };
      },
    },
    score: {
      getAgentQualityReport: async (input: GetAgentQualityReportRequest) => {
        reportRequests.push(input);
        return report;
      },
      listFlaggedByAgent: async (input: ListFlaggedScoresByAgentRequest) => {
        flaggedRequests.push(input);
        const answer = opts.pages?.[page] ?? create(ScoreListSchema, {});
        page += 1;
        return answer;
      },
    },
  } as unknown as Stigmer;
  return { client, calls, reportRequests, flaggedRequests };
}

function options(overrides: Partial<AgentQualityOptions> = {}): AgentQualityOptions {
  return { days: 30, flagged: false, agreement: false, limit: 20, format: "table", ...overrides };
}

describe("showAgentQuality, the report", () => {
  it("reads the agent by slug and its report in the active organization for the days asked", async () => {
    const server = fakeServer();
    await showAgentQuality(server.client, "acme", "support-desk", options({ days: 7 }));
    expect(server.calls[0]).toBe("agent.ref acme/support-desk");
    expect(server.reportRequests).toHaveLength(1);
    expect(server.reportRequests[0]).toMatchObject({ org: "acme", agentId: "agt_1", days: 7 });
  });

  it("reads an agent given by id", async () => {
    const server = fakeServer();
    await showAgentQuality(server.client, "acme", "agt_1", options());
    expect(server.calls[0]).toBe("agent.get agt_1");
    expect(server.reportRequests[0]?.agentId).toBe("agt_1");
  });

  it("prints the totals with every rate's counts, each rubric, the thumbs, and one row per version", async () => {
    const server = fakeServer();
    const out = await showAgentQuality(server.client, "acme", "support-desk", options());

    expect(out).toContain("Agent:   support-desk");
    expect(out).toContain("Window:  2026-09-13 to 2026-10-12 (UTC)");
    expect(out).toContain("Runs:    42 graded");
    // 199 of 200 never reads as 100%.
    expect(out).toContain("Health:  199 of 200 passed (99%), 2 not graded");
    expect(out).toContain("Judge:   10 of 12 passed (83%), 1 grading");
    expect(out).toMatch(/accurate\s+9 of 12 passed \(75%\)/);
    expect(out).toMatch(/polite\s+12 of 12 passed \(100%\), 2 not applicable/);
    expect(out).toContain("Thumbs:  5 up, 1 down");
    expect(out).toContain("judge (1 older version)");

    const rows = out.split("\n");
    expect(rows.find((line) => line.startsWith("v3 "))).toMatch(
      /^v3\s+2026-10-01 to 2026-10-12\s+20\s+19\/20 \(95%\)\s+5\/6 \(83%\)\s+3 up, 1 down$/,
    );
    expect(rows.find((line) => line.startsWith(HASH_OLD.slice(0, 12)))).toMatch(/^9e8d7c6b5a4f \*\s+2026-09-20 to 2026-09-30\s+15\s+-\s+5\/6 \(83%\)\s+-$/);
    expect(rows.find((line) => line.startsWith("unversioned"))).toMatch(/^unversioned\s+2026-09-14\s+7\s+7\/7 \(100%\)\s+-\s+-$/);
    expect(out).toContain("* older checks or rubrics also graded this version's runs");
    expect(server.calls).toContain("versions org_acme/support-desk");
  });

  it("names every version by its short hash when the history cannot be read", async () => {
    const server = fakeServer({ historyError: new Error("permission denied") });
    const out = await showAgentQuality(server.client, "acme", "support-desk", options());
    expect(out).toMatch(/^3f2a9c1e0b7d\s/m);
  });

  it("prints the report undecorated under -o json, and reads no history", async () => {
    const server = fakeServer();
    const out = await showAgentQuality(server.client, "acme", "support-desk", options({ format: "json" }));
    expect(JSON.parse(out)).toEqual(toJson(AgentQualityReportSchema, report, { useProtoFieldName: true }));
    expect(server.calls.some((call) => call.startsWith("versions"))).toBe(false);
  });

  it("prints the report as yaml under -o yaml", () => {
    expect(renderQualityReport(report, "support-desk", new Map(), "yaml")).toContain("from_date: 2026-09-13");
  });

  it("says so when no run was graded in the window", () => {
    const empty: AgentQualityReport = create(AgentQualityReportSchema, {
      fromDate: "2026-10-06",
      toDate: "2026-10-12",
      total: { runs: 0 },
    });
    const out = renderQualityReport(empty, "support-desk", new Map(), "table");
    expect(out).toContain("No graded runs in this window.");
    expect(out).not.toContain("VERSION");
  });

  it("says a metric was not graded rather than printing a rate with no count", () => {
    const healthOnly = create(AgentQualityReportSchema, {
      fromDate: "2026-10-06",
      toDate: "2026-10-12",
      total: { runs: 3, metrics: [{ metric: "run-health", evaluatorVersion: "c1", passed: 0, failed: 0, notGraded: 3 }] },
    });
    const out = renderQualityReport(healthOnly, "support-desk", new Map(), "table");
    expect(out).toContain("Health:  none graded, 3 not graded");
    expect(out).toContain("Judge:   not graded");
    expect(out).toContain("Thumbs:  none");
    expect(out).not.toContain("older");
  });

  it("reads no history when every version is unversioned, and never rounds a few passes to 0%", async () => {
    const server = fakeServer();
    const unversioned = create(AgentQualityReportSchema, {
      fromDate: "2026-10-06",
      toDate: "2026-10-12",
      total: { runs: 300, metrics: [{ metric: "run-health", evaluatorVersion: "c1", passed: 1, failed: 299 }] },
      versions: [
        {
          agentVersionHash: "",
          firstDate: "2026-10-06",
          lastDate: "2026-10-12",
          summary: { runs: 300, metrics: [{ metric: "run-health", evaluatorVersion: "c1", passed: 1, failed: 299 }] },
        },
      ],
    });
    server.client.score.getAgentQualityReport = async () => unversioned;
    const out = await showAgentQuality(server.client, "acme", "support-desk", options());
    expect(out).toContain("Health:  1 of 300 passed (1%)");
    expect(server.calls.some((call) => call.startsWith("versions"))).toBe(false);
  });

  it("refuses an empty organization on a server that holds several, before any read", async () => {
    const server = fakeServer();
    const error = await showAgentQuality(server.client, "", "agt_1", options()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).message).toContain("stigmer agent quality --org <org> <agent>");
    expect(server.calls).toEqual([]);
    expect(server.reportRequests).toEqual([]);
  });
});

describe("showAgentQuality, --flagged", () => {
  it("follows a short page that carries a token, asks only for what is missing, and stops at the limit", async () => {
    const server = fakeServer({
      pages: [
        create(ScoreListSchema, { entries: [flagged("run_3", "judge", 30, ["accurate", "polite"])], nextPageToken: "t1" }),
        create(ScoreListSchema, { entries: [], nextPageToken: "t2" }),
        create(ScoreListSchema, {
          entries: [flagged("run_2", "feedback", 20), flagged("run_1", "run-health", 10, ["no-repeated-calls"])],
          nextPageToken: "t3",
        }),
      ],
    });
    const out = await showAgentQuality(server.client, "acme", "support-desk", options({ flagged: true, limit: 3, days: 14 }));

    expect(server.flaggedRequests.map((r) => [r.pageSize, r.pageToken, r.days, r.org, r.agentId])).toEqual([
      [3, "", 14, "acme", "agt_1"],
      [2, "t1", 14, "acme", "agt_1"],
      [2, "t2", 14, "acme", "agt_1"],
    ]);
    expect(server.reportRequests).toEqual([]);

    const rows = out.split("\n");
    expect(rows.find((line) => line.startsWith("TIME"))).toMatch(/^TIME\s+RUN\s+METRIC\s+FAILED$/);
    expect(rows.find((line) => line.includes("run_3"))).toMatch(/^2026-10-12 14:30Z\s+run_3\s+judge\s+accurate, polite$/);
    expect(rows.find((line) => line.includes("run_2"))).toMatch(/feedback\s+thumbs down$/);
    expect(rows.find((line) => line.includes("run_1"))).toMatch(/run-health\s+no-repeated-calls$/);
    expect(out).not.toContain("reason for");
    expect(out).not.toContain("quoted a secret");
    expect(out).not.toContain("stayed-on-topic");
  });

  it("reads every page at 100 a request under --limit 0, following each token to the end", async () => {
    const server = fakeServer({
      pages: [
        create(ScoreListSchema, { entries: [flagged("run_3", "judge", 30)], nextPageToken: "t1" }),
        create(ScoreListSchema, { entries: [], nextPageToken: "t2" }),
        create(ScoreListSchema, { entries: [flagged("run_2", "feedback", 20)], nextPageToken: "" }),
      ],
    });
    const out = await showAgentQuality(server.client, "acme", "support-desk", options({ flagged: true, limit: 0 }));

    expect(server.flaggedRequests.map((r) => [r.pageSize, r.pageToken])).toEqual([
      [100, ""],
      [100, "t1"],
      [100, "t2"],
    ]);
    expect(out).toContain("run_3");
    expect(out).toContain("run_2");
  });

  it("prints a dash for a grade with no recorded time", async () => {
    const undated = create(ScoreSchema, { spec: { runId: "run_9", metric: "judge", value: { case: "passed", value: false } } });
    const server = fakeServer({ pages: [create(ScoreListSchema, { entries: [undated] })] });
    const out = await showAgentQuality(server.client, "acme", "support-desk", options({ flagged: true }));
    expect(out.split("\n").find((line) => line.includes("run_9"))).toMatch(/^-\s+run_9\s+judge\s+-$/);
  });

  it("says so when no run was flagged", async () => {
    const server = fakeServer({ pages: [create(ScoreListSchema, {})] });
    const out = await showAgentQuality(server.client, "acme", "support-desk", options({ flagged: true }));
    expect(out).toContain("No flagged runs found");
  });

  it("prints the scores undecorated under -o json and -o yaml", async () => {
    const score = flagged("run_3", "judge", 30, ["accurate"]);
    const json = await showAgentQuality(
      fakeServer({ pages: [create(ScoreListSchema, { entries: [score] })] }).client,
      "acme",
      "support-desk",
      options({ flagged: true, format: "json" }),
    );
    expect(JSON.parse(json)).toEqual([toJson(ScoreSchema, score, { useProtoFieldName: true })]);
    const yaml = await showAgentQuality(
      fakeServer({ pages: [create(ScoreListSchema, { entries: [score] })] }).client,
      "acme",
      "support-desk",
      options({ flagged: true, format: "yaml" }),
    );
    expect(yaml).toContain("run_id: run_3");
  });
});

describe("showAgentQuality, --agreement", () => {
  it("prints one table per rubric version, the current first, with the runs no rubric caught", async () => {
    const server = fakeServer();
    const out = await showAgentQuality(server.client, "acme", "support-desk", options({ agreement: true }));
    expect(server.reportRequests).toHaveLength(1);
    expect(server.calls.some((call) => call.startsWith("versions"))).toBe(false);
    expect(out).toContain(
      "Rubrics e6b2728dfc4b (current): 14 runs with a judge grade and thumbs; 3 disliked where no rubric failed (a failure no rubric catches)",
    );
    expect(out).toMatch(/^acted-only-as-asked\s+1\s+6\s+0\s+7$/m);
    expect(out).toContain("Rubrics 8191b6ca352b: 1 run with a judge grade and thumbs\n");
    expect(out.indexOf("e6b2728dfc4b")).toBeLessThan(out.indexOf("8191b6ca352b"));
    expect(out).toContain("FAILED, UP: the rubric failed runs people liked");
  });

  it("prints the agreement entries undecorated under -o json and -o yaml", () => {
    const json = JSON.parse(renderAgreement(report, "support-desk", "json")) as unknown[];
    expect(json).toEqual(report.agreement.map((entry) => toJson(JudgeAgreementSchema, entry, { useProtoFieldName: true })));
    expect(renderAgreement(report, "support-desk", "yaml")).toContain("thumbs_down_none_failed: 3");
  });

  it("says so when no run has both a judge grade and thumbs", () => {
    const none = create(AgentQualityReportSchema, { fromDate: "2026-10-06", toDate: "2026-10-12", total: { runs: 3 } });
    const out = renderAgreement(none, "support-desk", "table");
    expect(out).toContain("No run in this window has both an AI judge grade and a person's thumbs.");
    expect(out).not.toContain("RUBRIC");
  });
});

describe("readAgentQualityOptions", () => {
  it("counts 30 days and lists 20 flagged grades by default", () => {
    expect(readAgentQualityOptions({}, "table")).toEqual({
      days: 30,
      flagged: false,
      agreement: false,
      limit: 20,
      format: "table",
    });
    expect(readAgentQualityOptions({ days: "90", flagged: true, limit: "0" }, "json")).toEqual({
      days: 90,
      flagged: true,
      agreement: false,
      limit: 0,
      format: "json",
    });
  });

  it.each(["0", "91", "7.5", "-1", "week"])("refuses --days %s with the range it accepts", (days) => {
    expect(() => readAgentQualityOptions({ days }, "table")).toThrow(/give a whole number of days from 1 to 90/);
  });

  it("refuses a --limit that is not a whole number", () => {
    expect(() => readAgentQualityOptions({ flagged: true, limit: "ten" }, "table")).toThrow(/invalid --limit value "ten"/);
  });

  it("refuses --limit without --flagged", () => {
    expect(() => readAgentQualityOptions({ limit: "5" }, "table")).toThrow(/--limit applies to --flagged only/);
  });

  it("refuses --agreement with --flagged or --limit", () => {
    expect(readAgentQualityOptions({ agreement: true }, "table").agreement).toBe(true);
    expect(() => readAgentQualityOptions({ agreement: true, flagged: true }, "table")).toThrow(UsageError);
    expect(() => readAgentQualityOptions({ agreement: true, limit: "5" }, "table")).toThrow(
      /--agreement shows the report's thumbs-against-judge counts/,
    );
  });
});
