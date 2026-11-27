// The plugin-manage project's person: every way to manage a plugin, walked
// on the first-hour stack after the journey (tests/plugin-manage), with a
// browser context and a CLI of its own.
//
// The stack's hermetic issuer serves one person, so this is the journey's
// person, signed in afresh in a context of their own, with a scratch CLI of
// their own (helpers/cli.ts) signed in through that browser as the journey's
// is. Everything the specs make is named for them (plugins `manage-*`,
// agents `manage-*-agent`), never the journey's `app-tools` or its agent, so
// the journey's resources are untouched whichever runs first.
//
// A change of address needs a second address that signs in: a second OAuth
// MCP fixture (fixtures/oauth-mcp.ts), started here for the worker with the
// same opener policy the stack's own carries, and stopped with it.
//
// Local stack only: a deployed target's person and tool servers are the
// journey's to walk, and this project would make and remove plugins there.

import type { ChildProcess } from "node:child_process";
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { create } from "@bufbuild/protobuf";
import { createNodeClient } from "@stigmer/client/node";
import type { Stigmer } from "@stigmer/client";
import { ListMyOrganizationsInputSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/io_pb";
import { journeyCli, type JourneyCli } from "../helpers/cli";
import { expectCliSucceeded } from "../helpers/first-hour/steps";
import { JOURNEY_TARGET_VARIABLE, localTarget, type JourneyTarget } from "../helpers/first-hour/target";
import { journeySkipReason } from "./first-hour";
import { startOAuthMcpFixture } from "./oauth-mcp";

/** The person managing plugins, and the two addresses their servers move between. */
export interface Manager {
  readonly target: JourneyTarget;
  readonly cli: JourneyCli;
  readonly context: BrowserContext;
  /** The person's console tab. */
  readonly page: Page;
  /** The person's Organization, by slug. */
  readonly org: string;
  /** The stack's OAuth MCP server's URL: where each plugin starts. */
  readonly first: string;
  /** A second OAuth MCP server of this worker's, by URL: where a change of address moves to. */
  readonly second: string;
  /** A client as the person, on the bearer the console's own calls carry. */
  asPerson(): Promise<Stigmer>;
}

/**
 * Why this project cannot run here, or null when it can. A deployed target
 * skips visibly; a local stack without the first-hour shape skips as the
 * journey does (and fails inside the Gate, as the journey does).
 */
export function manageSkipReason(): string | null {
  if ((process.env[JOURNEY_TARGET_VARIABLE] ?? "") !== "") {
    return "managing plugins runs on the local first-hour stack only: on a deployed target it would make and remove plugins there";
  }
  return journeySkipReason();
}

export const test = base.extend<object, { manager: Manager }>({
  manager: [
    async ({ browser }, use) => {
      const target = localTarget();
      if (target === null) throw new Error(manageSkipReason() ?? "the first-hour stack is not booted");
      const first = await target.toolServer();
      const { child: secondProcess, ready: second } = await startOAuthMcpFixture({ openerPolicy: "same-origin" });
      const cli = journeyCli(target.packages);
      const context = await browser.newContext({ baseURL: target.consoleUrl });
      const apiOrigin = new URL(target.apiUrl).origin;
      let bearer: string | undefined;
      context.on("request", (request) => {
        const authorization = request.headers()["authorization"];
        if (new URL(request.url()).origin === apiOrigin && authorization?.startsWith("Bearer ")) bearer = authorization.slice(7);
      });
      const page = await context.newPage();
      const asPerson = async (): Promise<Stigmer> => {
        if (bearer === undefined) {
          await page.goto("/");
          await expect.poll(() => bearer, { timeout: 30_000, message: "the console's calls carry the person's bearer" }).toBeDefined();
        }
        return createNodeClient({ baseUrl: target.apiUrl, getAccessToken: () => bearer ?? null });
      };
      try {
        // The hermetic issuer signs its one person in at once.
        await target.signUp(page);
        await expect(page.getByRole("navigation").first()).toBeVisible({ timeout: 30_000 });
        const person = await asPerson();
        const [organization] = (await person.organization.listMine(create(ListMyOrganizationsInputSchema, {}))).entries;
        const org = organization?.metadata?.slug ?? "";
        expect(org, "the person has an Organization").not.toBe("");
        if (target.cliBackend.kind === "address") {
          const { name, endpoint } = target.cliBackend;
          expectCliSucceeded(await cli.line(`stigmer config backend add ${name} --endpoint ${endpoint}`));
          expectCliSucceeded(await cli.line(`stigmer config backend use ${name}`));
        }
        expectCliSucceeded(
          await cli.line("stigmer auth login", {
            timeoutMs: 120_000,
            onBrowser: async (url) => {
              const login = await context.newPage();
              try {
                await login.goto(url);
                await target.consentToCli?.(login);
                await login.waitForURL((at) => at.hostname === "127.0.0.1" || at.hostname === "localhost", { timeout: 60_000 });
              } finally {
                await login.close();
              }
            },
          }),
        );
        expectCliSucceeded(await cli.line(`stigmer config context set --org ${org}`));
        await use({ target, cli, context, page, org, first: first.mcpUrl, second: second.mcpUrl, asPerson });
      } finally {
        await context.close();
        cli.dispose();
        stop(secondProcess);
      }
    },
    { scope: "worker", timeout: 600_000 },
  ],
});

function stop(child: ChildProcess): void {
  child.removeAllListeners("exit");
  child.kill();
}

/**
 * Consents in a tool server's login window the browser opened: the fixture's
 * consent page's Allow link, then the window closes (a window that stays
 * open fails naming the page it stopped on).
 */
export async function consentInPopup(popup: Page): Promise<void> {
  await popup.getByRole("link", { name: "Allow" }).click({ timeout: 30_000 });
  let lastUrl = popup.url();
  popup.on("framenavigated", (frame) => {
    if (frame === popup.mainFrame()) lastUrl = frame.url();
  });
  await popup.waitForEvent("close", { timeout: 30_000 }).catch((error: unknown) => {
    throw new Error(`the sign-in window did not close; it stopped on ${lastUrl}`, { cause: error });
  });
}

/** An Agent file of the person's own: the quickstart agent's shape, with a computer, listing `plugins` when given. */
export function agentFile(name: string, plugins: readonly string[]): string {
  return [
    "apiVersion: agentic.stigmer.ai/v1",
    "kind: Agent",
    "metadata:",
    `  name: ${name}`,
    "spec:",
    "  description: Uses the plugin it is given.",
    "  instructions: |",
    "    You call the tools you are asked to call, with the text you are given.",
    "  disallowed_tools: [Bash]",
    // The stack's tool servers listen on loopback, which only an agent with a computer reaches.
    "  computer: COMPUTER_REQUIRED",
    ...(plugins.length > 0 ? ["  plugins:", ...plugins.flatMap((slug) => ["    - kind: plugin", `      slug: ${slug}`])] : []),
    "",
  ].join("\n");
}

export { expect };
