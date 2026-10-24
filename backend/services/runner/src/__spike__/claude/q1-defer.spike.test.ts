/*
 * Spike probe: does `defer` from a PreToolUse callback stop the engine
 * at exactly the gated call, survive the process, and run exactly that call
 * when the session resumes in a new process with no prompt?
 *
 *  (i)  the SDK alone: defer, the process exits, the proof file is absent;
 *       resume with an iterable that closes at once, and with one held open,
 *       and the re-fired hook allows without `updatedInput`. Also recorded: a
 *       resume carrying a prompt, `deny` at resume, `defer` again, and
 *       `allow` with a changed `updatedInput`.
 *  (ii) inside a sub-agent: the sub-agent's Bash call deferred; whether the
 *       whole query ends, what the hook input names, whether resume finishes
 *       both transcripts.
 *  (iv) an MCP call deferred and resumed, with the server's default startup
 *       and with `alwaysLoad`, each with and without a slow server.
 *
 * Depth (iii), through Stigmer's runtime, is `adapter.spike.test.ts`.
 * Facts are recorded first and asserted softly, so one red arm never hides
 * the others' evidence.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Options, PreToolUseHookInput, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  baseOptions,
  emptyPrompt,
  runResume,
  freshDirs,
  gateHooks,
  heldPrompt,
  recordingCanUseTool,
  resultSummary,
  runQuery,
  startSpikeMock,
  toolId,
  trackedSpawn,
  writeEvidence,
  type GateDecision,
  type HookSeen,
  type PermissionSeen,
  type RunResult,
  type SpikeDirs,
} from "./harness.js";
import { delegate, oneCall, probeMcpServer, scenarios } from "./scripts.js";

const TIMEOUT = 240_000;

type ResumePrompt = "closed" | "held" | "with-prompt";

interface ResumeFacts {
  turn1: Record<string, unknown>;
  turn1ExitCode: number | null | undefined;
  proofAfterTurn1: boolean;
  turn2: Record<string, unknown>;
  hooksAtResume: HookSeen[];
  permissionsAtResume: PermissionSeen[];
  proofAfterTurn2: string | null;
  turn3?: Record<string, unknown>;
}

function promptFor(how: ResumePrompt, text: string): { prompt: string | AsyncIterable<SDKUserMessage>; onResult?: () => void } {
  if (how === "closed") return { prompt: emptyPrompt() };
  if (how === "with-prompt") return { prompt: text };
  const held = heldPrompt();
  return { prompt: held.prompt, onResult: () => held.release() };
}

async function resumeRun(label: string, how: ResumePrompt, followUp: string, options: Options): Promise<RunResult> {
  const { prompt, onResult } = promptFor(how, followUp);
  return runQuery(label, prompt, options, (m) => {
    if (m.type === "result") onResult?.();
  });
}

/** One Bash call deferred in a first process, then resumed in a second with `atResume` deciding. */
async function deferThenResume(
  variant: string,
  how: ResumePrompt,
  atResume: (input: PreToolUseHookInput) => GateDecision,
  thirdResume?: (input: PreToolUseHookInput) => GateDecision,
): Promise<ResumeFacts> {
  const marker = `Q1I-${variant.toUpperCase()}`;
  const id = toolId(`q1i_${variant.replace(/-/g, "_")}`);
  const dirs: SpikeDirs = freshDirs(`q1i-${variant}`);
  const proof = join(dirs.cwd, "proof.txt");
  const call = { toolCallId: id, toolName: "Bash", toolInput: { command: `echo original-${variant} > ${proof}`, description: "write the proof" } };
  const mock = await startSpikeMock(`q1i-${variant}`, scenarios([oneCall(marker, call, `${marker} done`)]));
  try {
    const label = `q1i-${variant}`;
    const spawned = trackedSpawn(`${label}.turn1`);
    const hooks1: HookSeen[] = [];
    const perms1: PermissionSeen[] = [];
    const turn1 = await runQuery(
      `${label}.turn1`,
      `${marker} write the proof file`,
      baseOptions(dirs, mock.url, {
        hooks: gateHooks(`${label}.turn1`, (input) => (input.tool_name === "Bash" ? { decision: "defer" } : { decision: "pass" }), hooks1),
        canUseTool: recordingCanUseTool(`${label}.turn1`, perms1, () => ({ allow: false, message: "turn one never approves" })),
        spawnClaudeCodeProcess: spawned.spawnClaudeCodeProcess,
      }),
    );
    // The SDK ends its iterator when the process closes; give the exit event a tick.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const facts: ResumeFacts = {
      turn1: { ...resultSummary(turn1), hooks: hooks1, permissions: perms1 },
      turn1ExitCode: spawned.processes[0]?.child.exitCode,
      proofAfterTurn1: existsSync(proof),
      turn2: {},
      hooksAtResume: [],
      permissionsAtResume: [],
      proofAfterTurn2: null,
    };
    const hooks2: HookSeen[] = [];
    const perms2: PermissionSeen[] = [];
    const turn2 = await resumeRun(
      `${label}.turn2`,
      how,
      `${marker}-FOLLOWUP what happened?`,
      baseOptions(dirs, mock.url, {
        resume: turn1.sessionId,
        hooks: gateHooks(`${label}.turn2`, (input) => (input.tool_name === "Bash" ? atResume(input) : { decision: "pass" }), hooks2),
        canUseTool: recordingCanUseTool(`${label}.turn2`, perms2, () => ({ allow: true })),
      }),
    );
    facts.turn2 = resultSummary(turn2);
    facts.hooksAtResume = hooks2;
    facts.permissionsAtResume = perms2;
    facts.proofAfterTurn2 = existsSync(proof) ? readFileSync(proof, "utf8").trim() : null;
    if (thirdResume !== undefined) {
      const hooks3: HookSeen[] = [];
      const turn3 = await resumeRun(
        `${label}.turn3`,
        "held",
        "",
        baseOptions(dirs, mock.url, {
          resume: turn1.sessionId,
          hooks: gateHooks(`${label}.turn3`, (input) => (input.tool_name === "Bash" ? thirdResume(input) : { decision: "pass" }), hooks3),
          canUseTool: recordingCanUseTool(`${label}.turn3`, [], () => ({ allow: true })),
        }),
      );
      facts.turn3 = { ...resultSummary(turn3), hooks: hooks3, proof: existsSync(proof) ? readFileSync(proof, "utf8").trim() : null };
    }
    writeEvidence(`${label}.facts.json`, { variant, how, call, facts });
    return facts;
  } finally {
    await mock.close();
  }
}

