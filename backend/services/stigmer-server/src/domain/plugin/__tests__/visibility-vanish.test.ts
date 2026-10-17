/**
 * Pins the plugin's visibility write against a delete that lands between
 * its read and its write, through a composed server on an ephemeral port
 * and a native gRPC client:
 *
 *   - a visibility change of a plugin deleted between its read and its
 *     write answers NotFound with the domain's copy (`plugin not found:
 *     <id>`) rather than writing the plugin back.
 *
 * The delete lands inside the write: the store's atomic write is wrapped
 * so the first call for the plugin deletes the row and then calls through,
 * which finds no row (the shape of rename.test.ts's deleteMidWrite).
 *
 * Out of scope: push, which only seeds the plugin here (plugin.test.ts).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { claudePlugin } from "@stigmer/plugin-package/testing";
import type { PluginFixture } from "@stigmer/plugin-package/testing";
import { PluginCommandController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";

import { writeArchive } from "../../../archive/write.js";
import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import {
  baseConfig,
  silentLogger,
} from "../../../extensions/__tests__/composed-support.js";
import { seedOrganizations } from "../../organization/__tests__/support.js";

const ORG = "acme";

let dir: string;
let server: ComposedServer;
let plugins: Client<typeof PluginCommandController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "plugin-visibility-vanish-"));
  server = await composeServer({
    config: loadConfig(baseConfig(dir)),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  await seedOrganizations(transport, [ORG]);
  plugins = createClient(PluginCommandController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const encoder = new TextEncoder();

/** A fixture map as the archive the CLI would push: the server's own deterministic writer. */
function archiveOf(fixture: PluginFixture): Uint8Array {
  return writeArchive(
    [...fixture.entries()].map(([filePath, content]) => ({
      path: filePath,
      bytes: typeof content === "string" ? encoder.encode(content) : content,
    })),
  );
}

async function grpcError(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
}

/**
 * Runs `write` with the store's atomic write wrapped: the first call for
 * `kind` and `id` deletes the row, then calls through, so the writer finds
 * no row although its read found one. Answers the call's error.
 */
async function deleteMidWrite(
  kind: ApiResourceKind,
  id: string,
  write: () => Promise<unknown>,
): Promise<ConnectError> {
  const store = server.store;
  const updateResource = store.updateResource.bind(store);
  let armed = true;
  const spy = vi.spyOn(store, "updateResource").mockImplementation((async <
    Desc extends DescMessage,
  >(
    writtenKind: ApiResourceKind,
    writtenId: string,
    schema: Desc,
    modify: (msg: MessageShape<Desc>) => void,
  ) => {
    if (armed && writtenKind === kind && writtenId === id) {
      armed = false;
      await store.deleteResource(kind, id);
    }
    return updateResource(writtenKind, writtenId, schema, modify);
  }) as typeof store.updateResource);
  try {
    const error = await grpcError(write);
    expect(armed, "the write never reached the store").toBe(false);
    return error;
  } finally {
    spy.mockRestore();
  }
}

describe("updateVisibility — a plugin deleted mid-write", () => {
  it("a visibility change of a plugin deleted between its read and its write answers NotFound", async () => {
    const installed = await plugins.push({
      org: ORG,
      artifact: archiveOf(
        claudePlugin({
          name: "vanishing-plugin",
          version: "1.0.0",
          skills: [{ name: "greet", description: "Greets", body: "# Greet" }],
        }),
      ),
    });
    const id = installed.metadata!.id;

    const missing = await deleteMidWrite(ApiResourceKind.plugin, id, () =>
      plugins.updateVisibility({
        resourceId: id,
        visibility: ApiResourceVisibility.visibility_private,
      }),
    );

    expect(missing.code).toBe(Code.NotFound);
    expect(missing.rawMessage).toBe(`plugin not found: ${id}`);
  });
});
