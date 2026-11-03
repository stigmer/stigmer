// The docs pages' world: the resources their pictures draw, built from the
// values each page prints (docs-examples.ts), so a picture names nothing
// its page does not. Times are stamped from the samples' instant, as the
// rest of the gallery's data is, so nothing reads the clock.
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AgentSchema, type Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { ListAgentVersionsResponseSchema, type ListAgentVersionsResponse } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { RoutineSchema, type Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import {
  RoutineFireListSchema,
  RoutineFireOrigin,
  RoutineFireOutcome,
  type RoutineFireList,
} from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import { EnvironmentSchema, type Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { SkillSchema, type Skill } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { sampleDate } from "@stigmer/react-sdk/test";
import { ChannelSchema, type Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelAudience } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import { ChannelInstallState } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/status_pb";
import { ChannelAppSchema, type ChannelApp } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/api_pb";
import { VaultSchema, type Vault } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { ApiKeySchema, type ApiKey } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";
import { IdentityAccountSchema, type IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import {
  AGENT_EXAMPLE,
  CHAT_LINK_EXAMPLE,
  ENVIRONMENT_EXAMPLE,
  ROUTINE_EXAMPLE,
  SERVICE_ACCOUNT_EXAMPLE,
  SKILL_EXAMPLE,
  SLACK_APP_EXAMPLE,
  SLACK_EXAMPLE,
  WHATSAPP_EXAMPLE,
} from "./docs-examples.ts";
import { ORGANIZATION } from "./fixtures.ts";

const ORG_ID = ORGANIZATION.metadata?.id ?? "";
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Ada, who made every resource the docs' pages make: the gallery's account. */
const ADA = { id: "ia-ada", displayName: "Ada Lovelace", email: "ada@acme.example" } as const;

/** Made `daysAgo` days before the samples' instant by Ada, and not changed since. */
function madeBy(daysAgo: number) {
  const at = timestampFromDate(sampleDate(-daysAgo * DAY_MS));
  return { specAudit: { createdBy: ADA, createdAt: at, updatedBy: ADA, updatedAt: at } };
}

/** The Agent the agents page prints as YAML, each field of its detail page one of the file's. */
export const VARIANCE_REPORTER: Agent = create(AgentSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Agent",
  metadata: {
    id: "agt_00000000000000000000000051",
    name: AGENT_EXAMPLE.name,
    slug: AGENT_EXAMPLE.name,
    org: ORG_ID,
    visibility: ApiResourceVisibility.visibility_org,
  },
  spec: {
    description: AGENT_EXAMPLE.description,
    instructions: AGENT_EXAMPLE.instructions.join("\n\n"),
    skillRefs: AGENT_EXAMPLE.skills.map((slug) => ({ org: ORG_ID, kind: ApiResourceKind.skill, slug })),
    plugins: [{ org: ORG_ID, kind: ApiResourceKind.plugin, slug: AGENT_EXAMPLE.plugin }],
    tools: [...AGENT_EXAMPLE.tools],
    env: Object.fromEntries(
      AGENT_EXAMPLE.envNames.map((name, index) => [
        name,
        { isSecret: name.endsWith("_KEY"), description: AGENT_EXAMPLE.envDescriptions[index] },
      ]),
    ),
  },
  status: { audit: madeBy(30) },
});

/** The run the routine's first start began. */
const FIRST_RUN_ID = "run_00000000000000000000000062";

/** The Skill the skills page prints as one SKILL.md, pushed by Ada a month ago. */
export const VARIANCE_REPORT_SKILL: Skill = create(SkillSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Skill",
  metadata: {
    id: "skl_00000000000000000000000052",
    name: SKILL_EXAMPLE.name,
    slug: SKILL_EXAMPLE.name,
    org: ORG_ID,
    visibility: ApiResourceVisibility.visibility_org,
  },
  spec: { name: SKILL_EXAMPLE.name, description: SKILL_EXAMPLE.description, skillMd: SKILL_EXAMPLE.skillMd },
  status: { audit: madeBy(30) },
});

/** The Environment the environments page makes: pandas and poppler, GitHub and the team's own API only. */
export const DATA_SCIENCE: Environment = create(EnvironmentSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Environment",
  metadata: {
    id: "env_00000000000000000000000053",
    name: ENVIRONMENT_EXAMPLE.name,
    slug: ENVIRONMENT_EXAMPLE.slug,
    org: ORG_ID,
    visibility: ApiResourceVisibility.visibility_org,
  },
  spec: {
    description: ENVIRONMENT_EXAMPLE.description,
    networking: { type: NetworkingType.limited, allowedHosts: [...ENVIRONMENT_EXAMPLE.hosts], allowPackageManagers: true },
    packages: { apt: [...ENVIRONMENT_EXAMPLE.apt], pip: [...ENVIRONMENT_EXAMPLE.pip] },
  },
  status: { audit: madeBy(1) },
});

