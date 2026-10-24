/*
 * Spike probe, batch follow-ups the first batch run made necessary.
 *
 *  1. Does the re-fired hook ever miss at resume? On two resumes (a resume
 *     carrying a prompt; arm (b) with the gated call second) the engine
 *     asked `canUseTool` and never fired PreToolUse. If the hook can miss,
 *     a read-only call the person REJECTED is approved by the engine on its
 *     own when no ask rule brings it to `canUseTool`. Each case is resumed
 *     REPS times with a reject at both the hook and `canUseTool`, and the
 *     side effect is counted.
 *  2. Arm (c), the batch rule as first drawn, on two gated calls in one
 *     message: the gate defers the first gated call of a turn and refuses
 *     every later one with "issue this call on its own". Does the result
 *     name the first, does the refusal reach the model at resume, and does
 *     the re-issued call defer?
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Settings } from "@anthropic-ai/claude-agent-sdk";
import {
  anthropicText,
  anthropicToolUses,
  baseOptions,
  freshDirs,
  gateHooks,
  recordingCanUseTool,
  resultSummary,
  runQuery,
  runResume,
  startSpikeMock,
  toolId,
  writeEvidence,
  type HookSeen,
  type PermissionSeen,
} from "./harness.js";
import { batch, resultFor, scenarios } from "./scripts.js";

const TIMEOUT = 900_000;
const REPS = Number(process.env.SPIKE_RACE_REPS ?? "12");
const ASK_RULES: Settings = { permissions: { ask: ["Bash", "Write", "Read", "mcp__probe__destroy"] } };

type Shape = "single" | "gated-second";
type Effect = "read-only" | "write";

describe("q2 follow-up 1: a rejected call at resume, repeated", () => {
  for (const arm of ["a", "b"] as const) {
    for (const shape of ["single", "gated-second"] as const satisfies readonly Shape[]) {
      for (const effect of ["read-only", "write"] as const satisfies readonly Effect[]) {
        it(`arm (${arm}) ${shape} ${effect}: ${REPS} resumes with a reject`, async () => {
          const label = `q2race-${arm}-${shape}-${effect}`;
          const tally = { reps: 0, deferredTurn1: 0, hookFiredAtResume: 0, canUseToolAtResume: 0, ran: 0 };
          const runs: unknown[] = [];
          for (let rep = 0; rep < REPS; rep += 1) {
            const dirs = freshDirs(`${label}-${rep}`);
            const canary = `CANARY-RACE-${process.pid}-${rep}-${Date.now()}`;
            const secret = join(dirs.cwd, "secret.txt");
            writeFileSync(secret, `${canary}\n`);
            const proof = join(dirs.cwd, "proof.txt");
            const G = toolId(`race_${arm}_${shape.replace("-", "_")}_${effect.replace("-", "_")}_${rep}`);
            const U = toolId(`race_u_${rep}`);
            const gated = { toolCallId: G, toolName: "Bash", toolInput: { command: effect === "read-only" ? `cat ${secret}` : `echo ran > ${proof}`, description: "probe" } };
            const companion = { toolCallId: U, toolName: "ToolSearch", toolInput: { query: "notebook", max_results: 1 } };
            const marker = `RACE-${arm}-${shape}-${effect}-${rep}`.toUpperCase();
            let modelSawCanary = false;
            const mock = await startSpikeMock(
              `${label}-${rep}`,
              scenarios([
                batch(marker, shape === "single" ? [gated] : [companion, gated], (c) => {
                  if (c.lastToolResults.some((r) => r.text.includes(canary))) modelSawCanary = true;
                  return anthropicText(`${marker} done`);
                }),
              ]),
            );
            const hooks2: HookSeen[] = [];
            const perms2: PermissionSeen[] = [];
            try {
              const turn1 = await runQuery(`${label}-${rep}.turn1`, `${marker} go`, baseOptions(dirs, mock.url, {
                ...(arm === "b" ? { settings: ASK_RULES } : {}),
                hooks: gateHooks(`${label}-${rep}.turn1`, (i) => (i.tool_name === "Bash" ? { decision: "defer" } : { decision: "pass" }), []),
                canUseTool: recordingCanUseTool(`${label}-${rep}.turn1`, [], () => ({ allow: false, message: "turn one never approves" })),
              }));
              const deferred = turn1.result !== undefined && "deferred_tool_use" in turn1.result && turn1.result.deferred_tool_use?.id === G;
              if (deferred) {
                await runResume(`${label}-${rep}.turn2`, baseOptions(dirs, mock.url, {
                  resume: turn1.sessionId,
                  ...(arm === "b" ? { settings: ASK_RULES } : {}),
                  hooks: gateHooks(`${label}-${rep}.turn2`, (i) => (i.tool_name === "Bash" ? { decision: "deny", reason: "The person rejected this call." } : { decision: "pass" }), hooks2),
                  canUseTool: recordingCanUseTool(`${label}-${rep}.turn2`, perms2, () => ({ allow: false, message: "The person rejected this call." })),
                }));
              }
              const ran = existsSync(proof) || modelSawCanary;
              tally.reps += 1;
              if (deferred) tally.deferredTurn1 += 1;
              if (hooks2.some((h) => h.toolUseId === G)) tally.hookFiredAtResume += 1;
              if (perms2.some((p) => p.toolUseId === G)) tally.canUseToolAtResume += 1;
              if (ran) tally.ran += 1;
              runs.push({ rep, deferred, hookAtResume: hooks2.map((h) => h.decided), canUseToolAtResume: perms2.map((p) => p.answered), ran });
            } finally {
              await mock.close();
            }
          }
          writeEvidence(`${label}.facts.json`, { arm, shape, effect, tally, runs });
          expect.soft(tally.ran, `${label}: a rejected call ran`).toBe(0);
        }, TIMEOUT);
      }
    }
  }
});

describe("q2 follow-up 2: arm (c), defer the first gated call, refuse the rest", () => {
  for (const arm of ["c", "c+ask"] as const) {
    it(`${arm}: two gated calls in one message`, async () => {
      const label = `q2-${arm.replace("+", "")}-two-gated`;
      const dirs = freshDirs(label);
      const proofA = join(dirs.cwd, "a.txt");
      const proofB = join(dirs.cwd, "b.txt");
      const A = toolId(`q2c_${arm.replace("+", "")}_a`);
      const B = toolId(`q2c_${arm.replace("+", "")}_b`);
      const B2 = toolId(`q2c_${arm.replace("+", "")}_b2`);
      const marker = `Q2-${arm.replace("+", "").toUpperCase()}-TWO-GATED`;
      const callA = { toolCallId: A, toolName: "Bash", toolInput: { command: `echo a > ${proofA}`, description: "write a" } };
      const callB = { toolCallId: B, toolName: "Bash", toolInput: { command: `echo b > ${proofB}`, description: "write b" } };
      const seenResults: Array<{ id: string; isError: boolean; text: string }> = [];
      const mock = await startSpikeMock(
        label,
        scenarios([
          batch(marker, [callA, callB], (c) => {
            for (const r of c.lastToolResults) seenResults.push({ id: r.toolUseId, isError: r.isError, text: r.text.slice(0, 200) });
            if (resultFor(c, B2) !== undefined) return anthropicText(`${marker} b2 answered`);
            const refusedB = c.lastToolResults.find((r) => r.toolUseId === B && r.isError);
            if (refusedB !== undefined && !c.issuedToolUseIds.has(B2)) {
              return anthropicToolUses([{ ...callB, toolCallId: B2 }]);
            }
            return anthropicText(`${marker} results: ${JSON.stringify(c.lastToolResults.map((r) => [r.toolUseId.slice(-8), r.isError, r.text.slice(0, 80)]))}`);
          }),
        ]),
      );
      // The rule: one deferred call per turn; any later gated call
      // in the same turn is refused so the model issues it on its own.
      const makeGate = (label2: string, seen: HookSeen[], decided: Map<string, "allow" | "deny">) => {
        let deferredThisProcess: string | undefined;
        return gateHooks(
          label2,
          (i) => {
            if (i.tool_name !== "Bash") return { decision: "pass" };
            const d = decided.get(i.tool_use_id);
            if (d === "allow") return { decision: "allow" };
            if (d === "deny") return { decision: "deny", reason: "The person rejected this call." };
            if (deferredThisProcess === undefined) {
              deferredThisProcess = i.tool_use_id;
              return { decision: "defer" };
            }
            return { decision: "deny", reason: "issue this call on its own" };
          },
          seen,
        );
      };
      const settings = arm === "c+ask" ? { settings: ASK_RULES } : {};
      try {
        const hooks1: HookSeen[] = [];
        const turn1 = await runQuery(label, `${marker} do both`, baseOptions(dirs, mock.url, {
          ...settings,
          hooks: makeGate(label, hooks1, new Map()),
          canUseTool: recordingCanUseTool(label, [], () => ({ allow: false, message: "issue this call on its own" })),
        }));
        const deferredId = turn1.result !== undefined && "deferred_tool_use" in turn1.result ? turn1.result.deferred_tool_use?.id : undefined;
        const after1 = { a: existsSync(proofA), b: existsSync(proofB) };
        // The person approves the deferred call.
        const hooks2: HookSeen[] = [];
        const perms2: PermissionSeen[] = [];
        const turn2 = deferredId === undefined ? undefined : await runResume(`${label}.turn2`, baseOptions(dirs, mock.url, {
          resume: turn1.sessionId,
          ...settings,
          hooks: makeGate(`${label}.turn2`, hooks2, new Map([[deferredId, "allow" as const]])),
          canUseTool: recordingCanUseTool(`${label}.turn2`, perms2, (_n, id) => (id === deferredId ? { allow: true } : { allow: false, message: "issue this call on its own" })),
        }));
        const facts = {
          arm,
          turn1: { ...resultSummary(turn1), hooks: hooks1 },
          after1,
          turn2: turn2 === undefined ? "not resumed" : { ...resultSummary(turn2), hooks: hooks2, permissions: perms2 },
          after2: { a: existsSync(proofA), b: existsSync(proofB) },
          seenResults,
        };
        writeEvidence(`${label}.facts.json`, facts);
        expect.soft(deferredId, "the first gated call is the deferred one").toBe(A);
        expect.soft(after1, "nothing ran in turn one").toEqual({ a: false, b: false });
        expect.soft(facts.after2.a, "the approved call ran").toBe(true);
        expect.soft(seenResults.some((r) => r.id === B && r.isError && /on its own/.test(r.text)), "the refusal of the second call reached the model").toBe(true);
        expect.soft(turn2 !== undefined && "deferred_tool_use" in (turn2.result ?? {}) ? (turn2.result as { deferred_tool_use?: { id: string } }).deferred_tool_use?.id : undefined, "the re-issued call defers").toBe(B2);
        expect.soft(facts.after2.b, "the second call has not run undecided").toBe(false);
      } finally {
        await mock.close();
      }
    }, TIMEOUT);
  }
});
