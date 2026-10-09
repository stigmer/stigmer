import { describe, it, expect } from "vitest";
import {
  create,
  toJson,
  isFieldSet,
  type DescMessage,
  type Message,
} from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { HookFormat } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/spec_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import {
  InteractionMode,
  ServiceTier,
  ThinkingMode,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import {
  AgentShareSpecSchema,
  AgentShareAudience,
} from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeySpecSchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/spec_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/spec_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import {
  VaultConnectionSource,
  VaultSpecSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityProviderSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IdentityProviderSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/spec_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import {
  OAuthAppSpecSchema,
  VendorApprovalStatus,
  TokenEndpointAuthMethod,
} from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSpecSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/spec_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientSpecSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/spec_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/spec_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import {
  Harness,
  CursorMode,
  ExecutionTarget,
  GitWriteBackMode,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import { buildAgentProto, toAgentUpdateInput } from "../gen/agent";
import { buildAgentChannelProto, toAgentChannelUpdateInput } from "../gen/agentchannel";
import { buildRunProto, toRunUpdateInput } from "../gen/run";
import { buildAgentShareProto, toAgentShareUpdateInput } from "../gen/agentshare";
import { buildApiKeyProto, toApiKeyUpdateInput } from "../gen/apikey";
import { buildChannelAppProto, toChannelAppUpdateInput } from "../gen/channelapp";
import { buildIdentityAccountProto, toIdentityAccountUpdateInput } from "../gen/identityaccount";
import { buildIdentityProviderProto, toIdentityProviderUpdateInput } from "../gen/identityprovider";
import { buildMcpServerProto, toMcpServerUpdateInput } from "../gen/mcpserver";
import { buildOAuthAppProto, toOAuthAppUpdateInput } from "../gen/oauthapp";
import { buildOrganizationProto, toOrganizationUpdateInput } from "../gen/organization";
import { buildPlatformClientProto, toPlatformClientUpdateInput } from "../gen/platformclient";
import { buildScheduleProto, toScheduleUpdateInput } from "../gen/schedule";
import { buildSessionProto, toSessionUpdateInput } from "../gen/session";
import { buildVaultProto, toVaultUpdateInput } from "../gen/vault";

/**
 * Systematic wipe-bug guard for every generated toXxxUpdateInput mapper
 * (update RPCs are full-spec replacements — see gen/proto-utils.ts and the
 * mapper JSDoc). Three layers per resource, generalizing the pattern that
 * caught oss#319:
 *
 * 1. SCHEMA TRIPWIRE — proto reflection asserts the fixture populates
 *    EVERY top-level spec field (one arm per oneof). When a proto gains a
 *    field, this fails first, forcing the fixture forward; the round-trip
 *    then proves the regenerated mapper carries it.
 * 2. ROUND-TRIP — build(toUpdateInput(fixture)) must reproduce the spec
 *    exactly (compared as JSON, defaults omitted). Nested sub-fields are
 *    covered by population: every nested value in a fixture is
 *    non-default, so a dropped nested field breaks equality.
 * 3. METADATA — name/slug/org/labels survive; visibility is carried
 *    (idempotent — the server preserves it regardless, oss#573).
 */

const META = {
  id: "res-123",
  name: "Fixture Resource",
  slug: "fixture-resource",
  org: "acme",
  labels: { team: "platform" },
  visibility: ApiResourceVisibility.visibility_private,
};

function assertFixtureCoversSpec(schema: DescMessage, spec: Message): void {
  for (const field of schema.fields) {
    if (field.oneof) continue; // oneofs are asserted as a group below
    expect(
      isFieldSet(spec, field),
      `fixture must populate ${schema.typeName}.${field.name} — a new proto ` +
        `field lands here first; add it to the fixture, then the round-trip ` +
        `test proves the regenerated mapper carries it`,
    ).toBe(true);
  }
  for (const oneof of schema.oneofs) {
    const value = (spec as unknown as Record<string, { case?: string }>)[
      oneof.localName
    ];
    expect(
      value?.case,
      `fixture must set one arm of ${schema.typeName}.${oneof.name}`,
    ).toBeDefined();
  }
}

interface ResourceLike {
  metadata?: {
    name: string;
    slug: string;
    org: string;
    labels: Record<string, string>;
    visibility: ApiResourceVisibility;
  };
  spec?: Message;
}

function assertSpecRoundTrip(
  specSchema: DescMessage,
  original: ResourceLike,
  rebuilt: ResourceLike,
): void {
  expect(toJson(specSchema, rebuilt.spec!)).toEqual(
    toJson(specSchema, original.spec!),
  );
  expect(rebuilt.metadata?.name).toBe(META.name);
  expect(rebuilt.metadata?.slug).toBe(META.slug);
  // The fixture's own org: META's for an organization-scoped kind, empty
  // for an organization, which belongs to no organization.
  expect(rebuilt.metadata?.org).toBe(original.metadata?.org ?? "");
  expect(rebuilt.metadata?.labels).toEqual(META.labels);
  expect(rebuilt.metadata?.visibility).toBe(META.visibility);
}

// ---------------------------------------------------------------------------
// Shared nested fixtures
// ---------------------------------------------------------------------------

const MCP_USAGE = {
  mcpServerRef: {
    org: "acme",
    slug: "github-mcp",
    version: "v3",
    kind: ApiResourceKind.mcp_server,
  },
};

const WORKSPACE_ENTRIES = [
  {
    name: "repo",
    source: {
      source: {
        case: "gitRepo" as const,
        value: {
          url: "https://github.com/acme/app.git",
          branch: "main",
          commit: "abc123",
          depth: 1,
          writeBackMode: GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR,
          token: "***REDACTED***",
        },
      },
    },
  },
  {
    name: "scratch",
    source: { source: { case: "localPath" as const, value: { path: "/tmp/scratch" } } },
  },
];

const RUN_CONFIG = {
  modelName: "claude-sonnet-4.6",
  maxCostUsd: 4,
  maxToolRounds: 30,
  serviceTier: ServiceTier.FAST,
  thinkingMode: ThinkingMode.ENABLED,
  maxToolResultChars: 20000,
};

// ---------------------------------------------------------------------------
// Per-resource fixtures + suites
// ---------------------------------------------------------------------------

describe("toAgentUpdateInput", () => {
  const fixture = () =>
    create(AgentSchema, {
      metadata: META,
      spec: {
        description: "Handles support tickets.",
        iconUrl: "https://acme.example/agent.png",
        instructions: "Be terse.",
        mcpServerUsages: [MCP_USAGE],
        skillRefs: [
          { org: "acme", slug: "triage", version: "v2", kind: ApiResourceKind.skill },
        ],
        subAgents: [
          {
            name: "researcher",
            description: "Digs into logs.",
            instructions: "Cite sources.",
            tools: ["Read", "mcp__github-mcp__search_code"],
            disallowedTools: ["Bash(git push *)"],
            skillRefs: [
              { org: "acme", slug: "log-analysis", version: "v1", kind: ApiResourceKind.skill },
            ],
            modelOverride: "gpt-5.6-sol",
          },
        ],
        env: {
          API_KEY: { isSecret: true, description: "Vendor key", optional: true },
          WORKSPACE: { description: "Linear workspace", value: "acme" },
        },
        tools: ["Read", "Grep", "Agent(researcher)", "mcp__github-mcp"],
        disallowedTools: ["mcp__github-mcp__delete_repo"],
        runConfig: RUN_CONFIG,
        harness: Harness.NATIVE,
        vaults: [{ org: "acme", slug: "support-tools", kind: ApiResourceKind.vault }],
        hooks: [
          { source: { case: "plugin", value: { org: "acme", slug: "safety", kind: ApiResourceKind.plugin } } },
          {
            source: {
              case: "inline",
              value: {
                format: HookFormat.CLAUDE_CODE,
                groups: [
                  {
                    event: "PreToolUse",
                    matcher: "Bash",
                    handlers: [
                      { command: "/opt/guard", args: ["--strict"], timeoutSeconds: 30, condition: "Bash(git push *)", failClosed: false },
                    ],
                  },
                ],
              },
            },
          },
        ],
      },
    });

  it("fixture covers every AgentSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(AgentSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      AgentSpecSchema,
      original,
      buildAgentProto(toAgentUpdateInput(original)),
    );
  });
});

describe("toAgentChannelUpdateInput", () => {
  const fixture = () =>
    create(AgentChannelSchema, {
      metadata: META,
      spec: {
        agentRef: { org: "acme", slug: "support-bot", kind: ApiResourceKind.agent },
        enabled: true,
        providerConfig: { case: "slack", value: {} },
        vaults: [
          { org: "acme", slug: "prod", kind: ApiResourceKind.vault },
        ],
        appRef: { org: "acme", slug: "acme-slack", kind: ApiResourceKind.channel_app },
        proactiveMessagingEnabled: true,
        runConfig: RUN_CONFIG,
      },
    });

  it("fixture covers every AgentChannelSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(AgentChannelSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      AgentChannelSpecSchema,
      original,
      buildAgentChannelProto(toAgentChannelUpdateInput(original)),
    );
  });
});

