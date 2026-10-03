// The open-source edition as it ships holds one organization, and nobody
// names it.
// Domain: organizations (the single-organization facet).
//
// What this pins, against the shipped entry (local-single-org; every other
// target reports SKIPPED through `singleOrganization`):
//   - the server made its organization at its first start, and says so:
//     getServerInfo answers single_org, and findMyOrganizations lists exactly
//     one, whose own metadata.org is empty;
//   - a request that names no organization acts in that one, for one method
//     of each shape the contract has: an annotated create (agent, session), an
//     apply (environment), a reference lookup (agent getByReference), a list
//     with a top-level org (environment list), and search;
//   - an explicit organization is honoured: one that does not exist is still
//     refused by name;
//   - a kind that belongs to no organization stays that way (an API key's
//     metadata.org is empty);
//   - a second organization is refused with ORGANIZATION_LIMIT_REACHED, and
//     deleting the one with ORGANIZATION_IS_SINGLE.
//
// Deliberately out of scope: which field each method fills (the server's own
// inventory test holds docs/single-organization.md to the rule; the
// parent-scoped agent execution among them, whose create needs an engine this
// target does not run), the
// ownership of the organization on a self-host with sign-in (the server's
// membership tests and the console sign-in e2e), and every isolation
// property between organizations, which the other suites prove on the
// library entry.
import { Code } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { makeAgent } from "../support/agents";
import { makeApiKey } from "../support/apikeys";
import { makeEnvironment } from "../support/environments";
import { uniqueName } from "../support/naming";
import { makeSession } from "../support/sessions";
import { createTarget, type TargetProfile } from "../targets";

const NOBODY = "";

const capabilities = createTarget().capabilities;

describe.skipIf(!capabilities.singleOrganization)(
  "the open-source edition's one organization",
  () => {
    let target: TargetProfile;
    let clients: ConformanceClients;
    let theOrganization: string;

    beforeAll(async () => {
      target = createTarget();
      await target.setup();
      clients = target.clients();
      const mine = await clients.organizationQuery.findMyOrganizations({});
      theOrganization = mine.entries[0]?.metadata?.id ?? "";
    });

    afterAll(async () => {
      await target?.teardown();
    });

    it("[rpc:PlatformQueryController.getServerInfo] [rpc:OrganizationQueryController.findMyOrganizations] the server made one organization and says it fills it", async () => {
      const info = await clients.platformQuery.getServerInfo({});
      expect(info.singleOrg).toBe(true);
      const mine = await clients.organizationQuery.findMyOrganizations({});
      expect(mine.entries).toHaveLength(1);
      expect(theOrganization).not.toBe("");
      expect(mine.entries[0]?.metadata?.org).toBe("");
    });

    it("[rpc:AgentCommandController.create] [rpc:AgentQueryController.getByReference] an agent created and looked up with no organization lives in the one", async () => {
      const name = uniqueName("helper");
      const created = await clients.agentCommand.create(
        makeAgent({ org: NOBODY, name }),
      );
      expect(created.metadata?.org).toBe(theOrganization);

      const found = await clients.agentQuery.getByReference({
        org: NOBODY,
        kind: ApiResourceKind.agent,
        slug: created.metadata?.slug ?? "",
      });
      expect(found.metadata?.id).toBe(created.metadata?.id);
    });

    it("[rpc:EnvironmentCommandController.apply] [rpc:EnvironmentQueryController.list] an environment applied and listed with no organization lives in the one", async () => {
      const applied = await clients.environmentCommand.apply(
        makeEnvironment({ org: NOBODY, name: uniqueName("env") }),
      );
      expect(applied.metadata?.org).toBe(theOrganization);

      const listed = await clients.environmentQuery.list({ org: NOBODY });
      expect(listed.items.map((env) => env.metadata?.id)).toContain(
        applied.metadata?.id,
      );
    });

    it("[rpc:SessionCommandController.create] a session created with no organization lives in the one", async () => {
      const session = await clients.sessionCommand.create(
        // "" runs the built-in assistant: no agent fixture needed.
        makeSession({
          org: NOBODY,
          name: uniqueName("session"),
          agentInstanceId: "",
        }),
      );
      expect(session.metadata?.org).toBe(theOrganization);
    });

    it("[rpc:SearchService.search] search with no organization searches the one", async () => {
      const name = uniqueName("findable");
      const created = await clients.agentCommand.create(
        makeAgent({ org: NOBODY, name }),
      );
      const found = await clients.search.search({ org: NOBODY, query: name });
      expect(
        found.entries.map((entry) => entry.id),
      ).toContain(created.metadata?.id);
    });

    it("[rpc:AgentCommandController.create] an explicit organization is honoured: one that does not exist is refused by name", async () => {
      const refusal = await expectGrpcCode(
        () => clients.agentCommand.create(
          makeAgent({ org: "no-such-org", name: uniqueName("elsewhere") }),
        ),
        Code.NotFound,
        "an agent create naming an organization the server does not hold",
      );
      expect(refusal.rawMessage).toContain("no-such-org");
    });

    it("[rpc:ApiKeyCommandController.create] a kind that belongs to no organization stays that way", async () => {
      const key = await clients.apiKeyCommand.create(
        makeApiKey({ org: NOBODY, name: uniqueName("key") }),
      );
      expect(key.metadata?.org).toBe("");
    });

    it("[rpc:OrganizationCommandController.create] a second organization is refused before anything is written", async () => {
      const refusal = await expectGrpcCode(
        () => clients.organizationCommand.create({
          apiVersion: "tenancy.stigmer.ai/v1",
          kind: "Organization",
          metadata: { name: uniqueName("second") },
        }),
        Code.FailedPrecondition,
        "a create of a second organization",
      );
      expect(refusal.findDetails(ErrorInfoSchema)).toMatchObject([
        { reason: "ORGANIZATION_LIMIT_REACHED", metadata: { limit: "1" } },
      ]);
      const mine = await clients.organizationQuery.findMyOrganizations({});
      expect(mine.entries).toHaveLength(1);
    });

    it("[rpc:OrganizationCommandController.delete] the one organization cannot be deleted", async () => {
      const refusal = await expectGrpcCode(
        () => clients.organizationCommand.delete({ value: theOrganization }),
        Code.FailedPrecondition,
        "a delete of the server's one organization",
      );
      expect(refusal.findDetails(ErrorInfoSchema)).toMatchObject([
        { reason: "ORGANIZATION_IS_SINGLE", metadata: { org: theOrganization } },
      ]);
      const mine = await clients.organizationQuery.findMyOrganizations({});
      expect(mine.entries.map((org) => org.metadata?.id)).toEqual([
        theOrganization,
      ]);
    });
  },
);