/** The data team's Agent the environments page makes data-science the default of. */
export const DATA_ANALYST: Agent = create(AgentSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Agent",
  metadata: {
    id: "agt_00000000000000000000000054",
    name: ENVIRONMENT_EXAMPLE.agent,
    slug: ENVIRONMENT_EXAMPLE.agent,
    org: ORG_ID,
    visibility: ApiResourceVisibility.visibility_org,
  },
  spec: {
    instructions: "You answer the data team's questions from its reports and its API.",
    environmentRef: { org: ORG_ID, kind: ApiResourceKind.environment, slug: ENVIRONMENT_EXAMPLE.slug },
  },
  status: { audit: madeBy(30) },
});

/** The variance reporter's one version: the YAML the agents page prints, applied once. */
export const VARIANCE_REPORTER_VERSIONS: ListAgentVersionsResponse = create(ListAgentVersionsResponseSchema, {
  entries: [{ versionHash: "5d0e8b31", appliedAt: timestampFromDate(sampleDate(-30 * DAY_MS)), isCurrent: true, message: "First version" }],
});

/**
 * The routine the routines page makes: `enabled` off as the page's form
 * leaves it, or on once Enable & run now has started its first run.
 */
export function varianceRoutine(enabled: boolean): Routine {
  return create(RoutineSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Routine",
    metadata: {
      id: "rtn_00000000000000000000000061",
      name: ROUTINE_EXAMPLE.name,
      slug: ROUTINE_EXAMPLE.name,
      org: ORG_ID,
    },
    spec: {
      cron: ROUTINE_EXAMPLE.cron,
      timeZone: ROUTINE_EXAMPLE.timeZone,
      enabled,
      agent: {
        agentRef: { org: ORG_ID, kind: ApiResourceKind.agent, slug: ROUTINE_EXAMPLE.agent },
        message: ROUTINE_EXAMPLE.message,
      },
    },
    status: {
      // 09:00 in Kolkata is 03:30 UTC: the next one after the samples' instant (11:00 UTC) is tomorrow's.
      ...(enabled ? { nextFireAt: timestampFromDate(new Date(sampleDate(DAY_MS).toISOString().slice(0, 10) + "T03:30:00.000Z")) } : {}),
      ...(enabled ? { lastFireAt: timestampFromDate(sampleDate(-5 * MINUTE_MS)), lastRunId: FIRST_RUN_ID } : {}),
      audit: madeBy(0),
    },
  });
}

/** The routine's history after Enable & run now: one start, by hand, by Ada, five minutes ago. */
export function firstRunHistory(): RoutineFireList {
  return create(RoutineFireListSchema, {
    entries: [
      {
        routineId: "rtn_00000000000000000000000061",
        org: ORG_ID,
        nominalFireTime: timestampFromDate(sampleDate(-5 * MINUTE_MS)),
        origin: RoutineFireOrigin.MANUAL,
        outcome: RoutineFireOutcome.STARTED,
        runId: FIRST_RUN_ID,
        recordedAt: timestampFromDate(sampleDate(-5 * MINUTE_MS)),
        fireId: "fire_00000000000000000000000063",
        firedBy: ADA,
      },
    ],
  });
}

/** The variance reporter, as the Agent a channel serves. */
const REPORTER_REF = { org: ORG_ID, kind: ApiResourceKind.agent, slug: AGENT_EXAMPLE.name } as const;

/** The shared vault the channel pages attach for the variance reporter's tools, usable across the organization. */
export const LEDGER_KEYS: Vault = create(VaultSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Vault",
  metadata: { id: "vlt_00000000000000000000000073", name: SLACK_EXAMPLE.vault, slug: SLACK_EXAMPLE.vault, org: ORG_ID, visibility: ApiResourceVisibility.visibility_org },
  spec: { owner: { case: "org", value: ORG_ID } },
  status: { audit: madeBy(5) },
});

/** A channel's binding of the ledger keys. */
const LEDGER_KEYS_REF = { org: ORG_ID, kind: ApiResourceKind.vault, slug: SLACK_EXAMPLE.vault } as const;

/**
 * The Meta app the WhatsApp channel answers through: the Channel App the
 * WhatsApp page's manifest names.
 */
export const META_APP: ChannelApp = create(ChannelAppSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "ChannelApp",
  metadata: { id: "cha_00000000000000000000000071", name: WHATSAPP_EXAMPLE.app, slug: WHATSAPP_EXAMPLE.app, org: ORG_ID },
  spec: { providerConfig: { case: "whatsapp", value: { appId: "1234567890123456" } } },
  status: { audit: madeBy(7) },
});

/** The bring-your-own-Slack-app page's app, registered and waiting for its events URL. */
export const ACME_BOOKS_SLACK_APP: ChannelApp = create(ChannelAppSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "ChannelApp",
  metadata: { id: "cha_00000000000000000000000072", name: SLACK_APP_EXAMPLE.name, slug: "acme-books", org: ORG_ID },
  spec: { providerConfig: { case: "slack", value: { clientId: "7012345678901.7012345678902" } } },
  status: { audit: madeBy(0) },
});

