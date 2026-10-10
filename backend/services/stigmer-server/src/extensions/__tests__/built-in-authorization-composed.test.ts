/**
 * Pins the built-in AUTHORIZER end to end: under the require-authentication
 * posture, when no unit
 * registers an Authorizer, open source composes one that evaluates the
 * cloud's authorization model over the tuples it would have written,
 * derived from the row. The role rows stop being decorative.
 *
 * Three postures, proven by BEHAVIOUR over real boots, never by the
 * identity of the composed object:
 *   - OIDC with no unit Authorizer (the self-host's shape): the built-in
 *     drivers install. A private agent is visible to its owner and the
 *     organization's admins and to nobody else; a member reads an
 *     org-visible agent and may not edit it, creates one while the
 *     organization lets members (the default) and not once an admin turns
 *     that off, and never shares one with child organizations; a target that does not exist
 *     answers NOT_FOUND before any permission question (stigmer#224); an
 *     outsider on an EXISTING resource hears PERMISSION_DENIED, the
 *     cloud's answer; `findMyOrganizations` lists what a person may view
 *     and `find` refuses enumeration; `checkMyPermission` tells the truth;
 *     the retired public level is refused for the founder too, as an
 *     invalid level and not a permission question; an unprovisioned
 *     subject writes nothing until provisioned. The LIST lanes are a member's
 *     lists: an outsider lists nothing of an organization they hold no
 *     row in; My vaults and API keys are their owner's even to the
 *     organization's owner, who, like a teammate, is refused reading,
 *     writing and deleting another member's My vault by its id; the library (a search) omits a private agent
 *     for a member; the enumeration lanes answer through the scope; an
 *     unprovisioned subject's lists are empty and become theirs once
 *     provisioned.
 *   - trusted-local: the permissive default stays (one caller,
 *     nothing to separate; the laptop's rows are stamped `"system"`):
 *     tokenless reads and organization enumeration keep working, and
 *     the retired public level is refused here exactly as it is under
 *     every other posture (the level is gone, not gated). One question
 *     is answered as under sign-in: a request naming an Organization the
 *     server does not hold is NOT_FOUND with the same sentence, whether
 *     it writes (a create, an apply, a session) or reads (a usage
 *     report), so nothing is stored under a slug no Organization holds
 *     (stigmer#1163). The OIDC arm pins the same sentence beside it.
 *   - a unit's own Authorizer: nothing built in is installed; the unit's
 *     answer stands even against the founder.
 *
 * Written RED on 2026-09-15, before src/authorization/ existed, and
 * turned green once the drivers and the composition root landed. Every
 * negative assertion sits beside a positive one (the owner's own read and
 * edit succeed) so the file cannot pass vacuously. The per-module proofs
 * (the evaluator, the model tables, the drivers) live in
 * src/authorization/__tests__; this file is the proof at the wire.
 *
 * Why agents and not sessions: a session create needs an engine and an
 * instance; the blueprint kinds exercise the visibility axis (the
 * `organization#viewer` userset tuple is written for
 * `visibility_org` only) and the admin-edits / member-reads split with no
 * engine. The agent kind defaults unspecified visibility to org
 * (`defaults_to_org_visibility`), so the private arm sets
 * `visibility_private` explicitly. The outsider: the membership rules
 * run at a person's FIRST provisioning only, so an organization the
 * founder creates AFTER the member provisioned has no row for the member
 * — a two-organization server with an outsider, no revoke needed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fromBinary } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ActivityQueryController } from "@stigmer/protos/ai/stigmer/activity/v1/query_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { RunQueryController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/query_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { IamPolicyQueryController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/query_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { builtInModel } from "../../authorization/model/index.js";
import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import type { Store } from "../../store/interface.js";
import type { Authorizer } from "../authorizer.js";
import type { ListReadScope } from "../list-read-scope.js";
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
/** Provisioned inside the list-lane arms only, so its before/after is one arm's. */
const VISITOR = "fake|visitor";
/** A second member, provisioned inside the My vault arm only. */
const TEAMMATE = "fake|teammate";
const ORG = "built-in-org";
/** Founded AFTER the member provisioned: the member holds no row on it. */
const OTHER_ORG = "built-in-other-org";
/** Never created on any server in this file: the phantom target of stigmer#1163. */
const MISSING_ORG = "never-created-org";
/** The load-first chain's copy for it, which every posture's Authorize step answers. */
const MISSING_ORG_NOT_FOUND = `Organization not found: ${MISSING_ORG}`;

