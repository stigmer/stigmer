#!/usr/bin/env node
/**
 * Serves the Meridian embed page on a real origin (http://localhost:4173)
 * so the <stigmer-agent> embed-origin check has something honest to check —
 * file:// URLs have no origin. Dependency-free on purpose.
 * Run with: npm run demo:embed
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);

createServer(async (req, res) => {
  if (req.url !== "/" && req.url !== "/index.html") {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(await readFile(join(here, "index.html")));
}).listen(PORT, () => {
  console.log(`Meridian embed page: http://localhost:${PORT}`);
});