/** The variance reporter's chat link: the chat link page's ID, open to anyone, embeddable on acme.com. */
export const CHAT_LINK: Channel = create(ChannelSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Channel",
  metadata: { id: CHAT_LINK_EXAMPLE.channelId, name: AGENT_EXAMPLE.name, slug: AGENT_EXAMPLE.name, org: ORG_ID },
  spec: {
    agentRef: REPORTER_REF,
    enabled: true,
    type: { case: "web", value: { audience: ChannelAudience.public, allowedOrigins: [CHAT_LINK_EXAMPLE.origin] } },
    vaults: [LEDGER_KEYS_REF],
  },
  status: { installState: ChannelInstallState.installed, audit: madeBy(3) },
});

/** The variance reporter in the organization's Slack workspace, through the platform's Stigmer app. */
export const SLACK_CHANNEL: Channel = create(ChannelSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Channel",
  metadata: { id: "chn_01j9z3k8f2q4m6n7p8r9s0t1v3", name: SLACK_EXAMPLE.channel, slug: SLACK_EXAMPLE.channel, org: ORG_ID },
  spec: { agentRef: REPORTER_REF, enabled: true, type: { case: "slack", value: {} }, vaults: [LEDGER_KEYS_REF] },
  status: {
    installState: ChannelInstallState.installed,
    typeStatus: { case: "slack", value: { teamId: "T07ACME0001", teamName: "Acme", botUserId: "U07STIGMER1", installedAt: timestampFromDate(sampleDate(-2 * DAY_MS)) } },
    audit: madeBy(2),
  },
});

/** The variance reporter on the business's WhatsApp number, through its Meta app. */
export const WHATSAPP_CHANNEL: Channel = create(ChannelSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Channel",
  metadata: { id: "chn_01j9z3k8f2q4m6n7p8r9s0t1v4", name: WHATSAPP_EXAMPLE.channel, slug: WHATSAPP_EXAMPLE.channel, org: ORG_ID },
  spec: {
    agentRef: REPORTER_REF,
    enabled: true,
    type: { case: "whatsapp", value: { phoneNumberId: WHATSAPP_EXAMPLE.phoneNumberId, appRef: { org: ORG_ID, kind: ApiResourceKind.channel_app, slug: WHATSAPP_EXAMPLE.app } } },
    vaults: [LEDGER_KEYS_REF],
  },
  status: {
    installState: ChannelInstallState.installed,
    typeStatus: {
      case: "whatsapp",
      value: { phoneNumberId: WHATSAPP_EXAMPLE.phoneNumberId, displayPhoneNumber: "+1 555-010-0199", verifiedName: "Acme", channelAppId: META_APP.metadata?.id ?? "", installedAt: timestampFromDate(sampleDate(-DAY_MS)) },
    },
    audit: madeBy(1),
  },
});


/** The service accounts page's CI account, made by Ada at the samples' instant. */
export const CI_DEPLOY: IdentityAccount = create(IdentityAccountSchema, {
  apiVersion: "iam.stigmer.ai/v1",
  kind: "IdentityAccount",
  metadata: { id: "ia_00000000000000000000000081", name: SERVICE_ACCOUNT_EXAMPLE.name, slug: SERVICE_ACCOUNT_EXAMPLE.name, org: ORG_ID },
  status: { audit: madeBy(0) },
});

/**
 * The key the "shown once" picture prints. A real key is `stk_` and 32
 * random bytes in base64url, 43 characters (the server's
 * `domain/apikey/keymaterial.ts`); this one has that length and shape, and
 * its body reads as an example, so a public picture of it never looks like
 * a leaked key.
 */
export const DOCS_EXAMPLE_RAW_KEY = `stk_${"docs-example-key-for-ci-deploy".padEnd(43, "0")}`;

/** The key the create returns: its raw value in `spec.keyHash` this once, expiring in 90 days. */
export const GITHUB_ACTIONS_KEY_CREATED: ApiKey = create(ApiKeySchema, {
  apiVersion: "iam.stigmer.ai/v1",
  kind: "ApiKey",
  metadata: { id: "ak_00000000000000000000000082", name: SERVICE_ACCOUNT_EXAMPLE.key, org: ORG_ID },
  // A service account's key is bound to its organization, as the server's create stores it.
  spec: { keyHash: DOCS_EXAMPLE_RAW_KEY, expiresAt: timestampFromDate(sampleDate(90 * DAY_MS)), boundOrg: ORG_ID },
  status: { audit: madeBy(0) },
});

/** The same key as the account's page lists it two days later: created then, expiring 90 days on, used an hour ago. */
export const GITHUB_ACTIONS_KEY: ApiKey = create(ApiKeySchema, {
  apiVersion: "iam.stigmer.ai/v1",
  kind: "ApiKey",
  metadata: { id: "ak_00000000000000000000000082", name: SERVICE_ACCOUNT_EXAMPLE.key, org: ORG_ID },
  // The server's fingerprint is the key's last six characters (`fingerprintOf`).
  spec: { fingerprint: DOCS_EXAMPLE_RAW_KEY.slice(-6), expiresAt: timestampFromDate(sampleDate(88 * DAY_MS)), boundOrg: ORG_ID },
  status: { lastUsedAt: timestampFromDate(sampleDate(-60 * MINUTE_MS)), audit: madeBy(2) },
});