describe("toAgentExecutionUpdateInput", () => {
  const fixture = () =>
    create(RunSchema, {
      metadata: META,
      spec: {
        target: {
          case: "sessionSpec",
          value: {
            agentRef: { org: "acme", slug: "fixer", kind: ApiResourceKind.agent },
            subject: "Fix the flaky test",
            harnessStateId: "hs-1",
            harnessStateIdHistory: ["hs-0"],
            metadata: { "stigmer.ai/context": "embedded" },
            workspaceEntries: WORKSPACE_ENTRIES,
            mcpServerUsages: [MCP_USAGE],
            skillRefs: [
              { org: "acme", slug: "triage", version: "v2", kind: ApiResourceKind.skill },
            ],
            harness: Harness.CURSOR,
            cursorMode: CursorMode.CLOUD,
            executionTarget: ExecutionTarget.CLOUD,
          },
        },
        message: "Please fix it.",
        runConfig: RUN_CONFIG,
        interactionMode: InteractionMode.PLAN,
        buildFromPlan: true,
        structuredOutputSchema: { type: "object" },
        autoApproveAll: true,
        attachments: [
          {
            filename: "spec.pdf",
            storageKey: "att/spec.pdf",
            mountPath: "/work/spec.pdf",
            contentType: "application/pdf",
            extract: true,
            localPath: "/tmp/spec.pdf",
          },
        ],
        workspaceFileRefs: ["src/app.ts"],
        supersedesRunId: "exec-0",
        conversationCatchup: {
          digest: "Prior turns summarized.",
          windowEnd: timestampFromDate(new Date("2026-08-15T10:00:00Z")),
        },
      },
    });

  it("fixture covers every AgentExecutionSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(RunSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      RunSpecSchema,
      original,
      buildRunProto(toRunUpdateInput(original)),
    );
  });

  it("round-trips the existing-session arm of the target oneof", () => {
    const original = create(RunSchema, {
      metadata: META,
      spec: { target: { case: "sessionId", value: "ses-1" }, message: "Again." },
    });
    assertSpecRoundTrip(
      RunSpecSchema,
      original,
      buildRunProto(toRunUpdateInput(original)),
    );
  });
});

