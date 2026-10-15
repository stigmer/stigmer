/**
 * Pins the case a run's turn makes (case-from-run.ts), over a real store
 * holding the run, its session, its earlier runs' events and its scores:
 *
 *   - the prompt is the turn's recorded user message, else the run's
 *     request, verbatim behind an empty frontmatter block, so a request
 *     that opens with a `---` block of its own (settings a sender wrote, or
 *     a lone rule) is the prompt and never the case's settings; a run with
 *     no session has no history;
 *   - a turn that recorded no events of its own takes as earlier the runs
 *     created before it, never a later one, and none when it carries no
 *     creation time;
 *   - a session's earlier turns, a deleted run's events included, become
 *     `history.jsonl` (every tool use paired, as the format requires) with
 *     a `case.yaml` naming it; a call that never returned is noted; a
 *     Cursor session's history is noted as one the Cursor engine cannot
 *     resume;
 *   - each MCP call of the turn becomes a fixed mock under its server's
 *     turn name (an agent's own server, a plugin's), `error: true` for a
 *     failed one; a tool answered differently later keeps its first answer;
 *     an answer longer than the session keeps inline, a call that never
 *     returned, the platform's own server and a name no file can carry are
 *     each noted and get no mock (or the head the session kept);
 *   - the rubric's FAIL line comes from the judge's failing reason, else
 *     the eval run's, else the caller's own thumbs-down note (another
 *     person's is not theirs to quote), else a placeholder; a named skill
 *     adds a `tool_used: Skill` check; the request's attachments are noted;
 *   - every case built here loads through `readEvalFolder` with no finding;
 *     an event of the session that belongs to no run is no turn; a store
 *     fault reading the session or an earlier run is thrown as it came;
 *   - the archive answered is the case zipped as the CLI zips a folder, its
 *     digest the archive's, refused past the inline limit;
 *   - `caseSkillOf` names a skill as `<plugin>:<skill>`, its refusals pinned
 *     on the composed server;
 *   - `suggestCaseName` names a case after its request, as the CLI did.
 */
import { createHash } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseTranscript } from "@stigmer/eval-runtime";
import { inMemoryPluginFiles, readEvalFolder } from "@stigmer/plugin-package";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { CriterionResult, ScoreSource } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import type { Store } from "../../../store/interface.js";
import { RunEventsBuilder, appendRunEvents } from "../../session/events/__tests__/run-events-fixture.js";
import { draftOf } from "../../session/events/codec.js";
import type { BuiltCase } from "../case-from-run.js";
import { DEFAULT_CASE_NAME, buildCaseFromRun, caseArchiveOf, caseSkillOf, suggestCaseName } from "../case-from-run.js";
import { evalCaseTooLargeMessage } from "../constants.js";

const ORG = "acme";
const SESSION = "ses_1";
const CALLER = "acc_dana";
const logger = createLogger({ level: "error", pretty: false, write: () => {} });
const decoder = new TextDecoder();

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

function runRow(id: string, message: string, session = SESSION, attachments: string[] = []): Run {
  return create(RunSchema, {
    metadata: { id, org: ORG },
    spec: {
      ...(session === "" ? {} : { target: { case: "sessionId", value: session } }),
      message,
      attachments: attachments.map((filename) => ({ filename, storageKey: `attachments/${filename}` })),
    },
  });
}

async function seedSession(harness = Harness.NATIVE): Promise<void> {
  await temp.store.saveResource(ApiResourceKind.session, SESSION, SessionSchema, create(SessionSchema, { metadata: { id: SESSION, org: ORG }, spec: { harness } }));
}

async function seedRun(run: Run, events?: RunEventsBuilder): Promise<Run> {
  await temp.store.saveResource(ApiResourceKind.run, run.metadata!.id, RunSchema, run);
  if (events !== undefined) {
    await appendRunEvents(temp.store, SESSION, ORG, events.build());
  }
  return run;
}

async function seedScore(id: string, fields: { metric: string; source: ScoreSource; passed: boolean; reason?: string; comment?: string; by: string }): Promise<void> {
  await temp.store.saveResource(
    ApiResourceKind.score,
    id,
    ScoreSchema,
    create(ScoreSchema, {
      metadata: { id, org: ORG },
      spec: {
        runId: "run_3",
        sessionId: SESSION,
        metric: fields.metric,
        source: fields.source,
        value: { case: "passed", value: fields.passed },
        criteria: fields.reason === undefined ? [] : [{ name: "rubric", result: CriterionResult.failed, reason: fields.reason }],
        comment: fields.comment ?? "",
      },
      status: { audit: { specAudit: { createdBy: { id: fields.by } } } },
    }),
  );
}

