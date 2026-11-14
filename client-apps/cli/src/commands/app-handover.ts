// `stigmer app-handover --stack <stack> --agent <slug> [--write <dir>]` — the
// code that puts an agent's chat in your own app.
//
// Exactly what the console's agent page hands over on its In your app tab,
// from the one writer (`buildAppHandover`, `@stigmer/client`): for a server
// that signs people in, a token route for your backend (`GET
// /api/stigmer-token`, minted with an admin service account's key read from
// `STIGMER_API_KEY`, for the user your own `currentUser` names) and the chat
// component; for a server that trusts every caller (`stigmer up`), the
// development chat alone. Which one is the server's answer
// (`getServerInfo().authenticationRequired`), as the tab decides.
//
// The address written into the code is the backend's as a browser reaches
// it: `https://<host>` for a TLS endpoint (`:443` dropped), `http://<host>:<port>`
// for a plaintext one, since one port serves the browser's protocol and gRPC.
// Printed by default; `--write <dir>` writes the two files under dir (the
// handover's own paths, e.g. `app/api/stigmer-token/route.ts`), refusing to
// overwrite a file unless `--force`, and prints what to install.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Command } from "commander";
import type { AppHandover, AppHandoverFile, AppHandoverMode, AppHandoverStack } from "@stigmer/client";
import { ensureAuthenticated, resolveOrganization, resolveServerAddress } from "../config/index.js";
import { CliExitError, ExitCode, UsageError } from "../errors/index.js";
import { type OutputFlags, CommandResult, renderResult } from "../output/index.js";
import { VERSION } from "../version.js";
import { addResultFlags, globalOrg, resultFormat } from "./shared.js";

interface HandoverFlags extends OutputFlags {
  stack?: string;
  agent?: string;
  write?: string;
  force?: boolean;
}

const STACKS: readonly AppHandoverStack[] = ["nextjs", "node", "python", "go", "java"];
const SET_ORG_WITH = ["stigmer app-handover ... --org <org>", "stigmer config context set --org <org>"];
const RELEASE = /^\d+\.\d+\.\d+$/;

export function registerAppHandover(program: Command): void {
  const command = program
    .command("app-handover")
    .description("print or write the token route and chat that put an agent's chat in your own app")
    .requiredOption("--stack <stack>", `your backend: ${STACKS.join(", ")}`)
    .requiredOption("--agent <slug>", "the agent the chat talks to")
    .option("--write <dir>", "write the files under this folder (your app's root) instead of printing them")
    .option("-f, --force", "with --write, overwrite files that are already there")
    .action(async (options: HandoverFlags, cmd: Command) => {
      const format = resultFormat(options);
      const stack = parseStack(options.stack ?? "");
      const [{ connectBackend }, { currentOrganization }, { buildAppHandover }] = await Promise.all([
        import("../backend.js"),
        import("../client/current-organization.js"),
        import("@stigmer/client"),
      ]);
      const client = connectBackend();
      ensureAuthenticated(client.config);
      const organization = await currentOrganization(
        client.stigmer,
        resolveOrganization(client.config, globalOrg(cmd)),
        SET_ORG_WITH,
      );
      const org = organization.metadata?.slug ?? "";
      const agent = (options.agent ?? "").trim();
      await requireAgent(client.stigmer, org, agent);
      const info = await client.serverInfo();
      const mode: AppHandoverMode = info.authenticationRequired === false ? "local" : "sign-in";
      const handover = buildAppHandover({
        mode,
        stack,
        baseUrl: browserBaseUrl(resolveServerAddress(client.config).address),
        org,
        agent,
        sdkVersion: RELEASE.test(info.version) ? info.version : RELEASE.test(VERSION) ? VERSION : undefined,
      });
      if (options.write === undefined) {
        process.stdout.write(printedHandover(handover, mode));
        return;
      }
      renderResult(writeHandover(handover, mode, options.write, options.force === true), format);
    });
  addResultFlags(command);
}

