// Pins the default-set step over a real Connect backend: preparation is
// all-or-nothing and touches no backend; a default absent from the org is
// pushed public with the CLI's message; one present at the same digest,
// READY and public is skipped without a push; a changed digest, a non-READY
// state or a non-public visibility pushes again; the defaults go in the
// marketplace's order; one push failure does not stop the next; and a
// second run over a converged backend pushes nothing.

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import {
  createServer as createHttp2Server,
  type Http2Server,
  type ServerHttp2Session,
} from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  type Plugin,
  PluginSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import {
  ListPluginMembersResponseSchema,
  type PushPluginRequest,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginState } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { createNodeClient, normalizeEndpoint } from "@stigmer/sdk/node";
import type { Stigmer } from "@stigmer/sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { writeCursorMarketplace } from "../../marketplace/__fixtures__/cursor-marketplace.js";
import { preparePluginPush } from "../../resources/plugin.js";
import { installPreparedDefaults, prepareDefaultPlugins } from "./defaults.js";

let backend: Http2Server;
let stigmer: Stigmer;
const openSessions = new Set<ServerHttp2Session>();

/** The backend's plugins by slug; tests seed it and pushes converge it. */
let held: Map<string, Plugin>;
let pushes: PushPluginRequest[];
/** Slugs whose push the backend refuses, to prove one failure does not stop the next. */
let refusing: Set<string>;

let official: string;
let thermosDigest: string;
let githubDigest: string;

function pluginRow(
  slug: string,
  digest: string,
  state = PluginState.READY,
  visibility = ApiResourceVisibility.visibility_public,
): Plugin {
  return create(PluginSchema, {
    metadata: { id: `plg_${slug}`, slug, org: "stigmer", visibility },
    spec: { name: slug },
    status: { digest, state },
  });
}

