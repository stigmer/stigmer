import { describe, it, expect } from "vitest";
import { EvalMockKind } from "@stigmer/apis/ai/stigmer/agentic/run/v1/eval_case_pb";
import {
  create,
  toJson,
  isFieldSet,
  type DescMessage,
  type Message,
} from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { HookFormat } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { ChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import {
  ChannelSpecSchema,
  ChannelAudience,
} from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import {
  InteractionMode,
  ServiceTier,
  ThinkingMode,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiKeySchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeySpecSchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/spec_pb";
import { ChannelAppSchema } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/spec_pb";
import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import {
  VaultConnectionSource,
  VaultSpecSchema,
} from "@stigmer/apis/ai/stigmer/agentic/vault/v1/spec_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSpecSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/spec_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { FederationIssuerSchema } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { FederationIssuerSpecSchema } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/spec_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { OAuthAppSchema } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/api_pb";
import {
  OAuthAppSpecSchema,
  VendorApprovalStatus,
  TokenEndpointAuthMethod,
} from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSpecSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/spec_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/spec_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { SessionSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import {
  Harness,
  CursorMode,
  ExecutionTarget,
  GitWriteBackMode,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import { buildAgentProto, toAgentInput } from "../gen/agent";
import { buildChannelProto, toChannelInput } from "../gen/channel";
import { buildRunProto, toRunInput } from "../gen/run";
import { buildApiKeyProto, toApiKeyInput } from "../gen/apikey";
import { buildChannelAppProto, toChannelAppInput } from "../gen/channelapp";
import { buildIdentityAccountProto, toIdentityAccountInput } from "../gen/identityaccount";
import { buildFederationIssuerProto, toFederationIssuerInput } from "../gen/federationissuer";
import { buildOAuthAppProto, toOAuthAppInput } from "../gen/oauthapp";
import { buildOrganizationProto, toOrganizationInput } from "../gen/organization";
import { buildRoutineProto, toRoutineInput } from "../gen/routine";
import { buildSessionProto, toSessionInput } from "../gen/session";
import { buildVaultProto, toVaultInput } from "../gen/vault";

/**
 * Systematic loss guard for every generated toXxxInput mapper, which
 * restates a loaded resource for a copy (see the mapper JSDoc). Three
 * layers per resource, generalizing the pattern that caught oss#319:
 *
 * 1. SCHEMA TRIPWIRE — proto reflection asserts the fixture populates
 *    EVERY top-level spec field (one arm per oneof). When a proto gains a
 *    field, this fails first, forcing the fixture forward; the round-trip
 *    then proves the regenerated mapper carries it.
 * 2. ROUND-TRIP — build(toXxxInput(fixture)) must reproduce the spec
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

const PLUGIN_REFS = [
  { org: "acme", slug: "github", version: "v3", kind: ApiResourceKind.plugin },
];

// A conversation's resources, one of each arm: a repository whose token a
// read returns redacted, a folder on the person's machine, and a File.
const RESOURCES = [
  {
    name: "repo",
    resource: {
      case: "gitRepository" as const,
      value: {
        url: "https://github.com/acme/app.git",
        branch: "main",
        commit: "abc123",
        writeBackMode: GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR,
        token: "***REDACTED***",
      },
    },
  },
  {
    name: "scratch",
    resource: { case: "localPath" as const, value: { path: "/tmp/scratch" } },
  },
  {
    name: "",
    resource: { case: "file" as const, value: { fileId: "file_01", mountPath: "q3/ledger.xlsx" } },
  },
];

// A routine's resources: no folder and no token, which a routine refuses.
const ROUTINE_RESOURCES = [
  {
    name: "repo",
    resource: {
      case: "gitRepository" as const,
      value: { url: "https://github.com/acme/app.git", branch: "main" },
    },
  },
  {
    name: "",
    resource: { case: "file" as const, value: { fileId: "file_01", mountPath: "" } },
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

describe("toAgentInput", () => {
  const fixture = () =>
    create(AgentSchema, {
      metadata: META,
      spec: {
        description: "Handles support tickets.",
        iconUrl: "https://acme.example/agent.png",
        instructions: "Be terse.",
        plugins: PLUGIN_REFS,
        skillRefs: [
          { org: "acme", slug: "triage", version: "v2", kind: ApiResourceKind.skill },
        ],
        subagents: [
          { org: "acme", slug: "researcher", version: "a".repeat(64), kind: ApiResourceKind.agent },
        ],
        env: {
          API_KEY: { isSecret: true, description: "Vendor key", optional: true },
          WORKSPACE: { description: "Linear workspace", value: "acme" },
        },
        tools: ["Read", "Grep", "Agent(researcher)", "mcp__plugin_github_github"],
        disallowedTools: ["mcp__plugin_github_github__delete_repo"],
        runConfig: RUN_CONFIG,
        harness: Harness.NATIVE,
        environmentRef: { org: "acme", slug: "data-science", kind: ApiResourceKind.environment },
        mcpServers: [
          {
            name: "zendesk",
            url: "https://acme-co.zendesk.com/mcp",
            headers: { "X-Api-Key": "${ZENDESK_KEY}" },
          },
        ],
        hooks: [
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
      buildAgentProto(toAgentInput(original)),
    );
  });
});

describe("toChannelInput", () => {
  // The web arm carries the most fields; the Slack and WhatsApp arms
  // round-trip in their own cases below.
  const fixture = () =>
    create(ChannelSchema, {
      metadata: META,
      spec: {
        agentRef: { org: "acme", slug: "support-bot", kind: ApiResourceKind.agent },
        enabled: true,
        vaults: [
          { org: "acme", slug: "prod", kind: ApiResourceKind.vault },
        ],
        runConfig: RUN_CONFIG,
        type: {
          case: "web",
          value: {
            audience: ChannelAudience.public,
            allowedOrigins: ["https://acme.example"],
            messages: {
              rateLimited: "Slow down.",
              unavailable: "Back soon.",
              conversationEnded: "Bye.",
            },
          },
        },
      },
    });

  it("fixture covers every ChannelSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(ChannelSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      ChannelSpecSchema,
      original,
      buildChannelProto(toChannelInput(original)),
    );
  });

  it("round-trips the slack arm of the type oneof", () => {
    const original = create(ChannelSchema, {
      metadata: META,
      spec: {
        agentRef: { org: "acme", slug: "support-bot", kind: ApiResourceKind.agent },
        enabled: true,
        type: {
          case: "slack",
          value: {
            appRef: { org: "acme", slug: "acme-slack", kind: ApiResourceKind.channel_app },
          },
        },
      },
    });
    assertSpecRoundTrip(
      ChannelSpecSchema,
      original,
      buildChannelProto(toChannelInput(original)),
    );
  });

  it("round-trips the whatsapp arm of the type oneof", () => {
    const original = create(ChannelSchema, {
      metadata: META,
      spec: {
        agentRef: { org: "acme", slug: "support-bot", kind: ApiResourceKind.agent },
        enabled: true,
        type: {
          case: "whatsapp",
          value: {
            phoneNumberId: "1234567890",
            appRef: { org: "acme", slug: "acme-whatsapp", kind: ApiResourceKind.channel_app },
            proactiveMessagingEnabled: true,
          },
        },
      },
    });
    assertSpecRoundTrip(
      ChannelSpecSchema,
      original,
      buildChannelProto(toChannelInput(original)),
    );
  });
});

describe("toAgentExecutionInput", () => {
  const fixture = () =>
    create(RunSchema, {
      metadata: META,
      spec: {
        target: {
          case: "sessionSpec",
          value: {
            agentRef: { org: "acme", slug: "fixer", kind: ApiResourceKind.agent },
            subject: "Fix the flaky test",
            metadata: { "stigmer.ai/context": "embedded" },
            resources: RESOURCES,
            plugins: PLUGIN_REFS,
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
        tools: ["Read", "Grep"],
        disallowedTools: ["Skill"],
        appendSystemPrompt: "Answer in one paragraph.",
        fileIds: ["file_01", "file_02"],
        workspaceFileRefs: ["src/app.ts"],
        supersedesRunId: "exec-0",
        conversationCatchup: {
          digest: "Prior turns summarized.",
          windowEnd: timestampFromDate(new Date("2026-08-15T10:00:00Z")),
        },
        reconcileFileReview: true,
        excludedPluginIds: ["plg_compared"],
        evalCase: {
          pluginId: "plg_1",
          pluginDigest: "a".repeat(64),
          suiteDir: "evals",
          caseDir: "evals/fix",
          scaffoldScript: "setup.sh",
          addDirs: ["resources"],
          historyFile: "history.jsonl",
          env: { EVAL_X: "1" },
          mocks: [
            {
              server: "tracker",
              segment: "tracker-acme",
              toolsFile: "evals/mocks/tracker/_tools.json",
              tools: [
                {
                  tool: "create_issue",
                  file: "evals/mocks/tracker/create_issue.md",
                  kind: EvalMockKind.fixed,
                  error: true,
                  expectJson: '{"title":"string"}',
                  abortWhen: "",
                },
              ],
            },
          ],
          agentMockModel: "claude-haiku-4.5",
          agentMockCallBudget: 40,
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
      buildRunProto(toRunInput(original)),
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
      buildRunProto(toRunInput(original)),
    );
  });
});

describe("toApiKeyInput", () => {
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
      buildApiKeyProto(toApiKeyInput(original)),
    );
  });
});

describe("toChannelAppInput", () => {
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
      buildChannelAppProto(toChannelAppInput(original)),
    );
  });

  it("round-trips the whatsapp arm through the builder", () => {
    const original = whatsappFixture();
    assertSpecRoundTrip(
      ChannelAppSpecSchema,
      original,
      buildChannelAppProto(toChannelAppInput(original)),
    );
  });
});

describe("toVaultInput", () => {
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
              loginApp: "org:oap_linear",
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
      buildVaultProto(toVaultInput(original)),
    );
  });
});

describe("toIdentityAccountInput (tripwire)", () => {
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
        federationIssuerRef: {
          org: "acme",
          slug: "acme-okta",
          kind: ApiResourceKind.federation_issuer,
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
      buildIdentityAccountProto(toIdentityAccountInput(original)),
    );
  });
});

describe("toFederationIssuerInput", () => {
  const fixture = () =>
    create(FederationIssuerSchema, {
      metadata: META,
      spec: {
        displayName: "Acme Okta",
        jwksUri: "https://acme.okta.example/jwks",
        allowedIssuers: ["https://acme.okta.example"],
        expectedAudience: "stigmer",
        userinfoEndpoint: "https://acme.okta.example/userinfo",
        externalIdClaim: "org_slug",
        createAccountsOnSignIn: true,
        signInRole: IamRole.admin,
      },
    });

  it("fixture covers every FederationIssuerSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(FederationIssuerSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      FederationIssuerSpecSchema,
      original,
      buildFederationIssuerProto(toFederationIssuerInput(original)),
    );
  });
});

describe("toOAuthAppInput", () => {
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
        addresses: ["github.com", "https://api.githubcopilot.com/mcp"],
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
      buildOAuthAppProto(toOAuthAppInput(original)),
    );
  });
});

describe("toOrganizationInput (tripwire)", () => {
  // An organization belongs to no organization: its own metadata.org is empty.
  const fixture = () =>
    create(OrganizationSchema, {
      metadata: { ...META, org: "" },
      spec: {
        description: "We make everything.",
        logoUrl: "https://acme.example/logo.png",
        externalId: "cust-4411",
        parentOrg: "org_01jaaaaaaaaaaaaaaaaaaaaaaa",
        preferences: {
          standingContext: "We deploy to us-east-1.",
          defaultEnvironmentRef: { org: "acme", slug: "data-science", kind: ApiResourceKind.environment },
        },
        policies: { membersCanCreateAgents: true },
        embedding: {
          allowedOrigins: ["https://app.acme.example"],
          createAccountsOnSignIn: true,
          signInRole: IamRole.member,
          vaults: [{ org: "acme", slug: "product-keys", kind: ApiResourceKind.vault }],
        },
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
      buildOrganizationProto(toOrganizationInput(original)),
    );
  });
});

describe("toRoutineInput", () => {
  const fixture = () =>
    create(RoutineSchema, {
      metadata: META,
      spec: {
        cron: "0 9 * * 1",
        timeZone: "America/New_York",
        enabled: true,
        agent: {
          agentRef: { org: "acme", slug: "support-bot", kind: ApiResourceKind.agent },
          message: "Weekly triage.",
          harness: Harness.NATIVE,
          resources: ROUTINE_RESOURCES,
          vaults: [
            { org: "acme", slug: "prod", kind: ApiResourceKind.vault },
          ],
          runConfig: RUN_CONFIG,
          environmentRef: { org: "acme", slug: "data-science", kind: ApiResourceKind.environment },
        },
      },
    });

  it("fixture covers every RoutineSpec field (schema tripwire)", () => {
    assertFixtureCoversSpec(RoutineSpecSchema, fixture().spec!);
  });

  it("round-trips the full spec and metadata through the builder", () => {
    const original = fixture();
    assertSpecRoundTrip(
      RoutineSpecSchema,
      original,
      buildRoutineProto(toRoutineInput(original)),
    );
  });

  it("keeps a routine with no schedule without one: cron stays absent, not empty", () => {
    const original = fixture();
    delete original.spec!.cron;
    const rebuilt = buildRoutineProto(toRoutineInput(original));
    expect(rebuilt.spec?.cron).toBeUndefined();
    expect(rebuilt.spec?.timeZone).toBe("America/New_York");
  });
});

describe("toSessionInput", () => {
  const fixture = () =>
    create(SessionSchema, {
      metadata: META,
      spec: {
        agentRef: { org: "acme", slug: "fixer", kind: ApiResourceKind.agent },
        subject: "Fix the flaky test",
        metadata: { "stigmer.ai/context": "embedded" },
        resources: RESOURCES,
        plugins: PLUGIN_REFS,
        skillRefs: [
          { org: "acme", slug: "triage", version: "v2", kind: ApiResourceKind.skill },
        ],
        harness: Harness.CURSOR,
        cursorMode: CursorMode.CLOUD,
        executionTarget: ExecutionTarget.CLOUD,
        vaults: [{ org: "acme", slug: "customer-1234", kind: ApiResourceKind.vault }],
        includeMyVault: true,
        fileReview: true,
        environmentRef: { org: "acme", slug: "data-science", kind: ApiResourceKind.environment },
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
      buildSessionProto(toSessionInput(original)),
    );
  });

  it("keeps the id of a reference whose target was deleted, which comes back with no slug", () => {
    const original = fixture();
    original.spec!.agentRef = create(ApiResourceReferenceSchema, {
      org: "acme",
      kind: ApiResourceKind.agent,
      id: "agt_gone",
    });
    original.spec!.skillRefs = [
      create(ApiResourceReferenceSchema, { org: "acme", kind: ApiResourceKind.skill, id: "skl_gone" }),
    ];
    const rebuilt = buildSessionProto(toSessionInput(original));
    expect([rebuilt.spec?.agentRef?.id, rebuilt.spec?.agentRef?.slug]).toEqual(["agt_gone", ""]);
    expect(rebuilt.spec?.skillRefs.map((r) => [r.org, r.id, r.slug])).toEqual([["acme", "skl_gone", ""]]);
  });

  it("keeps every other field when only the subject changes", () => {
    const original = fixture();
    const rebuilt = buildSessionProto({
      ...toSessionInput(original),
      subject: "New subject",
    });
    expect(rebuilt.spec?.resources).toEqual(original.spec?.resources);
    expect(rebuilt.spec?.subject).toBe("New subject");
  });
});
