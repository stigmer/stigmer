/**
 * The Meridian chat link's channel id, carried from the seed to the pages
 * that link to it. A hosted chat link and the <stigmer-agent> embed name a
 * channel only by its id (`/chat/<channel id>`), which the server mints on
 * the channel's first apply, so the seed reads it back and records it here;
 * the embed server and the capture script read the record. The file is
 * git-ignored: each stack mints its own id.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Where the seed records the channel id. */
export const CHANNEL_ID_FILE = join(here, ".channel-id");

/**
 * Reads the applied channel's id through the CLI and records it. On a link
 * that is already on, `stigmer channel link` changes nothing (it keeps the
 * link's audience when none is asked for) and reports the link,
 * `/chat/<channel id>`. `--json` puts the report on stdout; the human form
 * goes to stderr.
 */
export function recordChannelId(bin, org, agentSlug) {
  const printed = execFileSync(bin, ["channel", "link", `${org}/${agentSlug}`, "--json"]).toString();
  const link = JSON.parse(printed).sections?.find((section) => section.title?.endsWith("chat link"))?.items?.[0];
  const id = link?.match(/\/chat\/([^/?\s]+)/)?.[1];
  if (id === undefined) {
    throw new Error(`no chat link in the output of stigmer channel link ${org}/${agentSlug} --json:\n${printed}`);
  }
  writeFileSync(CHANNEL_ID_FILE, `${id}\n`);
  return id;
}

/** The recorded channel id; throws with the remedy when the seed has not run. */
export function readChannelId() {
  try {
    return readFileSync(CHANNEL_ID_FILE, "utf8").trim();
  } catch {
    throw new Error(`${CHANNEL_ID_FILE} is missing: run the seed (npm run demo:seed) first`);
  }
}
