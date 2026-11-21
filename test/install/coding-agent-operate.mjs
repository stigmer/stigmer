#!/usr/bin/env node

/**
 * The operate walk: a person's one-line ask to their coding agent, with
 * Stigmer's plugin installed, makes their CI a key, and the server
 * afterwards holds what was asked and nothing more. The ask
 * (lib/coding-agent-operate.mjs, OPERATE): "Make CI a key that can run
 * agents but not change them. It's for our GitHub Actions nightly that runs
 * invoice-checker."
 *
 * The question bank grades answers; its CI-key case passes an answer that
 * only proposes. This walk reads the server after the coding agent acts, so
 * it proves the plugin makes the key right: a service account of the
 * organization with the Member role (it starts conversations with the
 * organization's agents and changes none an admin made), one key for it,
 * saved to a file through `--save-to-env` and never shown, the person's own
 * keys and the agents untouched.
 *
 * It needs a coding agent on a real model, so it is in no gate lane: by
 * hand (`make walk-coding-agent-operate`). The stage, the fixture (which
 * holds no service account), the project and the turns are every walk's
 * (lib/coding-agent-walk.mjs); the coding agent is answered "go ahead with
 * the changes I asked for" at each stop, a yes to the ask alone.
 *
 * Pass when lib/coding-agent-operate.mjs's judgeOperate finds nothing wrong
 * in what it reads back:
 * - `stigmer service-account list` names one service account; its
 *   Organization role, read through the TypeScript SDK on the stage CLI's
 *   sign-in (the account carries none; its grant does), is member; and
 *   `stigmer service-account keys <name>` lists one key;
 * - the file the CLI named on its saved-key line, read from the coding
 *   agent's stream, holds a key that `stigmer apikey fingerprint` resolves
 *   to that key;
 * - no key appears anywhere in the stream, neither a key's shape nor the
 *   saved key's text;
 * - `stigmer list apikeys`, the caller's own keys, lists what it listed
 *   before, and invoice-checker and reconciler are as they were.
 *
 * Usage: lib/coding-agent-operate.mjs, USAGE (`--help` prints it).
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import process from "node:process";
import { OPERATE, USAGE, judgeOperate, keyInEnvFile, parseOperateArgs, savedKeyFile, streamText } from "./lib/coding-agent-operate.mjs";
import { readJson, runMain, runWalk, sdkSession } from "./lib/coding-agent-walk.mjs";

/** The entries of a `--output json` list, whichever list shape it has. */
function entries(json) {
  return Array.isArray(json) ? json : Array.isArray(json?.entries) ? json.entries : Array.isArray(json?.items) ? json.items : [];
}

function ids(json) {
  return entries(json)
    .map((item) => item?.metadata?.id)
    .filter((id) => typeof id === "string" && id !== "");
}

/** Each principal's organization role codes, by principal id, read through the SDK. */
async function organizationRoles(cliHome) {
  const { client, org } = await sdkSession(cliHome);
  const access = await client.grant.listResourceAccessByPrincipal({ resource: { kind: "organization", id: org.id }, includeInherited: false });
  return new Map((access.entries ?? []).map((entry) => [entry.principal?.id ?? "", (entry.roles ?? []).map((grant) => grant.role?.code ?? "")]));
}

/** The key the coding agent saved: the file the CLI named, the key in it, and the id the server knows it by. */
async function savedKey(shim, env, projectDir, stream) {
  const file = savedKeyFile(stream);
  if (file === undefined) return { file, rawKey: undefined, keyId: undefined };
  const path = isAbsolute(file) ? file : join(projectDir, file);
  const rawKey = existsSync(path) ? keyInEnvFile(readFileSync(path, "utf8")) : undefined;
  if (rawKey === undefined) return { file, rawKey, keyId: undefined };
  const key = await readJson(shim, env, ["apikey", "fingerprint", rawKey]);
  return { file, rawKey, keyId: key?.metadata?.id };
}

/** What the server holds now, and what the coding agent's stream says. */
async function readState({ shim, env, cliHome, projectDir, streamPath }) {
  const accounts = entries(await readJson(shim, env, ["service-account", "list"]));
  const roles = accounts.length === 0 ? new Map() : await organizationRoles(cliHome);
  const serviceAccounts = [];
  for (const account of accounts) {
    const name = account?.metadata?.name ?? account?.metadata?.slug ?? "";
    const held = roles.get(account?.metadata?.id ?? "") ?? [];
    serviceAccounts.push({
      name,
      role: held.length === 1 ? held[0] : held.length === 0 ? undefined : held.join("+"),
      keys: ids(await readJson(shim, env, ["service-account", "keys", name])),
    });
  }
  const agents = {};
  for (const agent of OPERATE.agents) agents[agent] = await readJson(shim, env, ["get", "agent", agent]);
  const stream = existsSync(streamPath) ? streamText(readFileSync(streamPath, "utf8")) : "";
  return {
    serviceAccounts,
    myKeys: ids(await readJson(shim, env, ["list", "apikeys"])),
    agents,
    saved: await savedKey(shim, env, projectDir, stream),
    stream,
  };
}

async function main() {
  const args = parseOperateArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  await runWalk({
    name: "coding-agent-operate",
    ask: OPERATE.ask,
    skill: "stigmer-operate",
    audience: "https://operate-walk.stigmer.test/api",
    nativeClientId: "stigmer-operate-walk",
    args,
    readState,
    checkBefore: (before) => [
      ...(before.serviceAccounts.length > 0 ? ["the stage held a service account before the walk"] : []),
      ...OPERATE.agents.filter((agent) => before.agents[agent] === undefined).map((agent) => `${agent} was not seeded`),
    ],
    judge: judgeOperate,
    passed: `one service account with the ${OPERATE.role} role and one key, saved to a file and never shown; the person's own keys and ${OPERATE.agents.join(" and ")} as they were`,
  });
}

runMain("coding-agent-operate", main);