function apiKeyInput(name: string) {
  return {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "ApiKey",
    metadata: { name, org: ORG },
    spec: {},
  };
}

function sharedVaultInput(name: string, org: string = ORG) {
  return {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Vault",
    metadata: { name, org },
    spec: { description: name },
  };
}

/** The caller's My vault in `org`, created by its first secret; answers its id. */
async function myVaultOf(transport: Transport, org: string = ORG): Promise<string> {
  const vault = await createClient(VaultCommandController, transport).setSecrets({
    vault: { org, vault: { case: "mine", value: true } },
    secrets: { PLAIN_KEY: { value: "plain", description: "" } },
  });
  return vault.metadata!.id;
}

function organizationInput(slug: string) {
  return {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: slug, slug, org: "" },
    spec: { description: slug },
  };
}

/**
 * The one sentence for a level a kind does not support, as the agent chain
 * answers it (pipeline/steps/validate-visibility.ts builds it from the
 * kind's config); pinned as bytes because clients render it.
 */
const PUBLIC_LEVEL_REFUSED_FOR_AGENT =
  "agent resources cannot be set to visibility_public. " +
  "Supported visibility levels: visibility_private, visibility_org, visibility_child_orgs.";

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
  /** The ids the server minted for ORG and OTHER_ORG; requests name them by slug. */
  let orgId: string;
  let otherOrgId: string;

  const asFounder = () =>
    transportFor(port, fakeJwt(FOUNDER, "founder@example.com"));
  const asMember = () =>
    transportFor(port, fakeJwt(MEMBER, "member@example.com"));
  const asStranger = () =>
    transportFor(port, fakeJwt(STRANGER, "stranger@example.com"));
  const asVisitor = () =>
    transportFor(port, fakeJwt(VISITOR, "visitor@example.com"));
  const asTeammate = () =>
    transportFor(port, fakeJwt(TEAMMATE, "teammate@example.com"));

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

    // The founder provisions, founds the organization (owner row, the role
    // lifecycle), and the member provisions afterwards (member row, the
    // membership rules). Both blueprints are the founder's.
    const founderAccounts = createClient(
      IdentityAccountCommandController,
      asFounder(),
    );
    await founderAccounts.provisionMyAccount({});
    orgId =
      (
        await createClient(OrganizationCommandController, asFounder()).create(
          organizationInput(ORG),
        )
      ).metadata?.id ?? "";
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
    // founder is its owner (the role lifecycle); the member holds no row on
    // it — an outsider, on a real two-organization server.
    otherOrgId =
      (
        await createClient(OrganizationCommandController, asFounder()).create(
          organizationInput(OTHER_ORG),
        )
      ).metadata?.id ?? "";
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
    // `can_view` on the organization is `viewer`, which a member holds. The
    // request names it by slug; the serving chain resolves the slug to the
    // minted id, which is what the read answers.
    const organization = await createClient(
      OrganizationQueryController,
      asMember(),
    ).get({ value: ORG });
    expect(organization.metadata?.id).toMatch(/^org_[0-9a-z]{26}$/);
    expect(organization.metadata?.id).toBe(orgId);
    expect(organization.metadata?.slug).toBe(ORG);
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

  it("a create into an Organization that does not exist is NOT_FOUND with the load-first copy — the sentence the trusted-local arm pins too (stigmer#1163)", async () => {
    const failure = await failureOf(
      createClient(AgentCommandController, asFounder()).create(
        agentInput(
          "Phantom Agent",
          ApiResourceVisibility.visibility_org,
          MISSING_ORG,
        ),
      ),
    );
    expect(failure.code).toBe(Code.NotFound);
    expect(failure.rawMessage).toBe(MISSING_ORG_NOT_FOUND);
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
    expect(mine.entries.map((o) => o.metadata?.id)).toEqual([orgId]);
    const founders = await createClient(
      OrganizationQueryController,
      asFounder(),
    ).findMyOrganizations({});
    expect(founders.entries.map((o) => o.metadata?.id).sort()).toEqual(
      [orgId, otherOrgId].sort(),
    );
    expect(
      await codeOf(
        createClient(OrganizationQueryController, asMember()).find({
          org: ORG,
        }),
      ),
    ).toBe(Code.Unimplemented);
  });

  it("checkMyPermission tells the truth through the built-in authorizer", async () => {
    const ask = (transport: ReturnType<typeof asMember>) =>
      createClient(IamPolicyQueryController, transport).checkMyPermission({
        relation: "can_edit",
        resource: { kind: "agent", id: orgAgent.metadata!.id },
      });
    expect((await ask(asMember())).isAuthorized).toBe(false);
    expect((await ask(asFounder())).isAuthorized).toBe(true);
  });

  it("a member creates an agent while the organization lets members, and not once an admin turns that off — the annotation's copy is the wire", async () => {
    const memberAgents = createClient(AgentCommandController, asMember());
    const created = await memberAgents.create(
      agentInput("Member Agent", ApiResourceVisibility.visibility_private),
    );
    expect(created.metadata?.id).toMatch(/^agt_/);
    await memberAgents.delete({ value: created.metadata!.id });

    // Sharing with child organizations stays an admin's act.
    const childOrgs = await failureOf(
      memberAgents.create(
        agentInput("Member Child Agent", ApiResourceVisibility.visibility_child_orgs),
      ),
    );
    expect(childOrgs.code).toBe(Code.PermissionDenied);

    const policies = createClient(OrganizationCommandController, asFounder());
    await policies.updatePolicies({
      orgId,
      policies: { membersCanCreateAgents: false },
    });
    try {
      const failure = await failureOf(
        memberAgents.create(
          agentInput("Member Agent", ApiResourceVisibility.visibility_org),
        ),
      );
      expect(failure.code).toBe(Code.PermissionDenied);
      expect(failure.rawMessage).toBe(
        "unauthorized to create agent in this organization",
      );
      // A member may not change the policy back.
      expect(
        await codeOf(
          createClient(OrganizationCommandController, asMember()).updatePolicies({
            orgId,
            policies: { membersCanCreateAgents: true },
          }),
        ),
      ).toBe(Code.PermissionDenied);
    } finally {
      await policies.updatePolicies({
        orgId,
        policies: { membersCanCreateAgents: true },
      });
    }
  });

  it("the retired public level is refused for the founder as an invalid level, before any permission question", async () => {
    const failure = await failureOf(
      createClient(AgentCommandController, asFounder()).create(
        agentInput("Public Agent", ApiResourceVisibility.visibility_public),
      ),
    );
    expect(failure.code).toBe(Code.InvalidArgument);
    expect(failure.rawMessage).toBe(PUBLIC_LEVEL_REFUSED_FOR_AGENT);
  });

  describe("the list lanes (the built-in ListReadScope)", () => {
    let founderKey: string;
    let memberKey: string;
    let founderVault: string;
    let memberVault: string;
    let otherOrgVault: string;

    beforeAll(async () => {
      founderKey = (
        await createClient(ApiKeyCommandController, asFounder()).create(
          apiKeyInput("founder key"),
        )
      ).metadata!.id;
      memberKey = (
        await createClient(ApiKeyCommandController, asMember()).create(
          apiKeyInput("member key"),
        )
      ).metadata!.id;
      founderVault = await myVaultOf(asFounder());
      otherOrgVault = await myVaultOf(asFounder(), OTHER_ORG);
      // `can_create_vault` is `member`: a member's own My vault, which the
      // organization's admins never read.
      memberVault = await myVaultOf(asMember());
    });

    it("an OUTSIDER lists nothing of an organization they hold no row in — the empty list, never an error", async () => {
      const list = await createClient(
        VaultQueryController,
        asMember(),
      ).list({ org: OTHER_ORG });
      expect(list.items).toEqual([]);
      // The positive beside the negative: the founder lists their own.
      const founders = await createClient(
        VaultQueryController,
        asFounder(),
      ).list({ org: OTHER_ORG });
      expect(founders.items.map((e) => e.metadata?.id)).toEqual([
        otherOrgVault,
      ]);
    });

    it("My vaults are their owner's: the founder — the organization's owner — does NOT list a member's, and the member does not list the founder's", async () => {
      const founders = await createClient(
        VaultQueryController,
        asFounder(),
      ).list({ org: ORG });
      expect(founders.items.map((e) => e.metadata?.id)).toEqual([
        founderVault,
      ]);
      const members = await createClient(
        VaultQueryController,
        asMember(),
      ).list({ org: ORG });
      expect(members.items.map((e) => e.metadata?.id)).toEqual([
        memberVault,
      ]);
    });

    it("another member's My vault is theirs by id too: the organization's owner and a teammate are refused get, setSecrets, removeConnections and delete on it, and it stays as it was", async () => {
      await createClient(IdentityAccountCommandController, asTeammate()).provisionMyAccount({});
      // The positive beside the negatives: the teammate is a member, with a
      // My vault of their own.
      const teammateVault = await myVaultOf(asTeammate());
      expect(teammateVault).not.toBe(memberVault);

      for (const [who, transport] of [
        ["the owner", asFounder()],
        ["a teammate", asTeammate()],
      ] as const) {
        const query = createClient(VaultQueryController, transport);
        const command = createClient(VaultCommandController, transport);
        const target = { org: ORG, vault: { case: "id" as const, value: memberVault } };
        expect(await codeOf(query.get({ value: memberVault })), `${who} get`).toBe(
          Code.PermissionDenied,
        );
        expect(
          await codeOf(
            command.setSecrets({
              vault: target,
              secrets: { PLANTED: { value: "planted", description: "" } },
            }),
          ),
          `${who} setSecrets`,
        ).toBe(Code.PermissionDenied);
        expect(
          await codeOf(
            command.removeConnections({ vault: target, addresses: ["github.com"] }),
          ),
          `${who} removeConnections`,
        ).toBe(Code.PermissionDenied);
        expect(await codeOf(command.delete({ resourceId: memberVault })), `${who} delete`).toBe(
          Code.PermissionDenied,
        );
      }

      const own = await createClient(VaultQueryController, asMember()).get({ value: memberVault });
      expect(Object.keys(own.spec?.secrets ?? {})).toEqual(["PLAIN_KEY"]);
    });

    it("ApiKey.findAll — skip-authorization, list-scoped — hands each person their own keys and nobody else's", async () => {
      expect(
        (
          await createClient(ApiKeyQueryController, asFounder()).findAll({})
        ).entries.map((k) => k.metadata?.id),
      ).toEqual([founderKey]);
      expect(
        (
          await createClient(ApiKeyQueryController, asMember()).findAll({})
        ).entries.map((k) => k.metadata?.id),
      ).toEqual([memberKey]);
    });

    it("the library is a search: a member's search omits the private agent and keeps the org-visible one; the founder's has both", async () => {
      const memberSearch = await createClient(SearchService, asMember()).search(
        { kinds: [ApiResourceKind.agent], org: ORG },
      );
      expect(memberSearch.entries.map((e) => e.id).sort()).toEqual([
        orgAgent.metadata!.id,
      ]);
      const founderSearch = await createClient(
        SearchService,
        asFounder(),
      ).search({ kinds: [ApiResourceKind.agent], org: ORG });
      expect(founderSearch.entries.map((e) => e.id).sort()).toEqual(
        [privateAgent.metadata!.id, orgAgent.metadata!.id].sort(),
      );
    });

    it("the enumeration lanes answer through the scope without fault: recent activity and the execution summary for a member with no runs", async () => {
      const recents = await createClient(
        ActivityQueryController,
        asMember(),
      ).listRecentActivity({ pageSize: 10 });
      expect(recents.entries).toEqual([]);
      const summary = await createClient(
        RunQueryController,
        asMember(),
      ).getRunSummary({ org: ORG });
      expect(summary.activeCount).toBe(0);
      expect(summary.phaseCounts).toEqual({});
    });

    it("an unprovisioned subject's lists are empty, and become theirs after `provisionMyAccount`", async () => {
      const visitorVaults = createClient(VaultQueryController, asVisitor());
      expect((await visitorVaults.list({ org: ORG })).items).toEqual([]);
      await createClient(
        IdentityAccountCommandController,
        asVisitor(),
      ).provisionMyAccount({});
      const own = await myVaultOf(asVisitor());
      expect(
        (await visitorVaults.list({ org: ORG })).items.map(
          (e) => e.metadata?.id,
        ),
      ).toEqual([own]);
    });
  });

  it("an unprovisioned subject writes nothing until provisioned — then they are a member and may not author a blueprint once members may not", async () => {
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
    // A member now: reads the org-visible agent, and, with the
    // organization's policy off, `can_create_agent` is its admins'.
    const policies = createClient(OrganizationCommandController, asFounder());
    await policies.updatePolicies({
      orgId,
      policies: { membersCanCreateAgents: false },
    });
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
    await policies.updatePolicies({
      orgId,
      policies: { membersCanCreateAgents: true },
    });
  });
});

