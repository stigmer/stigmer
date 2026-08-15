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
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/spec_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import {
  InteractionMode,
  ApprovalMode,
  ServiceTier,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { AgentInstanceSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/spec_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import {
  AgentShareSpecSchema,
  AgentShareAudience,
} from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeySpecSchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/spec_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/spec_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
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
import { ManagementMode } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/enum_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientSpecSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/spec_pb";
import { ProjectSchema } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";
import { ProjectSpecSchema } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/spec_pb";
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
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import {
  WorkflowTaskKind,
  BudgetExceededPolicy,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/spec_pb";
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import {
  WorkflowInstanceSpecSchema,
  WorkflowExecutionVisibility,
} from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/spec_pb";

import { buildAgentProto, toAgentUpdateInput } from "../gen/agent";
import { buildAgentChannelProto, toAgentChannelUpdateInput } from "../gen/agentchannel";
import { buildAgentExecutionProto, toAgentExecutionUpdateInput } from "../gen/agentexecution";
import { buildAgentInstanceProto, toAgentInstanceUpdateInput } from "../gen/agentinstance";
import { buildAgentShareProto, toAgentShareUpdateInput } from "../gen/agentshare";
import { buildApiKeyProto, toApiKeyUpdateInput } from "../gen/apikey";
import { buildChannelAppProto, toChannelAppUpdateInput } from "../gen/channelapp";
import { buildEnvironmentProto, toEnvironmentUpdateInput } from "../gen/environment";
import { buildIdentityAccountProto, toIdentityAccountUpdateInput } from "../gen/identityaccount";
import { buildIdentityProviderProto, toIdentityProviderUpdateInput } from "../gen/identityprovider";
import { buildMcpServerProto, toMcpServerUpdateInput } from "../gen/mcpserver";
import { buildOAuthAppProto, toOAuthAppUpdateInput } from "../gen/oauthapp";
import { buildOrganizationProto, toOrganizationUpdateInput } from "../gen/organization";
import { buildPlatformClientProto, toPlatformClientUpdateInput } from "../gen/platformclient";
import { buildProjectProto, toProjectUpdateInput } from "../gen/project";
import { buildScheduleProto, toScheduleUpdateInput } from "../gen/schedule";
import { buildSessionProto, toSessionUpdateInput } from "../gen/session";
import { buildWorkflowProto, toWorkflowUpdateInput } from "../gen/workflow";
import { buildWorkflowExecutionProto, toWorkflowExecutionUpdateInput } from "../gen/workflowexecution";
import { buildWorkflowInstanceProto, toWorkflowInstanceUpdateInput } from "../gen/workflowinstance";

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
  expect(rebuilt.metadata?.org).toBe(META.org);
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
  enabledTools: ["create_issue"],
  toolApprovalOverrides: [
    { toolName: "create_issue", requiresApproval: true, message: "Careful." },
  ],
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
            mcpAccess: [{ mcpServer: "github-mcp", enabledTools: ["search_code"] }],
            skillRefs: [
              { org: "acme", slug: "log-analysis", version: "v1", kind: ApiResourceKind.skill },
            ],
            modelOverride: "gpt-5.6-sol",
          },
        ],
        env: { API_KEY: { isSecret: true, description: "Vendor key", optional: true } },
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
        environmentRefs: [
          { org: "acme", slug: "prod", kind: ApiResourceKind.environment },
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
    create(AgentExecutionSchema, {
      metadata: META,
      spec: {
        sessionId: "sess-1",
        agentId: "agent-1",
        sessionSpec: {
          agentInstanceId: "inst-1",
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
        message: "Please fix it.",
        executionConfig: {
          modelName: "claude-sonnet-4.6",
          contextManagement: {
            disableSummarization: true,
            customTriggerThreshold: 90,
            customTargetTokens: 50000,
          },
          maxToolRounds: 40,
          maxToolResultChars: 20000,
          maxCostUsd: 8,
          interactionMode: InteractionMode.PLAN,
          structuredOutputSchema: { type: "object" },
          buildFromPlan: true,
          approvalMode: ApprovalMode.UNATTENDED,
          serviceTier: ServiceTier.FAST,
        },
        runtimeEnv: { TOKEN: { value: "shh", isSecret: true } },
        callbackToken: new Uint8Array([1, 2, 3]),
        autoApproveAll: true,
        parentWorkflowId: "wf-1",
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
        activityTaskQueue: "runner-q",
        supersedesExecutionId: "exec-0",
        conversationCatchup: {
          digest: "Prior turns summarized.",
          windowEnd: timestampFromDate(new Date("2026-08-15T10:00:00Z")),
        },
        declaredPreferences: {
          orgContext: "We deploy to us-east-1.",
          userContext: "Keep answers terse.",
        },
      },
    });

  it("fixture covers every AgentExecutionSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(AgentExecutionSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      AgentExecutionSpecSchema,
      original,
      buildAgentExecutionProto(toAgentExecutionUpdateInput(original)),
    );
  });
});

