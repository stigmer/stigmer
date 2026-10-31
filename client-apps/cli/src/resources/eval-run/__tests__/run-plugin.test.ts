// Pins the `eval run --plugin` dispatch, and the follow loop every eval
// run shares (follow.ts), against a fake server and fake effects:
// the plugin is resolved by name and the eval created in its organization
// with every option; the suite's load findings (each once, on one line) and
// the filled spending limit go to stderr, or under `--json` the findings go
// into the document's `findings`; each finished try prints once while the command follows the
// eval; the table and summary go to stdout; `--json` is quiet and writes the
// result document to stdout or its path; `--no-wait` prints the id and
// returns (under `--json`, with the started eval's document); Ctrl+C cancels
// the eval and exits 130 with the partial results and why it stopped, the
// cancel's own answer standing when the read after it fails; a Ctrl+C
// during create cancels the eval once create answers (under `--no-wait`
// too), and a second one then exits before the id is known; a Ctrl+C
// during a read that hangs still sends the cancel, and a second one says how
// to cancel; an eval that finished as Ctrl+C landed, or that the cancel found
// done, is reported as finished with its own code; a read or a cancel with
// no answer in 30 seconds counts as failed; a read that
// fails is retried with backoff (a Ctrl+C during the wait still cancels),
// and past about a minute the eval is cancelled, `--json` written with
// what the command had, and the exit is 1, unless the cancel found the eval
// already finished, which is then reported as finished with its own code;
// when that cancel, or Ctrl+C's, fails too, the report says the eval may
// still be running in place of "Cancelled", `--json` adds `stillRunning`,
// and the exit stays 1 (lost) or 130 (Ctrl+C);
// the eval is sent with no name (the server names it by its id); any
// refusal of the start (not found, not permitted, a precondition, an
// invalid argument, an organization not set), from create or from the
// plugin read, exits 1, while a sign-in or connection failure passes on
// unchanged; and `eval cancel` cancels.

import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginWarningSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import type { EvalRun } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunPartialReason, EvalRunPhase } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import { StigmerError, type EvalRunInput, type Stigmer } from "@stigmer/client";
import { describe, expect, it } from "vitest";
import { CliExitError } from "../../../errors/index.js";
import type { EvalIo } from "../follow.js";
import { readEvalRunOptions, type EvalRunFlags } from "../options.js";
import { POLL_INTERVAL_MS, POLL_RETRY_BUDGET_MS, cancelEvalRun, runEvalRun } from "../run.js";
import { casesOf, finishedEval } from "./fixtures.js";

const plugin = create(PluginSchema, {
  metadata: { id: "plg_1", org: "org_acme", name: "thermos", slug: "thermos" },
  status: { evals: { dir: "evals", caseCount: 2, findings: [] } },
});

function pending(): EvalRun {
  const evalRun = finishedEval(EvalRunPhase.pending);
  casesOf(evalRun).length = 0;
  return evalRun;
}

function running(): EvalRun {
  return finishedEval(EvalRunPhase.running);
}

