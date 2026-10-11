/**
 * Test support: one seeded estate for the sub-agent retirement
 * (../sub-agents-retired.ts) and the outcome both drivers' migration tests
 * check against it (`SUB_AGENT_ESTATE`, `expectSubAgentsRetired`), so the
 * SQLite step (v28) and the Postgres step (v23) are held to the same
 * outcome over the same rows. The agent rows carry their sub-agents in
 * the retired AgentSpec field 6, written by wire number
 * (retired-mcp-server-rows.ts):
 *   - a parent holding two sub-agents, its previous version archived;
 *   - an agent whose spec without its sub-agent is a version it already
 *     archived (an edit added the sub-agent, nothing else), so the step
 *     archives no second row of that hash;
 *   - an agent with no sub-agents, left byte for byte;
 *   - sessions: one pinned to the parent (moved), one on the parent with
 *     no pinned version and one on the untouched agent (both left).
 */
import { create, fromBinary } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { expect } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";

import { canonicalSpecHash } from "../../pipeline/steps/spec-hash.js";
import { readSubAgents } from "../frozen-sub-agent.js";
import {
  SUB_AGENT_REMOVED_MESSAGE,
  SUB_AGENT_RETIREMENT_VERSION_MESSAGE,
} from "../sub-agents-retired.js";
import {
  pluginRef,
  retiredAgentRow,
  retiredSessionRow,
  skillRef,
} from "./retired-mcp-server-rows.js";
import type { RecordingLogger } from "./retired-mcp-server-rows.js";

export const SUB_AGENT_ESTATE_ORG = "org_01jz0000000000000000000000";
/** The previous version every seeded agent heads. */
export const SUB_AGENT_ESTATE_OLD_HASH = "a".repeat(64);

/** A row in the `resources` table. */
export interface SubAgentEstateRow {
  readonly kind: string;
  readonly id: string;
  readonly data: Uint8Array;
}

/** A row in the `resource_audit` table. */
export interface SubAgentEstateAuditRow {
  readonly kind: string;
  readonly resourceId: string;
  readonly data: Uint8Array;
  readonly versionHash: string;
}

/** What a driver's test reads back from its store after the step. */
export interface SubAgentStoreView {
  data(kind: string, id: string): Promise<Uint8Array | undefined>;
  /** The archived versions of one row, oldest first. */
  audit(kind: string, id: string): Promise<Array<{ versionHash: string; data: Uint8Array }>>;
}

const ORG = SUB_AGENT_ESTATE_ORG;
const OLD = SUB_AGENT_ESTATE_OLD_HASH;

const parentSpec: MessageInitShape<typeof AgentSpecSchema> = {
  instructions: "Review every pull request with care.",
  plugins: [pluginRef("gh-tools", ORG)],
  tools: ["Read"],
};

const parent = retiredAgentRow({
  metadata: { id: "agt_parent", org: ORG, slug: "reviewer", name: "reviewer" },
  spec: parentSpec,
  status: { versionHash: OLD },
  subAgents: [
    {
      name: "Issue Triager",
      instructions: "Triage every new issue.",
      skillRefs: [skillRef("house-style", ORG)],
      modelOverride: "claude-sonnet-4-5",
    },
    { name: "writer", instructions: "Write the release notes." },
  ],
});

const againSpec: MessageInitShape<typeof AgentSpecSchema> = {
  instructions: "Answer questions about the codebase.",
};

/** The version the agent held before an edit added its sub-agent. */
export const SUB_AGENT_ESTATE_AGAIN_HASH = canonicalSpecHash(
  AgentSpecSchema,
  create(AgentSpecSchema, againSpec),
);

const again = retiredAgentRow({
  metadata: { id: "agt_again", org: ORG, slug: "answerer", name: "answerer" },
  spec: againSpec,
  status: { versionHash: OLD },
  subAgents: [{ name: "searcher", instructions: "Search the code." }],
});

const plain = retiredAgentRow({
  metadata: { id: "agt_plain", org: ORG, slug: "plain", name: "plain" },
  spec: { instructions: "Write the release notes." },
  status: { versionHash: OLD },
});

function sessionOn(id: string, agentId: string, agentVersionHash: string): Uint8Array {
  return retiredSessionRow({
    metadata: { id, org: ORG, slug: id.replace("_", "-") },
    spec: { subject: "Work" },
    status: { agentId, agentVersionHash },
  });
}