describe("toAgentShareUpdateInput", () => {
  const fixture = () =>
    create(AgentShareSchema, {
      metadata: META,
      spec: {
        agentRef: { org: "acme", slug: "support-bot", kind: ApiResourceKind.agent },
        enabled: true,
        audience: AgentShareAudience.org,
        allowedOrigins: ["https://acme.example"],
        messages: {
          rateLimited: "Slow down.",
          unavailable: "Back soon.",
          conversationEnded: "Bye.",
        },
        vaults: [
          { org: "acme", slug: "prod", kind: ApiResourceKind.vault },
        ],
        runConfig: RUN_CONFIG,
      },
    });

  it("fixture covers every AgentShareSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(AgentShareSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      AgentShareSpecSchema,
      original,
      buildAgentShareProto(toAgentShareUpdateInput(original)),
    );
  });
});

describe("toApiKeyUpdateInput", () => {
  const fixture = () =>
    create(ApiKeySchema, {
      metadata: META,
      spec: {
        keyHash: "sha256:abcd",
        fingerprint: "fp-1234",
        expiresAt: timestampFromDate(new Date("2027-01-01T00:00:00Z")),
        neverExpires: true,
        boundOrg: "org_01acmeorganization00000000",
      },
    });

  it("fixture covers every ApiKeySpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(ApiKeySpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      ApiKeySpecSchema,
      original,
      buildApiKeyProto(toApiKeyUpdateInput(original)),
    );
  });
});

