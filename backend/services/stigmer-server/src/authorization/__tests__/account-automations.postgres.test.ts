/**
 * Pins the automations that act as a person (../account-automations.ts)
 * on both store drivers: the schedules, evaluators, plugin evals and agent
 * evals of one organization whose creator stamp names one of the asked
 * accounts, as an account id or as the raw issuer subject older rows carry,
 * and nothing of another organization or another creator; the kinds a
 * composition leaves out (its own mints act as accounts of their own) are
 * never read; an empty question reads nothing.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageInitShape } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { accountIdFor } from "../../domain/identityaccount/constants.js";
import { newResourceIdentityAccountStore } from "../../domain/identityaccount/resource-store.js";
import type { IdentityAccountStore } from "../../domain/identityaccount/store.js";
import { newAccountAutomations } from "../account-automations.js";
import { driverFixtures, dropPostgresFixture } from "./drivers.js";
import type { OpenedStore } from "./drivers.js";

const SUBJECT = "auth0|raj";
const RAJ = accountIdFor(SUBJECT);
const ANA = accountIdFor("auth0|ana");

afterAll(dropPostgresFixture);

const KINDS = [
  ApiResourceKind.schedule,
  ApiResourceKind.evaluator,
  ApiResourceKind.plugin_eval,
  ApiResourceKind.agent_eval,
  ApiResourceKind.identity_account,
];

describe.each(driverFixtures(KINDS))("the automations acting as a person on $name", (fixture) => {
  describe.skipIf(fixture.skip)("actingAs", () => {
    let opened: OpenedStore;
    let accounts: IdentityAccountStore;

    beforeEach(async () => {
      opened = await fixture.open();
      accounts = newResourceIdentityAccountStore(opened.store);
      await accounts.save(
        create(IdentityAccountSchema, {
          metadata: { id: RAJ, name: "Raj" },
          spec: { idpId: SUBJECT, provisioningMode: IdentityAccountProvisioningMode.direct },
        }),
      );
      await save(ApiResourceKind.schedule, ScheduleSchema, "sch_raj", "acme", RAJ, "Nightly report");
      await save(ApiResourceKind.schedule, ScheduleSchema, "sch_old", "acme", SUBJECT, "Old report");
      await save(ApiResourceKind.schedule, ScheduleSchema, "sch_ana", "acme", ANA, "Ana's report");
      await save(ApiResourceKind.schedule, ScheduleSchema, "sch_globex", "globex", RAJ, "Elsewhere");
      await save(ApiResourceKind.evaluator, EvaluatorSchema, "evl_raj", "acme", RAJ, "Judge");
      await save(ApiResourceKind.plugin_eval, PluginEvalSchema, "pev_raj", "acme", RAJ, "Plugin check");
      await save(ApiResourceKind.agent_eval, AgentEvalSchema, "aev_raj", "acme", RAJ, "Agent check");
    });

    afterEach(async () => {
      await opened.close();
    });

    async function save<Desc extends DescMessage>(
      kind: ApiResourceKind,
      schema: Desc,
      id: string,
      org: string,
      createdBy: string,
      name: string,
    ): Promise<void> {
      const init = {
        metadata: { id, name, slug: id, org },
        status: { audit: { specAudit: { createdBy: { id: createdBy } } } },
      } as unknown as MessageInitShape<Desc>;
      await opened.store.saveResource(kind, id, schema, create(schema, init));
    }

    it("lists one organization's automations created by the asked accounts, by account id or raw subject", async () => {
      const automations = newAccountAutomations({ store: opened.store, accounts });
      const found = await automations.actingAs("acme", new Set([RAJ]));
      expect(found.map((automation) => `${ApiResourceKind[automation.kind]}:${automation.id}`).sort()).toEqual(
        ["agent_eval:aev_raj", "evaluator:evl_raj", "plugin_eval:pev_raj", "schedule:sch_old", "schedule:sch_raj"],
      );
      expect(found.every((automation) => automation.accountId === RAJ)).toBe(true);
      expect(found.find((automation) => automation.id === "sch_raj")).toMatchObject({
        slug: "sch_raj",
        name: "Nightly report",
      });
    });

    it("reads only the kinds the composition's built-in mints act for", async () => {
      const automations = newAccountAutomations({
        store: opened.store,
        accounts,
        kinds: new Set([ApiResourceKind.evaluator]),
      });
      expect((await automations.actingAs("acme", new Set([RAJ]))).map((automation) => automation.id)).toEqual([
        "evl_raj",
      ]);
    });

    it("answers nothing, reading nothing, for no organization or no account", async () => {
      const reads: string[] = [];
      const automations = newAccountAutomations({
        store: {
          findAllByField: (kind, ...rest) => {
            reads.push(ApiResourceKind[kind]);
            return opened.store.findAllByField(kind, ...rest);
          },
        },
        accounts,
      });
      expect(await automations.actingAs("", new Set([RAJ]))).toEqual([]);
      expect(await automations.actingAs("acme", new Set())).toEqual([]);
      expect(reads).toEqual([]);
    });
  });
});