describe("built-in authorizer (composed server, trusted-local: the permissive default stays)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  /** The id the server minted for ORG, created by the first test below. */
  let orgId: string;

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
    orgId =
      (
        await createClient(OrganizationCommandController, anonymous).create(
          organizationInput(ORG),
        )
      ).metadata?.id ?? "";
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

  it("the laptop keeps organization enumeration and refuses the retired public level like every posture — the level is gone, not gated", async () => {
    const anonymous = transportFor(port);
    const failure = await failureOf(
      createClient(AgentCommandController, anonymous).create(
        agentInput(
          "Public Laptop Agent",
          ApiResourceVisibility.visibility_public,
        ),
      ),
    );
    expect(failure.code).toBe(Code.InvalidArgument);
    expect(failure.rawMessage).toBe(PUBLIC_LEVEL_REFUSED_FOR_AGENT);
    const all = await createClient(OrganizationQueryController, anonymous).find(
      { org: ORG },
    );
    expect(all.entries.map((o) => o.metadata?.id)).toContain(orgId);
  });

  it("the laptop's lists are the full scan — no scope composed, the rows stamped `system` included", async () => {
    const anonymous = transportFor(port);
    // A second agent beside the private one the earlier test created, so
    // the search below proves a scan and not a single-row coincidence.
    await createClient(AgentCommandController, anonymous).create(
      agentInput("Second Laptop Agent", ApiResourceVisibility.visibility_org),
    );
    const vaults = createClient(VaultCommandController, anonymous);
    await vaults.create(sharedVaultInput("laptop vault one"));
    await vaults.create(sharedVaultInput("laptop vault two"));
    const list = await createClient(VaultQueryController, anonymous).list({
      org: ORG,
    });
    expect(list.items.map((e) => e.metadata?.name).sort()).toEqual([
      "laptop vault one",
      "laptop vault two",
    ]);
    const search = await createClient(SearchService, anonymous).search({
      kinds: [ApiResourceKind.agent],
      org: ORG,
    });
    expect(search.entries.length).toBeGreaterThanOrEqual(2);
  });

  it("a request naming an Organization that does not exist is NOT_FOUND, as under sign-in, and stores nothing (stigmer#1163)", async () => {
    const anonymous = transportFor(port);
    const agents = createClient(AgentCommandController, anonymous);
    const phantom = agentInput(
      "Phantom Laptop Agent",
      ApiResourceVisibility.visibility_org,
      MISSING_ORG,
    );
    const refusals = [
      ["create", await failureOf(agents.create(phantom))],
      ["apply", await failureOf(agents.apply(phantom))],
      [
        "a session",
        await failureOf(
          createClient(SessionCommandController, anonymous).create({
            apiVersion: "agentic.stigmer.ai/v1",
            kind: "Session",
            metadata: { name: "Phantom Session", org: MISSING_ORG },
            spec: {},
          }),
        ),
      ],
      [
        "a usage report",
        await failureOf(
          createClient(
            RunQueryController,
            anonymous,
          ).getOrgUsageReport({
            org: MISSING_ORG,
            fromDate: "2026-09-01",
            toDate: "2026-09-30",
          }),
        ),
      ],
    ] as const;
    for (const [lane, failure] of refusals) {
      expect(failure.code, lane).toBe(Code.NotFound);
      expect(failure.rawMessage, lane).toBe(MISSING_ORG_NOT_FOUND);
    }
    // The search lane skips authorization and indexes on write, so a
    // phantom row would surface here; the laptop's full scan finds none.
    const search = await createClient(SearchService, anonymous).search({
      kinds: [ApiResourceKind.agent],
      org: MISSING_ORG,
    });
    expect(search.entries).toEqual([]);
    // The positive beside it: the same agent, applied into the
    // Organization the server holds, lands.
    const landed = await agents.apply(
      agentInput("Phantom Laptop Agent", ApiResourceVisibility.visibility_org),
    );
    expect(landed.metadata?.org).toBe(orgId);
  });
});

