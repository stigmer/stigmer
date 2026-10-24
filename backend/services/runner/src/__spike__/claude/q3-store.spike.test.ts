/*
 * Spike probe: does a waiting session survive the machine it started
 * on? The engine writes its transcript to its config directory first and
 * mirrors it to a `sessionStore`; a resume loads from the store. The probes
 * delete the first process's config directory whole before resuming, so the
 * resume has nothing local to read.
 *
 *  (1) a deferred Bash call, resumed from the store alone, under both flush modes;
 *      and once from a different working directory (what `projectKey` does);
 *  (2) a sub-agent's deferred call, restored through `listSubkeys`;
 *  (3) a store whose `append` rejects: the `mirror_error` and what the turn does;
 *  (4) the engine killed with SIGKILL mid-turn: the local copy against the store;
 *  (5) transcript bytes per turn, from (1) and (2);
 *  (6) a caller-chosen session id derived from a Stigmer session id, resumed twice.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SDKMessage, SessionStoreFlush } from "@anthropic-ai/claude-agent-sdk";
import {
  anthropicText,
  anthropicToolUses,
  baseOptions,
  runResume,
  freshDirs,
  gateHooks,
  recordingCanUseTool,
  resultSummary,
  runQuery,
  spikeEnv,
  startSpikeMock,
  toolId,
  trackedSpawn,
  writeEvidence,
  type HookSeen,
  type SpikeDirs,
} from "./harness.js";
import { FileSessionStore, filesUnder } from "./file-store.js";
import { agentToolName, oneCall, resultFor, scenarios } from "./scripts.js";

const TIMEOUT = 240_000;

/** A fresh config directory for the resuming process: the machine it started on is gone. */
function newMachine(dirs: SpikeDirs, n: number): SpikeDirs {
  rmSync(dirs.config, { recursive: true, force: true });
  rmSync(dirs.home, { recursive: true, force: true });
  const next = { ...dirs, config: join(dirs.root, `config-${n}`), home: join(dirs.root, `home-${n}`) };
  mkdirSync(next.config, { recursive: true });
  mkdirSync(next.home, { recursive: true });
  return next;
}

function withDirs(dirs: SpikeDirs, mockUrl: string): { cwd: string; env: Record<string, string> } {
  return { cwd: dirs.cwd, env: spikeEnv({ mockUrl, dirs }) };
}

/** RFC 4122 version 5 (SHA-1, name-based) UUID. */
function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const mirrorErrors = (messages: readonly SDKMessage[]): unknown[] =>
  messages.filter((m) => m.type === "system" && (m as { subtype?: string }).subtype === "mirror_error");