describe("toChannelAppUpdateInput", () => {
  const slackFixture = () =>
    create(ChannelAppSchema, {
      metadata: META,
      spec: {
        providerConfig: {
          case: "slack",
          value: { clientId: "1234.5678", clientSecret: "shh", signingSecret: "sign" },
        },
      },
    });

  const whatsappFixture = () =>
    create(ChannelAppSchema, {
      metadata: META,
      spec: {
        providerConfig: {
          case: "whatsapp",
          value: { appId: "wa-1", appSecret: "shh", accessToken: "tok", verifyToken: "vrfy" },
        },
      },
    });

  it("fixture covers every ChannelAppSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(ChannelAppSpecSchema, slackFixture().spec!);
  });

  it("round-trips the slack arm through the builder", () => {
    const original = slackFixture();
    assertSpecRoundTrip(
      ChannelAppSpecSchema,
      original,
      buildChannelAppProto(toChannelAppUpdateInput(original)),
    );
  });

  it("round-trips the whatsapp arm through the builder", () => {
    const original = whatsappFixture();
    assertSpecRoundTrip(
      ChannelAppSpecSchema,
      original,
      buildChannelAppProto(toChannelAppUpdateInput(original)),
    );
  });
});

describe("toVaultUpdateInput", () => {
  const fixture = () =>
    create(VaultSchema, {
      metadata: META,
      spec: {
        owner: { case: "person", value: "ida_ana" },
        description: "Support tools.",
        externalId: "customer-1234",
        secrets: {
          ZENDESK_API_KEY: {
            value: "",
            description: "Vendor key",
            savedBy: "ida_ana",
            savedAt: timestampFromDate(new Date("2026-10-08T00:00:00Z")),
          },
        },
        connections: {
          "https://mcp.linear.app/mcp": {
            token: "",
            source: VaultConnectionSource.sign_in,
            signIn: {
              expiresAt: 1_800_000_000n,
              clientId: "client-1",
              authMethod: "mcp_oauth",
              tokenEndpoint: "https://linear.app/oauth/token",
              refreshToken: "",
              mcpServerId: "mcp_linear",
            },
            description: "Linear",
            savedBy: "ida_ana",
            savedAt: timestampFromDate(new Date("2026-10-08T00:00:00Z")),
          },
        },
      },
    });

  it("fixture covers every VaultSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(VaultSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      VaultSpecSchema,
      original,
      buildVaultProto(toVaultUpdateInput(original)),
    );
  });
});

describe("toIdentityAccountUpdateInput (tripwire)", () => {
  const fixture = () =>
    create(IdentityAccountSchema, {
      metadata: META,
      spec: {
        idpId: "auth0|abc123",
        email: "ada@acme.example",
        firstName: "Ada",
        lastName: "Lovelace",
        pictureUrl: "https://acme.example/ada.png",
        isMachineAccount: true,
        provisioningMode: IdentityAccountProvisioningMode.federated,
        identityProviderRef: {
          org: "acme",
          slug: "acme-okta",
          kind: ApiResourceKind.identity_provider,
        },
        preferences: {
          standingContext: "Keep answers terse.",
          defaultHarness: "cursor",
          defaultNativeModel: "claude-sonnet-4.6",
          defaultCursorModel: "composer-2.5",
        },
      },
    });

  it("fixture covers every IdentityAccountSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(IdentityAccountSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      IdentityAccountSpecSchema,
      original,
      buildIdentityAccountProto(toIdentityAccountUpdateInput(original)),
    );
  });
});