describe("q1 (i): defer and a promptless resume, the SDK alone", () => {
  it("records a resume whose prompt iterable closes at once (the SDK's stdin closes with it)", async () => {
    const f = await deferThenResume("promptless-closed", "closed", () => ({ decision: "allow" }));
    expect.soft(f.turn1.terminalReason).toBe("tool_deferred");
    expect.soft(f.proofAfterTurn1).toBe(false);
  }, TIMEOUT);

  for (const how of ["held"] as const) {
    it(
      "defers, exits, and resumes with an iterable held open until the result",
      async () => {
        const f = await deferThenResume(`promptless-${how}`, how, () => ({ decision: "allow" }));
        expect.soft(f.turn1.terminalReason, "turn one ends on the deferred call").toBe("tool_deferred");
        expect.soft((f.turn1.deferred as { id?: string } | undefined)?.id, "the deferred call is named").toMatch(/^toolu_q1i_promptless/);
        expect.soft(f.turn1ExitCode, "the first process has exited").not.toBeNull();
        expect.soft(f.proofAfterTurn1, "nothing ran before the decision").toBe(false);
        expect.soft(f.hooksAtResume.length, "the hook re-fires at resume").toBeGreaterThan(0);
        expect.soft(f.hooksAtResume[0]?.toolUseId, "with the same tool_use_id").toBe((f.turn1.deferred as { id?: string } | undefined)?.id);
        expect.soft(f.hooksAtResume[0]?.input, "and the original input").toEqual((f.turn1.deferred as { input?: unknown } | undefined)?.input);
        expect.soft(f.proofAfterTurn2, "allow without updatedInput runs the original command").toBe(`original-promptless-${how}`);
      },
      TIMEOUT,
    );
  }

  it("records a resume that carries a prompt (the docs say the call is dropped)", async () => {
    const f = await deferThenResume("with-prompt", "with-prompt", () => ({ decision: "allow" }));
    expect.soft(f.turn1.terminalReason).toBe("tool_deferred");
  }, TIMEOUT);

  it("records deny at resume: what the model is told", async () => {
    const f = await deferThenResume("deny", "held", () => ({ decision: "deny", reason: "The person declined this command." }));
    expect.soft(f.proofAfterTurn2, "a denied call never runs").toBeNull();
  }, TIMEOUT);

  it("records defer again at resume, then allow on a third process", async () => {
    const f = await deferThenResume("defer-again", "held", () => ({ decision: "defer" }), () => ({ decision: "allow" }));
    expect.soft((f.turn2.deferred as { id?: string } | undefined)?.id, "the session defers again (deferred_tool_use set)").toBe((f.turn1.deferred as { id?: string } | undefined)?.id);
    expect.soft(f.proofAfterTurn2).toBeNull();
    expect.soft((f.turn3 as { proof?: string } | undefined)?.proof).toBe("original-defer-again");
  }, TIMEOUT);

  it("records allow with a changed updatedInput: what runs", async () => {
    const f = await deferThenResume("updated-input", "held", (input) => {
      const original = (input.tool_input ?? {}) as { command?: string };
      return { decision: "allow", updatedInput: { ...original, command: (original.command ?? "").replace("original-", "CHANGED-") } };
    });
    expect.soft(f.turn1.terminalReason).toBe("tool_deferred");
  }, TIMEOUT);
});

