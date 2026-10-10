/**
 * Test support: the rows an earlier release wrote that the MCP server
 * kind's removal migrates (../mcp-server-retired.ts), built by wire number
 * because the schemas that wrote the retired fields no longer exist:
 *   - an McpServer row (api_version 1, kind 2, metadata 3, spec 4), the
 *     plugin it came from named by the `stigmer.ai/plugin` label;
 *   - an Agent row whose spec carries server usages (AgentSpec field 4, each
 *     an McpServerUsage whose field 1 is the server reference) and hook
 *     sources naming a plugin (HookSource field 1);
 *   - a Session row whose spec carries server usages (SessionSpec field 7).
 * Plugins, skills and policies are written in the live schema, a member
 * skill carrying the two labels an install stamped.
 *
 * It also holds one seeded estate and the expectations both drivers'
 * migration tests check against it (`RETIREMENT_ESTATE`,
 * `expectEstateRetired`), so the SQLite and the Postgres step are held to
 * the same outcome over the same rows.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { expect } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/status_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { SessionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/status_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { canonicalSpecHash } from "../../pipeline/steps/spec-hash.js";
import type { StoreLogger } from "../logger.js";
import { RETIREMENT_VERSION_MESSAGE } from "../mcp-server-retired.js";
import { policyRow } from "./retired-instance-rows.js";

type ReferenceInit = MessageInitShape<typeof ApiResourceReferenceSchema>;
type MetadataInit = MessageInitShape<typeof ApiResourceMetadataSchema>;

/** The label an install stamped with the plugin's id. */
export const PLUGIN_LABEL = "stigmer.ai/plugin";
/** The label an install stamped with the archive digest. */
export const PLUGIN_VERSION_LABEL = "stigmer.ai/plugin-version";

/** The retired `mcp_server` kind's wire number, which the enum now reserves. */
const RETIRED_MCP_SERVER_KIND_NUMBER = 44 as ApiResourceKind;

/** A reference to a server, as a usage held it. */
export function serverRef(slug: string, org = ""): ReferenceInit {
  return { kind: RETIRED_MCP_SERVER_KIND_NUMBER, org, slug };
}

/** A reference to a plugin, as the step writes it. */
export function pluginRef(slug: string, org: string): ReferenceInit {
  return { kind: ApiResourceKind.plugin, org, slug };
}

/** A reference to a skill. */
export function skillRef(slug: string, org = ""): ReferenceInit {
  return { kind: ApiResourceKind.skill, org, slug };
}

function referenceBytes(ref: ReferenceInit): Uint8Array {
  return toBinary(
    ApiResourceReferenceSchema,
    create(ApiResourceReferenceSchema, ref),
  );
}

function metadataBytes(init: MetadataInit): Uint8Array {
  return toBinary(
    ApiResourceMetadataSchema,
    create(ApiResourceMetadataSchema, init),
  );
}

/** One retired McpServerUsage: `{ mcp_server_ref = 1 }`. */
function usageBytes(ref: ReferenceInit): Uint8Array {
  return new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .bytes(referenceBytes(ref))
    .finish();
}

/** An McpServer row as an earlier release stored it. */
export function retiredServerRow(options: {
  readonly metadata: MetadataInit;
  readonly url?: string;
}): Uint8Array {
  // The spec's content is never read by the step; any bytes stand for it.
  const spec = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string(options.url ?? "https://mcp.example.com")
    .finish();
  return new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("agentic.stigmer.ai/v1")
    .tag(2, WireType.LengthDelimited)
    .string("McpServer")
    .tag(3, WireType.LengthDelimited)
    .bytes(metadataBytes(options.metadata))
    .tag(4, WireType.LengthDelimited)
    .bytes(spec)
    .finish();
}

/**
 * An Agent row as an earlier release stored it: the live spec plus the
 * retired server usages (field 4) and plugin hook sources (field 12, each
 * a HookSource holding only field 1).
 */