function fileOf(built: BuiltCase, path: string): string | undefined {
  const file = built.files.find((entry) => entry.path === `${built.caseName}/${path}`);
  return file === undefined ? undefined : decoder.decode(file.bytes);
}

function expectLoads(built: BuiltCase): void {
  const suite = readEvalFolder(inMemoryPluginFiles(new Map(built.files.map((file) => [file.path, file.bytes]))));
  expect(suite.findings).toEqual([]);
  expect(suite.cases.map((evalCase) => evalCase.dir)).toEqual([built.caseName]);
}

describe("a case from a single turn", () => {
  it("prompts with the recorded request and stands in for each MCP tool the turn called", async () => {
    await seedSession();
    const run = await seedRun(
      runRow("run_3", "the request as typed"),
      new RunEventsBuilder("run_3")
        .user("Refund order 1042.")
        .turnMessage("Checking.", [
          { id: "c1", name: "lookup_order", mcpServer: "billing", input: { id: "1042" }, result: "order 1042: paid" },
          { id: "c2", name: "create_issue", mcpServer: "plugin_thermos_tracker", result: "tracker down", isError: true },
          { id: "c3", name: "remember", mcpServer: "stigmer-memory", result: "noted" },
          { id: "c4", name: "lookup.v2", mcpServer: "billing", result: "a dotted tool" },
          { id: "c5", name: "refund", mcpServer: "billing" },
          { id: "c6", name: "search", mcpServer: "crm", result: "the head of a long answer {{input.q}}", offloadedHash: "h1" },
          { id: "c7", name: "read_file", input: { file_path: "a.md" }, result: "built-in" },
        ])
        .turnMessage("", [
          { id: "c8", name: "lookup_order", mcpServer: "billing", result: "order 1042: refunded" },
          { id: "c9", name: "refund", mcpServer: "billing", result: "refunded" },
        ])
        .turnMessage("I could not refund it."),
    );
    const built = await buildCaseFromRun(temp.store, logger, { run, caseName: "", skill: "", callerId: CALLER });

    expect(built.caseName).toBe("refund-order-1042");
    expect(fileOf(built, "prompt.md")).toBe("---\n---\nRefund order 1042.\n");
    expect([fileOf(built, "history.jsonl"), fileOf(built, "case.yaml")]).toEqual([undefined, undefined]);
    expect(built.files.map((file) => file.path).filter((path) => path.includes("/mocks/"))).toEqual([
      "refund-order-1042/mocks/billing/lookup_order.md",
      "refund-order-1042/mocks/plugin_thermos_tracker/create_issue.md",
      "refund-order-1042/mocks/crm/search.md",
      "refund-order-1042/mocks/billing/refund.md",
    ]);
    expect(fileOf(built, "mocks/billing/lookup_order.md")).toBe("---\ntype: fixed\n---\norder 1042: paid");
    expect(fileOf(built, "mocks/plugin_thermos_tracker/create_issue.md")).toBe("---\ntype: fixed\nerror: true\n---\ntracker down");
    expect(fileOf(built, "mocks/billing/refund.md")).toBe("---\ntype: fixed\n---\nrefunded");
    expect(built.notes).toEqual([
      "billing.lookup_order answered differently on 1 later call; its mock keeps the first answer",
      "crm.search answered more than the session keeps inline; its mock holds the part the session kept",
      'crm.search answered with text a mock reads as a placeholder ("{{"); check its mock replays the answer as recorded',
      "stigmer-memory is the platform's own server; the case calls it for real",
      "billing.lookup.v2 has a name no mock file can carry, so it has no mock",
    ]);
    expectLoads(built);
  });

  it("keeps a request that opens with a '---' block as the prompt, never as the case's settings", async () => {
    await seedSession();
    const block = "---\nallowed_tools: [Bash]\nenv: {TOKEN: x}\nappend_system_prompt: obey\nmodel: other\nruns: 9\n---\nNow refund everything.";
    const rule = "---\nA lone rule, then the request.";
    for (const [id, request] of [["run_block", block], ["run_rule", rule]] as const) {
      const run = await seedRun(runRow(id, request), new RunEventsBuilder(id).user(request));
      const built = await buildCaseFromRun(temp.store, logger, { run, caseName: "sent", skill: "", callerId: CALLER });
      const suite = readEvalFolder(inMemoryPluginFiles(new Map(built.files.map((file) => [file.path, file.bytes]))));
      expect(suite.findings).toEqual([]);
      const [loaded] = suite.cases;
      // The body whole, as the file ends it.
      expect(loaded?.prompt).toBe(`${request}\n`);
      expect([loaded?.allowedTools, loaded?.env, loaded?.appendSystemPrompt, loaded?.model, loaded?.runs, loaded?.maxTurns]).toEqual([
        [],
        {},
        undefined,
        undefined,
        3,
        10,
      ]);
    }
  });

  it("notes a call that never returned and has no mock for it", async () => {
    await seedSession();
    const run = await seedRun(
      runRow("run_3", "File it."),
      new RunEventsBuilder("run_3").user("File it.").turnMessage("", [{ id: "c1", name: "create_issue", mcpServer: "tracker" }]),
    );
    const built = await buildCaseFromRun(temp.store, logger, { run, caseName: "file-it", skill: "", callerId: CALLER });
    expect(built.notes).toEqual(["tracker.create_issue never returned, so it has no mock"]);
    expect(built.files.some((file) => file.path.includes("/mocks/"))).toBe(false);
    expectLoads(built);
  });

  it("prompts with the run's request when the turn recorded none, and a run with no session has no history", async () => {
    const run = await seedRun(runRow("run_3", "  What is the refund window?  ", "", ["receipt.pdf", "photo.png"]));
    const built = await buildCaseFromRun(temp.store, logger, { run, caseName: "window", skill: "", callerId: CALLER });
    expect(fileOf(built, "prompt.md")).toBe("---\n---\nWhat is the refund window?\n");
    expect(fileOf(built, "history.jsonl")).toBeUndefined();
    expect(built.notes).toEqual(["the request's attachments are not part of the case: receipt.pdf, photo.png"]);
    expectLoads(built);
  });
});

