/**
 * The operate walk's pure parts (test/install/coding-agent-operate.mjs): the
 * one-line ask a person gives their coding agent for a CI key, what the
 * server must hold afterwards, the judge that reads that state and names
 * every check it fails, where the key was saved, and the walk's flags. Held
 * by lib/coding-agent-operate.test.mjs.
 *
 * The state is what the walk reads back:
 * - every service account of the organization, with its organization role
 *   (read through the TypeScript SDK: the account carries none, its grant
 *   does) and the ids of its keys (`stigmer service-account keys <name>`);
 * - the ids of the person's own keys (`stigmer list apikeys`, which lists
 *   the caller's own), before the coding agent started and after it stopped;
 * - the fixture's two agents' specs, before and after;
 * - the key the coding agent saved: the file the CLI named on its saved-key
 *   line, read from the coding agent's stream, and the id
 *   `stigmer apikey fingerprint` resolves the key in that file to;
 * - every text in the coding agent's stream, where no key may appear.
 */

import { FIXTURE } from "./coding-agent-bank.mjs";
import { parseWalkArgs } from "./coding-agent-walk.mjs";

/** The ask, the agent the job runs, and the role the ask comes to. */
export const OPERATE = Object.freeze({
  ask: `Make CI a key that can run agents but not change them. It's for our GitHub Actions nightly that runs ${FIXTURE.invoiceAgent}.`,
  /** The smallest Organization role that starts conversations with the Organization's Agents and changes none an admin made. */
  role: "member",
  /** The agents no access job may change. */
  agents: [FIXTURE.invoiceAgent, FIXTURE.reconcilerAgent],
});

/**
 * The Stigmer API keys in a text: `stk_` and 43 Base64URL characters, a
 * key's whole shape (the server's keymaterial.ts: 32 random bytes). The
 * docs' own example key, which the coding agent may read, is not one.
 */
export function keysIn(text) {
  return [...text.matchAll(/\bstk_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g)].map((m) => m[0]).filter((key) => !key.includes("example"));
}

/**
 * The file the CLI said it saved a key to, from the coding agent's stream
 * text: `API key created and saved as STIGMER_API_KEY in <path>`, or the
 * `--output json` form's `envFile`. The last one wins (a try may save twice;
 * the judge then finds two keys). undefined when the CLI never said it.
 */
export function savedKeyFile(text) {
  const said = [...text.matchAll(/API key created and saved as STIGMER_API_KEY in (\S+)/g)].map((m) => m[1]);
  const json = [...text.matchAll(/"envFile"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  const all = [...said, ...json];
  return all.length === 0 ? undefined : all[all.length - 1];
}

/** The last `STIGMER_API_KEY=` value in an env file's text; undefined when it sets none. */
export function keyInEnvFile(text) {
  const values = [...text.matchAll(/^STIGMER_API_KEY=(.*)$/gm)].map((m) => m[1].trim().replace(/^["']|["']$/g, ""));
  return values.length === 0 ? undefined : values[values.length - 1];
}

/** Every string inside a stream-json transcript, joined by newlines: what the coding agent said, ran and read. */
export function streamText(jsonl) {
  const out = [];
  const walk = (value) => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    try {
      walk(JSON.parse(line));
    } catch {
      out.push(line);
    }
  }
  return out.join("\n");
}

function sameJson(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function sorted(ids) {
  return [...ids].sort();
}

/**
 * Every check the state fails, in words; empty when the key is right.
 * @param {{
 *   myKeys: string[],
 *   agents: Record<string, { spec?: unknown } | undefined>,
 * }} before
 * @param {{
 *   serviceAccounts: Array<{ name: string, role: string | undefined, keys: string[] }>,
 *   myKeys: string[],
 *   agents: Record<string, { spec?: unknown } | undefined>,
 *   saved: { file: string | undefined, rawKey: string | undefined, keyId: string | undefined },
 *   stream: string,
 * }} now
 */
export function judgeOperate(before, now) {
  const failed = [];
  if (now.serviceAccounts.length !== 1) {
    failed.push(`${now.serviceAccounts.length} service accounts (${now.serviceAccounts.map((a) => a.name).join(", ") || "none"}); the ask wants one`);
  } else {
    const [account] = now.serviceAccounts;
    if (account.role !== OPERATE.role) failed.push(`service account ${account.name} holds ${JSON.stringify(account.role ?? null)}, not the ${OPERATE.role} role`);
    if (account.keys.length !== 1) failed.push(`service account ${account.name} has ${account.keys.length} keys; the ask wants one`);
    if (now.saved.file === undefined) {
      failed.push("the CLI never said it saved a key to a file (`--save-to-env`)");
    } else if (now.saved.keyId === undefined) {
      failed.push(`${now.saved.file} holds no key the server knows`);
    } else if (!account.keys.includes(now.saved.keyId)) {
      failed.push(`the key in ${now.saved.file} is not service account ${account.name}'s`);
    }
  }
  if (keysIn(now.stream).length > 0) failed.push("a key appears in the coding agent's stream");
  if (now.saved.rawKey !== undefined && now.saved.rawKey !== "" && now.stream.includes(now.saved.rawKey)) {
    failed.push("the saved key appears in the coding agent's stream");
  }
  if (!sameJson(sorted(now.myKeys), sorted(before.myKeys))) failed.push("the person's own keys changed: the ask wanted a service account's key, not theirs");
  for (const agent of OPERATE.agents) {
    if (now.agents[agent] === undefined) failed.push(`${agent} is gone`);
    else if (!sameJson(now.agents[agent]?.spec, before.agents[agent]?.spec)) failed.push(`${agent} changed: an access job touches no agent`);
  }
  return failed;
}

export const USAGE = `Usage:
  node test/install/coding-agent-operate.mjs [--model=<id>] [--max-budget-usd=<usd>]
      [--claude-max-turns=<n>] [--max-turns=<n>] [--keep]

Asks Claude Code, with Stigmer's plugin, for a CI key on a hermetic local
Stigmer ("${OPERATE.ask}"),
answers "go ahead" at each stop, then reads the server: one service account,
with the ${OPERATE.role} role and one key; the key in the file the CLI named is
that account's; no key in the coding agent's stream; the person's own keys
and the agents ${OPERATE.agents.join(" and ")} as they were. Needs \`claude\`
signed in, the plugin built (npm run build -w @stigmer/coding-agent-plugin)
and \`make build-server build-runner build-libs\`.

  --model=<id>           the coding agent's model (default claude-sonnet-5-5)
  --max-budget-usd=<n>   passed to each claude -p
  --claude-max-turns=<n> passed to each claude -p
  --max-turns=<n>        how many times the walk answers "go ahead" (default 2)
  --keep                 keep the scratch folder (the project, the stream, the logs)`;

/** The walk's flags, parsed; throws naming the flag on anything it does not know. */
export function parseOperateArgs(argv) {
  return parseWalkArgs(argv, USAGE);
}
