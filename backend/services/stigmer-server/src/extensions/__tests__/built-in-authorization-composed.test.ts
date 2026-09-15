/**
 * Pins the built-in AUTHORIZER end to end: under the require-authentication
 * posture, when no unit
 * registers an Authorizer, open source composes one that evaluates the
 * cloud's authorization model over the tuples it would have written,
 * derived from the row. The roles 2b records stop being decorative.
 *
 * Three postures, proven by BEHAVIOUR over real boots, never by the
 * identity of the composed object:
 *   - OIDC with no unit Authorizer (the self-host's shape): the built-in
 *     drivers install. A private agent is visible to its owner and the
 *     organization's admins and to nobody else; a member reads an
 *     org-visible agent and may not edit it, and may not create one
 *     (`can_create_agent` is `admin`); a target that does not exist
 *     answers NOT_FOUND before any permission question (stigmer#224); an
 *     outsider on an EXISTING resource hears PERMISSION_DENIED, the
 *     cloud's answer; `findMyOrganizations` lists what a person may view
 *     and `find` refuses enumeration; `checkMyPermission` tells the truth;
 *     nobody sets public visibility; an unprovisioned subject
 *     writes nothing until provisioned.
 *   - trusted-local: the permissive default stays (one caller,
 *     nothing to separate; the laptop's rows are stamped `"system"`):
 *     tokenless reads, public visibility and organization enumeration all
 *     keep working.
 *   - a unit's own Authorizer: nothing built in is installed; the unit's
 *     answer stands even against the founder.
 *
 * Written RED at S1 (2026-09-15), before src/authorization/ existed, and
 * turned green by slice 3 (the drivers and the composition root). Every
 * negative assertion sits beside a positive one (the owner's own read and
 * edit succeed) so the file cannot pass vacuously. The per-module proofs
 * (the evaluator, the model tables, the drivers) live in
 * src/authorization/__tests__; this file is the entry's definition of
 * done at the wire.
 *
 * Why agents and not sessions: a session create needs an engine and an
 * instance; the blueprint kinds exercise the visibility axis (the
 * `organization#viewer` userset tuple — cloud#257's shape — is written for
 * `visibility_org` only) and the admin-edits / member-reads split with no
 * engine. The agent kind defaults unspecified visibility to org
 * (`defaults_to_org_visibility`), so the private arm sets
 * `visibility_private` explicitly. The outsider: 2b's membership rules
 * run at a person's FIRST provisioning only, so an organization the
 * founder creates AFTER the member provisioned has no row for the member
 * — a two-organization server with an outsider, no revoke needed.
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
import { IamPolicyQueryController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/query_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { PUBLIC_VISIBILITY_DENY_MESSAGE } from "../../pipeline/steps/visibility-gates.js";
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
const STRANGER = "fake|stranger";
const ORG = "built-in-org";
/** Founded AFTER the member provisioned: the member holds no row on it. */
const OTHER_ORG = "built-in-other-org";

function organizationInput(slug: string) {
  return {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: slug, slug, org: "" },
    spec: { description: slug },
  };
}