describe("q1 (ii): a deferred call inside a sub-agent", () => {
  for (const background of [false, true]) {
    it(`defers the sub-agent's Bash call and resumes both transcripts (${background ? "background" : "foreground"} agent)`, async () => {
      const label = `q1sub-${background ? "bg" : "fg"}`;
      const AGENT = toolId(`q1sub_agent_${background ? "bg" : "fg"}`);
      const CHILD = toolId(`q1sub_bash_${background ? "bg" : "fg"}`);
      const dirs = freshDirs(label);
      const proof = join(dirs.cwd, "proof-sub.txt");
      const parent = `Q1SUB-${background ? "BG" : "FG"}-PARENT`;
      const child = `Q1SUB-${background ? "BG" : "FG"}-CHILD`;
      const mock = await startSpikeMock(
        label,
        scenarios([
          delegate(parent, AGENT, `${child} write the proof file with Bash`, "Q1SUB parent done", { background }),
          oneCall(child, { toolCallId: CHILD, toolName: "Bash", toolInput: { command: `echo from-sub-agent > ${proof}`, description: "write" } }, "Q1SUB child done"),
        ]),
      );
      try {
        const hooks1: HookSeen[] = [];
        const turn1 = await runQuery(
          `${label}.turn1`,
          `${parent} delegate the proof to a sub-agent`,
          baseOptions(dirs, mock.url, {
            hooks: gateHooks(`${label}.turn1`, (input) => (input.tool_use_id === CHILD ? { decision: "defer" } : { decision: "pass" }), hooks1),
            canUseTool: recordingCanUseTool(`${label}.turn1`, [], () => ({ allow: false, message: "turn one never approves" })),
          }),
        );
        const proofAfter1 = existsSync(proof);
        const hooks2: HookSeen[] = [];
        // Only a deferred turn has anything to resume; a held prompt over a
        // finished session waits for input forever.
        const turn2 = turn1.result !== undefined && "deferred_tool_use" in turn1.result && turn1.result.deferred_tool_use !== undefined ? await runResume(`${label}.turn2`, baseOptions(dirs, mock.url, {
            resume: turn1.sessionId,
            hooks: gateHooks(`${label}.turn2`, (input) => (input.tool_use_id === CHILD ? { decision: "allow" } : { decision: "pass" }), hooks2),
            canUseTool: recordingCanUseTool(`${label}.turn2`, [], () => ({ allow: true })),
          }),
        ) : undefined;
        const facts = {
          background,
          turn1: { ...resultSummary(turn1), hooks: hooks1 },
          proofAfter1,
          turn2: turn2 === undefined ? "not resumed: turn one reported no deferred call" : { ...resultSummary(turn2), hooks: hooks2 },
          proofAfter2: existsSync(proof) ? readFileSync(proof, "utf8").trim() : null,
        };
        writeEvidence(`${label}.facts.json`, facts);
        expect.soft(facts.turn1.terminalReason, "the whole query ends on the sub-agent's deferred call").toBe("tool_deferred");
        expect.soft(hooks1.find((h) => h.toolUseId === CHILD)?.agentId, "the hook input names the sub-agent").toBeTruthy();
        expect.soft(proofAfter1).toBe(false);
        expect.soft(hooks2.some((h) => h.toolUseId === CHILD), "resume re-fires inside the sub-agent").toBe(true);
        expect.soft(facts.proofAfter2).toBe("from-sub-agent");
        expect.soft(typeof facts.turn2 === "string" ? facts.turn2 : String(facts.turn2.result ?? ""), "the parent's transcript finishes after the resume").toContain("Q1SUB parent done");
      } finally {
        await mock.close();
      }
    }, TIMEOUT);
  }
});