const sessionPinned = sessionOn("ses_pinned", "agt_parent", OLD);
const sessionUnpinned = sessionOn("ses_unpinned", "agt_parent", "");
const sessionOther = sessionOn("ses_other", "agt_plain", OLD);

/** The estate (the module header). */
export const SUB_AGENT_ESTATE: {
  readonly rows: readonly SubAgentEstateRow[];
  readonly audit: readonly SubAgentEstateAuditRow[];
} = {
  rows: [
    { kind: "agent", id: "agt_parent", data: parent },
    { kind: "agent", id: "agt_again", data: again },
    { kind: "agent", id: "agt_plain", data: plain },
    { kind: "session", id: "ses_pinned", data: sessionPinned },
    { kind: "session", id: "ses_unpinned", data: sessionUnpinned },
    { kind: "session", id: "ses_other", data: sessionOther },
  ],
  audit: [
    { kind: "agent", resourceId: "agt_parent", data: parent, versionHash: OLD },
    { kind: "agent", resourceId: "agt_again", data: new Uint8Array([1]), versionHash: SUB_AGENT_ESTATE_AGAIN_HASH },
    { kind: "agent", resourceId: "agt_again", data: again, versionHash: OLD },
    { kind: "agent", resourceId: "agt_plain", data: plain, versionHash: OLD },
  ],
};

/** The outcome both drivers owe the estate. */
export async function expectSubAgentsRetired(
  view: SubAgentStoreView,
  logger: RecordingLogger,
): Promise<void> {
  // The parent loses its sub-agents and heads a new version, archived beside the previous one.
  const parentBytes = (await view.data("agent", "agt_parent"))!;
  const migrated = fromBinary(AgentSchema, parentBytes);
  expect(readSubAgents(migrated.spec!)).toEqual([]);
  expect(migrated.spec?.instructions).toBe(parentSpec.instructions);
  expect(migrated.spec?.plugins.map((ref) => ref.slug)).toEqual(["gh-tools"]);
  const newHash = canonicalSpecHash(AgentSpecSchema, migrated.spec!);
  expect(newHash).not.toBe(OLD);
  expect(migrated.status?.versionHash).toBe(newHash);
  expect(migrated.metadata?.version?.previousVersionId).toBe(OLD);
  expect(migrated.metadata?.version?.message).toBe(SUB_AGENT_RETIREMENT_VERSION_MESSAGE);
  const parentAudit = await view.audit("agent", "agt_parent");
  expect(parentAudit.map((entry) => entry.versionHash)).toEqual([OLD, newHash]);
  expect(parentAudit[1]!.data).toEqual(parentBytes);

  // An agent back on a version it archived gains no second row of that hash.
  const againAfter = fromBinary(AgentSchema, (await view.data("agent", "agt_again"))!);
  expect(readSubAgents(againAfter.spec!)).toEqual([]);
  expect(againAfter.status?.versionHash).toBe(SUB_AGENT_ESTATE_AGAIN_HASH);
  expect((await view.audit("agent", "agt_again")).map((entry) => entry.versionHash)).toEqual([
    SUB_AGENT_ESTATE_AGAIN_HASH,
    OLD,
  ]);

  // An agent with no sub-agents is left byte for byte, its history too.
  expect(await view.data("agent", "agt_plain")).toEqual(plain);
  expect((await view.audit("agent", "agt_plain")).length).toBe(1);

  // The pinned session moves to the parent's new version; the others are left.
  const pinned = fromBinary(SessionSchema, (await view.data("session", "ses_pinned"))!);
  expect(pinned.status?.agentVersionHash).toBe(newHash);
  expect(await view.data("session", "ses_unpinned")).toEqual(sessionUnpinned);
  expect(await view.data("session", "ses_other")).toEqual(sessionOther);

  // Each removed sub-agent is one warning naming its parent.
  const removed = logger.warnings.filter((warning) => warning.message === SUB_AGENT_REMOVED_MESSAGE);
  expect(removed.map((warning) => [warning.fields?.["agent"], warning.fields?.["subagent"]])).toEqual([
    [`${ORG}/answerer`, "searcher"],
    [`${ORG}/reviewer`, "Issue Triager"],
    [`${ORG}/reviewer`, "writer"],
  ]);
  expect(String(removed[1]?.fields?.["manifest"])).toContain("model_name: claude-sonnet-4-5");
}