export function retiredAgentRow(options: {
  readonly metadata: MetadataInit;
  readonly spec?: MessageInitShape<typeof AgentSpecSchema>;
  readonly status?: MessageInitShape<typeof AgentStatusSchema>;
  readonly serverUsages?: readonly ReferenceInit[];
  readonly pluginHooks?: readonly ReferenceInit[];
}): Uint8Array {
  const spec = new BinaryWriter().raw(
    toBinary(AgentSpecSchema, create(AgentSpecSchema, options.spec ?? {})),
  );
  for (const ref of options.serverUsages ?? []) {
    spec.tag(4, WireType.LengthDelimited).bytes(usageBytes(ref));
  }
  for (const ref of options.pluginHooks ?? []) {
    const source = new BinaryWriter()
      .tag(1, WireType.LengthDelimited)
      .bytes(referenceBytes(ref))
      .finish();
    spec.tag(12, WireType.LengthDelimited).bytes(source);
  }
  const row = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("agentic.stigmer.ai/v1")
    .tag(2, WireType.LengthDelimited)
    .string("Agent")
    .tag(3, WireType.LengthDelimited)
    .bytes(metadataBytes(options.metadata))
    .tag(4, WireType.LengthDelimited)
    .bytes(spec.finish());
  if (options.status !== undefined) {
    row
      .tag(5, WireType.LengthDelimited)
      .bytes(
        toBinary(AgentStatusSchema, create(AgentStatusSchema, options.status)),
      );
  }
  return row.finish();
}

/** A Session row as an earlier release stored it: the live spec plus the retired server usages (field 7). */
export function retiredSessionRow(options: {
  readonly metadata: MetadataInit;
  readonly spec?: MessageInitShape<typeof SessionSpecSchema>;
  readonly status?: MessageInitShape<typeof SessionStatusSchema>;
  readonly serverUsages?: readonly ReferenceInit[];
}): Uint8Array {
  const spec = new BinaryWriter().raw(
    toBinary(SessionSpecSchema, create(SessionSpecSchema, options.spec ?? {})),
  );
  for (const ref of options.serverUsages ?? []) {
    spec.tag(7, WireType.LengthDelimited).bytes(usageBytes(ref));
  }
  const row = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("agentic.stigmer.ai/v1")
    .tag(2, WireType.LengthDelimited)
    .string("Session")
    .tag(3, WireType.LengthDelimited)
    .bytes(metadataBytes(options.metadata))
    .tag(4, WireType.LengthDelimited)
    .bytes(spec.finish());
  if (options.status !== undefined) {
    row
      .tag(5, WireType.LengthDelimited)
      .bytes(
        toBinary(
          SessionStatusSchema,
          create(SessionStatusSchema, options.status),
        ),
      );
  }
  return row.finish();
}

/** A Plugin row in the live schema. */
export function pluginRow(metadata: MetadataInit): Uint8Array {
  return toBinary(
    PluginSchema,
    create(PluginSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Plugin",
      metadata,
    }),
  );
}

/** A Skill row in the live schema; a member skill carries the plugin's labels. */
export function skillRow(metadata: MetadataInit): Uint8Array {
  return toBinary(
    SkillSchema,
    create(SkillSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Skill",
      metadata,
    }),
  );
}

/** A logger that keeps what the step said. */
export interface RecordingLogger extends StoreLogger {
  readonly warnings: Array<{
    message: string;
    fields: Record<string, unknown> | undefined;
  }>;
  readonly infos: Array<{
    message: string;
    fields: Record<string, unknown> | undefined;
  }>;
}

export function recordingLogger(): RecordingLogger {
  const warnings: RecordingLogger["warnings"] = [];
  const infos: RecordingLogger["infos"] = [];
  return {
    warnings,
    infos,
    debug() {},
    info(message, fields) {
      infos.push({ message, fields });
    },
    warn(message, fields) {
      warnings.push({ message, fields });
    },
  };
}

// --- The seeded estate both drivers' migration tests run the step over. ---

export const ESTATE_ORG = "org_01jz0000000000000000000000";
/** The previous version every seeded agent heads. */
export const ESTATE_OLD_HASH = "a".repeat(64);
/** The plugin's name and server name give the new tool prefix. */
export const ESTATE_NEW_PREFIX = "mcp__plugin_GH_Tools_github";

/** A row in the `resources` table. */
export interface EstateRow {
  readonly kind: string;
  readonly id: string;
  readonly data: Uint8Array;
}

/** A row in the `resource_audit` table. */
export interface EstateAuditRow {
  readonly kind: string;
  readonly resourceId: string;
  readonly data: Uint8Array;
  readonly versionHash: string;
}

/** A row in the `resource_list_keys` table. */
export interface EstateListKey {
  readonly kind: string;
  readonly id: string;
  readonly key: string;
  readonly value: string;
}

