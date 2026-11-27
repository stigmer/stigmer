// One developer's first hour, as one person across the first-hour specs:
// a worker-scoped `journey` holding the target (helpers/first-hour/target.ts),
// the person's CLI (helpers/cli.ts), and the browser context the person
// signed up in, so every spec after the first finds them signed in to the
// console, the CLI and (once a step has signed in) the tool server, as one
// developer would be.
//
// The specs run in order in one worker (`--workers=1`, files named in
// order). Each step records itself when it finishes (`reach`), in this
// worker and in a file of the run's (the project's output folder, emptied
// at each run's start), and a later step first requires the steps it builds
// on (`require`), so a red step fails there, naming itself, and every step
// after it fails at once naming the step that stopped the journey instead
// of a symptom of it. A failure restarts the worker, whose new journey has
// reached nothing; the file still says which step stopped it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { createNodeClient } from "@stigmer/client/node";
import type { Stigmer } from "@stigmer/client";
import { journeyCli, type JourneyCli } from "../helpers/cli";
import { JOURNEY_TARGET_VARIABLE, loadJourneyTarget, localTarget, type JourneyTarget, type JourneyToolServer } from "../helpers/first-hour/target";

/** The steps, in the order the specs take them. */
export const STEPS = ["sign-up-to-an-agent", "console-tool-call", "embedded-tool-call", "terminal-tool-call", "agent-server-tool-call"] as const;
export type Step = (typeof STEPS)[number];

/** The tool server's name in the console, which is its plugin's too. */
export const TOOL_SERVER = "app-tools";
/** The tool every step's agent calls: the fixture's `echo`, which answers its `text`. */
export const TOOL = "echo";
/** The name a model calls a plugin server's tool by (mcp__plugin_<plugin>_<server>__<tool>). */
export const TOOL_AS_CALLED = `mcp__plugin_${TOOL_SERVER}_${TOOL_SERVER}__${TOOL}`;
/** The quickstart's agent, which every step uses. */
export const AGENT = "variance-reporter";

export interface Journey {
  readonly target: JourneyTarget;
  readonly cli: JourneyCli;
  /** The person's browser: one context for the whole hour. */
  readonly context: BrowserContext;
  /** The person's console tab. */
  readonly page: Page;
  /** What the steps learned on the way. */
  readonly found: {
    email?: string;
    org?: string;
    toolServer?: JourneyToolServer;
  };
  /** Fails unless every step before `step` finished in this worker, naming the first that did not. */
  require(step: Step): void;
  /** Records that `step` finished. */
  reach(step: Step): void;
  /** A client as the person, on the bearer the console's own calls carry. */
  asPerson(): Promise<Stigmer>;
}

/**
 * Why the journey cannot run on this stack, or null when it can (a sync
 * check for `test.skip`). Inside the gate (STIGMER_TEST_GATE=1) a stack
 * without the journey's parts fails instead: its lane exists for this
 * journey, and would otherwise pass with every step skipped.
 */
export function journeySkipReason(): string | null {
  if ((process.env[JOURNEY_TARGET_VARIABLE] ?? "") !== "") return null;
  if (localTarget() !== null) return null;
  const reason = "needs the first-hour stack (the OIDC posture, the mock model, the OAuth MCP fixture) — run `make test-e2e-first-hour`";
  if (process.env.STIGMER_TEST_GATE === "1") throw new Error(`the first-hour journey cannot run in the gate: it ${reason}`);
  return reason;
}

export const test = base.extend<object, { journey: Journey }>({
  journey: [
    async ({ browser }, use, workerInfo) => {
      const reachedFile = join(workerInfo.project.outputDir, "first-hour-reached.json");
      const reachedInRun = (): Step[] => (existsSync(reachedFile) ? (JSON.parse(readFileSync(reachedFile, "utf8")) as Step[]) : []);
      const loaded = await loadJourneyTarget();
      if ("skip" in loaded) throw new Error(loaded.skip);
      const target = loaded.target;
      const cli = journeyCli(target.packages);
      const context = await browser.newContext({ baseURL: target.consoleUrl });
      const apiOrigin = new URL(target.apiUrl).origin;
      let bearer: string | undefined;
      context.on("request", (request) => {
        const authorization = request.headers()["authorization"];
        if (new URL(request.url()).origin === apiOrigin && authorization?.startsWith("Bearer ")) bearer = authorization.slice(7);
      });
      const page = await context.newPage();
      const reached = new Set<Step>();
      const journey: Journey = {
        target,
        cli,
        context,
        page,
        found: {},
        require(step) {
          const before = STEPS.slice(0, STEPS.indexOf(step));
          const unfinished = before.find((earlier) => !reachedInRun().includes(earlier));
          if (unfinished !== undefined) throw new Error(`the journey stopped before ${step}: ${unfinished} did not finish`);
          if (before.some((earlier) => !reached.has(earlier))) {
            throw new Error(`the journey stopped before ${step}: the person's browser and CLI went with the worker a failure ended`);
          }
        },
        reach(step) {
          reached.add(step);
          mkdirSync(dirname(reachedFile), { recursive: true });
          writeFileSync(reachedFile, JSON.stringify([...new Set([...reachedInRun(), step])]));
        },
        async asPerson() {
          if (bearer === undefined) {
            await page.goto("/");
            await expect.poll(() => bearer, { timeout: 30_000, message: "the console's calls carry the person's bearer" }).toBeDefined();
          }
          return createNodeClient({ baseUrl: target.apiUrl, getAccessToken: () => bearer ?? null });
        },
      };
      try {
        await use(journey);
      } finally {
        await context.close();
        cli.dispose();
        await target.cleanup();
      }
    },
    { scope: "worker", timeout: 600_000 },
  ],
});

export { expect };