describe("toIdentityProviderUpdateInput", () => {
  const fixture = () =>
    create(IdentityProviderSchema, {
      metadata: META,
      spec: {
        displayName: "Acme Okta",
        jwksUri: "https://acme.okta.example/jwks",
        allowedIssuers: ["https://acme.okta.example"],
        expectedAudience: "stigmer",
        userinfoEndpoint: "https://acme.okta.example/userinfo",
        isSsoProvider: true,
        oidcClientId: "oidc-123",
        externalIdClaim: "org_slug",
        createAccountsOnSignIn: true,
        signInRole: IamRole.admin,
      },
    });

  it("fixture covers every IdentityProviderSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(IdentityProviderSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      IdentityProviderSpecSchema,
      original,
      buildIdentityProviderProto(toIdentityProviderUpdateInput(original)),
    );
  });
});

describe("toMcpServerUpdateInput", () => {
  const fixture = () =>
    create(McpServerSchema, {
      metadata: META,
      spec: {
        description: "GitHub tools.",
        iconUrl: "https://acme.example/mcp.png",
        tags: ["devtools"],
        serverType: {
          case: "stdio",
          value: { command: "npx", args: ["-y", "github-mcp"], workingDir: "/srv" },
        },
        env: { GH_TOKEN: { isSecret: true, description: "PAT", optional: true } },
        repositoryUrl: "https://github.com/acme/github-mcp",
        githubStars: 4200,
        auth: {
          oauthAppRef: { org: "acme", slug: "gh-oauth", kind: ApiResourceKind.oauth_app },
          targetEnvVar: "GH_TOKEN",
          tokenLifetimeHint: "8h",
          scopeHints: ["repo"],
          discoveryUrl: "https://github.com/.well-known/oauth",
          oauthOnly: true,
        },
      },
    });

  it("fixture covers every McpServerSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(McpServerSpecSchema, fixture().spec!);
  });

  it("round-trips the stdio arm through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      McpServerSpecSchema,
      original,
      buildMcpServerProto(toMcpServerUpdateInput(original)),
    );
  });

  it("round-trips the http arm through the builder", () => {
    const original = create(McpServerSchema, {
      metadata: META,
      spec: {
        serverType: {
          case: "http",
          value: {
            url: "https://mcp.acme.example",
            headers: { Authorization: "Bearer x" },
            queryParams: { v: "1" },
            timeoutSeconds: 30,
          },
        },
      },
    });
    assertSpecRoundTrip(
      McpServerSpecSchema,
      original,
      buildMcpServerProto(toMcpServerUpdateInput(original)),
    );
  });
});

describe("toOAuthAppUpdateInput", () => {
  const fixture = () =>
    create(OAuthAppSchema, {
      metadata: META,
      spec: {
        provider: "github",
        clientId: "gh-client-1",
        clientSecret: "***REDACTED***",
        authorizationUrl: "https://github.com/login/oauth/authorize",
        tokenUrl: "https://github.com/login/oauth/access_token",
        scopes: ["repo", "read:user"],
        userinfoUrl: "https://api.github.com/user",
        scopeParameterName: "scope",
        vendorApprovalStatus: VendorApprovalStatus.APPROVED,
        vendorApprovalDocsUrl: "https://acme.example/vendor-docs",
        tokenEndpointAuthMethod: TokenEndpointAuthMethod.CLIENT_SECRET_POST,
      },
    });

  it("fixture covers every OAuthAppSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(OAuthAppSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec (incl. the redaction marker) through the builder", () => {
    // Sending the redaction marker back means "keep the stored secret" —
    // the server's EncryptClientSecretForUpdateStep preserves on redacted.
    const original = fixture();
    assertSpecRoundTrip(
      OAuthAppSpecSchema,
      original,
      buildOAuthAppProto(toOAuthAppUpdateInput(original)),
    );
  });
});

describe("toOrganizationUpdateInput (tripwire)", () => {
  // An organization belongs to no organization: its own metadata.org is empty.
  const fixture = () =>
    create(OrganizationSchema, {
      metadata: { ...META, org: "" },
      spec: {
        description: "We make everything.",
        logoUrl: "https://acme.example/logo.png",
        externalId: "cust-4411",
        parentOrg: "org_01jaaaaaaaaaaaaaaaaaaaaaaa",
        preferences: { standingContext: "We deploy to us-east-1." },
      },
    });

  it("fixture covers every OrganizationSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(OrganizationSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      OrganizationSpecSchema,
      original,
      buildOrganizationProto(toOrganizationUpdateInput(original)),
    );
  });
});

