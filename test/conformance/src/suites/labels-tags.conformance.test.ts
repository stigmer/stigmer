// Labels and tags conformance — the rules every resource's labels and tags
// keep (Class A).
// Domain: ApiResourceMetadata.labels and .tags on every create, and a
// plugin's tags derived from its manifest.
//
// Labels follow the Kubernetes syntax: a key is an optional DNS prefix and
// "/" then a name of at most 63 characters that starts and ends with a
// letter or digit; a value is empty or such a name; at most 64 pairs. Tags
// are search words under GitHub's topic rule: lowercase letters, digits and
// hyphens, starting with a letter or digit, at most 50 characters, unique,
// at most 20. Each refusal below is a create that breaks one rule, answered
// InvalidArgument before anything is written; the admitted shapes beside
// them create.
//
// A plugin's manifest is an outside format whose keywords follow no such
// rule, so a push never refuses one for them: its tags are its keywords
// normalized, and spec.keywords stays as the manifest wrote it.
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { openPlugin, pushPlugin } from "../support/plugins";
import { makeSkillArtifact } from "../support/skills";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

async function createAgent(org: string, metadata: { labels?: Record<string, string>; tags?: string[] }) {
  const message = makeAgent({ org, name: uniqueName("lt-agent") });
  const agent = await clients.agentCommand.create({ ...message, metadata: { ...message.metadata, ...metadata } });
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }).catch(() => undefined));
  return agent;
}

describe("Labels and tags conformance — the syntax every create keeps", () => {
  it("[rpc:AgentCommandController.create] admits Kubernetes-shaped labels and topic-shaped tags", async () => {
    const { org } = await target.provisionTenancy();
    const labels = {
      team: "support",
      "example.com/tier": "gold",
      "app.kubernetes.io/name": "a.b_c-d",
      empty: "",
      [`${"k".repeat(63)}`]: "v".repeat(63),
    };
    const tags = ["prod", "a-b-testing", "x".repeat(50)];
    const agent = await createAgent(org, { labels, tags });
    expect(agent.metadata?.labels).toEqual(labels);
    expect(agent.metadata?.tags).toEqual(tags);
  });

  it("[rpc:AgentCommandController.create] refuses each label the syntax refuses", async () => {
    const { org } = await target.provisionTenancy();
    const refused: Array<[string, Record<string, string>]> = [
      ["a key starting with a hyphen", { "-team": "support" }],
      ["a key with a space", { "my team": "support" }],
      ["a key whose name is empty after its prefix", { "example.com/": "support" }],
      ["a key with an upper-case prefix", { "Example.com/team": "support" }],
      ["a key whose prefix is longer than 253", { [`${"a".repeat(254)}/team`]: "support" }],
      ["a key whose name is longer than 63", { [`${"t".repeat(64)}`]: "support" }],
      ["a value ending with a hyphen", { team: "support-" }],
      ["a value with a space", { team: "support team" }],
      ["a value longer than 63", { team: "v".repeat(64) }],
      ["more than 64 pairs", Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`key${i}`, "v"]))],
    ];
    for (const [why, labels] of refused) {
      await expectGrpcCode(() => createAgent(org, { labels }), Code.InvalidArgument, why);
    }
  });

  it("[rpc:AgentCommandController.create] refuses each tag list the topic rule refuses", async () => {
    const { org } = await target.provisionTenancy();
    const refused: Array<[string, string[]]> = [
      ["an upper-case tag", ["Prod"]],
      ["a tag with a space", ["sec filings"]],
      ["a tag starting with a hyphen", ["-prod"]],
      ["a tag longer than 50", ["x".repeat(51)]],
      ["a repeated tag", ["prod", "prod"]],
      ["more than 20 tags", Array.from({ length: 21 }, (_, i) => `tag-${i}`)],
    ];
    for (const [why, tags] of refused) {
      await expectGrpcCode(() => createAgent(org, { tags }), Code.InvalidArgument, why);
    }
  });

  it("[rpc:SkillCommandController.push] refuses a push whose labels break the syntax", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.skillCommand.push({
          org,
          labels: { "-team": "support" },
          artifact: makeSkillArtifact({ name: uniqueName("lt-skill"), description: "a refused skill" }),
        }),
      Code.InvalidArgument,
      "a push's label key starting with a hyphen",
    );
  });
});

describe("Labels and tags conformance — a plugin's tags are its keywords as search words", () => {
  it("[rpc:PluginCommandController.push] derives tags from the catalogue's kind of keywords and keeps them verbatim on the spec", async () => {
    const { org } = await target.provisionTenancy();
    const keywords = ["SEC filings", "a/b testing", "otter.ai", "a/b testing", "Market Data"];
    const plugin = await pushPlugin(
      clients,
      fixtures,
      org,
      openPlugin({
        name: uniqueName("lt-plugin"),
        version: "0.1.0",
        manifest: { keywords },
        mcpServers: { api: { type: "streamable-http", url: "https://mcp.vendor.test/mcp" } },
      }),
    );
    expect(plugin.metadata?.tags).toEqual(["sec-filings", "a-b-testing", "otter-ai", "market-data"]);
    expect(plugin.spec?.keywords).toEqual(keywords);
    const read = await clients.pluginQuery.get({ value: plugin.metadata!.id });
    expect(read.metadata?.tags).toEqual(plugin.metadata?.tags);
  });
});