/** A server whose eval reads as each of `reads` in turn, then the last one forever. */
function fakeServer(
  reads: EvalRun[],
  opts: {
    createError?: Error;
    getErrorAfterCancel?: Error;
    pluginError?: Error;
    /** The eval reads that fail, counted from the first read. */
    failedReads?: ReadonlySet<number>;
    cancelError?: Error;
    /** The eval reads that never answer, counted from the first read. */
    hungReads?: ReadonlySet<number>;
    /** Called as each eval read starts, with its count from the first read. */
    onRead?: (count: number) => void;
    /** Called while create is in flight, before it answers. */
    onCreate?: () => void;
  } = {},
) {
  const calls: string[] = [];
  const created: EvalRunInput[] = [];
  let next = 0;
  let readCount = 0;
  let cancelled = false;
  const client = {
    plugin: {
      get: async (id: string) => {
        calls.push(`plugin.get ${id}`);
        if (opts.pluginError !== undefined) throw opts.pluginError;
        return plugin;
      },
      getByReference: async (ref: { org: string; slug: string }) => (calls.push(`plugin.ref ${ref.org}/${ref.slug}`), plugin),
    },
    evalrun: {
      create: async (input: EvalRunInput) => {
        calls.push("create");
        created.push(input);
        opts.onCreate?.();
        if (opts.createError !== undefined) throw opts.createError;
        return pending();
      },
      get: async () => {
        calls.push("get");
        if (cancelled && opts.getErrorAfterCancel !== undefined) throw opts.getErrorAfterCancel;
        readCount += 1;
        opts.onRead?.(readCount);
        if (opts.hungReads?.has(readCount) === true) return new Promise<never>(() => undefined);
        if (opts.failedReads?.has(readCount) === true) throw new StigmerError("unavailable", "the server is unavailable", Code.Unavailable);
        const read = reads[Math.min(next, reads.length - 1)]!;
        next += 1;
        return read;
      },
      cancel: async (id: string) => {
        calls.push(`cancel ${id}`);
        if (opts.cancelError !== undefined) throw opts.cancelError;
        cancelled = true;
        const result = finishedEval(EvalRunPhase.partial);
        result.status!.partialReason = EvalRunPartialReason.cancelled;
        return result;
      },
    },
    platform: { getServerInfo: async () => ({ singleOrg: false }) },
  } as unknown as Stigmer;
  return { client, calls, created };
}