describe("q3 (1): a deferred call resumed from the store alone", () => {
  for (const flush of ["batched", "eager"] as const satisfies readonly SessionStoreFlush[]) {
    for (const cwdMoves of [false, true]) {
      if (cwdMoves && flush === "eager") continue;
      it(`flush ${flush}${cwdMoves ? ", resumed from another working directory" : ""}`, async () => {
        const label = `q3-1-${flush}${cwdMoves ? "-cwdmoves" : ""}`;
        const dirs = freshDirs(label);
        const store = new FileSessionStore(join(dirs.root, "store"));
        const proof = join(dirs.cwd, "proof.txt");
        const id = toolId(`q3_1_${flush}_${cwdMoves ? 1 : 0}`);
        const marker = `Q3-1-${flush.toUpperCase()}${cwdMoves ? "-MOVES" : ""}`;
        const mock = await startSpikeMock(label, scenarios([oneCall(marker, { toolCallId: id, toolName: "Bash", toolInput: { command: `echo from-store > ${proof}`, description: "write" } }, `${marker} done`)]));
        try {
          const turn1 = await runQuery(`${label}.turn1`, `${marker} write the proof`, {
            ...baseOptions(dirs, mock.url),
            sessionStore: store,
            sessionStoreFlush: flush,
            hooks: gateHooks(`${label}.turn1`, (i) => (i.tool_name === "Bash" ? { decision: "defer" } : { decision: "pass" }), []),
            canUseTool: recordingCanUseTool(`${label}.turn1`, [], () => ({ allow: false, message: "turn one never approves" })),
          });
          const localAfter1 = filesUnder(dirs.config);
          const storeAfter1 = store.inventory();
          const machine2 = newMachine(dirs, 2);
          const resumeDirs = cwdMoves ? { ...machine2, cwd: join(dirs.root, "elsewhere") } : machine2;
          mkdirSync(resumeDirs.cwd, { recursive: true });
          const hooks2: HookSeen[] = [];
          const turn2 = await runResume(`${label}.turn2`, {
            ...baseOptions(resumeDirs, mock.url),
            ...withDirs(resumeDirs, mock.url),
            resume: turn1.sessionId,
            sessionStore: store,
            sessionStoreFlush: flush,
            hooks: gateHooks(`${label}.turn2`, (i) => (i.tool_name === "Bash" ? { decision: "allow" } : { decision: "pass" }), hooks2),
            canUseTool: recordingCanUseTool(`${label}.turn2`, [], () => ({ allow: true })),
          });
          const facts = {
            flush,
            cwdMoves,
            turn1: resultSummary(turn1),
            localAfter1,
            storeAfter1,
            turn2: { ...resultSummary(turn2), hooks: hooks2, mirrorErrors: mirrorErrors(turn2.messages) },
            proof: existsSync(proof) ? readFileSync(proof, "utf8").trim() : null,
            storeAfter2: store.inventory(),
            storeCalls: store.calls,
          };
          writeEvidence(`${label}.facts.json`, facts);
          expect.soft(facts.turn1.terminalReason).toBe("tool_deferred");
          if (!cwdMoves) {
            // The re-fired hook misses about one resume in twelve (the batch probe);
            // `canUseTool` then decides. What the store must give back is the
            // waiting call itself, and the approved call running is the proof.
            expect.soft(facts.proof, "the resume from the store runs the approved call").toBe("from-store");
          }
        } finally {
          await mock.close();
        }
      }, TIMEOUT);
    }
  }
});

