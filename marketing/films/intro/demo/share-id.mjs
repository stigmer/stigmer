/**
 * The Meridian share's id, carried from the seed to the pages that link to
 * it. A hosted chat link and the <stigmer-agent> embed name a share only by
 * its id (`/chat/<share id>`), which the server mints on the share's first
 * apply, so the seed reads it back and records it here; the embed server
 * and the capture script read the record. The file is git-ignored: each
 * stack mints its own id.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Where the seed records the share id. */
export const SHARE_ID_FILE = join(here, ".share-id");

/**
 * Reads the applied share's id through the CLI and records it. On a share
 * that is already on, `stigmer share agent` changes nothing (it keeps the
 * share's audience when none is asked for) and prints the share's link,
 * `/chat/<share id>`.
 */
export function recordShareId(bin, org, agentSlug) {
  const printed = execFileSync(bin, ["share", "agent", `${org}/${agentSlug}`]).toString();
  const id = printed.match(/\/chat\/(ash_[0-9a-z]+)/)?.[1];
  if (id === undefined) {
    throw new Error(`no share link in the output of stigmer share agent ${org}/${agentSlug}:\n${printed}`);
  }
  writeFileSync(SHARE_ID_FILE, `${id}\n`);
  return id;
}

/** The recorded share id; throws with the remedy when the seed has not run. */
export function readShareId() {
  try {
    return readFileSync(SHARE_ID_FILE, "utf8").trim();
  } catch {
    throw new Error(`${SHARE_ID_FILE} is missing: run the seed (npm run demo:seed) first`);
  }
}