function fakeIo(opts: { interruptAfterSleeps?: number } = {}) {
  let stdout = "";
  let stderr = "";
  const files = new Map<string, string>();
  let handler: (() => void) | undefined;
  let sleeps = 0;
  const waits: number[] = [];
  const deadlines: (() => void)[] = [];
  const io: EvalIo = {
    stdout: { write: (text) => void (stdout += text) },
    stderr: { write: (text) => void (stderr += text) },
    writeFile: async (path, content) => void files.set(path, content),
    sleep: async (ms) => {
      sleeps += 1;
      waits.push(ms);
      if (opts.interruptAfterSleeps !== undefined && sleeps >= opts.interruptAfterSleeps) handler?.();
    },
    // A call's deadline passes only when the test says so, or ends on the signal.
    timeout: (_ms, signal) =>
      new Promise<void>((resolve) => {
        deadlines.push(resolve);
        if (signal.aborted) resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
    now: () => 1_074_000,
    onInterrupt: (h) => {
      handler = h;
      return () => {
        handler = undefined;
      };
    },
    exit: (code) => {
      throw new Error(`exit ${code}`);
    },
  };
  return {
    io,
    out: () => stdout,
    err: () => stderr,
    files,
    waits,
    listening: () => handler !== undefined,
    interrupt: () => handler?.(),
    /** Passes the deadline of every call waiting on one. */
    expire: () => deadlines.splice(0).forEach((resolve) => resolve()),
  };
}

/** Runs `eval run --plugin thermos` with `flags` over `--plugin`'s default. */
function run(client: Stigmer, org: string, flags: EvalRunFlags, io: EvalIo) {
  return runEvalRun(client, org, readEvalRunOptions({ plugin: "thermos", ...flags }), io);
}

describe("runEvalRun about a plugin", () => {
  it("creates the eval in the plugin's organization with every option, follows it, and prints the report", async () => {
    const server = fakeServer([running(), finishedEval()]);
    const fake = fakeIo();
    const code = await run(server.client, "acme", { runs: "2", model: ["stigmer/claude-sonnet-4-6"], tag: ["smoke"] }, fake.io);

    expect(code).toBe(0);
    expect(server.calls).toEqual(["plugin.ref acme/thermos", "create", "get", "get"]);
    expect(server.created[0]).toMatchObject({
      name: "",
      org: "org_acme",
      pluginId: "plg_1",
      pluginDigest: "",
      runs: 2,
      caseTags: ["smoke"],
      maxCostUsd: 5,
      targets: [{ modelName: "claude-sonnet-4-6" }],
    });
    expect(fake.err()).toContain("Spending limit $5.00, the default; set --max-cost-usd to change it.");
    // Each finished try once, though two reads carried it.
    expect(fake.err().match(/first-case · stigmer\/claude-sonnet-4-6 · with · try 1\/2/g)).toHaveLength(1);
    expect(fake.out()).toContain("CASE");
    expect(fake.out()).toContain("1 case(s) · mean Δ +0.67 · 74s · $0.41");
    expect(fake.out()).toContain("needs-fixture: not run: plugins");
    expect(fake.listening()).toBe(false);
  });

  // The server relays the suite reader's findings, whose message already
  // starts with the file's path (plugin-package's evals/fields.ts).
  const loadFindings = () => [
    create(PluginWarningSchema, {
      kind: "eval-case-invalid",
      message: "evals/a/prompt.md: unknown key 'max_turn'",
      path: "evals/a/prompt.md",
    }),
    create(PluginWarningSchema, {
      kind: "eval-grader-invalid",
      message: "evals/b/graders/x.md: grader 'x': pattern is not a valid regular expression:\nUnterminated group",
      path: "evals/b/graders/x.md",
    }),
  ];

  it("prints each of the suite's load findings once, on one line, to stderr and exits 1 for them", async () => {
    const server = fakeServer([finishedEval()]);
    plugin.status!.evals!.findings = loadFindings();
    try {
      const fake = fakeIo();
      expect(await run(server.client, "acme", {}, fake.io)).toBe(1);
      const lines = fake.err().split("\n").filter((line) => line.startsWith("evals: "));
      expect(lines).toEqual([
        "evals: evals/a/prompt.md: unknown key 'max_turn'",
        "evals: evals/b/graders/x.md: grader 'x': pattern is not a valid regular expression: Unterminated group",
      ]);
    } finally {
      plugin.status!.evals!.findings = [];
    }
  });

  it("puts the load findings in the --json document, writes nothing to stderr, and exits 1 for them", async () => {
    const server = fakeServer([finishedEval()]);
    plugin.status!.evals!.findings = loadFindings();
    try {
      const fake = fakeIo();
      expect(await run(server.client, "acme", { json: true }, fake.io)).toBe(1);
      expect(fake.err()).toBe("");
      const document = JSON.parse(fake.out()) as { findings: unknown };
      expect(document.findings).toEqual([
        { kind: "eval-case-invalid", path: "evals/a/prompt.md", message: "evals/a/prompt.md: unknown key 'max_turn'" },
        {
          kind: "eval-grader-invalid",
          path: "evals/b/graders/x.md",
          message: "evals/b/graders/x.md: grader 'x': pattern is not a valid regular expression:\nUnterminated group",
        },
      ]);
    } finally {
      plugin.status!.evals!.findings = [];
    }
  });

  it("writes the load findings into the --no-wait --json document too", async () => {
    const server = fakeServer([finishedEval()]);
    plugin.status!.evals!.findings = loadFindings();
    try {
      const fake = fakeIo();
      await run(server.client, "acme", { wait: false, json: "out.json" }, fake.io);
      expect(fake.err()).toBe("");
      const document = JSON.parse(fake.files.get("out.json") ?? "{}") as { findings: { path: string }[] };
      expect(document.findings.map((f) => f.path)).toEqual(["evals/a/prompt.md", "evals/b/graders/x.md"]);
    } finally {
      plugin.status!.evals!.findings = [];
    }
  });

  it("is quiet under --json, printing only the result document", async () => {
    const server = fakeServer([finishedEval()]);
    const fake = fakeIo();
    await run(server.client, "acme", { json: true }, fake.io);
    expect(fake.err()).toBe("");
    const document = JSON.parse(fake.out()) as {
      schemaVersion: number;
      subject: unknown;
      plugins: { cases: { name: string }[] }[];
      findings: unknown[];
    };
    expect(document.schemaVersion).toBe(1);
    expect(document.subject).toEqual({ kind: "plugin", id: "plg_1", slug: "thermos" });
    expect(document.plugins[0]?.cases.map((c) => c.name)).toEqual(["first-case"]);
    expect(document.findings).toEqual([]);
  });

  it("writes the result document to a --json path and prints nothing", async () => {
    const server = fakeServer([finishedEval()]);
    const fake = fakeIo();
    await run(server.client, "acme", { json: "results.json" }, fake.io);
    expect(fake.out()).toBe("");
    expect(JSON.parse(fake.files.get("results.json") ?? "{}")).toMatchObject({ partial: false, costUsd: 0.41 });
  });

  it("prints the id and returns under --no-wait", async () => {
    const server = fakeServer([finishedEval()]);
    const fake = fakeIo();
    expect(await run(server.client, "acme", { wait: false }, fake.io)).toBe(0);
    expect(fake.out()).toBe("evr_1\n");
    expect(fake.err()).toContain("stigmer get eval-run evr_1");
    expect(server.calls).not.toContain("get");
  });

  it("writes the started eval's document under --no-wait --json, and nothing else", async () => {
    const server = fakeServer([finishedEval()]);
    const fake = fakeIo();
    expect(await run(server.client, "acme", { wait: false, json: true }, fake.io)).toBe(0);
    expect(fake.err()).toBe("");
    expect(JSON.parse(fake.out())).toMatchObject({ schemaVersion: 1, plugins: [{ cases: [] }] });
    expect(server.calls).not.toContain("get");
  });

  it("cancels the eval on Ctrl+C, prints the partial results and exits 130", async () => {
    const server = fakeServer([running()]);
    const fake = fakeIo({ interruptAfterSleeps: 2 });
    const code = await run(server.client, "acme", { json: "out.json" }, fake.io);
    expect(code).toBe(130);
    expect(server.calls).toContain("cancel evr_1");
    expect(JSON.parse(fake.files.get("out.json") ?? "{}")).toMatchObject({ partial: true, partialReason: "interrupted" });
  });

  it("prints the cancel's own result when the read after it fails, with why the eval stopped", async () => {
    const server = fakeServer([running()], { getErrorAfterCancel: new Error("connection reset") });
    const fake = fakeIo({ interruptAfterSleeps: 2 });
    expect(await run(server.client, "acme", {}, fake.io)).toBe(130);
    expect(server.calls.slice(-2)).toEqual(["cancel evr_1", "get"]);
    expect(fake.err()).toContain("Cancelling evr_1…");
    expect(fake.out()).toContain("1 case(s) · mean Δ +0.67");
    expect(fake.out()).toContain("\nCancelled: 3 of 4 tries ran.\n");
  });

  it("exits at once on a second Ctrl+C, saying how to cancel the eval", async () => {
    const server = fakeServer([running()]);
    const fake = fakeIo();
    let handler: (() => void) | undefined;
    const io: EvalIo = {
      ...fake.io,
      onInterrupt: (h) => ((handler = h), () => undefined),
      sleep: async () => {
        handler?.();
        handler?.();
      },
    };
    await expect(run(server.client, "acme", {}, io)).rejects.toThrow("exit 130");
    expect(fake.err()).toContain("Stopped following evr_1; if it is still running, cancel it with: stigmer eval cancel evr_1\n");
  });

  it("cancels the eval once create answers on a Ctrl+C during create, prints its id and exits 130", async () => {
    const fake = fakeIo();
    const server = fakeServer([running()], { onCreate: () => fake.interrupt() });
    expect(await run(server.client, "acme", {}, fake.io)).toBe(130);
    expect(server.calls).toEqual(["plugin.ref acme/thermos", "create", "cancel evr_1", "get"]);
    expect(fake.err()).toContain("Started evr_1 on thermos.\n");
    expect(fake.err()).toContain("Cancelling evr_1…");
    expect(fake.out()).toContain("\nCancelled: 3 of 4 tries ran.\n");
    expect(fake.listening()).toBe(false);
  });

  it("cancels on a Ctrl+C during create under --no-wait too", async () => {
    const fake = fakeIo();
    const server = fakeServer([running()], { onCreate: () => fake.interrupt() });
    expect(await run(server.client, "acme", { wait: false, json: "out.json" }, fake.io)).toBe(130);
    expect(server.calls).toContain("cancel evr_1");
    expect(JSON.parse(fake.files.get("out.json") ?? "{}")).toMatchObject({ evalRunId: "evr_1", partial: true, partialReason: "interrupted" });
  });

  it("exits at once on a second Ctrl+C during create, before the eval's id is known", async () => {
    const fake = fakeIo();
    const server = fakeServer([running()], {
      onCreate: () => {
        fake.interrupt();
        fake.interrupt();
      },
    });
    await expect(run(server.client, "acme", {}, fake.io)).rejects.toThrow("exit 130");
    expect(fake.err()).toContain("Stopped before the server answered the start; if the eval run started, cancel it from the plugin's Evals tab in the console\n");
  });

  it("stops listening for Ctrl+C when create fails", async () => {
    const fake = fakeIo();
    const server = fakeServer([running()], { createError: new Error("boom") });
    await expect(run(server.client, "acme", {}, fake.io)).rejects.toThrow("boom");
    expect(fake.listening()).toBe(false);
  });

  it("sends the cancel on Ctrl+C while a read hangs, and exits 130", async () => {
    const fake = fakeIo();
    const server = fakeServer([running()], { hungReads: new Set([1]), onRead: (count) => count === 1 && fake.interrupt() });
    expect(await run(server.client, "acme", {}, fake.io)).toBe(130);
    expect(server.calls.slice(-3)).toEqual(["get", "cancel evr_1", "get"]);
    expect(fake.err()).toContain("Cancelling evr_1…");
    expect(fake.err()).not.toContain("Could not read");
    expect(fake.out()).toContain("\nCancelled: 3 of 4 tries ran.\n");
  });

  it("treats a read with no answer in 30 seconds as a failed read, tried again", async () => {
    const fake = fakeIo();
    const server = fakeServer([running(), finishedEval()], { hungReads: new Set([1]), onRead: (count) => count === 1 && setTimeout(fake.expire, 0) });
    expect(await run(server.client, "acme", {}, fake.io)).toBe(0);
    expect(fake.err()).toContain("Could not read evr_1 (no answer in 30s); trying again in 1s.");
    expect(fake.waits).toEqual([POLL_INTERVAL_MS, 1_000, POLL_INTERVAL_MS]);
  });

  it("says the eval may still be running when Ctrl+C's cancel has no answer in 30 seconds", async () => {
    const fake = fakeIo();
    const server = fakeServer([running()], { onRead: (count) => count === 1 && fake.interrupt() });
    const hungCancel = { ...server.client.evalrun, cancel: () => (setTimeout(fake.expire, 0), new Promise<never>(() => undefined)) };
    const client = { ...server.client, evalrun: hungCancel } as unknown as Stigmer;
    const error = await run(client, "acme", {}, fake.io).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(130);
    expect((error as CliExitError).message).toBe("could not cancel eval run evr_1 (no answer in 30s); cancel it with: stigmer eval cancel evr_1");
  });

  it("reports an eval that finished as Ctrl+C landed normally, with its own exit code", async () => {
    const fake = fakeIo();
    const server = fakeServer([finishedEval()], { onRead: (count) => count === 1 && fake.interrupt() });
    expect(await run(server.client, "acme", { json: "out.json" }, fake.io)).toBe(0);
    expect(server.calls).not.toContain("cancel evr_1");
    expect(JSON.parse(fake.files.get("out.json") ?? "{}")).toMatchObject({ partial: false });
  });

  it("reports an eval the cancel found already finished normally, not as cancelled", async () => {
    const server = fakeServer([running(), finishedEval()]);
    const fake = fakeIo({ interruptAfterSleeps: 2 });
    expect(await run(server.client, "acme", {}, fake.io)).toBe(0);
    expect(server.calls).toContain("cancel evr_1");
    expect(fake.out()).not.toContain("Cancelled");
    expect(fake.out()).toContain("1 case(s) · mean Δ +0.67");
  });

  it("exits 1, not the usage code, when the server refuses to start the suite", async () => {
    const refusal = new StigmerError("failed-precondition", "the plugin has no evals/ cases", Code.FailedPrecondition);
    const server = fakeServer([], { createError: refusal });
    const error = await run(server.client, "acme", {}, fakeIo().io).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect((error as CliExitError).message).toContain("the plugin has no evals/ cases");
  });

  it("exits 1, not the usage code, when the organization is not set", async () => {
    const server = fakeServer([finishedEval()]);
    const error = await run(server.client, "", {}, fakeIo().io).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect((error as CliExitError).message).toContain("organization not set");
    expect(server.calls).not.toContain("create");
  });

  it.each([
    ["not-found", Code.NotFound],
    ["permission-denied", Code.PermissionDenied],
    ["failed-precondition", Code.FailedPrecondition],
    ["invalid-argument", Code.InvalidArgument],
    ["already-exists", Code.AlreadyExists],
  ] as const)("exits 1 when the server refuses the eval's start as %s", async (name, code) => {
    const server = fakeServer([], { createError: new StigmerError(name, "the start was refused", code) });
    const error = await run(server.client, "acme", {}, fakeIo().io).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect((error as CliExitError).message).toContain("the start was refused");
  });

  it.each([
    ["not-found", Code.NotFound],
    ["permission-denied", Code.PermissionDenied],
  ] as const)("exits 1 when the plugin lookup is refused as %s", async (name, code) => {
    const server = fakeServer([finishedEval()], { pluginError: new StigmerError(name, "no such plugin", code) });
    const error = await run(server.client, "acme", { plugin: "plg_1" }, fakeIo().io).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect((error as CliExitError).message).toContain("no such plugin");
    expect(server.calls).not.toContain("create");
  });

  it("passes on a sign-in failure of the eval's start unchanged, for the CLI's own sign-in exit", async () => {
    const unauthenticated = new StigmerError("unauthenticated", "the token expired", Code.Unauthenticated);
    const server = fakeServer([], { createError: unauthenticated });
    await expect(run(server.client, "acme", {}, fakeIo().io)).rejects.toBe(unauthenticated);
  });

  it("exits 1, not the usage code, when the plugin read is refused as invalid", async () => {
    const refusal = new StigmerError("invalid-argument", "id is not a plugin id", Code.InvalidArgument);
    const server = fakeServer([finishedEval()], { pluginError: refusal });
    const error = await run(server.client, "acme", { plugin: "plg_1" }, fakeIo().io).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect((error as CliExitError).message).toContain("id is not a plugin id");
  });

  it("retries a failed read of the eval with backoff and follows it to the end", async () => {
    const server = fakeServer([running(), finishedEval()], { failedReads: new Set([1, 2]) });
    const fake = fakeIo();
    expect(await run(server.client, "acme", {}, fake.io)).toBe(0);
    expect(fake.waits).toEqual([POLL_INTERVAL_MS, 1_000, 2_000, POLL_INTERVAL_MS]);
    expect(server.calls).not.toContain("cancel evr_1");
    expect(fake.out()).toContain("1 case(s) · mean Δ +0.67");
  });

  it("cancels on a Ctrl+C during a retry's wait and exits 130", async () => {
    const server = fakeServer([running()], { failedReads: new Set([1]) });
    const fake = fakeIo({ interruptAfterSleeps: 2 });
    expect(await run(server.client, "acme", {}, fake.io)).toBe(130);
    expect(fake.waits).toEqual([POLL_INTERVAL_MS, 1_000]);
    expect(server.calls.slice(-2)).toEqual(["cancel evr_1", "get"]);
  });

  it("cancels the eval, writes --json with what it has and exits 1 once reads have failed for about a minute", async () => {
    const reads = new Set(Array.from({ length: 20 }, (_, i) => i + 2));
    const server = fakeServer([running()], { failedReads: reads });
    const fake = fakeIo();
    const error = await run(server.client, "acme", { json: "out.json" }, fake.io).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect((error as CliExitError).message).toBe(
      "lost track of eval run evr_1 (Cannot connect to the Stigmer server), so it was cancelled",
    );
    const retries = fake.waits.slice(2);
    expect(retries.reduce((sum, ms) => sum + ms, 0)).toBe(POLL_RETRY_BUDGET_MS);
    expect(server.calls).toContain("cancel evr_1");
    expect(JSON.parse(fake.files.get("out.json") ?? "{}")).toMatchObject({ partial: true, partialReason: "interrupted" });
    expect(fake.out()).toBe("");
  });

  it("reports an eval the lost-track cancel found already finished normally, with its own exit code", async () => {
    // Seven waits between failed reads, so reads 2 to 9 fail and the read after the cancel is the tenth.
    const reads = new Set(Array.from({ length: 8 }, (_, i) => i + 2));
    const server = fakeServer([running(), finishedEval()], { failedReads: reads });
    const fake = fakeIo();
    expect(await run(server.client, "acme", { json: "out.json" }, fake.io)).toBe(0);
    expect(server.calls.slice(-2)).toEqual(["cancel evr_1", "get"]);
    expect(JSON.parse(fake.files.get("out.json") ?? "{}")).toMatchObject({ partial: false });
    expect(JSON.parse(fake.files.get("out.json") ?? "{}")).not.toHaveProperty("stillRunning");
  });

  it("prints what it has and says the cancel failed too, when the server stays unreachable", async () => {
    const reads = new Set(Array.from({ length: 20 }, (_, i) => i + 1));
    const server = fakeServer([running()], { failedReads: reads, cancelError: new Error("connection refused") });
    const fake = fakeIo();
    const error = await run(server.client, "acme", {}, fake.io).catch((e: unknown) => e);
    expect((error as CliExitError).exitCode).toBe(1);
    expect((error as CliExitError).message).toBe(
      "lost track of eval run evr_1 (Cannot connect to the Stigmer server), and could not cancel it; cancel it with: stigmer eval cancel evr_1",
    );
    expect(fake.err()).toContain("Could not read evr_1 (Cannot connect to the Stigmer server); trying again in 1s.\n");
    expect(fake.out()).toContain("1 case(s) · mean Δ +0.67");
    expect(fake.out()).toContain(
      "\nLost track of the eval run; it may still be running: cancel it with `stigmer eval cancel evr_1`\n",
    );
    expect(fake.out()).not.toContain("Cancelled:");
  });

  it("writes --json with partial, interrupted and stillRunning when reads were lost and the cancel failed", async () => {
    const reads = new Set(Array.from({ length: 20 }, (_, i) => i + 1));
    const server = fakeServer([running()], { failedReads: reads, cancelError: new Error("connection refused") });
    const fake = fakeIo();
    const error = await run(server.client, "acme", { json: "out.json" }, fake.io).catch(
      (e: unknown) => e,
    );
    expect((error as CliExitError).exitCode).toBe(1);
    expect(JSON.parse(fake.files.get("out.json") ?? "{}")).toMatchObject({
      partial: true,
      partialReason: "interrupted",
      stillRunning: true,
    });
    expect(fake.out()).toBe("");
  });

  it("leaves stillRunning out of the --json document when the cancel went through", async () => {
    const server = fakeServer([running()]);
    const fake = fakeIo({ interruptAfterSleeps: 2 });
    await run(server.client, "acme", { json: "out.json" }, fake.io);
    expect(JSON.parse(fake.files.get("out.json") ?? "{}")).not.toHaveProperty("stillRunning");
  });

  it("prints what it has, says how to cancel, and exits 130 when Ctrl+C's cancel cannot reach the server", async () => {
    const outage = new StigmerError("unavailable", "the server is unavailable", Code.Unavailable);
    const server = fakeServer([running()], { cancelError: outage });
    const fake = fakeIo({ interruptAfterSleeps: 2 });
    const error = await run(server.client, "acme", {}, fake.io).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(130);
    expect((error as CliExitError).message).toBe(
      "could not cancel eval run evr_1 (Cannot connect to the Stigmer server); cancel it with: stigmer eval cancel evr_1",
    );
    expect(fake.out()).toContain("1 case(s) · mean Δ +0.67");
    expect(fake.out()).toContain(
      "\nCould not cancel the eval run; it may still be running: cancel it with `stigmer eval cancel evr_1`\n",
    );
    expect(fake.out()).not.toContain("Cancelled:");
    expect(fake.listening()).toBe(false);
  });

  it("writes --json with stillRunning and exits 130 when Ctrl+C's cancel cannot reach the server", async () => {
    const server = fakeServer([running()], { cancelError: new Error("connection refused") });
    const fake = fakeIo({ interruptAfterSleeps: 2 });
    const error = await run(server.client, "acme", { json: true }, fake.io).catch(
      (e: unknown) => e,
    );
    expect((error as CliExitError).exitCode).toBe(130);
    expect((error as CliExitError).message).toBe(
      "could not cancel eval run evr_1 (connection refused); cancel it with: stigmer eval cancel evr_1",
    );
    expect(fake.err()).toBe("");
    expect(JSON.parse(fake.out())).toMatchObject({ partial: true, partialReason: "interrupted", stillRunning: true });
  });

  it("passes on a create failure that is not a refusal of the suite, unchanged", async () => {
    const outage = new StigmerError("unavailable", "the server is unavailable", Code.Unavailable);
    const server = fakeServer([], { createError: outage });
    await expect(run(server.client, "acme", {}, fakeIo().io)).rejects.toBe(outage);
  });

  it("fails with the eval's own reason when it could not run", async () => {
    const failed = finishedEval(EvalRunPhase.failed);
    failed.status!.error = "the plugin archive could not be read";
    const server = fakeServer([failed]);
    await expect(run(server.client, "acme", {}, fakeIo().io)).rejects.toThrow(
      "the eval run could not run: the plugin archive could not be read",
    );
  });

  it("reads a plugin given by id and passes its version", async () => {
    const server = fakeServer([finishedEval()]);
    const digest = "b".repeat(64);
    await run(server.client, "acme", { plugin: `plg_1@${digest}` }, fakeIo().io);
    expect(server.calls[0]).toBe("plugin.get plg_1");
    expect(server.created[0]?.pluginDigest).toBe(digest);
  });
});

describe("cancelEvalRun", () => {
  it("cancels by id and says how far the eval got", async () => {
    const server = fakeServer([]);
    const result = await cancelEvalRun(server.client, "evr_1");
    expect(server.calls).toEqual(["cancel evr_1"]);
    expect(result.message).toBe("Cancelled evr_1: tries in flight stop; 3 of 4 tries had finished.");
    expect(result.data).toEqual({ evalRunId: "evr_1", triesFinished: 3, triesTotal: 4 });
  });
});
