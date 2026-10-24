/*
 * Spike probe: when the model asks for several tools in one message,
 * `defer` is ignored and every call "goes through the normal permission
 * flow". Does any gated call run before a decision?
 *
 * One assistant message carries a gated call and an ungated one (ToolSearch,
 * read-only and approved on its own; Glob is not in 2.1.310's default tools). The
 * gate defers the gated call; `canUseTool` refuses an id the gate deferred
 * with "issue this call on its own" and refuses anything it did not expect,
 * so the gate fails closed. The script then re-issues the call alone, and it
 * must defer. Five gated classes, two arms:
 *
 *  (a) the gate as first drawn: a hook plus `canUseTool`;
 *  (b) the same gate with ask rules over every gated class passed through
 *      the `settings` option, so every gated call reaches `canUseTool`.
 *
 * The side effect is the evidence: the proof file, the MCP server's call
 * log, or a canary's appearance in a later request's tool result.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Options, Settings } from "@anthropic-ai/claude-agent-sdk";
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
  startSpikeMock,
  toolId,
  writeEvidence,
  type HookSeen,
  type PermissionSeen,
  type SpikeDirs,
} from "./harness.js";
import { batch, oneCall, probeMcpServer, resultFor, scenarios } from "./scripts.js";

const TIMEOUT = 240_000;

type GatedClass = "bash-write" | "bash-read" | "mcp" | "write" | "read";
const CLASSES: readonly GatedClass[] = ["bash-write", "bash-read", "mcp", "write", "read"];

const ASK_RULES: Settings = { permissions: { ask: ["Bash", "Write", "Read", "mcp__probe__destroy"] } };

interface ClassSetup {
  name: string;
  input: Record<string, unknown>;
  canary?: string;
  sideEffect(): boolean;
}

function setupClass(cls: GatedClass, dirs: SpikeDirs, callLog: string): ClassSetup {
  const canary = `CANARY-${cls}-${process.pid}-${Date.now()}`;
  switch (cls) {
    case "bash-write": {
      const proof = join(dirs.cwd, "batch-proof.txt");
      return { name: "Bash", input: { command: `echo ran > ${proof}`, description: "write" }, sideEffect: () => existsSync(proof) };
    }
    case "bash-read": {
      const secret = join(dirs.cwd, "secret.txt");
      writeFileSync(secret, `${canary}\n`);
      return { name: "Bash", input: { command: `cat ${secret}`, description: "read a file" }, canary, sideEffect: () => false };
    }
    case "mcp":
      return {
        name: "mcp__probe__destroy",
        input: { target: "database" },
        sideEffect: () => existsSync(callLog) && readFileSync(callLog, "utf8").includes('"call"'),
      };
    case "write": {
      const proof = join(dirs.cwd, "written.txt");
      return { name: "Write", input: { file_path: proof, content: "written by the batch" }, sideEffect: () => existsSync(proof) };
    }
    case "read": {
      const secret = join(dirs.cwd, "secret-read.txt");
      writeFileSync(secret, `${canary}\n`);
      return { name: "Read", input: { file_path: secret }, canary, sideEffect: () => false };
    }
  }
}

function isGated(cls: GatedClass, toolName: string): boolean {
  if (cls === "bash-write" || cls === "bash-read") return toolName === "Bash";
  if (cls === "mcp") return toolName === "mcp__probe__destroy";
  if (cls === "write") return toolName === "Write";
  return toolName === "Read";
}

describe("q2: a gated call inside a batch", () => {
  for (const arm of ["a", "b"] as const) {
    for (const cls of CLASSES) {
      it(`arm (${arm}) ${arm === "a" ? "hook + canUseTool" : "hook + ask rules + canUseTool"}: ${cls}`, async () => {
        const label = `q2-${arm}-${cls}`;
        const dirs = freshDirs(label);
        const callLog = join(dirs.root, "mcp-calls.jsonl");
        const setup = setupClass(cls, dirs, callLog);
        const GATED_1 = toolId(`q2${arm}_${cls.replace("-", "_")}_g1`);
        const UNGATED_1 = toolId(`q2${arm}_${cls.replace("-", "_")}_u1`);
        const GATED_2 = toolId(`q2${arm}_${cls.replace("-", "_")}_g2`);
        const marker = `Q2-${arm.toUpperCase()}-${cls.toUpperCase()}`;
        const toolResultsSeen: Array<{ id: string; isError: boolean; text: string }> = [];
        const mock = await startSpikeMock(
          label,
          scenarios([
            batch(
              marker,
              [
                { toolCallId: GATED_1, toolName: setup.name, toolInput: setup.input },
                { toolCallId: UNGATED_1, toolName: "ToolSearch", toolInput: { query: "notebook", max_results: 1 } },
              ],
              (c) => {
                for (const r of c.lastToolResults) toolResultsSeen.push({ id: r.toolUseId, isError: r.isError, text: r.text.slice(0, 400) });
                if (resultFor(c, GATED_2) !== undefined) return anthropicText(`${marker} re-issued call answered`);
                if (resultFor(c, GATED_1) !== undefined) return anthropicToolUses([{ toolCallId: GATED_2, toolName: setup.name, toolInput: setup.input }]);
                return anthropicText(`${marker} unexpected: ${JSON.stringify(c.lastToolResults).slice(0, 300)}`);
              },
            ),
          ]),
        );
        const deferred = new Set<string>();
        const hooks: HookSeen[] = [];
        const perms: PermissionSeen[] = [];
        const options: Options = baseOptions(dirs, mock.url, {
          ...(cls === "mcp" ? { mcpServers: { probe: probeMcpServer({ PROBE_MCP_LOG: callLog }, { alwaysLoad: true }) } } : {}),
          ...(arm === "b" ? { settings: ASK_RULES } : {}),
          hooks: gateHooks(
            label,
            (input) => {
              if (!isGated(cls, input.tool_name)) return { decision: "pass" };
              deferred.add(input.tool_use_id);
              return { decision: "defer" };
            },
            hooks,
          ),
          canUseTool: recordingCanUseTool(label, perms, (_name, id) =>
            deferred.has(id) ? { allow: false, message: "issue this call on its own" } : { allow: false, message: "unexpected call: the gate fails closed" },
          ),
        });
        try {
          const run = await runQuery(label, `${marker} do both things`, options);
          const leaked = setup.canary !== undefined && toolResultsSeen.some((r) => r.text.includes(setup.canary!));
          const facts = {
            arm,
            cls,
            result: resultSummary(run),
            hooks,
            permissions: perms,
            toolResultsSeen,
            sideEffectRan: setup.sideEffect(),
            canaryReachedModel: leaked,
            ranUndecided: setup.sideEffect() || leaked,
          };
          writeEvidence(`${label}.facts.json`, facts);
          expect.soft(facts.ranUndecided, `${label}: the gated call ran before a decision`).toBe(false);
          expect.soft(run.result !== undefined && "terminal_reason" in run.result ? run.result.terminal_reason : undefined, `${label}: the re-issued call defers`).toBe("tool_deferred");
        } finally {
          await mock.close();
        }
      }, TIMEOUT);
    }
  }

  for (const arm of ["a", "b"] as const) {
    for (const shape of ["gated-second", "two-gated"] as const) {
      it(`arm (${arm}) batch shape ${shape}: what defers, what runs, and what a resume does`, async () => {
        const label = `q2-${arm}-${shape}`;
        const dirs = freshDirs(label);
        const proofA = join(dirs.cwd, "a.txt");
        const proofB = join(dirs.cwd, "b.txt");
        const A = toolId(`q2${arm}_${shape.replace("-", "_")}_a`);
        const B = toolId(`q2${arm}_${shape.replace("-", "_")}_b`);
        const marker = `Q2-${arm.toUpperCase()}-${shape.toUpperCase()}`;
        const callA = { toolCallId: A, toolName: "Bash", toolInput: { command: `echo a > ${proofA}`, description: "write a" } };
        const callB =
          shape === "two-gated"
            ? { toolCallId: B, toolName: "Bash", toolInput: { command: `echo b > ${proofB}`, description: "write b" } }
            : { toolCallId: B, toolName: "ToolSearch", toolInput: { query: "notebook", max_results: 1 } };
        const calls = shape === "gated-second" ? [callB, callA] : [callA, callB];
        const toolResultsSeen: Array<{ id: string; isError: boolean; text: string }> = [];
        const mock = await startSpikeMock(
          label,
          scenarios([
            batch(marker, calls, (c) => {
              for (const r of c.lastToolResults) toolResultsSeen.push({ id: r.toolUseId, isError: r.isError, text: r.text.slice(0, 300) });
              return anthropicText(`${marker} results: ${JSON.stringify(c.lastToolResults.map((r) => [r.toolUseId.slice(-12), r.isError, r.text.slice(0, 80)]))}`);
            }),
          ]),
        );
        const deferred = new Set<string>();
        const hooks1: HookSeen[] = [];
        const perms1: PermissionSeen[] = [];
        try {
          const turn1 = await runQuery(label, `${marker} do both things`, baseOptions(dirs, mock.url, {
            ...(arm === "b" ? { settings: ASK_RULES } : {}),
            hooks: gateHooks(label, (i) => {
              if (i.tool_name !== "Bash") return { decision: "pass" };
              deferred.add(i.tool_use_id);
              return { decision: "defer" };
            }, hooks1),
            canUseTool: recordingCanUseTool(label, perms1, (_n, id) =>
              deferred.has(id) ? { allow: false, message: "issue this call on its own" } : { allow: false, message: "unexpected call: the gate fails closed" },
            ),
          }));
          const after1 = { a: existsSync(proofA), b: existsSync(proofB) };
          const deferredId = turn1.result !== undefined && "deferred_tool_use" in turn1.result ? turn1.result.deferred_tool_use?.id : undefined;
          const hooks2: HookSeen[] = [];
          const perms2: PermissionSeen[] = [];
          // Resume, allowing every Bash call the gate is asked about, to see
          // whether the second gated call re-fires, defers or is lost.
          const turn2 = deferredId === undefined ? undefined : await runResume(`${label}.turn2`, baseOptions(dirs, mock.url, {
            resume: turn1.sessionId,
            ...(arm === "b" ? { settings: ASK_RULES } : {}),
            hooks: gateHooks(`${label}.turn2`, (i) => (i.tool_name === "Bash" ? { decision: "allow" } : { decision: "pass" }), hooks2),
            canUseTool: recordingCanUseTool(`${label}.turn2`, perms2, () => ({ allow: true })),
          }));
          const facts = {
            arm,
            shape,
            order: calls.map((c) => `${c.toolName}:${c.toolCallId.slice(-14)}`),
            turn1: { ...resultSummary(turn1), hooks: hooks1, permissions: perms1 },
            after1,
            turn2: turn2 === undefined ? "not resumed" : { ...resultSummary(turn2), hooks: hooks2, permissions: perms2 },
            after2: { a: existsSync(proofA), b: existsSync(proofB) },
            toolResultsSeen,
            ranUndecided: after1.a || after1.b,
          };
          writeEvidence(`${label}.facts.json`, facts);
          expect.soft(facts.ranUndecided, `${label}: a gated call ran before a decision`).toBe(false);
        } finally {
          await mock.close();
        }
      }, TIMEOUT);
    }
  }

  it("arm (b) leaves a single deferred call unchanged: defer, resume, the hook allows, canUseTool allows", async () => {
    const dirs = freshDirs("q2-b-single");
    const proof = join(dirs.cwd, "proof.txt");
    const id = toolId("q2b_single");
    const mock = await startSpikeMock(
      "q2-b-single",
      scenarios([oneCall("Q2B-SINGLE", { toolCallId: id, toolName: "Bash", toolInput: { command: `echo single > ${proof}`, description: "write" } }, "Q2B single done")]),
    );
    try {
      const hooks1: HookSeen[] = [];
      const turn1 = await runQuery(
        "q2-b-single.turn1",
        "Q2B-SINGLE write the proof",
        baseOptions(dirs, mock.url, {
          settings: ASK_RULES,
          hooks: gateHooks("q2-b-single.turn1", (i) => (i.tool_name === "Bash" ? { decision: "defer" } : { decision: "pass" }), hooks1),
          canUseTool: recordingCanUseTool("q2-b-single.turn1", [], () => ({ allow: false, message: "turn one never approves" })),
        }),
      );
      const allowed = new Set<string>();
      const hooks2: HookSeen[] = [];
      const perms2: PermissionSeen[] = [];
      const turn2 = await runResume("q2-b-single.turn2", baseOptions(dirs, mock.url, {
          resume: turn1.sessionId,
          settings: ASK_RULES,
          hooks: gateHooks(
            "q2-b-single.turn2",
            (i) => {
              if (i.tool_name !== "Bash") return { decision: "pass" };
              allowed.add(i.tool_use_id);
              return { decision: "allow" };
            },
            hooks2,
          ),
          canUseTool: recordingCanUseTool("q2-b-single.turn2", perms2, (_n, toolUseId) =>
            allowed.has(toolUseId) ? { allow: true } : { allow: false, message: "unexpected call: the gate fails closed" },
          ),
        }),
      );
      const facts = {
        turn1: resultSummary(turn1),
        turn2: { ...resultSummary(turn2), hooks: hooks2, permissions: perms2 },
        proof: existsSync(proof) ? readFileSync(proof, "utf8").trim() : null,
      };
      writeEvidence("q2-b-single.facts.json", facts);
      expect.soft(facts.turn1.terminalReason).toBe("tool_deferred");
      expect.soft(perms2.length, "the ask rule brings the hook-allowed call to canUseTool").toBeGreaterThan(0);
      expect.soft(facts.proof, "and the original command runs").toBe("single");
    } finally {
      await mock.close();
    }
  }, TIMEOUT);

  it("records whether an ask rule can name every tool (ToolSearch alone under `*`, named, and with no rule)", async () => {
    const results: Record<string, unknown> = {};
    for (const [name, ask] of [
      ["star", ["*"]],
      ["named", ["ToolSearch"]],
      ["none", []],
    ] as const) {
      const dirs = freshDirs(`q2-askall-${name}`);
      const id = toolId(`q2_askall_${name.replace("-", "_")}`);
      const mock = await startSpikeMock(`q2-askall-${name}`, scenarios([oneCall(`Q2ASK-${name.toUpperCase()}`, { toolCallId: id, toolName: "ToolSearch", toolInput: { query: "notebook", max_results: 1 } }, "tool search done")]));
      const perms: PermissionSeen[] = [];
      try {
        const run = await runQuery(
          `q2-askall-${name}`,
          `Q2ASK-${name.toUpperCase()} list files`,
          baseOptions(dirs, mock.url, {
            settings: { permissions: { ask: [...ask] } },
            canUseTool: recordingCanUseTool(`q2-askall-${name}`, perms, () => ({ allow: false, message: "recorded and refused" })),
          }),
        );
        results[name] = { ask, result: resultSummary(run), canUseToolCalls: perms };
      } finally {
        await mock.close();
      }
    }
    writeEvidence("q2-askall.facts.json", results);
    expect(Object.keys(results)).toHaveLength(3);
  }, TIMEOUT);
});
