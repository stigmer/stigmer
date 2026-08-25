/**
 * Pins the agentshare domain against Go's agentshare_test.go, case-for-case
 * — through the REAL stack: a composed server on an ephemeral port, native
 * gRPC clients (share + agent — the cross-org arms flip real visibility
 * through the agent pipeline), the full interceptor chain.
 *
 * The load-bearing pins beyond the conformance suite's black-box view:
 *   - the client-provided agent-id pin is discarded and re-stamped;
 *   - the T09 indistinguishability contract compared ERROR-TO-ERROR (a
 *     private cross-org agent vs a genuinely missing one; disabled vs
 *     deleted vs locked-link vs no-share);
 *   - the pin keeps a recreated same-slug agent from reviving a dangling
 *     share (decision 013's rebind guard);
 *   - the #478 store-failure sanitization, pinned at the seam
 *     (findShareByOrgAndSlug) with an injected failing store — the
 *     composed server cannot fault-inject storage.
 *
 * Go tests run one store per test function; this file shares ONE server,
 * so count-sensitive assertions use dedicated orgs and every agent name is
 * unique (slugs derive from names).
 */
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
import type { AgentShare } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { AgentShareAudience } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import type { Store } from "../../../store/interface.js";
import {
  ORG_REQUIRED_FOR_LOOKUP_MESSAGE,
  crossOrgAudienceMessage,
} from "../constants.js";
import { findShareByOrgAndSlug, sharingLinkTokenAllowed } from "../steps.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const API_VERSION = "agentic.stigmer.ai/v1";

type ShareCommand = Client<typeof AgentShareCommandController>;
type ShareQuery = Client<typeof AgentShareQueryController>;
type AgentCommand = Client<typeof AgentCommandController>;

