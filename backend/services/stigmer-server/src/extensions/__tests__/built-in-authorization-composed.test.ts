/**
 * Pins the built-in AUTHORIZER end to end (20260914.03, T01_1_review.md
 * Q-OA-2, Q-OA-7): under the require-authentication posture, when no unit
 * registers an Authorizer, open source composes one that evaluates the
 * cloud's authorization model over the tuples it would have written,
 * derived from the row. The roles 2b records stop being decorative.
 *
 * Three postures, proven by BEHAVIOUR over real boots, never by the
 * identity of the composed object:
 *   - OIDC with no unit Authorizer (the self-host's shape): the built-in
 *     drivers install. A private agent is visible to its owner and the
 *     organization's admins and to nobody else; a member reads an
 *     org-visible agent and may not edit it; a target that does not exist
 *     answers NOT_FOUND before any permission question (stigmer#224).
 *   - trusted-local: the permissive default stays (Q-OA-7 — one caller,
 *     nothing to separate; the laptop's rows are stamped `"system"`).
 *   - a unit's own Authorizer: nothing built in is installed; the unit's
 *     answer stands even against the founder.
 *
 * Written RED at S1 (2026-09-15), before src/authorization/ exists: the
 * two arms marked RED pass today only because the composed Authorizer is
 * `newPermissiveSingleTeamAuthorizer()` — they are the window the P1
 * release hold names. Every negative assertion sits beside a positive one
 * (the owner's own read and edit succeed) so the file cannot pass
 * vacuously once the drivers land. The per-module proofs (the evaluator,
 * the model tables, the two drivers) are written at slice 1's design pass;
 * this file is the entry's definition of done at the wire.
 *
 * Why agents and not sessions: a session create needs an engine and an
 * instance; the blueprint kinds exercise the visibility axis (the model's
 * `organization#member` viewer tuple is written for `visibility_org` only)
 * and the admin-edits / member-reads split with no engine. The agent kind
 * defaults unspecified visibility to org (`defaults_to_org_visibility`),
 * so the private arm sets `visibility_private` explicitly. On a
 * one-organization server 2b's membership rules make every later arrival
 * a member, so "an outsider" exists only after a revoke — the outsider
 * arm is the OIDC sibling's, where two organizations exist.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import type { Authorizer } from "../authorizer.js";
import type { ServerExtension } from "../registry.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "./composed-support.js";

const FOUNDER = "fake|founder";
const MEMBER = "fake|member";
const ORG = "built-in-org";

function organizationInput(slug: string) {
  return {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: slug, slug, org: "" },
    spec: { description: slug },
  };
}

function agentInput(name: string, visibility: ApiResourceVisibility) {
  return {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Agent",
    metadata: { name, org: ORG, visibility },
    spec: { instructions: "a conformant instruction body" },
  };
}

async function codeOf(promise: Promise<unknown>): Promise<Code | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return (error as ConnectError).code;
  }
}

describe("built-in authorizer (composed server, OIDC with no unit Authorizer: the model is enforced)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let privateAgent: Agent;
  let orgAgent: Agent;

  const asFounder = () =>
    transportFor(port, fakeJwt(FOUNDER, "founder@example.com"));
  const asMember = () =>
    transportFor(port, fakeJwt(MEMBER, "member@example.com"));

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "built-in-authorizer-oidc-"));
    // The unit vouches for tokens and declares the posture and registers
    // NO Authorizer — the open-source OIDC self-host's shape.
    const unit: ServerExtension = {
      name: "fake-oidc-only",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
    };
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();

    // The founder provisions, founds the organization (owner row, 2b's
    // lifecycle), and the member provisions afterwards (member row, 2b's
    // membership rules). Both blueprints are the founder's.
    const founderAccounts = createClient(
      IdentityAccountCommandController,
      asFounder(),
    );
    await founderAccounts.provisionMyAccount({});
    await createClient(OrganizationCommandController, asFounder()).create(
      organizationInput(ORG),
    );
    await createClient(
      IdentityAccountCommandController,
      asMember(),
    ).provisionMyAccount({});

    const founderAgents = createClient(AgentCommandController, asFounder());
    privateAgent = await founderAgents.create(
      agentInput("Private Agent", ApiResourceVisibility.visibility_private),
    );
    orgAgent = await founderAgents.create(
      agentInput("Org Agent", ApiResourceVisibility.visibility_org),
    );
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the owner reads both of their agents and the member reads the organization", async () => {
    const founderQuery = createClient(AgentQueryController, asFounder());
    expect(
      (await founderQuery.get({ value: privateAgent.metadata!.id })).metadata
        ?.id,
    ).toBe(privateAgent.metadata!.id);
    expect(
      (await founderQuery.get({ value: orgAgent.metadata!.id })).metadata?.id,
    ).toBe(orgAgent.metadata!.id);
    // `can_view` on the organization is `viewer`, which a member holds.
    expect(
      (
        await createClient(OrganizationQueryController, asMember()).get({
          value: ORG,
        })
      ).metadata?.id,
    ).toBe(ORG);
  });

  it("a member reads an org-visible agent", async () => {
    const read = await createClient(AgentQueryController, asMember()).get({
      value: orgAgent.metadata!.id,
    });
    expect(read.metadata?.id).toBe(orgAgent.metadata!.id);
  });

  it("RED: a member may not read another member's PRIVATE agent — `agent.viewer` has the organization only through the `visibility_org` tuple", async () => {
    expect(
      await codeOf(
        createClient(AgentQueryController, asMember()).get({
          value: privateAgent.metadata!.id,
        }),
      ),
    ).toBe(Code.PermissionDenied);
  });

  it("RED: a member may not edit an org-visible agent — `can_edit` is `owner`, which is the creator or an admin of the organization", async () => {
    const memberEdit = createClient(AgentCommandController, asMember()).update({
      ...orgAgent,
      spec: { ...orgAgent.spec!, instructions: "edited by a member" },
    });
    expect(await codeOf(memberEdit)).toBe(Code.PermissionDenied);

    // The positive beside the negative: the owner's own edit succeeds.
    const ownerEdit = await createClient(
      AgentCommandController,
      asFounder(),
    ).update({
      ...orgAgent,
      spec: { ...orgAgent.spec!, instructions: "edited by the owner" },
    });
    expect(ownerEdit.spec?.instructions).toBe("edited by the owner");
  });

  it("a target that does not exist answers NOT_FOUND before any permission question (stigmer#224)", async () => {
    expect(
      await codeOf(
        createClient(AgentQueryController, asMember()).get({
          value: "agt_does_not_exist",
        }),
      ),
    ).toBe(Code.NotFound);
  });
});

describe("built-in authorizer (composed server, trusted-local: the permissive default stays)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "built-in-authorizer-local-"));
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a private agent created tokenless is read tokenless — one caller, nothing to separate (Q-OA-7)", async () => {
    const anonymous = transportFor(port);
    await createClient(OrganizationCommandController, anonymous).create(
      organizationInput(ORG),
    );
    const created = await createClient(
      AgentCommandController,
      anonymous,
    ).create(
      agentInput("Laptop Agent", ApiResourceVisibility.visibility_private),
    );
    const read = await createClient(AgentQueryController, anonymous).get({
      value: created.metadata!.id,
    });
    expect(read.metadata?.id).toBe(created.metadata!.id);
  });
});

describe("built-in authorizer (composed server, a unit's own Authorizer: nothing built in is installed)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let unitCalls = 0;

  /** Denies everything and counts — the proof the unit's answer, not the built-in one, is on the wire. */
  const denyingAuthorizer: Authorizer = {
    authorize: () => {
      unitCalls += 1;
      return Promise.resolve({ kind: "deny", reason: "the unit says no" });
    },
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "built-in-authorizer-unit-"));
    const unit: ServerExtension = {
      name: "fake-unit",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
      authorizer: denyingAuthorizer,
    };
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the founder is refused by the unit's Authorizer on their own organization — the built-in one never ran", async () => {
    const founder = transportFor(port, fakeJwt(FOUNDER, "founder@example.com"));
    // Organization create is `is_skip_authorization` by annotation; the
    // read that follows is annotated `can_view` and meets the unit.
    await createClient(OrganizationCommandController, founder).create(
      organizationInput(ORG),
    );
    expect(
      await codeOf(
        createClient(OrganizationQueryController, founder).get({ value: ORG }),
      ),
    ).toBe(Code.PermissionDenied);
    expect(unitCalls, "the unit's Authorizer was consulted").toBeGreaterThan(0);
  });
});
