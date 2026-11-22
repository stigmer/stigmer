/**
 * The platform MCP lane on a composed server (boot/compose.ts): composed
 * only where a unit declares `servesPlatformMcp`, and its tools dial the
 * server's own port.
 *
 *   - declared: `/v1/mcp/memory` lists the memory roster, and a
 *     `remember` call reaches this server's own memory chain over
 *     loopback, which answers it (here with its refusal for an
 *     organization that does not exist), not a dial failure;
 *   - undeclared: the prefix is the adapter's 404;
 *   - the open-source edition's unit declares it.
 *
 * Trusted-local (no sign-in), the posture the open-source edition ships
 * in; the signed-in door is lane.test.ts's.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../../../boot/config.js";
import { composeServer, type ComposedServer } from "../../../boot/compose.js";
import { openSourceEdition } from "../../../editions/open-source.js";
import {
  baseConfig,
  silentLogger,
} from "../../../extensions/__tests__/composed-support.js";
import type { ServerExtension } from "../../../extensions/registry.js";

let dir: string | undefined;
let server: ComposedServer | undefined;

afterEach(async () => {
  await server?.shutdown();
  server = undefined;
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function boot(extensions: ServerExtension[]): Promise<string> {
  dir = mkdtempSync(path.join(tmpdir(), "platform-mcp-lane-"));
  server = await composeServer({
    config: loadConfig(baseConfig(dir)),
    logger: silentLogger,
    extensions,
    portOverride: 0,
    host: "127.0.0.1",
  });
  return `http://127.0.0.1:${await server.start()}`;
}

async function rpc(
  url: string,
  method: string,
  params: unknown,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      connection: "close",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

describe("the platform MCP lane on a composed server", () => {
  it("serves the memory roster, whose tool reaches this server's own memory chain", async () => {
    const base = await boot([{ name: "lane", servesPlatformMcp: true }]);

    const listed = (await (
      await rpc(`${base}/v1/mcp/memory`, "tools/list", {})
    ).json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(["remember"]);

    const called = await rpc(`${base}/v1/mcp/memory`, "tools/call", {
      name: "remember",
      arguments: { fact: "The deploy window is Tuesday." },
    });
    expect(called.status).toBe(200);
    const answer = (await called.json()) as {
      result: { isError?: boolean; content: Array<{ text: string }> };
    };
    const text = answer.result.content.map((part) => part.text).join("\n");
    expect(answer.result.isError).toBe(true);
    // The server's own validation answered: the call crossed the loopback
    // dial and ran the memory chain.
    expect(text).toContain("metadata.org is required");
  });

  it("is the adapter's 404 when no unit declares it", async () => {
    const base = await boot([]);
    expect((await rpc(`${base}/v1/mcp/memory`, "tools/list", {})).status).toBe(
      404,
    );
  });

  it("is declared by the open-source edition's unit", () => {
    expect(openSourceEdition.servesPlatformMcp).toBe(true);
  });
});