let server: ComposedServer;
let shares: ShareCommand;
let query: ShareQuery;
let agents: AgentCommand;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "agentshare-domain-test-"));
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("STIGMER_RUNNER_TOKEN_KEY", Buffer.alloc(32, 8).toString("base64"));
  server = composeServer({
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

/** Flips the agent marketplace-public through the real pipeline (D1). */
async function makeAgentPublic(agent: Agent): Promise<void> {
  await agents.updateVisibility({
    resourceId: agent.metadata!.id,
    visibility: ApiResourceVisibility.visibility_public,
  });
}

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
  await server.store.saveResource(ApiResourceKind.skill, id, SkillSchema, skill);
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
    const agent = await createTestAgent(uniqueName("Canonical Default Agent"), ORG);
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

  it("cross-org ref to a nonexistent agent is NOT_FOUND — no cross-org fallback", async () => {
    const agent = await createTestAgent(uniqueName("Cross Org Ghost Agent"), ORG);
    const share = shareFor(agent, true);
    share.spec.agentRef = { ...share.spec.agentRef, org: "some-other-org" } as never;

    const err = await grpcError(() => shares.create(share));
    expect(err.code).toBe(Code.NotFound);
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
    const agent = await createTestAgent(uniqueName("Duplicate Share Agent"), ORG);
    await shares.create(shareFor(agent, true));

    const err = await grpcError(() => shares.create(shareFor(agent, true)));
    expect(err.code).toBe(Code.AlreadyExists);
  });

  it("a named share coexists under its own slug", async () => {
    const agent = await createTestAgent(uniqueName("Multi Channel Agent"), ORG);
    await shares.create(shareFor(agent, true));

    const named = shareFor(agent, true);
    (named.metadata as Record<string, string>).name = uniqueName("Docs Site Channel");
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
    const agent = await createTestAgent(uniqueName("Launch Gate Config Agent"), ORG);
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
    const agent = await createTestAgent(uniqueName("Origin Validation Agent"), ORG);
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
    const agent = await createTestAgent(uniqueName("Message Length Agent"), ORG);
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

  it("environment_refs on an org-audience share is INVALID_ARGUMENT; public persists", async () => {
    const agent = await createTestAgent(uniqueName("Env Refs Audience Agent"), ORG);
    const envRef = {
      kind: ApiResourceKind.environment,
      org: ORG,
      slug: "shared-credentials",
    };

    const err = await grpcError(() =>
      shares.create({
        ...shareFor(agent, true),
        spec: {
          ...shareFor(agent, true).spec,
          audience: AgentShareAudience.org,
          environmentRefs: [envRef],
        },
      }),
    );
    expect(err.code).toBe(Code.InvalidArgument);

    const created = await shares.create({
      ...shareFor(agent, true),
      spec: {
        ...shareFor(agent, true).spec,
        audience: AgentShareAudience.public,
        environmentRefs: [envRef],
      },
    });
    expect(created.spec?.environmentRefs).toHaveLength(1);
    expect(created.spec?.environmentRefs[0]?.slug).toBe("shared-credentials");
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
    const agentA = await createTestAgent(uniqueName("Immutable Ref Agent A"), ORG);
    const agentB = await createTestAgent(uniqueName("Immutable Ref Agent B"), ORG);
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
// Cross-org contract (Go TestAgentShareController_CrossOrg, decision 013).
// ---------------------------------------------------------------------------

describe("cross-org shares (decision 013)", () => {
  const PROVIDER = "provider-org";
  const CONSUMER = "consumer-org";

  function crossOrgShare(agent: Agent, enabled: boolean) {
    const share = shareFor(agent, enabled);
    share.metadata.org = CONSUMER;
    share.spec.agentRef = { ...share.spec.agentRef, org: agent.metadata!.org } as never;
    return share;
  }

  it("public agent is shareable cross-org: pin stamped, slug defaulted, profile resolves", async () => {
    const agent = await createTestAgent(uniqueName("Public Provider Agent"), PROVIDER);
    await makeAgentPublic(agent);

    const created = await shares.create(crossOrgShare(agent, true));
    expect(created.metadata?.org).toBe(CONSUMER);
    expect(created.spec?.agentRef?.org).toBe(PROVIDER);
    expect(created.metadata?.slug).toBe(agent.metadata!.slug);
    expect(created.status?.agentId).toBe(agent.metadata!.id);

    const profile = await query.getSharedProfile({
      org: CONSUMER,
      slug: created.metadata!.slug,
    });
    expect(profile.org).toBe(CONSUMER);
    expect(profile.name).toBe(agent.metadata!.name);
  });

  it("non-public agent is NOT_FOUND, indistinguishable from absence", async () => {
    const agent = await createTestAgent(uniqueName("Private Provider Agent"), PROVIDER);

    const err = await grpcError(() => shares.create(crossOrgShare(agent, true)));
    expect(err.code).toBe(Code.NotFound);

    // The refusal must match a genuinely missing agent — no existence
    // probe for private slugs (the T09 indistinguishability contract).
    const ghost = crossOrgShare(agent, true);
    ghost.spec.agentRef = { ...ghost.spec.agentRef, org: "empty-provider-org" } as never;
    const ghostErr = await grpcError(() => shares.create(ghost));
    expect(err.rawMessage).toBe(ghostErr.rawMessage);
  });

  it("org audience is refused cross-org, on create and on update", async () => {
    const agent = await createTestAgent(uniqueName("Audience Rule Agent"), PROVIDER);
    await makeAgentPublic(agent);

    const orgAudience = crossOrgShare(agent, true);
    (orgAudience.spec as Record<string, unknown>).audience = AgentShareAudience.org;
    const createErr = await grpcError(() => shares.create(orgAudience));
    expect(createErr.code).toBe(Code.FailedPrecondition);
    expect(createErr.rawMessage).toBe(crossOrgAudienceMessage(PROVIDER));

    const created = await shares.create(crossOrgShare(agent, true));
    created.spec!.audience = AgentShareAudience.org;
    const updateErr = await grpcError(() => shares.update(created));
    expect(updateErr.code).toBe(Code.FailedPrecondition);
    expect(updateErr.rawMessage).toBe(crossOrgAudienceMessage(PROVIDER));
  });

  it("non-public dependencies block creation, naming every blocker sorted", async () => {
    await saveSkill(
      "skl_private_dep",
      PROVIDER,
      "private-skill",
      ApiResourceVisibility.visibility_private,
    );
    await saveSkill(
      "skl_public_dep",
      PROVIDER,
      "public-skill",
      ApiResourceVisibility.visibility_public,
    );

    const agent = await agents.create({
      apiVersion: API_VERSION,
      kind: "Agent",
      metadata: { name: uniqueName("Tooling Agent"), org: PROVIDER },
      spec: {
        instructions: "You are a tool-using cross-org test agent.",
        skillRefs: [
          { kind: ApiResourceKind.skill, slug: "private-skill" },
          { kind: ApiResourceKind.skill, slug: "public-skill" },
        ],
      },
    });
    await makeAgentPublic(agent);

    const err = await grpcError(() => shares.create(crossOrgShare(agent, true)));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toContain("provider-org/private-skill");
    expect(err.rawMessage).not.toContain("public-skill");

    // Same-org sharing of the same agent stays unaffected — the sweep is
    // a cross-org rule only.
    await shares.create(shareFor(agent, true));
  });

  it("visibility flip fails the profile closed", async () => {
    const agent = await createTestAgent(uniqueName("Revocable Agent"), PROVIDER);
    await makeAgentPublic(agent);
    const created = await shares.create(crossOrgShare(agent, true));

    const ref = { org: CONSUMER, slug: created.metadata!.slug };
    await query.getSharedProfile(ref);

    await agents.updateVisibility({
      resourceId: agent.metadata!.id,
      visibility: ApiResourceVisibility.visibility_private,
    });

    const err = await grpcError(() => query.getSharedProfile(ref));
    expect(err.code).toBe(Code.NotFound);
  });

  it("agent delete leaves the cross-org share failing closed; recreate never rebinds", async () => {
    const name = uniqueName("Ephemeral Provider Agent");
    const agent = await createTestAgent(name, PROVIDER);
    await makeAgentPublic(agent);
    const created = await shares.create(crossOrgShare(agent, true));
    const ref = { org: CONSUMER, slug: created.metadata!.slug };

    await agents.delete({ value: agent.metadata!.id });

    // The consumer org's share survives the provider's delete (cross-org
    // shares are NOT cascaded — not the provider's resource to destroy)
    // but fails closed.
    const survived = await query.get({ value: created.metadata!.id });
    expect(survived.status?.agentId).toBe(agent.metadata!.id);
    const danglingErr = await grpcError(() => query.getSharedProfile(ref));
    expect(danglingErr.code).toBe(Code.NotFound);

    // A DIFFERENT public agent later claims the same org/slug: the pin
    // must keep the old share dark.
    const recreated = await createTestAgent(name, PROVIDER);
    await makeAgentPublic(recreated);
    expect(recreated.metadata!.slug).toBe(agent.metadata!.slug);

    const rebindErr = await grpcError(() => query.getSharedProfile(ref));
    expect(rebindErr.code).toBe(Code.NotFound);
  });
});

// ---------------------------------------------------------------------------
// Anonymous profile lane (Go TestAgentShareController_GetSharedProfile).
// ---------------------------------------------------------------------------

describe("getSharedProfile (anonymous lane)", () => {
  const ORG = "profile-test-org";

  it("uniform NotFound across no-share / disabled / deleted; enabled resolves trimmed", async () => {
    const agent = await createTestAgent(uniqueName("Shared Profile Agent"), ORG);
    const ref = { org: ORG, slug: agent.metadata!.slug };

    // No share yet.
    const noShareErr = await grpcError(() => query.getSharedProfile(ref));
    expect(noShareErr.code).toBe(Code.NotFound);
    expect(noShareErr.rawMessage).toBe(`Agent not found: ${agent.metadata!.slug}`);

    // Enabled share resolves to the trimmed profile — display fields from
    // the AGENT, URL identity from the SHARE, never the full Agent.
    const share = await shares.create(shareFor(agent, true));
    const profile = await query.getSharedProfile(ref);
    expect(profile.org).toBe(share.metadata!.org);
    expect(profile.slug).toBe(share.metadata!.slug);
    expect(profile.name).toBe(agent.metadata!.name);
    expect(profile.description).toBe(agent.spec!.description);
    expect(profile.iconUrl).toBe(agent.spec!.iconUrl);
    expect(profile.defaultInstanceId).not.toBe("");

    // Disabled: byte-identical to no-share.
    share.spec!.enabled = false;
    await shares.update(share);
    const disabledErr = await grpcError(() => query.getSharedProfile(ref));
    expect(disabledErr.code).toBe(Code.NotFound);
    expect(disabledErr.rawMessage).toBe(noShareErr.rawMessage);

    // Deleted: indistinguishable too.
    await shares.delete({ value: share.metadata!.id });
    const deletedErr = await grpcError(() => query.getSharedProfile(ref));
    expect(deletedErr.code).toBe(Code.NotFound);
    expect(deletedErr.rawMessage).toBe(noShareErr.rawMessage);
  });

  it("dangling agent_ref fails closed with the same error", async () => {
    const agent = await createTestAgent(uniqueName("Soon Deleted Agent"), ORG);
    await shares.create(shareFor(agent, true));
    await agents.delete({ value: agent.metadata!.id });

    const err = await grpcError(() =>
      query.getSharedProfile({ org: ORG, slug: agent.metadata!.slug }),
    );
    expect(err.code).toBe(Code.NotFound);
  });

  it("empty org is INVALID_ARGUMENT (anti-enumeration)", async () => {
    const err = await grpcError(() =>
      query.getSharedProfile({ org: "", slug: "any-slug" }),
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(ORG_REQUIRED_FOR_LOOKUP_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// Audience + member lane (Go TestAgentShareController_Audience).
// ---------------------------------------------------------------------------

describe("audience and the member resolution lane", () => {
  const ORG = "audience-test-org";

  it("audience persists and round-trips", async () => {
    const agent = await createTestAgent(uniqueName("Audience Round Trip Agent"), ORG);
    const created = await shares.create({
      ...shareFor(agent, true),
      spec: { ...shareFor(agent, true).spec, audience: AgentShareAudience.org },
    });
    expect(created.spec?.audience).toBe(AgentShareAudience.org);

    const fetched = await query.get({ value: created.metadata!.id });
    expect(fetched.spec?.audience).toBe(AgentShareAudience.org);
  });

  it("member path resolves shares in either audience (OSS: membership always holds)", async () => {
    const agent = await createTestAgent(uniqueName("Member Resolution Agent"), ORG);
    const ref = { org: ORG, slug: agent.metadata!.slug };

    const noShareErr = await grpcError(() => query.getSharedProfileForMember(ref));
    expect(noShareErr.code).toBe(Code.NotFound);

    await shares.create({
      ...shareFor(agent, true),
      spec: { ...shareFor(agent, true).spec, audience: AgentShareAudience.org },
    });

    const profile = await query.getSharedProfileForMember(ref);
    expect(profile.slug).toBe(agent.metadata!.slug);
  });
});

// ---------------------------------------------------------------------------
// Agent-apply isolation (Go TestAgentShareController_AgentApplyNeverTouchesShare).
// ---------------------------------------------------------------------------

describe("agent apply never touches the share (decision 011)", () => {
  it("a full agent update leaves the share resolving, with fresh display fields", async () => {
    const agent = await createTestAgent(
      uniqueName("Apply Isolation Agent"),
      "apply-isolation-org",
    );
    await shares.create(shareFor(agent, true));

    agent.spec!.description = "Updated description";
    await agents.update(agent);

    const profile = await query.getSharedProfile({
      org: "apply-isolation-org",
      slug: agent.metadata!.slug,
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
    const request = (token: string) => ({
      org: ORG,
      slug: agent.metadata!.slug,
      linkToken: token,
    });

    // Capture the no-share NOT_FOUND before creating — the locked-link
    // refusal must be byte-identical to it.
    const noShareErr = await grpcError(() => query.getSharedProfile(request("")));

    const share = await shares.create(shareFor(agent, true));

    // A stray ?k= on an unlocked link is harmless.
    await query.getSharedProfile(request("stray-token"));

    // Rotation locks the link: 27 url-safe chars, status-resident.
    const rotated = await shares.rotateShareLink({ resourceId: share.metadata!.id });
    const firstToken = rotated.status?.shareLinkToken ?? "";
    expect(firstToken).toHaveLength(27);
    expect(firstToken).toMatch(/^[A-Za-z0-9_-]+$/);

    const lockedErr = await grpcError(() => query.getSharedProfile(request("")));
    expect(lockedErr.code).toBe(Code.NotFound);
    expect(lockedErr.rawMessage).toBe(noShareErr.rawMessage);

    await query.getSharedProfile(request(firstToken));

    // Re-rotation kills the previous token.
    const reRotated = await shares.rotateShareLink({ resourceId: share.metadata!.id });
    const secondToken = reRotated.status?.shareLinkToken ?? "";
    expect(secondToken).not.toBe(firstToken);

    const deadErr = await grpcError(() => query.getSharedProfile(request(firstToken)));
    expect(deadErr.code).toBe(Code.NotFound);
    await query.getSharedProfile(request(secondToken));

    // The tokenless member path must not reveal a token-locked PUBLIC share.
    const memberErr = await grpcError(() =>
      query.getSharedProfileForMember({ org: ORG, slug: agent.metadata!.slug }),
    );
    expect(memberErr.code).toBe(Code.NotFound);

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
    const agent = await createTestAgent(uniqueName("Org Audience Rotate Agent"), ORG);
    const created = await shares.create({
      ...shareFor(agent, true),
      spec: { ...shareFor(agent, true).spec, audience: AgentShareAudience.org },
    });
    await shares.rotateShareLink({ resourceId: created.metadata!.id });

    const profile = await query.getSharedProfileForMember({
      org: ORG,
      slug: agent.metadata!.slug,
    });
    expect(profile.slug).toBe(agent.metadata!.slug);
  });
});

// ---------------------------------------------------------------------------
// getByAgent (Go TestAgentShareController_GetByAgent).
// ---------------------------------------------------------------------------

describe("getByAgent", () => {
  it("finds the canonical share and a renamed share", async () => {
    const agent = await createTestAgent(uniqueName("Get By Agent Agent"), "gba-org");
    const canonical = await shares.create(shareFor(agent, true));

    const renamed = shareFor(agent, true);
    (renamed.metadata as Record<string, string>).name = uniqueName("Renamed Channel");
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
    await makeAgentPublic(agent);
    await shares.create(shareFor(agent, true));

    const crossOrg = shareFor(agent, true);
    crossOrg.metadata.org = "gba-consumer-org";
    crossOrg.spec.agentRef = {
      ...crossOrg.spec.agentRef,
      org: agent.metadata!.org,
    } as never;
    await shares.create(crossOrg);

    const cases: Array<{ org: string; want: number; wantOrg: string }> = [
      { org: "", want: 2, wantOrg: "" },
      { org: "gba-provider-org", want: 1, wantOrg: "gba-provider-org" },
      { org: "gba-consumer-org", want: 1, wantOrg: "gba-consumer-org" },
      { org: "gba-bystander-org", want: 0, wantOrg: "" },
    ];
    for (const tt of cases) {
      const list = await query.getByAgent({ agentId: agent.metadata!.id, org: tt.org });
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
    (again.spec as Record<string, unknown>).allowedOrigins = ["https://docs.example.com"];
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
      listResources: async () => {
        throw cause;
      },
    } as unknown as Store;

    const err = await grpcError(() => findShareByOrgAndSlug(failing, "o", "s"));
    expect(err.code).toBe(Code.Internal);
    expect(err.rawMessage).toBe("failed to list agent share resources");
    expect(err.rawMessage).not.toContain("bbolt");
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