/** The stack `--stack` names. */
export function parseStack(value: string): AppHandoverStack {
  const stack = value.trim().toLowerCase().replace(/^next(\.js)?$/, "nextjs");
  if ((STACKS as readonly string[]).includes(stack)) return stack as AppHandoverStack;
  throw new UsageError(`unknown stack "${value}"\n\nUse --stack ${STACKS.join(", ")}.`);
}

/**
 * The address a browser reaches a gRPC endpoint at: `https://host` for
 * `:443`, `http://host:port` otherwise, and a loopback or unported host as
 * the client dials it. Pure.
 */
export function browserBaseUrl(endpoint: string): string {
  const bare = endpoint.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const match = /^(.*):(\d+)$/.exec(bare);
  if (match === null) {
    const host = bare.toLowerCase();
    const loopback = host === "localhost" || host.startsWith("127.") || host === "[::1]";
    return `${loopback ? "http" : "https"}://${bare}`;
  }
  const [, host, port] = match;
  return port === "443" ? `https://${host}` : `http://${host}:${port}`;
}

/** The handover as text to read or paste: each file under its path, with what to install. Pure. */
export function printedHandover(handover: AppHandover, mode: AppHandoverMode): string {
  const parts: string[] = [];
  if (mode === "local") {
    parts.push(
      "This server trusts every caller, so this is the development chat: it sends no token.",
      "To go live, run the agent on a server that signs people in, and run this again there.",
      "",
    );
  }
  for (const file of filesOf(handover)) {
    parts.push(`# ${file.file}`, `# install: ${file.install.replace(/\n/g, "\n#   ")}`, "", file.code.trimEnd(), "");
  }
  return `${parts.join("\n")}\n`;
}

/** Write the handover's files under `root`, refusing to overwrite unless `force`. */
export function writeHandover(handover: AppHandover, mode: AppHandoverMode, root: string, force: boolean): CommandResult {
  const files = filesOf(handover);
  const target = resolve(root);
  const existing = files.map((f) => join(target, f.file)).filter((path) => existsSync(path));
  if (existing.length > 0 && !force) {
    throw new CliExitError(
      `${existing.map(shown).join(", ")} ${existing.length === 1 ? "is" : "are"} already there`,
      ExitCode.Usage,
      ["Keep yours and print the code instead (drop --write), or overwrite with --force."],
    );
  }
  for (const file of files) {
    const path = join(target, file.file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.code);
  }
  const written = files.map((f) => shown(join(target, f.file)));
  const result = CommandResult.success(`Wrote ${written.join(" and ")}`).withData({ mode, files: written });
  for (const file of files) {
    result.hint(
      file.installLanguage === "xml"
        ? `For ${file.file}: add the Maven dependency the printed handover names (drop --write to see it)`
        : `For ${file.file}: ${file.install.split("\n")[0]}`,
    );
  }
  if (mode === "sign-in") {
    result
      .hint("Replace currentUser in the route with your app's own sign-in.")
      .hint("Put the admin service account's key in STIGMER_API_KEY, in an env file git ignores.");
  } else {
    result.hint("This is the development chat: it sends no token, for a server that trusts every caller.");
  }
  return result;
}

function filesOf(handover: AppHandover): AppHandoverFile[] {
  return handover.backend === undefined ? [handover.chat] : [handover.backend, handover.chat];
}

async function requireAgent(stigmer: import("@stigmer/client").Stigmer, org: string, slug: string): Promise<void> {
  if (slug === "") throw new UsageError("--agent needs the agent's slug");
  try {
    await stigmer.agent.getByReference({ org, slug });
  } catch (err) {
    const { classify } = await import("../errors/index.js");
    const { Code } = await import("@connectrpc/connect");
    if (classify(err)?.code === Code.NotFound) {
      throw new CliExitError(
        `no agent "${slug}" in ${org}`,
        ExitCode.NotFound,
        ["See the organization's agents: stigmer list agents"],
        { cause: err },
      );
    }
    throw err;
  }
}

function shown(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel.startsWith("..") ? path : rel;
}