function agentInput(
  name: string,
  visibility: ApiResourceVisibility,
  org: string = ORG,
) {
  return {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Agent",
    metadata: { name, org, visibility },
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

async function failureOf(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected the call to fail");
}

describe("built-in authorizer (composed server, OIDC with no unit Authorizer: the model is enforced)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let privateAgent: Agent;
  let orgAgent: Agent;
  let otherOrgAgent: Agent;

  const asFounder = () =>
    transportFor(port, fakeJwt(FOUNDER, "founder@example.com"));
  const asMember = () =>
    transportFor(port, fakeJwt(MEMBER, "member@example.com"));
  const asStranger = () =>
    transportFor(port, fakeJwt(STRANGER, "stranger@example.com"));

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

    // The second organization, founded AFTER the member provisioned: the
    // founder is its owner (2b's lifecycle); the member holds no row on
    // it — an outsider, on a real two-organization server.
    await createClient(OrganizationCommandController, asFounder()).create(
      organizationInput(OTHER_ORG),
    );
    otherOrgAgent = await founderAgents.create(
      agentInput(
        "Other Org Agent",
        ApiResourceVisibility.visibility_org,
        OTHER_ORG,
      ),
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

  it("a member may not read another member's PRIVATE agent — `agent.viewer` has the organization only through the `visibility_org` tuple", async () => {
    expect(
      await codeOf(
        createClient(AgentQueryController, asMember()).get({
          value: privateAgent.metadata!.id,
        }),
      ),
    ).toBe(Code.PermissionDenied);
  });

  it("a member may not edit an org-visible agent — `can_edit` is `owner`, which is the creator or an admin of the organization", async () => {
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

  it("an outsider on an EXISTING organization and its agent hears PERMISSION_DENIED — the cloud's answer; NOT_FOUND is for what does not exist", async () => {
    expect(
      await codeOf(
        createClient(OrganizationQueryController, asMember()).get({
          value: OTHER_ORG,
        }),
      ),
    ).toBe(Code.PermissionDenied);
    expect(
      await codeOf(
        createClient(AgentQueryController, asMember()).get({
          value: otherOrgAgent.metadata!.id,
        }),
      ),
    ).toBe(Code.PermissionDenied);
    // The positive beside the negative: the founder, its owner, reads it.
    expect(
      (
        await createClient(AgentQueryController, asFounder()).get({
          value: otherOrgAgent.metadata!.id,
        })
      ).metadata?.id,
    ).toBe(otherOrgAgent.metadata!.id);
  });

  it("findMyOrganizations lists what a person may view — the member one, the founder both — and `find` refuses enumeration", async () => {
    const mine = await createClient(
      OrganizationQueryController,
      asMember(),
    ).findMyOrganizations({});
    expect(mine.entries.map((o) => o.metadata?.id)).toEqual([ORG]);
    const founders = await createClient(
      OrganizationQueryController,
      asFounder(),
    ).findMyOrganizations({});
    expect(founders.entries.map((o) => o.metadata?.id).sort()).toEqual(
      [ORG, OTHER_ORG].sort(),
    );
    expect(
      await codeOf(
        createClient(OrganizationQueryController, asMember()).find({
          org: ORG,
        }),
      ),
    ).toBe(Code.Unimplemented);
  });

  it("checkMyPermission tells the truth through the built-in authorizer (2b's arm 3)", async () => {
    const ask = (transport: ReturnType<typeof asMember>) =>
      createClient(IamPolicyQueryController, transport).checkMyPermission({
        relation: "can_edit",
        resource: { kind: "agent", id: orgAgent.metadata!.id },
      });
    expect((await ask(asMember())).isAuthorized).toBe(false);
    expect((await ask(asFounder())).isAuthorized).toBe(true);
  });

  it("a member may not create an agent (`can_create_agent` is `admin`) — the annotation's copy is the wire", async () => {
    const failure = await failureOf(
      createClient(AgentCommandController, asMember()).create(
        agentInput("Member Agent", ApiResourceVisibility.visibility_org),
      ),
    );
    expect(failure.code).toBe(Code.PermissionDenied);
    expect(failure.rawMessage).toBe(
      "unauthorized to create agent in this organization",
    );
  });

  it("nobody sets PUBLIC visibility on an enforcing self-host — the platform gate denies the founder with the policy copy", async () => {
    const failure = await failureOf(
      createClient(AgentCommandController, asFounder()).create(
        agentInput("Public Agent", ApiResourceVisibility.visibility_public),
      ),
    );
    expect(failure.code).toBe(Code.PermissionDenied);
    expect(failure.rawMessage).toBe(PUBLIC_VISIBILITY_DENY_MESSAGE);
  });

  it("an unprovisioned subject writes nothing until provisioned — then they are a member and still may not author a blueprint", async () => {
    const strangerAgents = createClient(AgentCommandController, asStranger());
    const before = await failureOf(
      strangerAgents.create(
        agentInput("Stranger Agent", ApiResourceVisibility.visibility_org),
      ),
    );
    expect(before.code).toBe(Code.PermissionDenied);

    await createClient(
      IdentityAccountCommandController,
      asStranger(),
    ).provisionMyAccount({});
    // A member now (2b's arm 5): reads the org-visible agent, and
    // `can_create_agent` still says `admin`.
    expect(
      (
        await createClient(AgentQueryController, asStranger()).get({
          value: orgAgent.metadata!.id,
        })
      ).metadata?.id,
    ).toBe(orgAgent.metadata!.id);
    expect(
      await codeOf(
        strangerAgents.create(
          agentInput("Stranger Agent", ApiResourceVisibility.visibility_org),
        ),
      ),
    ).toBe(Code.PermissionDenied);
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

  it("a private agent created tokenless is read tokenless — one caller, nothing to separate", async () => {
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

  it("the laptop keeps public visibility and organization enumeration — no directory, no platform gate that bites", async () => {
    const anonymous = transportFor(port);
    const publicAgent = await createClient(
      AgentCommandController,
      anonymous,
    ).create(
      agentInput(
        "Public Laptop Agent",
        ApiResourceVisibility.visibility_public,
      ),
    );
    expect(publicAgent.metadata?.visibility).toBe(
      ApiResourceVisibility.visibility_public,
    );
    const all = await createClient(OrganizationQueryController, anonymous).find(
      { org: ORG },
    );
    expect(all.entries.map((o) => o.metadata?.id)).toContain(ORG);
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