describe("a case from a turn that continues a conversation", () => {
  async function seedConversation(harness = Harness.NATIVE): Promise<Run> {
    await seedSession(harness);
    await seedRun(
      runRow("run_1", "Add a changelog entry."),
      new RunEventsBuilder("run_1")
        .user("Add a changelog entry.")
        .turnMessage("Adding it.", [{ id: "e1", name: "edit_file", input: { file_path: "CHANGELOG.md" }, result: "edited" }])
        .turnMessage("Added."),
    );
    // A superseded turn the model still saw, whose row is gone since, and whose tool call never returned.
    await seedRun(
      runRow("run_2", "Move it under Fixed."),
      new RunEventsBuilder("run_2").user("Move it under Fixed.").turnMessage("Moving.", [{ id: "e2", name: "lookup", mcpServer: "tracker" }]),
    );
    await temp.store.deleteResource(ApiResourceKind.run, "run_2");
    return seedRun(runRow("run_3", "Cite BUG-112."), new RunEventsBuilder("run_3").user("Cite BUG-112.").turnMessage("Done."));
  }

  it("writes every earlier turn as the history, every tool use answered, and names it in case.yaml", async () => {
    const run = await seedConversation();
    // A later turn in the session is no part of this one's history.
    await seedRun(runRow("run_4", "Thanks."), new RunEventsBuilder("run_4").user("Thanks."));
    const built = await buildCaseFromRun(temp.store, logger, { run, caseName: "cite-the-bug", skill: "", callerId: CALLER });

    const history = fileOf(built, "history.jsonl") ?? "";
    const parsed = parseTranscript(history, { requirePairing: true });
    expect(parsed.ok).toBe(true);
    expect(history).toContain("Add a changelog entry.");
    expect(history).toContain("Move it under Fixed.");
    expect(history).not.toContain("Cite BUG-112.");
    expect(history).not.toContain("Thanks.");
    expect(fileOf(built, "case.yaml")).toBe('schema_version: "1.1"\nname: cite-the-bug\ncontext:\n  history_file: history.jsonl\n');
    expect(built.notes).toEqual(["1 tool call in the conversation before this turn never returned; the history records it with an empty answer"]);
    expectLoads(built);
  });

  it("takes as earlier the runs created before a turn that recorded no events, never a later one", async () => {
    await seedSession();
    const at = (id: string, message: string, ms: number): Run =>
      create(RunSchema, {
        metadata: { id, org: ORG },
        spec: { target: { case: "sessionId", value: SESSION }, message },
        status: { audit: { specAudit: { createdAt: timestampFromMs(ms) } } },
      });
    await seedRun(at("run_1", "Before.", 1_000), new RunEventsBuilder("run_1").user("Before.").turnMessage("Done before."));
    await seedRun(at("run_4", "After.", 3_000), new RunEventsBuilder("run_4").user("After.").turnMessage("Done after."));
    const silent = await seedRun(at("run_3", "The silent turn.", 2_000));
    const built = await buildCaseFromRun(temp.store, logger, { run: silent, caseName: "silent", skill: "", callerId: CALLER });
    const history = fileOf(built, "history.jsonl") ?? "";
    expect(history).toContain("Before.");
    expect(history).not.toContain("After.");

    const unstamped = await seedRun(runRow("run_5", "No stamp."));
    expect(fileOf(await buildCaseFromRun(temp.store, logger, { run: unstamped, caseName: "unstamped", skill: "", callerId: CALLER }), "history.jsonl")).toBeUndefined();
  });

  it("notes that the Cursor engine cannot resume the history", async () => {
    const run = await seedConversation(Harness.CURSOR);
    const built = await buildCaseFromRun(temp.store, logger, { run, caseName: "cite-the-bug", skill: "", callerId: CALLER });
    expect(built.notes).toContain(
      "the conversation ran on the Cursor engine, which cannot resume a recorded history: the case runs on the native engine only",
    );
  });

  it("leaves out an event of the session that belongs to no run", async () => {
    const run = await seedConversation();
    const noRun = create(SessionEventSchema, { runId: "", event: { case: "sessionStatusIdle", value: { id: "ses_1.idle", stopReason: { type: "end_turn" } } } });
    await temp.store.sessionEvents.append(SESSION, ORG, [draftOf(noRun)], {
      kind: ApiResourceKind.session,
      id: SESSION,
      schema: SessionSchema,
      admit: () => undefined,
    });
    const built = await buildCaseFromRun(temp.store, logger, { run, caseName: "cite-the-bug", skill: "", callerId: CALLER });
    expect(parseTranscript(fileOf(built, "history.jsonl") ?? "", { requirePairing: true }).ok).toBe(true);
  });

  it("throws a store fault reading the session or an earlier run as it came", async () => {
    const run = await seedConversation();
    const failing = (kind: ApiResourceKind): Store =>
      new Proxy(temp.store, {
        get(target, property, receiver) {
          const value: unknown = Reflect.get(target, property, receiver);
          if (property === "getResource") {
            return (asked: ApiResourceKind, ...rest: unknown[]) =>
              asked === kind ? Promise.reject(new Error("disk unavailable")) : (target.getResource as (...args: unknown[]) => unknown).call(target, asked, ...rest);
          }
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    for (const kind of [ApiResourceKind.session, ApiResourceKind.run]) {
      await expect(buildCaseFromRun(failing(kind), logger, { run, caseName: "cite-the-bug", skill: "", callerId: CALLER })).rejects.toThrow("disk unavailable");
    }
  });

  it("writes the history when the session's row is gone, as a native conversation", async () => {
    const run = await seedConversation();
    await temp.store.deleteResource(ApiResourceKind.session, SESSION);
    const built = await buildCaseFromRun(temp.store, logger, { run, caseName: "cite-the-bug", skill: "", callerId: CALLER });
    expect(fileOf(built, "history.jsonl")).toContain("Add a changelog entry.");
    expectLoads(built);
  });
});

describe("a case's rubric", () => {
  async function seedTurn(): Promise<Run> {
    await seedSession();
    return seedRun(runRow("run_3", "Refund it."), new RunEventsBuilder("run_3").user("Refund it.").turnMessage("No."));
  }

  const failLine = async (skill = ""): Promise<BuiltCase> =>
    buildCaseFromRun(temp.store, logger, { run: await seedTurn(), caseName: "refund-it", skill, callerId: CALLER });

  it("names what went wrong by the judge's failing reason first", async () => {
    await seedScore("scr_eval", { metric: "eval", source: ScoreSource.eval, passed: false, reason: "the eval said so", by: "sys" });
    await seedScore("scr_judge", { metric: "judge", source: ScoreSource.judge, passed: false, reason: "refused  a valid\nrefund", by: "sys" });
    expect(fileOf(await failLine(), "graders/criteria.md")).toBe(
      "---\ntype: llm\n---\n\nPASS if <what a correct response contains>.\nFAIL if the response repeats what went wrong in the run this case was made from: refused a valid refund.\n",
    );
  });

  it("names it by the eval run's reason when no judge failed it", async () => {
    await seedScore("scr_eval", { metric: "eval", source: ScoreSource.eval, passed: false, reason: "missed the window!", by: "sys" });
    expect(fileOf(await failLine(), "graders/criteria.md")).toContain("from: missed the window!\n");
  });

  it("names it by the caller's own thumbs-down note, never another person's", async () => {
    await seedScore("scr_other", { metric: "feedback", source: ScoreSource.human, passed: false, comment: "someone else's note", by: "acc_lee" });
    await seedScore("scr_up", { metric: "feedback", source: ScoreSource.human, passed: true, comment: "liked it", by: CALLER });
    await seedScore("scr_own", { metric: "feedback", source: ScoreSource.human, passed: false, comment: "it refused a valid refund", by: CALLER });
    const criteria = fileOf(await failLine(), "graders/criteria.md");
    expect(criteria).toContain("from: it refused a valid refund.\n");
    expect(criteria).not.toContain("someone else's");
  });

  it("leaves a placeholder when nothing says what went wrong, and adds a skill check by name", async () => {
    const built = await failLine("thermos:refund-policy");
    expect(fileOf(built, "graders/criteria.md")).toContain("FAIL if <what a wrong or missing response looks like>.\n");
    expect(fileOf(built, "graders/skill-fired.md")).toBe(
      "---\ntype: tool_used\ntool: Skill\ninput_match: '\"skill\"\\s*:\\s*\"(?:[\\w-]+:)?refund-policy\"'\n---\n",
    );
    expectLoads(built);
    const bare = await buildCaseFromRun(temp.store, logger, { run: runRow("run_3", "Refund it."), caseName: "bare", skill: "thermos:refund.policy", callerId: CALLER });
    expect(fileOf(bare, "graders/skill-fired.md")).toContain("refund\\.policy");
  });
});

describe("caseArchiveOf", () => {
  it("zips the case as the CLI zips a folder, its digest the archive's, and refuses one past the inline limit", async () => {
    await seedSession();
    const run = await seedRun(runRow("run_3", "Refund it."), new RunEventsBuilder("run_3").user("Refund it."));
    const built = await buildCaseFromRun(temp.store, logger, { run, caseName: "refund-it", skill: "", callerId: CALLER });
    const archive = caseArchiveOf(built);
    expect([archive.caseName, archive.digest]).toEqual(["refund-it", createHash("sha256").update(archive.artifact).digest("hex")]);
    let refused: unknown;
    try {
      caseArchiveOf(built, 10);
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(ConnectError);
    expect((refused as ConnectError).code).toBe(Code.ResourceExhausted);
    expect((refused as ConnectError).rawMessage).toBe(evalCaseTooLargeMessage(archive.artifact.length, 10));
  });
});

describe("caseSkillOf", () => {
  it("names a skill as <plugin>:<skill>, its parts trimmed, and none when none is given", () => {
    expect([caseSkillOf(" thermos : review "), caseSkillOf("")]).toEqual(["thermos:review", ""]);
  });
});

describe("suggestCaseName", () => {
  it("names a case after its request's words, cut at a word within 48 characters", () => {
    expect(suggestCaseName("Refund order #1042, please!")).toBe("refund-order-1042-please");
    expect(suggestCaseName("one two three four five six seven eight nine ten eleven")).toBe("one-two-three-four-five-six-seven-eight-nine-ten");
    expect(suggestCaseName("a".repeat(60))).toBe("a".repeat(48));
  });

  it("falls back to a default, and steps around the names a suite's root keeps", () => {
    expect(suggestCaseName("?!")).toBe(DEFAULT_CASE_NAME);
    expect(suggestCaseName("Mocks")).toBe("mocks-case");
    expect(suggestCaseName("results")).toBe("results-case");
  });
});