describe("toAgentInstanceUpdateInput", () => {
  const fixture = () =>
    create(AgentInstanceSchema, {
      metadata: META,
      spec: {
        agentId: "agent-1",
        description: "Prod instance.",
        environmentRefs: [
          { org: "acme", slug: "prod", kind: ApiResourceKind.environment },
        ],
      },
    });

  it("fixture covers every AgentInstanceSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(AgentInstanceSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      AgentInstanceSpecSchema,
      original,
      buildAgentInstanceProto(toAgentInstanceUpdateInput(original)),
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
        environmentRefs: [
          { org: "acme", slug: "prod", kind: ApiResourceKind.environment },
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

describe("toEnvironmentUpdateInput", () => {
  const fixture = () =>
    create(EnvironmentSchema, {
      metadata: META,
      spec: {
        description: "Prod secrets.",
        data: {
          API_KEY: { value: "shh", isSecret: true, description: "Vendor key" },
        },
      },
    });

  it("fixture covers every EnvironmentSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(EnvironmentSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      EnvironmentSpecSchema,
      original,
      buildEnvironmentProto(toEnvironmentUpdateInput(original)),
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
        rateLimitBudget: 120,
        userinfoEndpoint: "https://acme.okta.example/userinfo",
        isSsoProvider: true,
        oidcClientId: "oidc-123",
        autoProvisionAccounts: true,
        autoGrantOnOrg: true,
        autoGrantRole: IamRole.admin,
        tenantOrgClaim: "org_slug",
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

  it("preserves rate_limit_budget when only the display name changes (live wipe bug)", () => {
    const original = fixture();
    const rebuilt = buildIdentityProviderProto({
      ...toIdentityProviderUpdateInput(original),
      displayName: "Acme Okta (renamed)",
    });
    expect(rebuilt.spec?.rateLimitBudget).toBe(120);
    expect(rebuilt.spec?.displayName).toBe("Acme Okta (renamed)");
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
        defaultEnabledTools: ["search_code"],
        env: { GH_TOKEN: { isSecret: true, description: "PAT", optional: true } },
        pinnedToolApprovals: [
          { toolName: "create_issue", message: "Writes data.", fromDestructiveHint: true },
        ],
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
  const fixture = () =>
    create(OrganizationSchema, {
      metadata: META,
      spec: {
        description: "We make everything.",
        logoUrl: "https://acme.example/logo.png",
        managementMode: ManagementMode.self_managed,
        identityProviderRef: {
          org: "acme",
          slug: "acme-okta",
          kind: ApiResourceKind.identity_provider,
        },
        externalOrgId: "ext-org-1",
        isPersonal: true,
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
        autoProvisionAccounts: true,
        autoGrantOnOrg: true,
        autoGrantRole: IamRole.owner,
        allowedOrigins: ["https://embed.acme.example"],
        environmentRefs: [
          { org: "acme", slug: "prod", kind: ApiResourceKind.environment },
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

  it("preserves environment_refs when only origins change (live wipe bug)", () => {
    const original = fixture();
    const rebuilt = buildPlatformClientProto({
      ...toPlatformClientUpdateInput(original),
      allowedOrigins: ["https://other.acme.example"],
    });
    expect(rebuilt.spec?.environmentRefs.map((r) => r.slug)).toEqual(["prod"]);
    expect(rebuilt.spec?.allowedOrigins).toEqual(["https://other.acme.example"]);
  });
});

describe("toProjectUpdateInput", () => {
  const fixture = () =>
    create(ProjectSchema, {
      metadata: META,
      spec: {
        entryPoint: "apps/web",
        description: "Customer portal.",
        members: [{ org: "acme", slug: "ada" }],
      },
    });

  it("fixture covers every ProjectSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(ProjectSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      ProjectSpecSchema,
      original,
      buildProjectProto(toProjectUpdateInput(original)),
    );
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
            environmentRefs: [
              { org: "acme", slug: "prod", kind: ApiResourceKind.environment },
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
        agentInstanceId: "inst-1",
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

describe("toWorkflowUpdateInput", () => {
  const fixture = () =>
    create(WorkflowSchema, {
      metadata: META,
      spec: {
        description: "Nightly triage.",
        document: {
          dsl: "1.0",
          namespace: "acme",
          name: "nightly-triage",
          version: "0.2.0",
          description: "Runs every night.",
        },
        tasks: [
          {
            name: "call-api",
            kind: WorkflowTaskKind.http_call,
            taskConfig: { url: "https://api.acme.example/tickets" },
            export: { as: "tickets" },
            flow: { then: "triage" },
            compensate: [
              {
                name: "undo",
                kind: WorkflowTaskKind.set_vars,
                taskConfig: { variables: { rolledBack: true } },
              },
            ],
          },
        ],
        env: { API_KEY: { isSecret: true, description: "Vendor key", optional: true } },
        budget: {
          maxCostMicros: 5_000_000n,
          maxTotalTokens: 2_000_000n,
          maxDurationSeconds: 1800,
          onExceeded: BudgetExceededPolicy.budget_exceeded_human_review,
        },
      },
    });

  it("fixture covers every WorkflowSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(WorkflowSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec (recursive tasks, bigint budget) through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      WorkflowSpecSchema,
      original,
      buildWorkflowProto(toWorkflowUpdateInput(original)),
    );
  });
});

describe("toWorkflowExecutionUpdateInput", () => {
  const fixture = () =>
    create(WorkflowExecutionSchema, {
      metadata: META,
      spec: {
        workflowInstanceId: "wfi-1",
        workflowId: "wf-1",
        triggerMessage: "Manual run.",
        triggerMetadata: { source: "console" },
        runtimeEnv: { TOKEN: { value: "shh", isSecret: true } },
        callbackToken: new Uint8Array([9, 8, 7]),
        executionTarget: ExecutionTarget.CLOUD,
      },
    });

  it("fixture covers every WorkflowExecutionSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(WorkflowExecutionSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      WorkflowExecutionSpecSchema,
      original,
      buildWorkflowExecutionProto(toWorkflowExecutionUpdateInput(original)),
    );
  });
});

describe("toWorkflowInstanceUpdateInput", () => {
  const fixture = () =>
    create(WorkflowInstanceSchema, {
      metadata: META,
      spec: {
        workflowId: "wf-1",
        description: "Prod instance.",
        environmentRefs: [
          { org: "acme", slug: "prod", kind: ApiResourceKind.environment },
        ],
        executionVisibility: WorkflowExecutionVisibility.organization,
      },
    });

  it("fixture covers every WorkflowInstanceSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(WorkflowInstanceSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      WorkflowInstanceSpecSchema,
      original,
      buildWorkflowInstanceProto(toWorkflowInstanceUpdateInput(original)),
    );
  });

  it("preserves execution_visibility when only environments change (live wipe bug)", () => {
    const original = fixture();
    const rebuilt = buildWorkflowInstanceProto({
      ...toWorkflowInstanceUpdateInput(original),
      environmentRefs: [{ org: "acme", slug: "staging", kind: ApiResourceKind.environment }],
    });
    expect(rebuilt.spec?.executionVisibility).toBe(
      WorkflowExecutionVisibility.organization,
    );
    expect(rebuilt.spec?.environmentRefs.map((r) => r.slug)).toEqual(["staging"]);
  });
});
