/**
 * Pins the skill's visibility write against a delete that lands between
 * its read and its write, through a composed server on an ephemeral port
 * and a native gRPC client:
 *
 *   - a visibility change of a skill deleted between its read and its
 *     write answers NotFound with the domain's copy (`skill not found:
 *     <id>`) rather than writing the skill back.
 *
 * The delete lands inside the write: the store's atomic write is wrapped
 * so the first call for the skill deletes the row and then calls through,
 * which finds no row (the shape of rename.test.ts's deleteMidWrite).
 *
 * Out of scope: push, which only seeds the skill here (skill.test.ts).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildZip } from "@stigmer/zip-structure/testing";
import { SkillCommandController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

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
let command: Client<typeof SkillCommandController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "skill-visibility-vanish-"));
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
  command = createClient(SkillCommandController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

function makeArtifact(name: string): Uint8Array {
  return buildZip([
    {
      name: "SKILL.md",
      content: `---\nname: ${name}\ndescription: composed-server test skill\n---\n# Skill body`,
    },
  ]);
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

describe("updateVisibility — a skill deleted mid-write", () => {
  it("a visibility change of a skill deleted between its read and its write answers NotFound", async () => {
    const pushed = await command.push({
      org: ORG,
      artifact: makeArtifact("vanishing-skill"),
    });
    const id = pushed.metadata!.id;

    const missing = await deleteMidWrite(ApiResourceKind.skill, id, () =>
      command.updateVisibility({
        resourceId: id,
        visibility: ApiResourceVisibility.visibility_private,
      }),
    );

    expect(missing.code).toBe(Code.NotFound);
    expect(missing.rawMessage).toBe(`skill not found: ${id}`);
  });
});