describe("q3 (2): a session with a sub-agent's transcript, restored through listSubkeys", () => {
  // A defer inside a sub-agent is lost (the sub-agent defer probe), so the sub-agent
  // here finishes in the foreground and the PARENT's next call defers: the
  // resume must restore the sub-agent's transcript from the store too.
  it("resumes from the store alone after a sub-agent ran", async () => {
    const AGENT = toolId("q3sub_agent");
    const BASH = toolId("q3sub_bash");
    const dirs = freshDirs("q3-2");
    const store = new FileSessionStore(join(dirs.root, "store"));
    const proof = join(dirs.cwd, "proof-sub.txt");
    const mock = await startSpikeMock(
      "q3-2",
      scenarios([
        {
          marker: "Q3SUB-PARENT",
          answer: (c) => {
            if (resultFor(c, BASH) !== undefined) return anthropicText("Q3SUB parent done");
            if (resultFor(c, AGENT) !== undefined) return anthropicToolUses([{ toolCallId: BASH, toolName: "Bash", toolInput: { command: `echo after-sub-agent > ${proof}`, description: "write" } }]);
            if (!c.issuedToolUseIds.has(AGENT)) {
              return anthropicToolUses([{ toolCallId: AGENT, toolName: agentToolName(c), toolInput: { description: "child", prompt: "Q3SUB-CHILD answer in one word", subagent_type: "general-purpose", run_in_background: false } }]);
            }
            return anthropicText(`Q3SUB unexpected: ${JSON.stringify(c.lastToolResults).slice(0, 200)}`);
          },
        },
        { marker: "Q3SUB-CHILD", answer: () => anthropicText("child-word") },
      ]),
    );
    try {
      const turn1 = await runQuery("q3-2.turn1", "Q3SUB-PARENT delegate, then write", {
        ...baseOptions(dirs, mock.url),
        sessionStore: store,
        settings: { permissions: { ask: ["Bash"] } },
        hooks: gateHooks("q3-2.turn1", (i) => (i.tool_use_id === BASH ? { decision: "defer" } : { decision: "pass" }), []),
        canUseTool: recordingCanUseTool("q3-2.turn1", [], () => ({ allow: false, message: "turn one never approves" })),
      });
      const storeAfter1 = store.inventory();
      const machine2 = newMachine(dirs, 2);
      const hooks2: HookSeen[] = [];
      const turn2 = await runResume("q3-2.turn2", {
        ...baseOptions(machine2, mock.url),
        resume: turn1.sessionId,
        sessionStore: store,
        settings: { permissions: { ask: ["Bash"] } },
        hooks: gateHooks("q3-2.turn2", (i) => (i.tool_use_id === BASH ? { decision: "allow" } : { decision: "pass" }), hooks2),
        canUseTool: recordingCanUseTool("q3-2.turn2", [], (_n, id) => (id === BASH ? { allow: true } : { allow: false, message: "fail closed" })),
      });
      const facts = {
        turn1: resultSummary(turn1),
        storeAfter1,
        turn2: { ...resultSummary(turn2), hooks: hooks2 },
        proof: existsSync(proof) ? readFileSync(proof, "utf8").trim() : null,
        storeCalls: store.calls,
        storeAfter2: store.inventory(),
        localAfter2: filesUnder(machine2.config),
      };
      writeEvidence("q3-2.facts.json", facts);
      expect.soft(facts.turn1.terminalReason).toBe("tool_deferred");
      expect.soft(storeAfter1.some((f) => f.file.includes("subagents")), "the sub-agent's transcript was mirrored under its own key").toBe(true);
      expect.soft(store.calls.some((c) => c.op === "listSubkeys" && c.result !== "[]"), "the resume lists the sub-agent's key").toBe(true);
      expect.soft(facts.proof).toBe("after-sub-agent");
      expect.soft(String(facts.turn2.result ?? "")).toContain("Q3SUB parent done");
    } finally {
      await mock.close();
    }
  }, TIMEOUT);
});

