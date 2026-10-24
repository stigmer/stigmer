/*
 * Spike probe: can the agent's own shell commands, or a stdio MCP server
 * the engine starts, get at Stigmer's credentials?
 *
 * The engine is a separate program, so its environment carries what its
 * model calls need: the proxy's address, a credential, the turn key and the
 * execution id. Its Bash tool and its stdio MCP servers are its children,
 * running as the same user. Each arm runs one scripted Bash call and one MCP
 * call that dump their own environment and every ancestor's
 * `/proc/<pid>/environ` (Linux only), and reports which probe secret each
 * process exposes. Run in the container as the agent user
 * (`container/q4-q5.sh`); on macOS there is no `/proc`, so only the
 * children's own environments are measured.
 *
 *  1. scrub-off  : host token in the engine's environment, no scrub (the red)
 *  2. scrub-on   : the same with CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1
 *  3. turncred   : the engine holds only its turn's key (the turn-credential remedy)
 *  4. hostshell  : Bash routed to a shell the host serves (`toolAliases`), host token in the engine
 *  5. both       : the host-served shell and the turn credential together
 *
 * Every value is masked before it is written; the run then scans every
 * evidence file for the raw secrets and fails if one is found.
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { release, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { AgentProxy } from "../../agent-proxy/server.js";
import { hermeticCursorConfig } from "../../activities/execute-cursor/__test-utils__/hermetic-cursor.js";
import type { HermeticEnvironment } from "../../__test-utils__/hermetic-activity.js";
import { buildShellEnv } from "../../shared/shell-env.js";
import {
  EVIDENCE_DIR,
  baseOptions,
  freshDirs,
  recordingCanUseTool,
  resultSummary,
  runQuery,
  spikeEnv,
  startSpikeMock,
  toolId,
  writeEvidence,
} from "./harness.js";
import { anthropicText, anthropicToolUses } from "./harness.js";
import { maskEnv, probeMcpServer, resultFor, scenarios } from "./scripts.js";

const TIMEOUT = 240_000;
const EXECUTION_ID = "aex_spike_q5_0001";
const here = dirname(fileURLToPath(import.meta.url));

type Arm = "scrub-off" | "scrub-on" | "turncred" | "hostshell" | "both";
const ARMS: readonly Arm[] = ["scrub-off", "scrub-on", "turncred", "hostshell", "both"];

interface Dump {
  pid: number;
  uid?: number;
  env: Record<string, string>;
  ancestors: Array<{ pid: number; cmdline: string; environ: Record<string, string> | string }>;
}

interface Exposure {
  process: string;
  secrets: string[];
}

function exposures(dump: Dump, secrets: Record<string, string>): Exposure[] {
  const found = (env: Record<string, string>): string[] =>
    Object.entries(secrets).flatMap(([name, value]) => (Object.values(env).some((v) => v.includes(value)) ? [name] : []));
  const out: Exposure[] = [{ process: `self pid=${dump.pid}`, secrets: found(dump.env) }];
  for (const a of dump.ancestors) {
    out.push({
      process: `ancestor pid=${a.pid} ${a.cmdline.slice(0, 80)}`,
      secrets: typeof a.environ === "string" ? [`(${a.environ})`] : found(a.environ),
    });
  }
  return out;
}

function masked(dump: Dump, secrets: Record<string, string>): unknown {
  const values = Object.values(secrets);
  return {
    pid: dump.pid,
    uid: dump.uid,
    env: maskEnv(dump.env, values),
    ancestors: dump.ancestors.map((a) => ({
      pid: a.pid,
      cmdline: values.reduce((s, v) => s.split(v).join("<secret>"), a.cmdline),
      environ: typeof a.environ === "string" ? a.environ : maskEnv(a.environ, values),
    })),
  };
}

describe("q5: what the engine's children can reach", () => {
  for (const arm of ARMS) {
    it(`arm ${arm}`, async () => {
      const label = `q5-${arm}`;
      const dirs = freshDirs(label);
      const bashDump = join(dirs.cwd, "bash-dump.json");
      const mcpDump = join(dirs.root, "mcp-dump.json");
      const BASH = toolId(`q5_${arm.replace("-", "_")}_bash`);
      const MCP = toolId(`q5_${arm.replace("-", "_")}_mcp`);
      const marker = `Q5-${arm.toUpperCase()}`;
      const mock = await startSpikeMock(
        label,
        scenarios([
          {
            marker,
            answer: (c) => {
              if (resultFor(c, MCP) !== undefined) return anthropicText(`${marker} done`);
              if (resultFor(c, BASH) !== undefined) return anthropicToolUses([{ toolCallId: MCP, toolName: "mcp__probe__dump_env", toolInput: {} }]);
              return anthropicToolUses([
                { toolCallId: BASH, toolName: "Bash", toolInput: { command: `${process.execPath} ${join(here, "dump-env.mjs")} ${bashDump}`, description: "dump" } },
              ]);
            },
          },
        ]),
      );
      const root = dirs.root;
      const proxy = await AgentProxy.start({
        ...hermeticCursorConfig({ workspaceRootDir: root } as HermeticEnvironment),
        proxyEndpoint: mock.url,
        stigmerTokenRef: { current: "runner-token-spike-q5" },
      });
      const hostToken = randomBytes(24).toString("hex");
      const turnKey = randomBytes(24).toString("hex");
      proxy.authorizeHost(hostToken);
      const closeTurn = proxy.openTurn({ executionId: EXECUTION_ID, threadId: "thread-q5", turnKey });
      const turnCredential = arm === "turncred" || arm === "both";
      const hostShell = arm === "hostshell" || arm === "both";
      AgentProxy.spikeTurnCredential = turnCredential;
      const secrets = { hostToken, turnKey, executionId: EXECUTION_ID };
      try {
        const env = spikeEnv({
          mockUrl: `${proxy.endpoint}/v1/proxy/llm/anthropic`,
          dirs,
          apiKey: turnCredential ? turnKey : hostToken,
          scrub: arm !== "scrub-off",
          extra: { ANTHROPIC_CUSTOM_HEADERS: `X-Stigmer-Turn-Key: ${turnKey}\nX-Stigmer-Execution-Id: ${EXECUTION_ID}` },
        });
        // The host-served shell: a tool in this process (the SDK host), run
        // with the native shell's environment, so the agent's commands are
        // never the engine's children.
        const hostServer = createSdkMcpServer({
          name: "host",
          tools: [
            tool("bash", "Run a shell command", { command: z.string(), description: z.string().optional() }, async (args) => {
              const out = execFileSync("/bin/bash", ["-c", args.command], { cwd: dirs.cwd, env: buildShellEnv({}), encoding: "utf8" });
              return { content: [{ type: "text", text: out }] };
            }),
          ],
        });
        const run = await runQuery(label, `${marker} dump what you can see`, {
          ...baseOptions(dirs, mock.url),
          env,
          mcpServers: {
            probe: probeMcpServer({ PROBE_MCP_DUMP: mcpDump }, { alwaysLoad: true }),
            ...(hostShell ? { host: hostServer } : {}),
          },
          ...(hostShell ? { toolAliases: { Bash: "mcp__host__bash" } } : {}),
          canUseTool: recordingCanUseTool(label, [], () => ({ allow: true })),
        });
        const dumps: Record<string, unknown> = {};
        const exposed: Record<string, Exposure[]> = {};
        for (const [name, path] of [
          ["bash", bashDump],
          ["mcp", mcpDump],
        ] as const) {
          if (!existsSync(path)) {
            dumps[name] = "no dump written";
            continue;
          }
          const dump = JSON.parse(readFileSync(path, "utf8")) as Dump;
          dumps[name] = masked(dump, secrets);
          exposed[name] = exposures(dump, secrets);
        }
        const facts = {
          arm,
          platform: platform(),
          kernel: release(),
          uid: process.getuid?.(),
          result: resultSummary(run),
          hostEnvNames: Object.keys(process.env).sort(),
          engineEnv: maskEnv(env, Object.values(secrets)),
          exposed,
          dumps,
        };
        writeEvidence(`${label}.facts.json`, facts);
        // No raw secret anywhere in the evidence directory.
        const leaks = readdirSync(EVIDENCE_DIR).filter((f) => {
          const text = readFileSync(join(EVIDENCE_DIR, f), "utf8");
          return text.includes(hostToken) || text.includes(turnKey);
        });
        expect(leaks, "no evidence file carries a raw secret").toEqual([]);
        expect.soft(Object.keys(exposed).length, "both children wrote a dump").toBe(2);
      } finally {
        AgentProxy.spikeTurnCredential = false;
        closeTurn();
        await proxy.close();
        await mock.close();
      }
    }, TIMEOUT);
  }
});