beforeAll(async () => {
  official = mkdtempSync(join(tmpdir(), "stigmer-defaults-official-"));
  writeCursorMarketplace(official);
  // The fixture is Cursor-dialect (no `defaults`); the official tree is Stigmer's, so write that file over it.
  rmSync(join(official, ".cursor-plugin"), { recursive: true, force: true });
  writeFileSync(
    join(official, "marketplace.json"),
    JSON.stringify({
      name: "stigmer",
      plugins: [
        { name: "thermos", source: "./thermos" },
        { name: "github", source: "./third_party/github" },
      ],
      defaults: ["thermos", "github"],
    }),
  );
  thermosDigest = (await preparePluginPush(join(official, "thermos"))).digest;
  githubDigest = (
    await preparePluginPush(join(official, "third_party", "github"))
  ).digest;

  const routes = (router: ConnectRouter) => {
    router.service(PluginCommandController, {
      push: (req) => {
        pushes.push(req);
        // The archive names the plugin: the backend knows the two trees by their digests.
        const slug =
          digestOf(req.artifact) === thermosDigest ? "thermos" : "github";
        if (refusing.has(slug))
          throw new ConnectError(`refused ${slug}`, Code.FailedPrecondition);
        const row = pluginRow(
          slug,
          digestOf(req.artifact),
          PluginState.READY,
          req.visibility,
        );
        held.set(slug, row);
        return row;
      },
    });
    router.service(PluginQueryController, {
      getByReference: (ref) => {
        const row = held.get(ref.slug);
        if (row === undefined)
          throw new ConnectError(`plugin ${ref.slug} not found`, Code.NotFound);
        return row;
      },
      listMembers: () =>
        create(ListPluginMembersResponseSchema, { members: [] }),
    });
  };
  backend = createHttp2Server(connectNodeAdapter({ routes }));
  backend.on("session", (session) => {
    openSessions.add(session);
    session.on("close", () => openSessions.delete(session));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const port = (backend.address() as AddressInfo).port;
  stigmer = createNodeClient({
    baseUrl: normalizeEndpoint(`127.0.0.1:${port}`),
  });
});

afterAll(async () => {
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
  rmSync(official, { recursive: true, force: true });
});

beforeEach(() => {
  held = new Map();
  pushes = [];
  refusing = new Set();
});

function digestOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const say = (): void => {};

async function run() {
  const prepared = await prepareDefaultPlugins({ repoDir: () => official });
  return installPreparedDefaults({ stigmer, info: say }, prepared, "stigmer");
}

describe("prepareDefaultPlugins", () => {
  it("prepares every default in the marketplace's order without touching the backend", async () => {
    const prepared = await prepareDefaultPlugins({ repoDir: () => official });
    expect(prepared.map((entry) => [entry.name, entry.push.digest])).toEqual([
      ["thermos", thermosDigest],
      ["github", githubDigest],
    ]);
    expect(pushes).toHaveLength(0);
  });

  it("refuses the whole set when one default cannot be prepared", async () => {
    const broken = mkdtempSync(join(tmpdir(), "stigmer-defaults-broken-"));
    try {
      writeFileSync(
        join(broken, "marketplace.json"),
        JSON.stringify({
          name: "stigmer",
          plugins: [{ name: "missing", source: "./missing" }],
          defaults: ["missing"],
        }),
      );
      await expect(
        prepareDefaultPlugins({ repoDir: () => broken }),
      ).rejects.toThrow(/1 plugin this CLI cannot install/);
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });
});

describe("installPreparedDefaults", () => {
  it("installs every default in order, public, with the CLI's message, on a fresh backend", async () => {
    const result = await run();
    expect(result.outcomes.map((o) => [o.name, o.action])).toEqual([
      ["thermos", "installed"],
      ["github", "installed"],
    ]);
    expect(result.failed).toEqual([]);
    expect(pushes.map((p) => p.org)).toEqual(["stigmer", "stigmer"]);
    expect(
      pushes.every(
        (p) => p.visibility === ApiResourceVisibility.visibility_public,
      ),
    ).toBe(true);
    expect(pushes[0]?.message).toMatch(
      /^default plugin, installed by stigmer up \(/,
    );
    expect(digestOf(pushes[0]!.artifact)).toBe(thermosDigest);
    expect(digestOf(pushes[1]!.artifact)).toBe(githubDigest);
  });

  it("pushes nothing when every default is already held at the same digest, READY and public", async () => {
    held.set("thermos", pluginRow("thermos", thermosDigest));
    held.set("github", pluginRow("github", githubDigest));
    const result = await run();
    expect(result.outcomes.map((o) => o.action)).toEqual([
      "up-to-date",
      "up-to-date",
    ]);
    expect(pushes).toHaveLength(0);
  });

  it("pushes again on a changed digest, a non-READY state, or a non-public visibility", async () => {
    held.set("thermos", pluginRow("thermos", "f".repeat(64)));
    held.set("github", pluginRow("github", githubDigest, PluginState.FAILED));
    expect((await run()).outcomes.map((o) => o.action)).toEqual([
      "installed",
      "installed",
    ]);
    expect(pushes).toHaveLength(2);

    pushes = [];
    held.set(
      "thermos",
      pluginRow(
        "thermos",
        thermosDigest,
        PluginState.READY,
        ApiResourceVisibility.visibility_private,
      ),
    );
    held.set("github", pluginRow("github", githubDigest));
    expect((await run()).outcomes.map((o) => o.action)).toEqual([
      "installed",
      "up-to-date",
    ]);
    expect(pushes).toHaveLength(1);
  });

  it("a second run over a backend the first converged pushes nothing", async () => {
    await run();
    pushes = [];
    const result = await run();
    expect(result.outcomes.map((o) => o.action)).toEqual([
      "up-to-date",
      "up-to-date",
    ]);
    expect(pushes).toHaveLength(0);
  });

  it("one default failing does not stop the next, and the failure is named", async () => {
    refusing.add("thermos");
    const result = await run();
    expect(result.outcomes.map((o) => [o.name, o.action])).toEqual([
      ["thermos", "failed"],
      ["github", "installed"],
    ]);
    expect(result.failed).toEqual(["thermos"]);
    const failed = result.outcomes[0];
    expect(failed?.action === "failed" && failed.error).toMatch(
      /refused thermos/,
    );
  });
});