/** A connect attempt as the retired table held it. */
export interface EstateAttempt {
  readonly id: string;
  readonly org: string;
  readonly createdBy: string;
  readonly mcpServerId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

const plugin = pluginRow({
  id: "plg_gh",
  org: ESTATE_ORG,
  slug: "gh-tools",
  name: "GH Tools",
});

const agentUser = retiredAgentRow({
  metadata: {
    id: "agt_user",
    org: ESTATE_ORG,
    slug: "reviewer",
    name: "reviewer",
  },
  spec: {
    instructions: "Review every pull request with care.",
    skillRefs: [skillRef("pr-review"), skillRef("house-style")],
    tools: ["mcp__github__create_issue", "mcp__notes__*", "Read"],
  },
  status: { versionHash: ESTATE_OLD_HASH },
  serverUsages: [serverRef("github"), serverRef("notes")],
});

const agentComposed = retiredAgentRow({
  metadata: {
    id: "agt_composed",
    org: ESTATE_ORG,
    slug: "gh-tools",
    name: "gh-tools",
    labels: {
      [PLUGIN_LABEL]: "plg_gh",
      [PLUGIN_VERSION_LABEL]: "sha256:old",
      team: "platform",
    },
  },
  spec: {
    instructions: "The plugin's main agent, composed at install.",
    subAgents: [{ name: "triager", instructions: "Triage every new issue." }],
  },
  status: { versionHash: ESTATE_OLD_HASH },
  serverUsages: [serverRef("github")],
});

const agentPlain = retiredAgentRow({
  metadata: {
    id: "agt_plain",
    org: ESTATE_ORG,
    slug: "writer",
    name: "writer",
  },
  spec: {
    instructions: "Write the release notes.",
    skillRefs: [skillRef("house-style")],
  },
  status: { versionHash: ESTATE_OLD_HASH },
});

const sessionPinned = retiredSessionRow({
  metadata: { id: "ses_pinned", org: ESTATE_ORG, slug: "ses-pinned" },
  spec: { subject: "Triage", skillRefs: [skillRef("pr-review")] },
  status: { agentId: "agt_user", agentVersionHash: ESTATE_OLD_HASH },
  serverUsages: [serverRef("github")],
});

const sessionOther = retiredSessionRow({
  metadata: { id: "ses_other", org: ESTATE_ORG, slug: "ses-other" },
  spec: { subject: "Notes" },
  status: { agentId: "agt_plain", agentVersionHash: ESTATE_OLD_HASH },
});

/** The estate: a plugin with one server and one skill, a hand-added server, agents, sessions and grants. */
export const RETIREMENT_ESTATE: {
  readonly rows: readonly EstateRow[];
  readonly audit: readonly EstateAuditRow[];
  readonly listKeys: readonly EstateListKey[];
  readonly attempts: readonly EstateAttempt[];
} = {
  rows: [
    { kind: "plugin", id: "plg_gh", data: plugin },
    {
      kind: "mcp_server",
      id: "mcp_gh",
      data: retiredServerRow({
        metadata: {
          id: "mcp_gh",
          org: ESTATE_ORG,
          slug: "github",
          name: "github",
          labels: {
            [PLUGIN_LABEL]: "plg_gh",
            [PLUGIN_VERSION_LABEL]: "sha256:old",
          },
        },
      }),
    },
    {
      kind: "mcp_server",
      id: "mcp_notes",
      data: retiredServerRow({
        metadata: {
          id: "mcp_notes",
          org: ESTATE_ORG,
          slug: "notes",
          name: "notes",
        },
      }),
    },
    {
      kind: "skill",
      id: "skl_review",
      data: skillRow({
        id: "skl_review",
        org: ESTATE_ORG,
        slug: "pr-review",
        name: "pr-review",
        labels: {
          [PLUGIN_LABEL]: "plg_gh",
          [PLUGIN_VERSION_LABEL]: "sha256:old",
        },
      }),
    },
    {
      kind: "skill",
      id: "skl_own",
      data: skillRow({
        id: "skl_own",
        org: ESTATE_ORG,
        slug: "house-style",
        name: "house-style",
      }),
    },
    { kind: "agent", id: "agt_user", data: agentUser },
    { kind: "agent", id: "agt_composed", data: agentComposed },
    { kind: "agent", id: "agt_plain", data: agentPlain },
    { kind: "session", id: "ses_pinned", data: sessionPinned },
    { kind: "session", id: "ses_other", data: sessionOther },
    {
      kind: "iam_policy",
      id: "pol_server",
      data: policyRow({
        id: "pol_server",
        principal: "identity_account:acc_1",
        relation: "owner",
        resource: "mcp_server:mcp_gh",
      }),
    },
    {
      kind: "iam_policy",
      id: "pol_hand",
      data: policyRow({
        id: "pol_hand",
        principal: "mcp_server:mcp_notes",
        relation: "viewer",
        resource: "organization:" + ESTATE_ORG,
      }),
    },
    {
      kind: "iam_policy",
      id: "pol_member",
      data: policyRow({
        id: "pol_member",
        principal: "identity_account:acc_1",
        relation: "owner",
        resource: "skill:skl_review",
      }),
    },
    {
      kind: "iam_policy",
      id: "pol_own",
      data: policyRow({
        id: "pol_own",
        principal: "identity_account:acc_1",
        relation: "owner",
        resource: "skill:skl_own",
      }),
    },
    {
      kind: "iam_policy",
      id: "pol_agent",
      data: policyRow({
        id: "pol_agent",
        principal: "identity_account:acc_1",
        relation: "owner",
        resource: "agent:agt_user",
      }),
    },
  ],
  audit: [
    {
      kind: "mcp_server",
      resourceId: "mcp_gh",
      data: new Uint8Array([1]),
      versionHash: "b".repeat(64),
    },
    {
      kind: "skill",
      resourceId: "skl_review",
      data: new Uint8Array([2]),
      versionHash: "c".repeat(64),
    },
    {
      kind: "skill",
      resourceId: "skl_own",
      data: new Uint8Array([3]),
      versionHash: "d".repeat(64),
    },
    {
      kind: "agent",
      resourceId: "agt_user",
      data: agentUser,
      versionHash: ESTATE_OLD_HASH,
    },
    {
      kind: "agent",
      resourceId: "agt_plain",
      data: agentPlain,
      versionHash: ESTATE_OLD_HASH,
    },
  ],
  listKeys: [
    { kind: "mcp_server", id: "mcp_gh", key: "org", value: ESTATE_ORG },
    { kind: "skill", id: "skl_review", key: "org", value: ESTATE_ORG },
    { kind: "skill", id: "skl_own", key: "org", value: ESTATE_ORG },
    {
      kind: "iam_policy",
      id: "pol_server",
      key: "resource",
      value: "mcp_server:mcp_gh",
    },
    {
      kind: "iam_policy",
      id: "pol_own",
      key: "resource",
      value: "skill:skl_own",
    },
  ],
  attempts: [
    {
      id: "att_1",
      org: ESTATE_ORG,
      createdBy: "acc_1",
      mcpServerId: "mcp_gh",
      createdAt: 1_700_000_000_000,
      expiresAt: 1_700_000_600_000,
    },
  ],
};

/** What a driver's test reads back from its store after the step. */
export interface RetiredStoreView {
  data(kind: string, id: string): Promise<Uint8Array | undefined>;
  count(
    table: "resources" | "resource_audit" | "resource_list_keys",
    kind: string,
    id?: string,
  ): Promise<number>;
  /** The archived versions of one row, oldest first. */
  audit(
    kind: string,
    id: string,
  ): Promise<Array<{ versionHash: string; data: Uint8Array }>>;
  attemptColumns(): Promise<string[]>;
  attemptCount(): Promise<number>;
}

/** The outcome both drivers owe the estate. */
export async function expectEstateRetired(
  view: RetiredStoreView,
  logger: RecordingLogger,
): Promise<void> {
  // Every server row, and the skill the plugin installed, leave every table.
  for (const table of [
    "resources",
    "resource_audit",
    "resource_list_keys",
  ] as const) {
    expect(await view.count(table, "mcp_server"), table).toBe(0);
    expect(await view.count(table, "skill", "skl_review"), table).toBe(0);
    expect(await view.count(table, "skill", "skl_own"), table).toBe(1);
  }
  // The plugin row is left as it was.
  expect(await view.data("plugin", "plg_gh")).toEqual(plugin);

  // The user's agent lists the plugin, keeps its own skill, renames the plugin server's tools and drops the hand server's usage.
  const userBytes = await view.data("agent", "agt_user");
  expect(userBytes).toBeDefined();
  const user = fromBinary(AgentSchema, userBytes!);
  const userSpec = user.spec!;
  expect(userSpec.plugins.map((ref) => [ref.kind, ref.org, ref.slug])).toEqual([
    [ApiResourceKind.plugin, ESTATE_ORG, "gh-tools"],
  ]);
  expect(userSpec.skillRefs.map((ref) => ref.slug)).toEqual(["house-style"]);
  expect(userSpec.tools).toEqual([
    `${ESTATE_NEW_PREFIX}__create_issue`,
    "mcp__notes__*",
    "Read",
  ]);
  expect((userSpec as { $unknown?: unknown }).$unknown).toBeUndefined();
  const newHash = canonicalSpecHash(AgentSpecSchema, userSpec);
  expect(newHash).not.toBe(ESTATE_OLD_HASH);
  expect(user.status?.versionHash).toBe(newHash);
  expect(user.metadata?.version?.id).toBe(newHash);
  expect(user.metadata?.version?.previousVersionId).toBe(ESTATE_OLD_HASH);
  expect(user.metadata?.version?.message).toBe(RETIREMENT_VERSION_MESSAGE);
  // The new version is archived beside the previous one, which stays.
  const userAudit = await view.audit("agent", "agt_user");
  expect(userAudit.map((entry) => entry.versionHash)).toEqual([
    ESTATE_OLD_HASH,
    newHash,
  ]);
  expect(userAudit[1]!.data).toEqual(userBytes);

  // The composed agent is an ordinary agent listing its plugin: labels and sub-agents gone, instructions kept.
  const composed = fromBinary(
    AgentSchema,
    (await view.data("agent", "agt_composed"))!,
  );
  expect(composed.metadata?.labels).toEqual({ team: "platform" });
  expect(composed.spec?.subAgents).toEqual([]);
  expect(composed.spec?.instructions).toBe(
    "The plugin's main agent, composed at install.",
  );
  expect(composed.spec?.plugins.map((ref) => ref.slug)).toEqual(["gh-tools"]);
  const composedAudit = await view.audit("agent", "agt_composed");
  expect(composedAudit.map((entry) => entry.versionHash)).toEqual([
    composed.status?.versionHash,
  ]);

  // An agent with no plugin parts is left byte for byte, its history too.
  expect(await view.data("agent", "agt_plain")).toEqual(agentPlain);
  expect((await view.audit("agent", "agt_plain")).length).toBe(1);

  // The session lists the plugin and moves to its agent's new version; the other is untouched.
  const pinned = fromBinary(
    SessionSchema,
    (await view.data("session", "ses_pinned"))!,
  );
  expect(pinned.spec?.plugins.map((ref) => ref.slug)).toEqual(["gh-tools"]);
  expect(pinned.spec?.skillRefs).toEqual([]);
  expect(pinned.spec?.subject).toBe("Triage");
  expect(pinned.status?.agentVersionHash).toBe(newHash);
  expect(await view.data("session", "ses_other")).toEqual(sessionOther);

  // Grants naming a row that left go, from the rows and the list keys; the rest stay.
  for (const id of ["pol_server", "pol_hand", "pol_member"]) {
    expect(await view.count("resources", "iam_policy", id), id).toBe(0);
    expect(await view.count("resource_list_keys", "iam_policy", id), id).toBe(
      0,
    );
  }
  expect(await view.count("resources", "iam_policy", "pol_own")).toBe(1);
  expect(await view.count("resource_list_keys", "iam_policy", "pol_own")).toBe(
    1,
  );
  expect(await view.count("resources", "iam_policy", "pol_agent")).toBe(1);

  // The attempt table names a plugin's server; the retired attempts are gone.
  expect(await view.attemptColumns()).toEqual([
    "id",
    "org",
    "created_by",
    "person",
    "plugin_id",
    "server",
    "created_at",
    "expires_at",
  ]);
  expect(await view.attemptCount()).toBe(0);

  // The hand-added server is named with the way back.
  expect(logger.warnings).toHaveLength(1);
  expect(logger.warnings[0]!.fields).toMatchObject({
    agent: `${ESTATE_ORG}/reviewer`,
    server: "notes",
  });
  expect(String(logger.warnings[0]!.fields?.["fix"])).toContain(
    "stigmer mcp add notes",
  );
}
