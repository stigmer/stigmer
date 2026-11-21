#!/usr/bin/env node

/**
 * The build walk: a person's one-line ask to their coding agent, with
 * Stigmer's plugin installed, changes an agent they already have, and the
 * server afterwards holds what was asked and nothing more. The ask
 * (lib/coding-agent-build.mjs, BUILD): "Make invoice-checker check our
 * invoices every Monday at 9 Berlin time, and hook up our ledger API's MCP
 * server at https://mcp.ledgerline.example/mcp so it can use only
 * get_ledger and list_accounts from it."
 *
 * The question bank grades answers and traces; no grader reads the server
 * after a try. This walk does, so it proves the plugin builds: a routine
 * and a plugin holding the MCP server made the way the docs show, the
 * server's two tools named in the full tool-name form, the agent changed
 * from its live definition rather than rewritten, and the routine left off,
 * since switching it on spends the Organization's model keys and no one
 * asked.
 *
 * It needs a coding agent on a real model, so it is in no gate lane: by
 * hand (`make walk-coding-agent-build`). The stage is lib/hermetic-stage.mjs
 * with the question bank's fixture seeded (lib/bank-fixture.mjs): the CLI
 * signed in as the organization's admin, the vendor-aliases skill pushed,
 * invoice-checker and reconciler applied and run once. The project folder
 * holds what a person who set up holds, the agents' manifests under
 * `stigmer/`. The coding agent is Claude Code (`claude -p`, stream-json
 * kept) with the plugin as a release builds it (coding-agents/dist/plugin,
 * `--plugin-dir`), given the ask alone, answered "go ahead with the changes
 * I asked for" when it stops before the state is right, up to `--max-turns`.
 * The plugin reads Stigmer's docs from the live site, as it does for a
 * person.
 *
 * The stage's server starts no sandboxes, so it refuses an Environment that
 * installs packages or limits networking (domain/environment/facts.ts): the
 * ask's second half is an MCP server, which `stigmer mcp add` installs as a
 * plugin without reaching its address, so no one need serve it.
 *
 * Pass when lib/coding-agent-build.mjs's judgeBuild finds nothing wrong in
 * what it reads back (the stage's CLI with `--output json`, and the
 * organization's plugins through the TypeScript SDK on the CLI's own
 * sign-in, since the CLI lists no plugins): one routine names
 * invoice-checker, with Mondays at 9 in Europe/Berlin, not switched on and
 * never started; one plugin holds the MCP server, invoice-checker lists it,
 * and its tools name get_ledger and list_accounts in the full
 * `mcp__plugin_<plugin>_<server>__<tool>` form and nothing wider of that
 * server; invoice-checker's instructions, skills and disallowed tools are
 * what they were before the coding agent started.
 *
 * The stage, the fixture, the project and the turns are every walk's
 * (lib/coding-agent-walk.mjs).
 *
 * Usage: lib/coding-agent-build.mjs, USAGE (`--help` prints it).
 */

import process from "node:process";

import { listedSlugs } from "./lib/bank-fixture.mjs";
import { BUILD, USAGE, judgeBuild, parseBuildArgs } from "./lib/coding-agent-build.mjs";
import { readJson, runMain, runWalk, sdkSession } from "./lib/coding-agent-walk.mjs";

/** The organization's plugins, each as its slug and MCP servers, read through the TypeScript SDK (the CLI lists none). */
async function readPlugins(cliHome) {
  const { client, org } = await sdkSession(cliHome);
  const listed = (await client.plugin.list({ org: org.slug })).entries ?? [];
  return listed.map((plugin) => ({
    metadata: { slug: plugin.metadata?.slug },
    status: {
      mcpServers: (plugin.status?.mcpServers ?? []).map((server) => ({
        name: server.name,
        http: server.transport?.case === "http" ? { url: server.transport.value.url } : undefined,
      })),
    },
  }));
}

/** What the server holds now: the agent, every routine with its fires, every plugin. */
async function readState({ shim, env, cliHome }) {
  const agent = await readJson(shim, env, ["get", "agent", BUILD.agent]);
  const routines = [];
  for (const slug of listedSlugs(JSON.stringify((await readJson(shim, env, ["list", "routines"])) ?? []))) {
    const routine = await readJson(shim, env, ["get", "routine", slug]);
    const fires = await readJson(shim, env, ["routine", "fires", slug]);
    const fired = Array.isArray(fires) ? fires.length : Array.isArray(fires?.entries) ? fires.entries.length : Array.isArray(fires?.fires) ? fires.fires.length : 0;
    if (routine !== undefined) routines.push({ routine, fires: fired });
  }
  return { agent, routines, plugins: await readPlugins(cliHome) };
}

async function main() {
  const args = parseBuildArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  await runWalk({
    name: "coding-agent-build",
    ask: BUILD.ask,
    skill: "stigmer-build",
    audience: "https://build-walk.stigmer.test/api",
    nativeClientId: "stigmer-build-walk",
    args,
    readState,
    checkBefore: (before) => [
      ...(before.agent === undefined ? [`${BUILD.agent} was not seeded`] : []),
      ...(before.routines.length > 0 || before.plugins.length > 0 ? ["the stage held a routine or a plugin before the walk"] : []),
    ],
    judge: (before, now) => judgeBuild({ agentBefore: before.agent, agentAfter: now.agent, routines: now.routines, plugins: now.plugins }),
    passed: `one routine on ${BUILD.agent}, Mondays at 9 ${BUILD.timeZone}, off and never started; the MCP server a plugin it lists, its tools ${BUILD.mcpTools.join(" and ")} alone; its instructions, skills and disallowed tools as they were`,
  });
}

runMain("coding-agent-build", main);
