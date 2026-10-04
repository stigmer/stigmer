#!/usr/bin/env node
/**
 * Serves the Meridian embed page on a real origin (http://localhost:4173)
 * so the <stigmer-agent> embed-origin check has something honest to check —
 * file:// URLs have no origin. Dependency-free on purpose.
 * Run with: npm run demo:embed
 *
 * The page is authored against the local console origin; APP_ORIGIN swaps
 * it at serve time for the S4d cloud take (see cloud/README.md):
 *   APP_ORIGIN=https://app.stigmer.ai npm run demo:embed
 * The embed names the share by its id, which the last seed recorded
 * (../share-id.mjs); it is filled in at serve time too.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readShareId } from "../share-id.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const LOCAL_APP_ORIGIN = "http://localhost:7234";
const APP_ORIGIN = process.env.APP_ORIGIN ?? LOCAL_APP_ORIGIN;
const SHARE_ID = readShareId();

createServer(async (req, res) => {
  if (req.url !== "/" && req.url !== "/index.html") {
    res.writeHead(404).end("not found");
    return;
  }
  const html = await readFile(join(here, "index.html"), "utf8");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    html
      .replaceAll(LOCAL_APP_ORIGIN, APP_ORIGIN)
      .replaceAll("__MERIDIAN_SHARE_ID__", SHARE_ID),
  );
}).listen(PORT, () => {
  console.log(`Meridian embed page: http://localhost:${PORT} (app origin: ${APP_ORIGIN})`);
});
