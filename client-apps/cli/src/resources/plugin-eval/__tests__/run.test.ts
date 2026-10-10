// Pins the `plugin eval` dispatch against a fake server and fake effects:
// the plugin is resolved by name and the eval created in its organization
// with every option; the suite's load findings and the filled spending limit
// go to stderr; each finished try prints once while the command follows the
// eval; the table and summary go to stdout; `--json` is quiet and writes the
// result document to stdout or its path; `--no-wait` prints the id and
// returns (under `--json`, with the started eval's document); Ctrl+C cancels
// the eval and exits 130 with the partial results and why it stopped, the
// cancel's own answer standing when the read after it fails; a read that
// fails is retried with backoff, and past about a minute the eval is
// cancelled, `--json` written with what the command had, and the exit is 1;
// the eval is sent with no name (the server names it by its id); a create
// refused as a usage error, an organization not set, or a plugin read
// refused as invalid exits 1, any other create failure passes on unchanged;
// and `plugin eval cancel` cancels.

import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginWarningSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalPartialReason, PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { StigmerError, type PluginEvalInput, type Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import { CliExitError } from "../../../errors/index.js";
import { readPluginEvalOptions, type PluginEvalFlags } from "../options.js";
import { POLL_INTERVAL_MS, POLL_RETRY_BUDGET_MS, cancelPluginEval, runPluginEval, type PluginEvalIo } from "../run.js";
import { finishedEval } from "./fixtures.js";

const plugin = create(PluginSchema, {
  metadata: { id: "plg_1", org: "org_acme", name: "thermos", slug: "thermos" },
  status: { evals: { dir: "evals", caseCount: 2, findings: [] } },
});

function pending(): PluginEval {
  const pluginEval = finishedEval(PluginEvalPhase.pending);
  pluginEval.status!.cases = [];
  return pluginEval;
}

function running(): PluginEval {
  return finishedEval(PluginEvalPhase.running);
}

/** A server whose eval reads as each of `reads` in turn, then the last one forever. */
function fakeServer(
  reads: PluginEval[],
  opts: {
    createError?: Error;
    getErrorAfterCancel?: Error;
    pluginError?: Error;
    /** The eval reads that fail, counted from the first read. */
    failedReads?: ReadonlySet<number>;
    cancelError?: Error;
  } = {},
) {
  const calls: string[] = [];
  const created: PluginEvalInput[] = [];
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
    plugineval: {
      create: async (input: PluginEvalInput) => {
        calls.push("create");
        created.push(input);
        if (opts.createError !== undefined) throw opts.createError;
        return pending();
      },
      get: async () => {
        calls.push("get");
        if (cancelled && opts.getErrorAfterCancel !== undefined) throw opts.getErrorAfterCancel;
        readCount += 1;
        if (opts.failedReads?.has(readCount) === true) throw new StigmerError("unavailable", "the server is unavailable", Code.Unavailable);
        const read = reads[Math.min(next, reads.length - 1)]!;
        next += 1;
        return read;
      },
      cancel: async (id: string) => {
        calls.push(`cancel ${id}`);
        if (opts.cancelError !== undefined) throw opts.cancelError;
        cancelled = true;
        const result = finishedEval(PluginEvalPhase.partial);
        result.status!.partialReason = PluginEvalPartialReason.cancelled;
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
  const io: PluginEvalIo = {
    stdout: { write: (text) => void (stdout += text) },
    stderr: { write: (text) => void (stderr += text) },
    writeFile: async (path, content) => void files.set(path, content),
    sleep: async (ms) => {
      sleeps += 1;
      waits.push(ms);
      if (opts.interruptAfterSleeps !== undefined && sleeps >= opts.interruptAfterSleeps) handler?.();
    },
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
  return { io, out: () => stdout, err: () => stderr, files, waits, listening: () => handler !== undefined };
}

function options(flags: PluginEvalFlags = {}) {
  return readPluginEvalOptions(flags);
}

const THERMOS = { ref: "thermos", digest: "" };

describe("runPluginEval", () => {
  it("creates the eval in the plugin's organization with every option, follows it, and prints the report", async () => {
    const server = fakeServer([running(), finishedEval()]);
    const fake = fakeIo();
    const code = await runPluginEval(server.client, "acme", THERMOS, options({ runs: "2", model: ["native/claude-sonnet-4-6"], tag: ["smoke"] }), fake.io);

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
    expect(fake.err().match(/first-case · native\/claude-sonnet-4-6 · with · try 1\/2/g)).toHaveLength(1);
    expect(fake.out()).toContain("CASE");
    expect(fake.out()).toContain("1 case(s) · mean Δ +0.67 · 74s · $0.41 · Δ provisional");
    expect(fake.out()).toContain("needs-fixture: not run: context.scaffold_script");
    expect(fake.listening()).toBe(false);
  });

  it("prints the suite's load findings to stderr and exits 1 for them", async () => {
    const server = fakeServer([finishedEval()]);
    plugin.status!.evals!.findings = [
      create(PluginWarningSchema, { kind: "eval-case-invalid", message: "unknown key 'max_turn'", path: "evals/a/prompt.md" }),
    ];
    try {
      const fake = fakeIo();
      expect(await runPluginEval(server.client, "acme", THERMOS, options(), fake.io)).toBe(1);
      expect(fake.err()).toContain("evals: evals/a/prompt.md: unknown key 'max_turn'");
    } finally {
      plugin.status!.evals!.findings = [];
    }
  });

  it("is quiet under --json, printing only the result document", async () => {
    const server = fakeServer([finishedEval()]);
    const fake = fakeIo();
    await runPluginEval(server.client, "acme", THERMOS, options({ json: true }), fake.io);
    expect(fake.err()).toBe("");
    const document = JSON.parse(fake.out()) as { schemaVersion: number; cases: { name: string }[] };
    expect(document.schemaVersion).toBe(1);
    expect(document.cases.map((c) => c.name)).toEqual(["first-case"]);
  });

  it("writes the result document to a --json path and prints nothing", async () => {
    const server = fakeServer([finishedEval()]);
    const fake = fakeIo();
    await runPluginEval(server.client, "acme", THERMOS, options({ json: "results.json" }), fake.io);
    expect(fake.out()).toBe("");
    expect(JSON.parse(fake.files.get("results.json") ?? "{}")).toMatchObject({ partial: false, costUsd: 0.41 });
  });

  it("prints the id and returns under --no-wait", async () => {
    const server = fakeServer([finishedEval()]);
    const fake = fakeIo();
    expect(await runPluginEval(server.client, "acme", THERMOS, options({ wait: false }), fake.io)).toBe(0);
    expect(fake.out()).toBe("pev_1\n");
    expect(fake.err()).toContain("stigmer get plugin-eval pev_1");
    expect(server.calls).not.toContain("get");
  });

  it("writes the started eval's document under --no-wait --json, and nothing else", async () => {
    const server = fakeServer([finishedEval()]);
    const fake = fakeIo();
    expect(await runPluginEval(server.client, "acme", THERMOS, options({ wait: false, json: true }), fake.io)).toBe(0);
    expect(fake.err()).toBe("");
    expect(JSON.parse(fake.out())).toMatchObject({ schemaVersion: 1, cases: [] });
    expect(server.calls).not.toContain("get");
  });

  it("cancels the eval on Ctrl+C, prints the partial results and exits 130", async () => {
    const server = fakeServer([running()]);
    const fake = fakeIo({ interruptAfterSleeps: 2 });
    const code = await runPluginEval(server.client, "acme", THERMOS, options({ json: "out.json" }), fake.io);
    expect(code).toBe(130);
    expect(server.calls).toContain("cancel pev_1");
    expect(JSON.parse(fake.files.get("out.json") ?? "{}")).toMatchObject({ partial: true, partialReason: "interrupted" });
  });

  it("prints the cancel's own result when the read after it fails, with why the eval stopped", async () => {
    const server = fakeServer([running()], { getErrorAfterCancel: new Error("connection reset") });
    const fake = fakeIo({ interruptAfterSleeps: 2 });
    expect(await runPluginEval(server.client, "acme", THERMOS, options(), fake.io)).toBe(130);
    expect(server.calls.slice(-2)).toEqual(["cancel pev_1", "get"]);
    expect(fake.err()).toContain("Cancelling pev_1…");
    expect(fake.out()).toContain("1 case(s) · mean Δ +0.67");
    expect(fake.out()).toContain("\nCancelled: 3 of 4 tries ran.\n");
  });

  it("exits at once on a second Ctrl+C", async () => {
    const server = fakeServer([running()]);
    const fake = fakeIo();
    let handler: (() => void) | undefined;
    const io: PluginEvalIo = {
      ...fake.io,
      onInterrupt: (h) => ((handler = h), () => undefined),
      sleep: async () => {
        handler?.();
        handler?.();
      },
    };
    await expect(runPluginEval(server.client, "acme", THERMOS, options(), io)).rejects.toThrow("exit 130");
  });

  it("exits 1, not the usage code, when the server refuses to start the suite", async () => {
    const refusal = new StigmerError("failed-precondition", "the plugin has no evals/ cases", Code.FailedPrecondition);
    const server = fakeServer([], { createError: refusal });
    const error = await runPluginEval(server.client, "acme", THERMOS, options(), fakeIo().io).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect((error as CliExitError).message).toContain("the plugin has no evals/ cases");
  });

  it("exits 1, not the usage code, when the organization is not set", async () => {
    const server = fakeServer([finishedEval()]);
    const error = await runPluginEval(server.client, "", THERMOS, options(), fakeIo().io).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect((error as CliExitError).message).toContain("organization not set");
    expect(server.calls).not.toContain("create");
  });

  it("exits 1, not the usage code, when the plugin read is refused as invalid", async () => {
    const refusal = new StigmerError("invalid-argument", "id is not a plugin id", Code.InvalidArgument);
    const server = fakeServer([finishedEval()], { pluginError: refusal });
    const error = await runPluginEval(server.client, "acme", { ref: "plg_1", digest: "" }, options(), fakeIo().io).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect((error as CliExitError).message).toContain("id is not a plugin id");
  });

  it("retries a failed read of the eval with backoff and follows it to the end", async () => {
    const server = fakeServer([running(), finishedEval()], { failedReads: new Set([1, 2]) });
    const fake = fakeIo();
    expect(await runPluginEval(server.client, "acme", THERMOS, options(), fake.io)).toBe(0);
    expect(fake.waits).toEqual([POLL_INTERVAL_MS, 1_000, 2_000, POLL_INTERVAL_MS]);
    expect(server.calls).not.toContain("cancel pev_1");
    expect(fake.out()).toContain("1 case(s) · mean Δ +0.67");
  });

  it("cancels the eval, writes --json with what it has and exits 1 once reads have failed for about a minute", async () => {
    const reads = new Set(Array.from({ length: 20 }, (_, i) => i + 2));
    const server = fakeServer([running()], { failedReads: reads });
    const fake = fakeIo();
    const error = await runPluginEval(server.client, "acme", THERMOS, options({ json: "out.json" }), fake.io).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect((error as CliExitError).message).toBe(
      "lost track of eval pev_1 (Cannot connect to the Stigmer server), so it was cancelled",
    );
    const retries = fake.waits.slice(2);
    expect(retries.reduce((sum, ms) => sum + ms, 0)).toBe(POLL_RETRY_BUDGET_MS);
    expect(server.calls).toContain("cancel pev_1");
    expect(JSON.parse(fake.files.get("out.json") ?? "{}")).toMatchObject({ partial: true, partialReason: "interrupted" });
    expect(fake.out()).toBe("");
  });

  it("prints what it has and says the cancel failed too, when the server stays unreachable", async () => {
    const reads = new Set(Array.from({ length: 20 }, (_, i) => i + 1));
    const server = fakeServer([running()], { failedReads: reads, cancelError: new Error("connection refused") });
    const fake = fakeIo();
    const error = await runPluginEval(server.client, "acme", THERMOS, options(), fake.io).catch((e: unknown) => e);
    expect((error as CliExitError).exitCode).toBe(1);
    expect((error as CliExitError).message).toBe(
      "lost track of eval pev_1 (Cannot connect to the Stigmer server), and could not cancel it; cancel it with: stigmer plugin eval cancel pev_1",
    );
    expect(fake.err()).toContain("Could not read pev_1 (Cannot connect to the Stigmer server); trying again in 1s.\n");
    expect(fake.out()).toContain("\nCancelled: 3 of 4 tries ran.\n");
  });

  it("passes on a create failure that is not a refusal of the suite, unchanged", async () => {
    const outage = new StigmerError("unavailable", "the server is unavailable", Code.Unavailable);
    const server = fakeServer([], { createError: outage });
    await expect(runPluginEval(server.client, "acme", THERMOS, options(), fakeIo().io)).rejects.toBe(outage);
  });

  it("fails with the eval's own reason when it could not run", async () => {
    const failed = finishedEval(PluginEvalPhase.failed);
    failed.status!.error = "the plugin archive could not be read";
    const server = fakeServer([failed]);
    await expect(runPluginEval(server.client, "acme", THERMOS, options(), fakeIo().io)).rejects.toThrow(
      "the eval could not run: the plugin archive could not be read",
    );
  });

  it("reads a plugin given by id and passes its version", async () => {
    const server = fakeServer([finishedEval()]);
    const digest = "b".repeat(64);
    await runPluginEval(server.client, "acme", { ref: "plg_1", digest }, options(), fakeIo().io);
    expect(server.calls[0]).toBe("plugin.get plg_1");
    expect(server.created[0]?.pluginDigest).toBe(digest);
  });
});

describe("cancelPluginEval", () => {
  it("cancels by id and says how far the eval got", async () => {
    const server = fakeServer([]);
    let stderr = "";
    await cancelPluginEval(server.client, "pev_1", { stderr: { write: (text) => void (stderr += text) } });
    expect(server.calls).toEqual(["cancel pev_1"]);
    expect(stderr).toBe("Cancelled pev_1: tries in flight stop; 3 of 4 tries had finished.\n");
  });
});