/**
 * The single-person check: for the sole person on a server, the four
 * enumeration consumers and the restrict lanes answer byte-for-byte what
 * they answered before any scope was composed. Two boots of the OIDC
 * posture on one seed; the only variable is the scope — the built-in one,
 * or a unit's pass-through (every offered id kept, every id enumerated:
 * a unit that keeps everything, and the `??` proving
 * that a unit's driver still wins over the built-in one).
 */
describe("built-in list scope (two boots, one seed — the scope is the only variable)", () => {
  interface Boot {
    readonly dir: string;
    readonly server: ComposedServer;
    readonly port: number;
  }

  /** What the founder sees through every list-shaped lane, by NAME (ids differ per boot). */
  interface Readout {
    readonly search: string[];
    readonly keys: string[];
    readonly vaults: string[];
    readonly recents: string[];
    readonly summaryActive: number;
  }

  const boots: Boot[] = [];

  async function boot(scope: ListReadScope | undefined): Promise<Boot> {
    const dir = mkdtempSync(path.join(tmpdir(), "built-in-list-scope-"));
    const unit: ServerExtension = {
      name: "fake-oidc-only",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
      ...(scope === undefined ? {} : { drivers: { listReadScope: scope } }),
    };
    const server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    const opened = { dir, server, port };
    boots.push(opened);
    return opened;
  }

  async function seedFounder(port: number): Promise<void> {
    const founder = transportFor(port, fakeJwt(FOUNDER, "founder@example.com"));
    await createClient(
      IdentityAccountCommandController,
      founder,
    ).provisionMyAccount({});
    await createClient(OrganizationCommandController, founder).create(
      organizationInput(ORG),
    );
    const agents = createClient(AgentCommandController, founder);
    await agents.create(
      agentInput("Scoped Private Agent", ApiResourceVisibility.visibility_private),
    );
    await agents.create(
      agentInput("Scoped Org Agent", ApiResourceVisibility.visibility_org),
    );
    await createClient(ApiKeyCommandController, founder).create(
      apiKeyInput("scope key"),
    );
    await createClient(VaultCommandController, founder).create(
      sharedVaultInput("scope vault"),
    );
  }

  async function readout(port: number): Promise<Readout> {
    const founder = transportFor(port, fakeJwt(FOUNDER, "founder@example.com"));
    const search = await createClient(SearchService, founder).search({
      kinds: [ApiResourceKind.agent],
      org: ORG,
    });
    const keys = await createClient(ApiKeyQueryController, founder).findAll({});
    const vaults = await createClient(VaultQueryController, founder).list({
      org: ORG,
    });
    const recents = await createClient(
      ActivityQueryController,
      founder,
    ).listRecentActivity({ pageSize: 10 });
    const summary = await createClient(
      RunQueryController,
      founder,
    ).getRunSummary({ org: ORG });
    return {
      search: search.entries.map((e) => e.name).sort(),
      keys: keys.entries.map((k) => k.metadata?.name ?? "").sort(),
      vaults: vaults.items.map((e) => e.metadata?.name ?? "").sort(),
      recents: recents.entries.map((e) => e.id).sort(),
      summaryActive: summary.activeCount,
    };
  }

  afterAll(async () => {
    for (const opened of boots) {
      await opened.server.shutdown();
      rmSync(opened.dir, { recursive: true, force: true });
    }
  });

  it("the founder's readout is identical with the built-in scope and with a pass-through unit scope", async () => {
    // The pass-through enumerates every id of the kind from the server's
    // own store (bound after boot: the unit is composed before the store
    // exists), so the enumeration consumers see the unscoped answer.
    let unscopedStore: Store | undefined;
    const passThrough: ListReadScope = {
      async authorizedResourceIds(_caller, kind) {
        const schema = builtInModel.byKind(kind)?.schema;
        if (unscopedStore === undefined || schema === undefined) {
          throw new Error("the pass-through is bound to a booted server");
        }
        const rows = await unscopedStore.listResources(kind);
        return new Set(
          rows.map((bytes) => metadataOf(fromBinary(schema, bytes))?.id ?? ""),
        );
      },
      restrictListEntries: (_caller, _kind, entries) =>
        Promise.resolve(new Set(entries.map((entry) => entry.id))),
    };
    const before = await boot(passThrough);
    unscopedStore = before.server.store;
    const after = await boot(undefined);
    await seedFounder(before.port);
    await seedFounder(after.port);
    const beforeReadout = await readout(before.port);
    const afterReadout = await readout(after.port);
    expect(afterReadout).toEqual(beforeReadout);
    // Not vacuous: the seed is visible through every lane read.
    expect(afterReadout.search).toEqual(["Scoped Org Agent", "Scoped Private Agent"]);
    expect(afterReadout.keys).toEqual(["scope key"]);
    expect(afterReadout.vaults).toEqual(["scope vault"]);
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
