/**
 * Pins the plugins a run lists (run-plugins.ts), over a real SQLite store.
 *
 * runPluginReferences: the agent version's references then the
 * conversation's, one per organization and slug (a reference naming no
 * organization keys under the run's), the conversation's reference
 * winning where both name one, so its chosen version is the one planned;
 * a reference with no slug is dropped.
 *
 * loadRunPlugins: each reference resolves like a skill reference, the
 * installed plugin for no version, an archived one by its digest or its
 * tag, in the reference's organization or the run's; a plugin or a version
 * that is gone is left out (the runner refuses the turn naming it); a
 * store fault is never mistaken for a missing plugin; two plugins of one
 * name from two organizations refuse FAILED_PRECONDITION naming both,
 * before anything is planned. Each loaded plugin carries its id, its name
 * and its status, an empty status when the row has none.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import { loadRunPlugins, runPluginReferences } from "../run-plugins.js";

const ORG = "acme";
const OTHER_ORG = "elsewhere";
const HEAD = "a".repeat(64);
const OLDER = "b".repeat(64);

let dir: string;
let store: Store;

/** A plugin row: `name` is the name a turn uses, `server` the one server it lists. */
function pluginRow(opts: {
  id: string;
  org: string;
  slug: string;
  name: string;
  digest: string;
  version: string;
  server: string;
}) {
  return create(PluginSchema, {
    metadata: { id: opts.id, org: opts.org, slug: opts.slug, name: opts.name },
    spec: { name: opts.name, version: opts.version },
    status: {
      digest: opts.digest,
      mcpServers: [
        { name: opts.server, transport: { case: "http", value: { url: `https://${opts.server}.example/mcp` } } },
      ],
    },
  });
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "run-plugins-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
  await store.saveResource(
    ApiResourceKind.plugin,
    "plg_linear",
    PluginSchema,
    pluginRow({ id: "plg_linear", org: ORG, slug: "linear", name: "linear", digest: HEAD, version: "2.0.0", server: "head" }),
  );
  await store.saveAudit(
    ApiResourceKind.plugin,
    "plg_linear",
    PluginSchema,
    pluginRow({ id: "plg_linear", org: ORG, slug: "linear", name: "linear", digest: OLDER, version: "1.0.0", server: "older" }),
    OLDER,
    "1.0.0",
  );
  await store.saveResource(
    ApiResourceKind.plugin,
    "plg_notion",
    PluginSchema,
    pluginRow({ id: "plg_notion", org: ORG, slug: "notion", name: "notion", digest: HEAD, version: "1.0.0", server: "notion" }),
  );
  // Another organization's plugin of the same name, and one whose slug differs but whose name collides.
  await store.saveResource(
    ApiResourceKind.plugin,
    "plg_linear_elsewhere",
    PluginSchema,
    pluginRow({ id: "plg_linear_elsewhere", org: OTHER_ORG, slug: "linear", name: "linear", digest: HEAD, version: "1.0.0", server: "theirs" }),
  );
  await store.saveResource(
    ApiResourceKind.plugin,
    "plg_bare",
    PluginSchema,
    create(PluginSchema, { metadata: { id: "plg_bare", org: ORG, slug: "bare", name: "bare" } }),
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function ref(org: string, slug: string, version = ""): ApiResourceReference {
  return create(ApiResourceReferenceSchema, { org, slug, version });
}

describe("runPluginReferences", () => {
  it("lists the agent's references then the conversation's, once each, the conversation's reference winning", () => {
    const refs = runPluginReferences(
      create(AgentSpecSchema, { plugins: [ref(ORG, "linear", "1.0.0"), ref("", "notion")] }),
      create(SessionSchema, { spec: { plugins: [ref("", "linear", "2.0.0"), ref(OTHER_ORG, "github")] } }),
      ORG,
    );
    expect(refs.map((r) => [r.org, r.slug, r.version])).toEqual([
      ["", "linear", "2.0.0"],
      ["", "notion", ""],
      [OTHER_ORG, "github", ""],
    ]);
  });

  it("keeps two organizations' plugins of one slug apart and drops a reference with no slug", () => {
    const refs = runPluginReferences(
      create(AgentSpecSchema, { plugins: [ref(ORG, "linear"), ref(ORG, "")] }),
      create(SessionSchema, { spec: { plugins: [ref(OTHER_ORG, "linear")] } }),
      ORG,
    );
    expect(refs.map((r) => `${r.org}/${r.slug}`)).toEqual([`${ORG}/linear`, `${OTHER_ORG}/linear`]);
  });

  it("lists the conversation's own plugins for the built-in assistant, and nothing with neither", () => {
    expect(
      runPluginReferences(undefined, create(SessionSchema, { spec: { plugins: [ref(ORG, "notion")] } }), ORG).map(
        (r) => r.slug,
      ),
    ).toEqual(["notion"]);
    expect(runPluginReferences(undefined, undefined, ORG)).toEqual([]);
  });
});

describe("loadRunPlugins", () => {
  it("loads the installed plugin for no version, in the run's organization when the reference names none", async () => {
    const plugins = await loadRunPlugins(store, [ref("", "linear"), ref(ORG, "notion")], ORG);
    expect(plugins.map((p) => [p.id, p.name, p.status.mcpServers[0]?.name])).toEqual([
      ["plg_linear", "linear", "head"],
      ["plg_notion", "notion", "notion"],
    ]);
  });

  it("loads an archived version by its digest and by its tag", async () => {
    for (const version of [OLDER, "1.0.0"]) {
      const [plugin] = await loadRunPlugins(store, [ref(ORG, "linear", version)], ORG);
      expect(plugin?.id, version).toBe("plg_linear");
      expect(plugin?.status.digest, version).toBe(OLDER);
      expect(plugin?.status.mcpServers.map((s) => s.name), version).toEqual(["older"]);
    }
  });

  it("leaves out a plugin that is gone and a version the plugin does not hold", async () => {
    const plugins = await loadRunPlugins(
      store,
      [ref(ORG, "no-such-plugin"), ref(ORG, "linear", "9.9.9"), ref(ORG, "notion")],
      ORG,
    );
    expect(plugins.map((p) => p.id)).toEqual(["plg_notion"]);
  });

  it("gives a plugin with no status an empty one", async () => {
    const [plugin] = await loadRunPlugins(store, [ref(ORG, "bare")], ORG);
    expect(plugin?.status.mcpServers).toEqual([]);
    expect(plugin?.status.digest).toBe("");
  });

  it("refuses two plugins of one name from two organizations, naming both", async () => {
    const failure = await loadRunPlugins(store, [ref(ORG, "linear"), ref(OTHER_ORG, "linear")], ORG).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((failure as ConnectError).rawMessage).toContain("two plugins named 'linear'");
    expect((failure as ConnectError).rawMessage).toContain(`${ORG}/linear`);
    expect((failure as ConnectError).rawMessage).toContain(`${OTHER_ORG}/linear`);
  });

  it("fails on a store fault rather than leaving the plugin out", async () => {
    const faulty = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === "listResources") {
          return async () => {
            throw new Error("disk gone");
          };
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const failure = await loadRunPlugins(faulty, [ref(ORG, "linear")], ORG).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.Internal);
  });
});
