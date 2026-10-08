/**
 * Pins the agentshare domain against Go's agentshare_test.go, case-for-case
 * — through the REAL stack: a composed server on an ephemeral port, native
 * gRPC clients (share + agent — the cross-org arms flip real visibility
 * through the agent pipeline), the full interceptor chain.
 *
 * The load-bearing pins beyond the conformance suite's black-box view:
 *   - the client-provided agent-id pin is discarded and re-stamped;
 *   - the indistinguishability contract compared ERROR-TO-ERROR (a
 *     private cross-org agent vs a genuinely missing one; disabled vs
 *     deleted vs locked-link vs no-share vs an organization that is gone);
 *   - the pin keeps a recreated same-slug agent from reviving a dangling
 *     share (the rebind guard);
 *   - the #478 store-failure sanitization, pinned at the seam
 *     (loadLinkedShare) with an injected failing store — the composed
 *     server cannot fault-inject storage.
 *
 * Go tests run one store per test function; this file shares ONE server,
 * so count-sensitive assertions use dedicated orgs and every agent name is
 * unique (slugs derive from names).
 */
import { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentShareCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/command_pb";
import { AgentShareQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/query_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import type { AgentShare } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { AgentShareAudience } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import type { Store } from "../../../store/interface.js";
import { sameOrgInvariantMessage } from "../constants.js";
import { loadLinkedShare, sharingLinkTokenAllowed } from "../steps.js";
import {
  organizationId,
  seedOrganizations,
} from "../../organization/__tests__/support.js";
import type { OrganizationIds } from "../../organization/__tests__/support.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const API_VERSION = "agentic.stigmer.ai/v1";

type ShareCommand = Client<typeof AgentShareCommandController>;
type ShareQuery = Client<typeof AgentShareQueryController>;
type AgentCommand = Client<typeof AgentCommandController>;

let server: ComposedServer;
let shares: ShareCommand;
let query: ShareQuery;
let agents: AgentCommand;
let dir: string;

// Requests name organizations by slug, which the serving chain turns into
// the minted id; rows written straight to the store, and what the server
// answers or interpolates into an error, carry the id.
let organizationIds: OrganizationIds;
function idOf(slug: string): string {
  return organizationId(organizationIds, slug);
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "agentshare-domain-test-"));
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv(
    "STIGMER_RUNNER_TOKEN_KEY",
    Buffer.alloc(32, 8).toString("base64"),
  );
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: 127.0.0.1:1 is deterministically
      // closed, so boots fail the non-fatal connect fast and can never touch
      // a live local Temporal (the conformance CRUD harness does the same).
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  // Every Organization a describe below writes into (each names its own).
  organizationIds = await seedOrganizations(transport, [
    "create-test-org",
    "launchgate-test-org",
    "update-test-org",
    "profile-test-org",
    "audience-test-org",
    "rotate-test-org",
    "apply-isolation-org",
    "apply-sem-org",
    "gba-bystander-org",
    "gba-provider-org",
    "gba-org",
    "provider-org",
    "consumer-org",
  ]);
  shares = createClient(AgentShareCommandController, transport);
  query = createClient(AgentShareQueryController, transport);
  agents = createClient(AgentCommandController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

let counter = 0;
function uniqueName(base: string): string {
  counter += 1;
  return `${base} ${counter}`;
}

async function createTestAgent(name: string, org: string): Promise<Agent> {
  return agents.create({
    apiVersion: API_VERSION,
    kind: "Agent",
    metadata: { name, org },
    spec: {
      description: "Agent for sharing tests",
      instructions: "You are a helpful agent for sharing verification.",
      iconUrl: "https://example.com/icon.svg",
    },
  });
}

/** Flips the agent marketplace-public through the real pipeline. */
/**
 * Writes a skill fixture directly to the store — the established
 * cross-domain fixture pattern (the skill domain is not ported yet, and
 * Go's test does the same because the skill controller needs artifact
 * storage the sharing tests don't).
 */
async function saveSkill(
  id: string,
  org: string,
  slug: string,
  visibility: ApiResourceVisibility,
): Promise<void> {
  const skill = create(SkillSchema, {
    apiVersion: API_VERSION,
    kind: "Skill",
    metadata: { id, name: slug, slug, org, visibility },
  });
  await server.store.saveResource(
    ApiResourceKind.skill,
    id,
    SkillSchema,
    skill,
  );
}

/** Minimal canonical share: no slug, no name — both default from the agent. */
function shareFor(agent: Agent, enabled: boolean) {
  return {
    apiVersion: API_VERSION,
    kind: "AgentShare",
    metadata: { org: agent.metadata!.org },
    spec: {
      agentRef: { kind: ApiResourceKind.agent, slug: agent.metadata!.slug },
      enabled,
    },
  };
}

async function grpcError(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
    throw new Error("expected the call to fail");
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Create (Go TestAgentShareController_Create).
// ---------------------------------------------------------------------------

describe("agentshare create", () => {
  const ORG = "create-test-org";

  it("canonical share defaults slug and name from the agent; ash_ id; ref normalized", async () => {
    const agent = await createTestAgent(
      uniqueName("Canonical Default Agent"),
      ORG,
    );
    const share = await shares.create(shareFor(agent, true));

    expect(share.metadata?.slug).toBe(agent.metadata!.slug);
    expect(share.metadata?.id).toMatch(/^ash_/);
    expect(share.spec?.agentRef?.org).toBe(agent.metadata!.org);
  });

  it("nonexistent agent is NOT_FOUND", async () => {
    const err = await grpcError(() =>
      shares.create({
        apiVersion: API_VERSION,
        kind: "AgentShare",
        metadata: { org: ORG },
        spec: {
          agentRef: { kind: ApiResourceKind.agent, slug: "no-such-agent" },
          enabled: true,
        },
      }),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toBe("Agent not found: no-such-agent");
  });

  it("an agent_ref naming another organization is FAILED_PRECONDITION with the same-organization copy, before any lookup", async () => {
    const agent = await createTestAgent(
      uniqueName("Cross Org Ghost Agent"),
      ORG,
    );
    const share = shareFor(agent, true);
    share.spec.agentRef = {
      ...share.spec.agentRef,
      org: "some-other-org",
    } as never;

    const err = await grpcError(() => shares.create(share));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(sameOrgInvariantMessage("some-other-org"));
  });

  it("stamps the agent-id pin on the created share", async () => {
    const agent = await createTestAgent(uniqueName("Pin Stamp Agent"), ORG);
    const share = await shares.create(shareFor(agent, true));
    expect(share.status?.agentId).toBe(agent.metadata!.id);
  });

  it("a client-provided pin is discarded, never trusted", async () => {
    const agent = await createTestAgent(uniqueName("Pin Forgery Agent"), ORG);
    const created = await shares.create({
      ...shareFor(agent, true),
      status: { agentId: "agt_forged" },
    });
    expect(created.status?.agentId).toBe(agent.metadata!.id);
  });

  it("missing org is INVALID_ARGUMENT with the pinned copy", async () => {
    const agent = await createTestAgent(uniqueName("Orgless Share Agent"), ORG);
    const share = shareFor(agent, true);
    share.metadata.org = "";

    const err = await grpcError(() => shares.create(share));
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("second canonical share for the same agent is ALREADY_EXISTS", async () => {
    const agent = await createTestAgent(
      uniqueName("Duplicate Share Agent"),
      ORG,
    );
    await shares.create(shareFor(agent, true));

    const err = await grpcError(() => shares.create(shareFor(agent, true)));
    expect(err.code).toBe(Code.AlreadyExists);
  });

  it("a named share coexists under its own slug", async () => {
    const agent = await createTestAgent(uniqueName("Multi Channel Agent"), ORG);
    await shares.create(shareFor(agent, true));

    const named = shareFor(agent, true);
    (named.metadata as Record<string, string>).name =
      uniqueName("Docs Site Channel");
    const second = await shares.create(named);
    expect(second.metadata?.slug).not.toBe(agent.metadata!.slug);
  });
});

// ---------------------------------------------------------------------------
// Launch-gate config (Go TestAgentShareController_LaunchGateConfig) — the
// validation arms are protovalidate CEL rules in the proto, enforced by
// the shared ValidateProto step; asserted here, not reimplemented.
// ---------------------------------------------------------------------------

describe("launch-gate config", () => {
  const ORG = "launchgate-test-org";

  it("allowed_origins and messages persist and round-trip", async () => {
    const agent = await createTestAgent(
      uniqueName("Launch Gate Config Agent"),
      ORG,
    );
    const created = await shares.create({
      ...shareFor(agent, true),
      spec: {
        ...shareFor(agent, true).spec,
        allowedOrigins: ["https://docs.example.com", "http://localhost:3000"],
        messages: {
          rateLimited: "Custom rate copy",
          unavailable: "Custom unavailable copy",
          conversationEnded: "Custom ended copy",
        },
      },
    });

    const fetched = await query.get({ value: created.metadata!.id });
    expect(fetched.spec?.allowedOrigins).toEqual([
      "https://docs.example.com",
      "http://localhost:3000",
    ]);
    expect(fetched.spec?.messages?.rateLimited).toBe("Custom rate copy");
    expect(fetched.spec?.messages?.unavailable).toBe("Custom unavailable copy");
    expect(fetched.spec?.messages?.conversationEnded).toBe("Custom ended copy");
  });

  it("malformed origins are INVALID_ARGUMENT", async () => {
    const agent = await createTestAgent(
      uniqueName("Origin Validation Agent"),
      ORG,
    );
    for (const origin of [
      "docs.example.com", // missing scheme
      "https://example.com/path", // path not allowed
      "https://example.com/", // trailing slash not allowed
      "ftp://example.com", // wrong scheme
      "https://example.com?q=1", // query not allowed
    ]) {
      const err = await grpcError(() =>
        shares.create({
          ...shareFor(agent, true),
          spec: { ...shareFor(agent, true).spec, allowedOrigins: [origin] },
        }),
      );
      expect(err.code, `origin ${origin}`).toBe(Code.InvalidArgument);
    }
  });

  it("overlong custom message is INVALID_ARGUMENT", async () => {
    const agent = await createTestAgent(
      uniqueName("Message Length Agent"),
      ORG,
    );
    const err = await grpcError(() =>
      shares.create({
        ...shareFor(agent, true),
        spec: {
          ...shareFor(agent, true).spec,
          messages: { rateLimited: "x".repeat(301) },
        },
      }),
    );
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("a saved thinking mode with no model of its own is INVALID_ARGUMENT, on create and on update", async () => {
    const agent = await createTestAgent(uniqueName("Thinking Alone Agent"), ORG);
    const err = await grpcError(() =>
      shares.create({
        ...shareFor(agent, true),
        spec: { ...shareFor(agent, true).spec, runConfig: { thinkingMode: ThinkingMode.ENABLED } },
      }),
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("spec.run_config.model_name");

    const created = await shares.create(shareFor(agent, true));
    const update = await grpcError(() =>
      shares.update({
        ...shareFor(agent, true),
        metadata: { ...shareFor(agent, true).metadata, id: created.metadata!.id, slug: created.metadata!.slug },
        spec: { ...shareFor(agent, true).spec, runConfig: { serviceTier: ServiceTier.FAST } },
      }),
    );
    expect(update.code).toBe(Code.InvalidArgument);
  });

  it("vaults on an org-audience share is INVALID_ARGUMENT; public persists with its attacher recorded", async () => {
    const agent = await createTestAgent(
      uniqueName("Vaults Audience Agent"),
      ORG,
    );
    // The vault must exist when the share is written (the reference rule).
    await server.store.saveResource(
      ApiResourceKind.vault,
      "vlt_shared_credentials",
      VaultSchema,
      create(VaultSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Vault",
        metadata: {
          id: "vlt_shared_credentials",
          name: "shared-credentials",
          slug: "shared-credentials",
          org: idOf(ORG),
          visibility: ApiResourceVisibility.visibility_org,
        },
        spec: { owner: { case: "org", value: idOf(ORG) } },
      }),
    );
    const vaultRef = {
      kind: ApiResourceKind.vault,
      org: ORG,
      slug: "shared-credentials",
    };

    const err = await grpcError(() =>
      shares.create({
        ...shareFor(agent, true),
        spec: {
          ...shareFor(agent, true).spec,
          audience: AgentShareAudience.org,
          vaults: [vaultRef],
        },
      }),
    );
    expect(err.code).toBe(Code.InvalidArgument);

    const created = await shares.create({
      ...shareFor(agent, true),
      spec: {
        ...shareFor(agent, true).spec,
        audience: AgentShareAudience.public,
        vaults: [vaultRef],
      },
    });
    expect(created.spec?.vaults).toHaveLength(1);
    expect(created.spec?.vaults[0]?.slug).toBe("shared-credentials");
    expect(
      created.status?.vaultAttachers["vlt_shared_credentials"],
    ).not.toBe("");
  });

  it("a My vault cannot be attached to a share", async () => {
    const agent = await createTestAgent(uniqueName("My Vault Share Agent"), ORG);
    await server.store.saveResource(
      ApiResourceKind.vault,
      "vlt_someones_own",
      VaultSchema,
      create(VaultSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Vault",
        metadata: {
          id: "vlt_someones_own",
          name: "My vault",
          slug: "my-vault-someones-own",
          org: idOf(ORG),
        },
        spec: { owner: { case: "person", value: "ida_someone" } },
      }),
    );
    const err = await grpcError(() =>
      shares.create({
        ...shareFor(agent, true),
        spec: {
          ...shareFor(agent, true).spec,
          audience: AgentShareAudience.public,
          vaults: [
            { kind: ApiResourceKind.vault, org: ORG, slug: "my-vault-someones-own" },
          ],
        },
      }),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toMatch(/a My vault cannot be attached to a share link/);
  });
});

// ---------------------------------------------------------------------------
// Update (Go TestAgentShareController_Update).
// ---------------------------------------------------------------------------

describe("agentshare update", () => {
  const ORG = "update-test-org";

  it("disable is a config-preserving pause", async () => {
    const agent = await createTestAgent(uniqueName("Pause Agent"), ORG);
    const created = await shares.create({
      ...shareFor(agent, true),
      spec: {
        ...shareFor(agent, true).spec,
        allowedOrigins: ["https://docs.example.com"],
      },
    });

    created.spec!.enabled = false;
    const updated = await shares.update(created);
    expect(updated.spec?.enabled).toBe(false);
    expect(updated.spec?.allowedOrigins).toHaveLength(1);
  });

  it("agent_ref is immutable — FAILED_PRECONDITION with the pinned copy", async () => {
    const agentA = await createTestAgent(
      uniqueName("Immutable Ref Agent A"),
      ORG,
    );
    const agentB = await createTestAgent(
      uniqueName("Immutable Ref Agent B"),
      ORG,
    );
    const created = await shares.create(shareFor(agentA, true));

    created.spec!.agentRef = create(ApiResourceReferenceSchema, {
      kind: ApiResourceKind.agent,
      org: agentB.metadata!.org,
      slug: agentB.metadata!.slug,
    });
    const err = await grpcError(() => shares.update(created));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toContain("spec.agent_ref is immutable");
  });
});

// ---------------------------------------------------------------------------
// Cross-org contract (Go TestAgentShareController_CrossOrg).
// ---------------------------------------------------------------------------

describe("the same-organization invariant", () => {
  const PROVIDER = "provider-org";
  const CONSUMER = "consumer-org";

  function shareInAnotherOrg(agent: Agent, enabled: boolean) {
    const share = shareFor(agent, enabled);
    share.metadata.org = CONSUMER;
    share.spec.agentRef = {
      ...share.spec.agentRef,
      org: agent.metadata!.org,
    } as never;
    return share;
  }

  it("another organization's agent cannot be shared — the same sentence whether the agent exists or not, at any level", async () => {
    const existing = await createTestAgent(
      uniqueName("Provider Agent"),
      PROVIDER,
    );
    const err = await grpcError(() =>
      shares.create(shareInAnotherOrg(existing, true)),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(sameOrgInvariantMessage(idOf(PROVIDER)));

    const ghost = shareFor(existing, true);
    ghost.metadata.org = CONSUMER;
    ghost.spec.agentRef = {
      ...ghost.spec.agentRef,
      org: PROVIDER,
      slug: "no-such-agent",
    } as never;
    const ghostErr = await grpcError(() => shares.create(ghost));
    expect(ghostErr.code).toBe(Code.FailedPrecondition);
    expect(ghostErr.rawMessage).toBe(sameOrgInvariantMessage(idOf(PROVIDER)));
  });

  it("a stored share whose agent is in another organization fails the profile closed, like a dangling reference", async () => {
    const agent = await createTestAgent(
      uniqueName("Legacy Provider Agent"),
      PROVIDER,
    );
    // A row from before the invariant, written straight to the store.
    const legacy = create(AgentShareSchema, {
      apiVersion: API_VERSION,
      kind: "AgentShare",
      metadata: {
        id: "ash_legacy_cross_org",
        name: "legacy-cross-org",
        slug: "legacy-cross-org",
        org: idOf(CONSUMER),
      },
      spec: {
        agentRef: {
          kind: ApiResourceKind.agent,
          org: idOf(PROVIDER),
          slug: agent.metadata!.slug,
        },
        enabled: true,
        audience: AgentShareAudience.public,
      },
      status: { agentId: agent.metadata!.id },
    });
    await server.store.saveResource(
      ApiResourceKind.agent_share,
      legacy.metadata!.id,
      AgentShareSchema,
      legacy,
    );

    const err = await grpcError(() =>
      query.getSharedProfile({ shareId: legacy.metadata!.id }),
    );
    expect(err.code).toBe(Code.NotFound);
    // The row itself is still readable by id — nothing is deleted.
    const row = await query.get({ value: legacy.metadata!.id });
    expect(row.status?.agentId).toBe(agent.metadata!.id);
  });
});

// ---------------------------------------------------------------------------
// Anonymous profile lane (Go TestAgentShareController_GetSharedProfile).
// ---------------------------------------------------------------------------

describe("getSharedProfile (anonymous lane)", () => {
  const ORG = "profile-test-org";

  it("uniform NotFound across no-share / disabled / deleted; enabled resolves trimmed", async () => {
    const agent = await createTestAgent(
      uniqueName("Shared Profile Agent"),
      ORG,
    );

    // No such share: the refusal echoes the id the caller sent.
    const noShareErr = await grpcError(() =>
      query.getSharedProfile({ shareId: "ash_never_created" }),
    );
    expect(noShareErr.code).toBe(Code.NotFound);
    expect(noShareErr.rawMessage).toBe("Agent not found: ash_never_created");

    // Enabled share resolves by its id to the trimmed profile — display
    // fields from the AGENT, org, slug and the agent reference the hosted
    // page starts its sessions on from the SHARE, never the full Agent.
    const share = await shares.create(shareFor(agent, true));
    const ref = { shareId: share.metadata!.id };
    const missing = `Agent not found: ${share.metadata!.id}`;
    const profile = await query.getSharedProfile(ref);
    expect(profile.org).toBe(share.metadata!.org);
    expect(profile.slug).toBe(share.metadata!.slug);
    expect(profile.name).toBe(agent.metadata!.name);
    expect(profile.description).toBe(agent.spec!.description);
    expect(profile.iconUrl).toBe(agent.spec!.iconUrl);
    expect(profile.agentRef).toEqual(share.spec!.agentRef);

    // Disabled: byte-identical to no-share.
    share.spec!.enabled = false;
    await shares.update(share);
    const disabledErr = await grpcError(() => query.getSharedProfile(ref));
    expect(disabledErr.code).toBe(Code.NotFound);
    expect(disabledErr.rawMessage).toBe(missing);

    // Deleted: indistinguishable too.
    await shares.delete({ value: share.metadata!.id });
    const deletedErr = await grpcError(() => query.getSharedProfile(ref));
    expect(deletedErr.code).toBe(Code.NotFound);
    expect(deletedErr.rawMessage).toBe(missing);
  });

  it("dangling agent_ref fails closed with the same error, naming the share's id", async () => {
    const agent = await createTestAgent(uniqueName("Soon Deleted Agent"), ORG);
    const share = await shares.create(shareFor(agent, true));
    await agents.delete({ value: agent.metadata!.id });

    const err = await grpcError(() =>
      query.getSharedProfile({ shareId: share.metadata!.id }),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toBe(`Agent not found: ${share.metadata!.id}`);
  });

  it("a stored share whose agent is gone or was replaced fails closed, naming the share's id", async () => {
    // An agent delete cascades its shares, so these rows are written
    // straight to the store: one names an agent slug nothing holds, one
    // pins an agent id the slug's current holder does not carry.
    const agent = await createTestAgent(uniqueName("Rebound Agent"), ORG);
    const rows = [
      { id: "ash_stored_dangling", slug: "no-such-agent", pin: "" },
      {
        id: "ash_stored_stale_pin",
        slug: agent.metadata!.slug,
        pin: "agt_replaced",
      },
    ];
    for (const row of rows) {
      const stored = create(AgentShareSchema, {
        apiVersion: API_VERSION,
        kind: "AgentShare",
        metadata: { id: row.id, name: row.id, slug: row.id, org: idOf(ORG) },
        spec: {
          agentRef: {
            kind: ApiResourceKind.agent,
            org: idOf(ORG),
            slug: row.slug,
          },
          enabled: true,
          audience: AgentShareAudience.public,
        },
        status: { agentId: row.pin },
      });
      await server.store.saveResource(
        ApiResourceKind.agent_share,
        row.id,
        AgentShareSchema,
        stored,
      );
      const err = await grpcError(() =>
        query.getSharedProfile({ shareId: row.id }),
      );
      expect(err.code, row.id).toBe(Code.NotFound);
      expect(err.rawMessage, row.id).toBe(`Agent not found: ${row.id}`);
      await server.store.deleteResource(ApiResourceKind.agent_share, row.id);
    }
  });

  it("another kind's id answers the same NotFound", async () => {
    const agent = await createTestAgent(uniqueName("Wrong Kind Agent"), ORG);
    const err = await grpcError(() =>
      query.getSharedProfile({ shareId: agent.metadata!.id }),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toBe(`Agent not found: ${agent.metadata!.id}`);
  });

  it("an empty share_id is INVALID_ARGUMENT", async () => {
    const err = await grpcError(() => query.getSharedProfile({ shareId: "" }));
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("a share whose organization is gone answers the same NotFound on both lanes", async () => {
    const agent = await createTestAgent(
      uniqueName("Orphaned Share Agent"),
      ORG,
    );
    const share = await shares.create(shareFor(agent, true));
    const ref = { shareId: share.metadata!.id };
    await query.getSharedProfile(ref);

    // Delete leaves an organization's resources in place; only its row
    // goes. Removing the row directly is that state, with nothing else
    // in this shared server's organization disturbed.
    const org = share.metadata!.org;
    const orgRow = await server.store.getResource(
      ApiResourceKind.organization,
      org,
      OrganizationSchema,
    );
    await server.store.deleteResource(ApiResourceKind.organization, org);
    try {
      const anonymous = await grpcError(() => query.getSharedProfile(ref));
      expect(anonymous.code).toBe(Code.NotFound);
      expect(anonymous.rawMessage).toBe(
        `Agent not found: ${share.metadata!.id}`,
      );
      const member = await grpcError(() =>
        query.getSharedProfileForMember({ value: share.metadata!.id }),
      );
      expect(member.code).toBe(Code.NotFound);
      expect(member.rawMessage).toBe(anonymous.rawMessage);
    } finally {
      await server.store.saveResource(
        ApiResourceKind.organization,
        org,
        OrganizationSchema,
        orgRow,
      );
    }
    await query.getSharedProfile(ref);
  });
});

// ---------------------------------------------------------------------------
// Audience + member lane (Go TestAgentShareController_Audience).
// ---------------------------------------------------------------------------

describe("audience and the member resolution lane", () => {
  const ORG = "audience-test-org";

  it("audience persists and round-trips", async () => {
    const agent = await createTestAgent(
      uniqueName("Audience Round Trip Agent"),
      ORG,
    );
    const created = await shares.create({
      ...shareFor(agent, true),
      spec: { ...shareFor(agent, true).spec, audience: AgentShareAudience.org },
    });
    expect(created.spec?.audience).toBe(AgentShareAudience.org);

    const fetched = await query.get({ value: created.metadata!.id });
    expect(fetched.spec?.audience).toBe(AgentShareAudience.org);
  });

  it("member path resolves shares in either audience (OSS: membership always holds)", async () => {
    const agent = await createTestAgent(
      uniqueName("Member Resolution Agent"),
      ORG,
    );

    const noShareErr = await grpcError(() =>
      query.getSharedProfileForMember({ value: "ash_never_created" }),
    );
    expect(noShareErr.code).toBe(Code.NotFound);
    expect(noShareErr.rawMessage).toBe("Agent not found: ash_never_created");

    const share = await shares.create({
      ...shareFor(agent, true),
      spec: { ...shareFor(agent, true).spec, audience: AgentShareAudience.org },
    });

    const profile = await query.getSharedProfileForMember({
      value: share.metadata!.id,
    });
    expect(profile.slug).toBe(agent.metadata!.slug);
  });

  it("the member path refuses a disabled share with the missing share's NotFound", async () => {
    const agent = await createTestAgent(
      uniqueName("Member Disabled Agent"),
      ORG,
    );
    const share = await shares.create({
      ...shareFor(agent, false),
      spec: {
        ...shareFor(agent, false).spec,
        audience: AgentShareAudience.org,
      },
    });
    const err = await grpcError(() =>
      query.getSharedProfileForMember({ value: share.metadata!.id }),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toBe(`Agent not found: ${share.metadata!.id}`);
  });

  it("the ANONYMOUS path collapses an org-audience share to the uniform NotFound (the proto's audience contract)", async () => {
    const agent = await createTestAgent(
      uniqueName("Org Audience Anon Agent"),
      ORG,
    );
    const share = await shares.create({
      ...shareFor(agent, true),
      spec: { ...shareFor(agent, true).spec, audience: AgentShareAudience.org },
    });

    // Byte-identical with the missing/disabled/rotated refusals — a
    // members-only share link must teach an anonymous visitor nothing.
    const err = await grpcError(() =>
      query.getSharedProfile({ shareId: share.metadata!.id }),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toBe(`Agent not found: ${share.metadata!.id}`);

    // Flipping back to public restores anonymous resolution — the same
    // immediate-revocation latency as disabling the share.
    share.spec!.audience = AgentShareAudience.public;
    await shares.update(share);
    const profile = await query.getSharedProfile({
      shareId: share.metadata!.id,
    });
    expect(profile.slug).toBe(agent.metadata!.slug);
  });
});

// ---------------------------------------------------------------------------
// Agent-apply isolation (Go TestAgentShareController_AgentApplyNeverTouchesShare).
// ---------------------------------------------------------------------------

describe("agent apply never touches the share", () => {
  it("a full agent update leaves the share resolving, with fresh display fields", async () => {
    const agent = await createTestAgent(
      uniqueName("Apply Isolation Agent"),
      "apply-isolation-org",
    );
    const share = await shares.create(shareFor(agent, true));

    agent.spec!.description = "Updated description";
    await agents.update(agent);

    const profile = await query.getSharedProfile({
      shareId: share.metadata!.id,
    });
    expect(profile.description).toBe("Updated description");
  });
});

// ---------------------------------------------------------------------------
// rotateShareLink (Go TestAgentShareController_RotateShareLink + org-audience
// member-path twin).
// ---------------------------------------------------------------------------

describe("rotateShareLink", () => {
  const ORG = "rotate-test-org";

  it("the full rotation lifecycle: lock, resolve-with-token, re-rotate, preserve across update", async () => {
    const agent = await createTestAgent(uniqueName("Rotate Link Agent"), ORG);
    const share = await shares.create(shareFor(agent, true));
    const request = (token: string) => ({
      shareId: share.metadata!.id,
      linkToken: token,
    });
    // The locked-link refusal is byte-identical to a missing share's.
    const missing = `Agent not found: ${share.metadata!.id}`;

    // A stray ?k= on an unlocked link is harmless.
    await query.getSharedProfile(request("stray-token"));

    // Rotation locks the link: 27 url-safe chars, status-resident.
    const rotated = await shares.rotateShareLink({
      resourceId: share.metadata!.id,
    });
    const firstToken = rotated.status?.shareLinkToken ?? "";
    expect(firstToken).toHaveLength(27);
    expect(firstToken).toMatch(/^[A-Za-z0-9_-]+$/);

    const lockedErr = await grpcError(() =>
      query.getSharedProfile(request("")),
    );
    expect(lockedErr.code).toBe(Code.NotFound);
    expect(lockedErr.rawMessage).toBe(missing);

    await query.getSharedProfile(request(firstToken));

    // Re-rotation kills the previous token.
    const reRotated = await shares.rotateShareLink({
      resourceId: share.metadata!.id,
    });
    const secondToken = reRotated.status?.shareLinkToken ?? "";
    expect(secondToken).not.toBe(firstToken);

    const deadErr = await grpcError(() =>
      query.getSharedProfile(request(firstToken)),
    );
    expect(deadErr.code).toBe(Code.NotFound);
    expect(deadErr.rawMessage).toBe(missing);
    await query.getSharedProfile(request(secondToken));

    // The tokenless member path must not reveal a token-locked PUBLIC share.
    const memberErr = await grpcError(() =>
      query.getSharedProfileForMember({ value: share.metadata!.id }),
    );
    expect(memberErr.code).toBe(Code.NotFound);
    expect(memberErr.rawMessage).toBe(missing);

    // A manifest-shaped update (no status) preserves the token — status
    // survives every update verbatim, the design's core guarantee.
    const current = await query.get({ value: share.metadata!.id });
    current.status = undefined;
    const updated = await shares.update(current);
    expect(updated.status?.shareLinkToken).toBe(secondToken);
  });

  it("nonexistent share is NOT_FOUND", async () => {
    const err = await grpcError(() =>
      shares.rotateShareLink({ resourceId: "ash-does-not-exist" }),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toBe("AgentShare not found: ash-does-not-exist");
  });

  it("member path stays open for org-audience shares even when a token exists", async () => {
    const agent = await createTestAgent(
      uniqueName("Org Audience Rotate Agent"),
      ORG,
    );
    const created = await shares.create({
      ...shareFor(agent, true),
      spec: { ...shareFor(agent, true).spec, audience: AgentShareAudience.org },
    });
    await shares.rotateShareLink({ resourceId: created.metadata!.id });

    const profile = await query.getSharedProfileForMember({
      value: created.metadata!.id,
    });
    expect(profile.slug).toBe(agent.metadata!.slug);
  });
});

// ---------------------------------------------------------------------------
// getByAgent (Go TestAgentShareController_GetByAgent).
// ---------------------------------------------------------------------------

describe("getByAgent", () => {
  it("finds the canonical share and a renamed share", async () => {
    const agent = await createTestAgent(
      uniqueName("Get By Agent Agent"),
      "gba-org",
    );
    const canonical = await shares.create(shareFor(agent, true));

    const renamed = shareFor(agent, true);
    (renamed.metadata as Record<string, string>).name =
      uniqueName("Renamed Channel");
    const second = await shares.create(renamed);

    const list = await query.getByAgent({ agentId: agent.metadata!.id });
    expect(list.totalCount).toBe(2);
    const slugs = list.items.map((s: AgentShare) => s.metadata?.slug);
    expect(slugs).toContain(canonical.metadata!.slug);
    expect(slugs).toContain(second.metadata!.slug);
  });

  it("nonexistent agent yields an empty list, not an error", async () => {
    const list = await query.getByAgent({ agentId: "agt-does-not-exist" });
    expect(list.totalCount).toBe(0);
  });

  it("org scopes the list to one org's shares", async () => {
    const agent = await createTestAgent(
      uniqueName("Org Scoped List Agent"),
      "gba-provider-org",
    );
    await shares.create(shareFor(agent, true));
    const named = shareFor(agent, true);
    named.metadata = { ...named.metadata, name: "second link" } as never;
    await shares.create(named);

    // The request names the organization by slug; the shares it answers
    // record the organization's id.
    const cases: Array<{ org: string; want: number; wantOrg: string }> = [
      { org: "", want: 2, wantOrg: "" },
      { org: "gba-provider-org", want: 2, wantOrg: idOf("gba-provider-org") },
      { org: "gba-bystander-org", want: 0, wantOrg: "" },
    ];
    for (const tt of cases) {
      const list = await query.getByAgent({
        agentId: agent.metadata!.id,
        org: tt.org,
      });
      expect(list.totalCount, `org ${tt.org}`).toBe(tt.want);
      for (const item of list.items) {
        if (tt.wantOrg !== "") {
          expect(item.metadata?.org).toBe(tt.wantOrg);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Apply semantics (Go TestAgentShareController_Apply) — delegates the
// CLONED state, so a canonical manifest (no name/slug) applies twice into
// ONE share.
// ---------------------------------------------------------------------------

describe("apply semantics", () => {
  it("apply creates, re-apply updates in place — never duplicates", async () => {
    const agent = await createTestAgent(
      uniqueName("Apply Semantics Agent"),
      "apply-sem-org",
    );

    const created = await shares.apply(shareFor(agent, true));
    expect(created.metadata?.id).not.toBe("");

    const again = shareFor(agent, true);
    (again.spec as Record<string, unknown>).allowedOrigins = [
      "https://docs.example.com",
    ];
    const updated = await shares.apply(again);
    expect(updated.metadata?.id).toBe(created.metadata!.id);
    expect(updated.spec?.allowedOrigins).toHaveLength(1);

    const list = await query.list({ org: "apply-sem-org" });
    expect(list.totalCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Seam-level pins that the composed server cannot reach.
// ---------------------------------------------------------------------------

describe("seam-level pins", () => {
  it("store failure leaks no internals (stigmer/stigmer#478)", async () => {
    // Go injects a failing store into the controller; here the pin sits on
    // the exact seam that formats the wire error — the share lookup used
    // by the ONLY anonymous RPC. The wire carries the static message; the
    // cause stays server-side on ConnectError.cause.
    const cause = new Error("bbolt: /var/lib/stigmer/store.db corrupted");
    const failing = {
      getResource: async () => {
        throw cause;
      },
    } as unknown as Store;

    const err = await grpcError(() => loadLinkedShare(failing, "ash_x"));
    expect(err.code).toBe(Code.Internal);
    expect(err.rawMessage).toBe("failed to load agent share");
    expect(err.rawMessage).not.toContain("bbolt");
    expect(err.cause).toBe(cause);
  });

  it("an organization read failure leaks no internals either", async () => {
    const cause = new Error("bbolt: /var/lib/stigmer/store.db corrupted");
    const failing = {
      getResource: async (kind: ApiResourceKind) => {
        if (kind === ApiResourceKind.agent_share) {
          return create(AgentShareSchema, {
            metadata: { id: "ash_x", org: "org_x" },
          });
        }
        throw cause;
      },
    } as unknown as Store;

    const err = await grpcError(() => loadLinkedShare(failing, "ash_x"));
    expect(err.code).toBe(Code.Internal);
    expect(err.rawMessage).toBe("failed to load organization");
    expect(err.cause).toBe(cause);
  });

  it("sharingLinkTokenAllowed: constant-time compare with Go's length semantics", () => {
    // Unlocked link: anything presented is ignored.
    expect(sharingLinkTokenAllowed("", "")).toBe(true);
    expect(sharingLinkTokenAllowed("stray", "")).toBe(true);
    // Locked link: exact match only; empty and length-mismatched presented
    // tokens refuse (Go's ConstantTimeCompare returns 0 on length
    // mismatch; Node's timingSafeEqual would THROW without the guard).
    expect(sharingLinkTokenAllowed("", "live-token")).toBe(false);
    expect(sharingLinkTokenAllowed("live-token", "live-token")).toBe(true);
    expect(sharingLinkTokenAllowed("live-tok", "live-token")).toBe(false);
    expect(sharingLinkTokenAllowed("live-tokeX", "live-token")).toBe(false);
  });
});