describe("toPlatformClientUpdateInput", () => {
  const fixture = () =>
    create(PlatformClientSchema, {
      metadata: META,
      spec: {
        clientId: "pc-1",
        clientSecretHash: "sha256:hash",
        secretFingerprint: "fp-1",
        expiresAt: timestampFromDate(new Date("2027-06-01T00:00:00Z")),
        neverExpires: true,
        createAccountsOnSignIn: true,
        signInRole: IamRole.owner,
        allowedOrigins: ["https://embed.acme.example"],
        vaults: [
          { org: "acme", slug: "prod", kind: ApiResourceKind.vault },
        ],
      },
    });

  it("fixture covers every PlatformClientSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(PlatformClientSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      PlatformClientSpecSchema,
      original,
      buildPlatformClientProto(toPlatformClientUpdateInput(original)),
    );
  });

  it("preserves vaults when only origins change (live wipe bug)", () => {
    const original = fixture();
    const rebuilt = buildPlatformClientProto({
      ...toPlatformClientUpdateInput(original),
      allowedOrigins: ["https://other.acme.example"],
    });
    expect(rebuilt.spec?.vaults.map((r) => r.slug)).toEqual(["prod"]);
    expect(rebuilt.spec?.allowedOrigins).toEqual(["https://other.acme.example"]);
  });
});

describe("toScheduleUpdateInput", () => {
  const fixture = () =>
    create(ScheduleSchema, {
      metadata: META,
      spec: {
        cron: "0 9 * * 1",
        timeZone: "America/New_York",
        enabled: true,
        target: {
          case: "agent",
          value: {
            agentRef: { org: "acme", slug: "support-bot", kind: ApiResourceKind.agent },
            message: "Weekly triage.",
            harness: Harness.NATIVE,
            workspaceEntries: WORKSPACE_ENTRIES,
            vaults: [
              { org: "acme", slug: "prod", kind: ApiResourceKind.vault },
            ],
            runConfig: RUN_CONFIG,
          },
        },
      },
    });

  it("fixture covers every ScheduleSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(ScheduleSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      ScheduleSpecSchema,
      original,
      buildScheduleProto(toScheduleUpdateInput(original)),
    );
  });
});

describe("toSessionUpdateInput", () => {
  const fixture = () =>
    create(SessionSchema, {
      metadata: META,
      spec: {
        agentRef: { org: "acme", slug: "fixer", kind: ApiResourceKind.agent },
        subject: "Fix the flaky test",
        harnessStateId: "hs-1",
        harnessStateIdHistory: ["hs-0"],
        metadata: { "stigmer.ai/context": "embedded" },
        workspaceEntries: WORKSPACE_ENTRIES,
        mcpServerUsages: [MCP_USAGE],
        skillRefs: [
          { org: "acme", slug: "triage", version: "v2", kind: ApiResourceKind.skill },
        ],
        harness: Harness.CURSOR,
        cursorMode: CursorMode.CLOUD,
        executionTarget: ExecutionTarget.CLOUD,
        vaults: [{ org: "acme", slug: "customer-1234", kind: ApiResourceKind.vault }],
        secrets: { OPENAI_API_KEY: "***REDACTED***" },
        connections: { "https://mcp.linear.app/mcp": "***REDACTED***" },
      },
    });

  it("fixture covers every SessionSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(SessionSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      SessionSpecSchema,
      original,
      buildSessionProto(toSessionUpdateInput(original)),
    );
  });

  it("preserves harness state history when only the subject changes (hand-written mapper gap)", () => {
    const original = fixture();
    const rebuilt = buildSessionProto({
      ...toSessionUpdateInput(original),
      subject: "New subject",
    });
    expect(rebuilt.spec?.harnessStateIdHistory).toEqual(["hs-0"]);
    expect(rebuilt.spec?.subject).toBe("New subject");
  });
});
