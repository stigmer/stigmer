/**
 * Pins the server's copy of the hosts the runner itself reaches
 * (`stigmer-server/src/sandbox/runner-lanes.ts`) to the runner's own: a
 * sandbox whose Environment limits networking keeps those hosts open beside
 * its listed ones, so a copy that drifts from the runner's lanes closes a
 * host a turn needs.
 *
 *   - `CURSOR_HOSTS` equals the runner's Cursor domains, the
 *     `CURSOR_DOMAINS` list in `activities/execute-cursor/fetch-interceptor.ts`
 *     (not exported, so read from the file's text);
 *   - `ANTHROPIC_DEFAULT_ROOT` and `OPENAI_DEFAULT_ROOT` equal the roots the
 *     runner's terminate-mode lanes fall back to (`agent-proxy/lanes.ts`,
 *     read from the file's text).
 *
 * The server module is loaded by URL, as `attach/__tests__/push.test.ts`
 * loads the server's naming module, so the runner's typecheck never follows
 * the server's imports.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

interface ServerRunnerLanes {
  readonly CURSOR_HOSTS: readonly string[];
  readonly ANTHROPIC_DEFAULT_ROOT: string;
  readonly OPENAI_DEFAULT_ROOT: string;
}

async function serverRunnerLanes(): Promise<ServerRunnerLanes> {
  const path = resolve(import.meta.dirname, "../../../../stigmer-server/src/sandbox/runner-lanes.ts");
  return (await import(pathToFileURL(path).href)) as ServerRunnerLanes;
}

function runnerSource(relative: string): string {
  return readFileSync(resolve(import.meta.dirname, "..", "..", relative), "utf8");
}

/** The string literals of the runner's `CURSOR_DOMAINS` array. */
function runnerCursorDomains(): string[] {
  const match = /const CURSOR_DOMAINS = \[([^\]]*)\];/.exec(runnerSource("activities/execute-cursor/fetch-interceptor.ts"));
  expect(match, "fetch-interceptor.ts declares CURSOR_DOMAINS as an array literal").not.toBeNull();
  const domains = [...match![1]!.matchAll(/"([^"]+)"/g)].map((literal) => literal[1]!);
  expect(domains.length, "CURSOR_DOMAINS names its hosts as string literals").toBeGreaterThan(0);
  return domains;
}

/** The literal a function in `agent-proxy/lanes.ts` falls back to. */
function laneDefault(fn: string, fallback: RegExp): string {
  const source = runnerSource("agent-proxy/lanes.ts");
  const start = source.indexOf(`function ${fn}(`);
  expect(start, `lanes.ts declares ${fn}`).toBeGreaterThanOrEqual(0);
  const body = source.slice(start, source.indexOf("\n}\n", start));
  const match = fallback.exec(body);
  expect(match, `${fn} falls back to a string literal`).not.toBeNull();
  return match![1]!;
}

describe("the server's copy of the runner's platform lanes", () => {
  it("names the runner's Cursor hosts", async () => {
    const { CURSOR_HOSTS } = await serverRunnerLanes();
    expect([...CURSOR_HOSTS].sort()).toEqual(runnerCursorDomains().sort());
  });

  it("names the runner's default Anthropic root", async () => {
    const { ANTHROPIC_DEFAULT_ROOT } = await serverRunnerLanes();
    expect(ANTHROPIC_DEFAULT_ROOT).toBe(laneDefault("anthropicBase", /\?\? "([^"]+)"/));
    expect(ANTHROPIC_DEFAULT_ROOT).toBe("https://api.anthropic.com");
  });

  it("names the runner's default OpenAI root", async () => {
    const { OPENAI_DEFAULT_ROOT } = await serverRunnerLanes();
    expect(OPENAI_DEFAULT_ROOT).toBe(laneDefault("openAiBase", /\|\| "([^"]+)"/));
    expect(OPENAI_DEFAULT_ROOT).toBe("https://api.openai.com/v1");
  });
});