describe("q3 (3) and (4): failure modes", () => {
  it("(3) a store whose append rejects", async () => {
    const dirs = freshDirs("q3-3");
    const store = new FileSessionStore(join(dirs.root, "store"), { failAppend: true });
    const id = toolId("q3_3");
    const mock = await startSpikeMock("q3-3", scenarios([oneCall("Q3-3", { toolCallId: id, toolName: "Bash", toolInput: { command: "echo hi", description: "print" } }, "Q3-3 done")]));
    try {
      const run = await runQuery("q3-3", "Q3-3 run it", {
        ...baseOptions(dirs, mock.url),
        sessionStore: store,
        canUseTool: recordingCanUseTool("q3-3", [], () => ({ allow: true })),
      });
      const facts = { result: resultSummary(run), mirrorErrors: mirrorErrors(run.messages), storeCalls: store.calls, local: filesUnder(dirs.config) };
      writeEvidence("q3-3.facts.json", facts);
      expect.soft(facts.mirrorErrors.length, "the SDK reports the dropped batch").toBeGreaterThan(0);
    } finally {
      await mock.close();
    }
  }, TIMEOUT);

  it("(4) the engine killed with SIGKILL while a tool runs", async () => {
    const dirs = freshDirs("q3-4");
    const store = new FileSessionStore(join(dirs.root, "store"));
    const id = toolId("q3_4");
    const mock = await startSpikeMock("q3-4", scenarios([oneCall("Q3-4", { toolCallId: id, toolName: "Bash", toolInput: { command: `${process.execPath} -e "setTimeout(() => {}, 30000)"`, description: "wait for thirty seconds" } }, "Q3-4 done")]));
    const spawned = trackedSpawn("q3-4");
    try {
      let killedAt: number | undefined;
      const run = await runQuery(
        "q3-4",
        "Q3-4 wait a while",
        {
          ...baseOptions(dirs, mock.url),
          sessionStore: store,
          spawnClaudeCodeProcess: spawned.spawnClaudeCodeProcess,
          hooks: gateHooks(
            "q3-4",
            () => {
              // The tool is about to run: kill the engine a second into it.
              setTimeout(() => {
                killedAt = Date.now();
                spawned.processes[0]?.child.kill("SIGKILL");
              }, 1_000);
              return { decision: "allow" };
            },
            [],
          ),
          canUseTool: recordingCanUseTool("q3-4", [], () => ({ allow: true })),
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      const local = filesUnder(dirs.config).filter((f) => f.file.endsWith(".jsonl"));
      const localLines = local.map((f) => ({ ...f, lines: readFileSync(join(dirs.config, f.file), "utf8").split("\n").filter(Boolean).length }));
      const facts = { killedAt, result: resultSummary(run), local: localLines, store: store.inventory(), storeCalls: store.calls };
      writeEvidence("q3-4.facts.json", facts);
      expect(killedAt).toBeDefined();
    } finally {
      await mock.close();
    }
  }, TIMEOUT);
});

describe("q3 (6): a session id derived from Stigmer's", () => {
  it("starts a session under a derived UUID and resumes it twice", async () => {
    const NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8"; // RFC 4122's URL namespace
    const derived = uuidV5("stigmer-session:ses_hermetic_0001", NAMESPACE);
    const forked = uuidV5("stigmer-session:ses_hermetic_0001:fork", NAMESPACE);
    const dirs = freshDirs("q3-6");
    const store = new FileSessionStore(join(dirs.root, "store"));
    const mock = await startSpikeMock(
      "q3-6",
      scenarios([
        { marker: "Q3ID-ONE", answer: () => anthropicText("first turn") },
        { marker: "Q3ID-TWO", answer: () => anthropicText("second turn") },
        { marker: "Q3ID-THREE", answer: () => anthropicText("third turn") },
        { marker: "Q3ID-BOTH", answer: () => anthropicText("both turn") },
        { marker: "Q3ID-FORK", answer: () => anthropicText("fork turn") },
      ]),
    );
    try {
      const steps: Record<string, unknown> = {};
      const one = await runQuery("q3-6.one", "Q3ID-ONE hello", { ...baseOptions(dirs, mock.url), sessionStore: store, sessionId: derived });
      steps.one = resultSummary(one);
      const two = await runQuery("q3-6.two", "Q3ID-TWO again", { ...baseOptions(dirs, mock.url), sessionStore: store, resume: derived });
      steps.two = resultSummary(two);
      const three = await runQuery("q3-6.three", "Q3ID-THREE again", { ...baseOptions(dirs, mock.url), sessionStore: store, resume: derived });
      steps.three = resultSummary(three);
      const both = await runQuery("q3-6.both", "Q3ID-BOTH again", { ...baseOptions(dirs, mock.url), sessionStore: store, resume: derived, sessionId: derived });
      steps.sessionIdWithResume = resultSummary(both);
      const fork = await runQuery("q3-6.fork", "Q3ID-FORK again", { ...baseOptions(dirs, mock.url), sessionStore: store, resume: derived, sessionId: forked, forkSession: true });
      steps.fork = resultSummary(fork);
      const facts = { derived, forked, steps, store: store.inventory() };
      writeEvidence("q3-6.facts.json", facts);
      expect.soft(one.sessionId, "the first turn runs under the derived id").toBe(derived);
      expect.soft(two.sessionId, "a resume keeps it").toBe(derived);
      expect.soft(three.sessionId, "and so does the next").toBe(derived);
    } finally {
      await mock.close();
    }
  }, TIMEOUT);
});