describe("q1 (iv): a deferred MCP call at resume", () => {
  for (const alwaysLoad of [false, true]) {
    for (const startDelayMs of [0, 2_000]) {
      it(`alwaysLoad=${alwaysLoad}, server start delay ${startDelayMs} ms`, async () => {
        const variant = `al${alwaysLoad ? 1 : 0}-d${startDelayMs}`;
        const id = toolId(`q1mcp_${variant.replace(/-/g, "_")}`);
        const dirs = freshDirs(`q1mcp-${variant}`);
        const callLog = join(dirs.root, "mcp-calls.jsonl");
        const marker = `Q1MCP-${variant.toUpperCase()}`;
        const mock = await startSpikeMock(
          `q1mcp-${variant}`,
          scenarios([oneCall(marker, { toolCallId: id, toolName: "mcp__probe__destroy", toolInput: { target: "database" } }, `${marker} done`)]),
        );
        const server = probeMcpServer(
          { PROBE_MCP_LOG: callLog, PROBE_MCP_START_DELAY_MS: String(startDelayMs) },
          alwaysLoad ? { alwaysLoad: true } : {},
        );
        try {
          const hooks1: HookSeen[] = [];
          const turn1 = await runQuery(
            `q1mcp-${variant}.turn1`,
            `${marker} destroy the database`,
            baseOptions(dirs, mock.url, {
              mcpServers: { probe: server },
              hooks: gateHooks(`q1mcp-${variant}.turn1`, (input) => (input.tool_name.startsWith("mcp__") ? { decision: "defer" } : { decision: "pass" }), hooks1),
              canUseTool: recordingCanUseTool(`q1mcp-${variant}.turn1`, [], () => ({ allow: false, message: "turn one never approves" })),
            }),
          );
          const callsAfter1 = existsSync(callLog) ? readFileSync(callLog, "utf8").split("\n").filter((l) => l.includes('"call"')).length : 0;
          const hooks2: HookSeen[] = [];
          const turn2 = await runResume(`q1mcp-${variant}.turn2`, baseOptions(dirs, mock.url, {
              resume: turn1.sessionId,
              mcpServers: { probe: server },
              hooks: gateHooks(`q1mcp-${variant}.turn2`, (input) => (input.tool_name.startsWith("mcp__") ? { decision: "allow" } : { decision: "pass" }), hooks2),
              canUseTool: recordingCanUseTool(`q1mcp-${variant}.turn2`, [], () => ({ allow: true })),
            }),
          );
          const callsAfter2 = existsSync(callLog) ? readFileSync(callLog, "utf8").split("\n").filter((l) => l.includes('"call"')).length : 0;
          const facts = {
            alwaysLoad,
            startDelayMs,
            turn1: { ...resultSummary(turn1), hooks: hooks1 },
            callsAfter1,
            turn2: { ...resultSummary(turn2), hooks: hooks2 },
            callsAfter2,
          };
          writeEvidence(`q1mcp-${variant}.facts.json`, facts);
          expect.soft(facts.turn1.terminalReason).toBe("tool_deferred");
          expect.soft(callsAfter1, "nothing ran before the decision").toBe(0);
        } finally {
          await mock.close();
        }
      }, TIMEOUT);
    }
  }
});
