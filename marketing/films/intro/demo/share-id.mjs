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

/** Reads the applied share's id through the CLI and records it. */
export function recordShareId(bin, org, slug) {
  const share = JSON.parse(
    execFileSync(bin, ["--org", org, "get", "agent-share", slug, "-o", "json"]).toString(),
  );
  const id = share?.metadata?.id;
  if (typeof id !== "string" || id === "") {
    throw new Error(`no id on agent-share ${org}/${slug}`);
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
