// Where the first-hour journey runs: the server, console, model, tool server
// and packages a developer meets, as configuration, so the same specs walk
// the hour on the Gate's local stack and on any deployed Stigmer.
//
// The local target is the Gate's: the OIDC stack global-setup boots (the
// hermetic issuer, the mock model, the OAuth MCP fixture whose login page
// carries an opener policy), the console `next dev` serves, and this
// checkout's CLI and packed kit. A deployed target is a module named by
// STIGMER_E2E_JOURNEY_TARGET (an absolute path), whose default export is a
// function returning a JourneyTarget; the run then sets
// STIGMER_E2E_BASE_URL to its console, which skips the local stack and the
// dev server (global-setup.ts, playwright.config.ts). Nothing here names a
// deployment: a deployment's module says what it is.
//
// The parts:
//   - `signUp`: a new person through the console's sign-up door, ending
//     signed in to the console in `page`'s context;
//   - `cliBackend`: how the CLI finds the server before the docs' Stigmer
//     Cloud tab runs (`stigmer auth login`): the CLI's own default, or a
//     backend added by address, as a self-hosted reader does first;
//   - `model`: the mock (a script per tool step) or a live provider's key,
//     which the step saves in the console's Models & providers as the docs
//     say;
//   - `toolServer`: the OAuth MCP server the agent calls, and whether a
//     deployed runner reaches it only from an agent with a computer
//     (`loopback`) or from anywhere (`public`);
//   - `packages`: the kit the app installs and the CLI the person runs,
//     this checkout's or a published version's;
//   - `cleanup`: whatever the target made for the person, after the walk.

import { pathToFileURL } from "node:url";
import type { Page } from "@playwright/test";
import { FIRST_HOUR_STACK, OIDC_STACK } from "../../fixtures/oidc";
import { getOAuthMcpFixture } from "../../fixtures/oauth-mcp";
import { getMockControlUrl } from "../mock-llm-control";

/** How a tool step's model is driven: a script on the mock, or a live provider on a key. */
export type JourneyModel =
  | { readonly kind: "mock"; readonly controlUrl: string }
  | { readonly kind: "live"; readonly provider: "Anthropic"; readonly key: string };

/** The tool server the agent calls, and how a runner reaches it. */
export interface JourneyToolServer {
  /** The MCP server's URL, as the console's "Add MCP server" takes it. */
  readonly mcpUrl: string;
  /** `loopback`: only an agent with a computer reaches it; `public`: any agent does. */
  readonly reach: "loopback" | "public";
}

/** Where the person's packages come from. */
export type JourneyPackages =
  | { readonly kind: "checkout" }
  | {
      readonly kind: "registry";
      readonly version: string;
      /** Where `@stigmer/*` installs from, when not npm's default registry; every other package comes from npm's. */
      readonly registry?: string;
    };

/** How the CLI finds the server before `stigmer auth login`. */
export type JourneyCliBackend =
  | { readonly kind: "default" }
  | { readonly kind: "address"; readonly name: string; readonly endpoint: string };

export interface JourneyTarget {
  /** A short name for reports: `local`, or the deployment's own. */
  readonly name: string;
  /** The console's origin. */
  readonly consoleUrl: string;
  /** The API's origin, where the console's calls go. */
  readonly apiUrl: string;
  /** Signs a new person up through the console's sign-up door; `page` ends signed in. Returns their address. */
  signUp(page: Page): Promise<string>;
  /** Answers a login page the CLI or a tool server opened in the person's browser, when it asks for more than a redirect. */
  consentToCli?(page: Page): Promise<void>;
  readonly cliBackend: JourneyCliBackend;
  readonly model: JourneyModel;
  toolServer(): Promise<JourneyToolServer>;
  readonly packages: JourneyPackages;
  cleanup(): Promise<void>;
}

/** The variable naming a deployed target's module. */
export const JOURNEY_TARGET_VARIABLE = "STIGMER_E2E_JOURNEY_TARGET";

/**
 * The run's target: the deployed one STIGMER_E2E_JOURNEY_TARGET names, or
 * the local stack's. `null` when neither is there (a stack booted without
 * the OIDC shape and the mock model), with the reason, for a visible skip.
 */
export async function loadJourneyTarget(): Promise<{ target: JourneyTarget } | { skip: string }> {
  const module = process.env[JOURNEY_TARGET_VARIABLE];
  if (module !== undefined && module !== "") {
    const loaded = (await import(pathToFileURL(module).href)) as { default: () => JourneyTarget | Promise<JourneyTarget> };
    return { target: await loaded.default() };
  }
  const local = localTarget();
  return local === null
    ? { skip: "needs the first-hour stack (the OIDC posture, the mock model, the OAuth MCP fixture) — run `make test-e2e-first-hour`" }
    : { target: local };
}

const API_PORT = process.env.STIGMER_E2E_API_PORT ?? "7234";

/** The Gate's stack as a target, or null when this run did not boot it. */
export function localTarget(): JourneyTarget | null {
  const controlUrl = getMockControlUrl();
  const oauthMcp = getOAuthMcpFixture();
  if (!OIDC_STACK || !FIRST_HOUR_STACK || controlUrl === null || oauthMcp === null) return null;
  return {
    name: "local",
    consoleUrl: process.env.STIGMER_E2E_BASE_URL ?? "http://localhost:3000",
    apiUrl: `http://localhost:${API_PORT}`,
    // The hermetic issuer signs its one person in at once, sign-up asked
    // for or not, and the server's first person owns the organization it
    // made: the first sign-up of a fresh server.
    signUp: async (page) => {
      await page.goto("/login?signup=1");
      await page.waitForURL((url) => url.pathname !== "/login" && url.pathname !== "/auth/callback", { timeout: 30_000 }).catch((error: unknown) => {
        throw new Error(`the sign-up door never handed the person to the issuer and back; the console stayed at ${page.url()}`, { cause: error });
      });
      return "";
    },
    cliBackend: { kind: "address", name: "first-hour", endpoint: `localhost:${API_PORT}` },
    model: { kind: "mock", controlUrl },
    toolServer: async () => ({ mcpUrl: oauthMcp.mcpUrl, reach: "loopback" }),
    packages: { kind: "checkout" },
    cleanup: async () => {},
  };
}
