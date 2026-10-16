/**
 * Pins the built-in eval-run caller on both store drivers: an eval run's
 * tries act as its creator, resolved from the row's creation stamp as the
 * grading caller's creator is (grading-caller.postgres.test.ts beside this
 * file), and only while that creator may still edit the eval run's
 * subject, its plugin or its agent, as create required: a creator who may
 * no longer (demoted to viewer, or gone from the organization) is the
 * seam's DETERMINISTIC refusal, the try not graded "the eval run's creator
 * can no longer run it", naming the subject, as is an eval run whose stamp
 * names no person this server knows or whose row names no subject; a
 * missing eval run and an authorizer that cannot answer stay
 * infrastructure throws.
 */
import { create } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { accountIdFor } from "../../domain/identityaccount/constants.js";
import { newResourceIdentityAccountStore } from "../../domain/identityaccount/resource-store.js";
import type { IdentityAccountStore } from "../../domain/identityaccount/store.js";
import { EvalRunCallerRefusedError } from "../../extensions/eval-run-caller.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import {
  CREATOR_CANNOT_RUN_EVAL_REASON,
  creatorCannotEditSubjectMessage,
  evalRunHasNoPersonMessage,
  evalRunHasNoSubjectMessage,
  newBuiltInEvalRunCaller,
} from "../eval-run-caller.js";
import { driverFixtures, dropPostgresFixture } from "./drivers.js";
import type { OpenedStore } from "./drivers.js";

const SUBJECT = "auth0|priya";
const PRIYA = accountIdFor(SUBJECT);

afterAll(dropPostgresFixture);

describe.each(
  driverFixtures([ApiResourceKind.eval_run, ApiResourceKind.identity_account]),
)("the built-in eval-run caller on $name", (fixture) => {
  describe.skipIf(fixture.skip)("mintEvalRunCaller", () => {
    let opened: OpenedStore;
    let accounts: IdentityAccountStore;

    beforeEach(async () => {
      opened = await fixture.open();
      accounts = newResourceIdentityAccountStore(opened.store);
      await accounts.save(
        create(IdentityAccountSchema, {
          metadata: { id: PRIYA, name: "Priya" },
          spec: {
            idpId: SUBJECT,
            email: "priya@example.com",
            provisioningMode: IdentityAccountProvisioningMode.direct,
          },
        }),
      );
    });

    afterEach(async () => {
      await opened.close();
    });

    async function evalRun(id: string, createdBy: string): Promise<void> {
      await opened.store.saveResource(
        ApiResourceKind.eval_run,
        id,
        EvalRunSchema,
        create(EvalRunSchema, {
          metadata: { id, name: id, org: "acme" },
          spec: { subject: { case: "pluginId", value: "plg_1" }, maxCostUsd: 5 },
          status: { audit: { specAudit: { createdBy: { id: createdBy } } } },
        }),
      );
    }

    async function evalRunOnAgent(id: string, createdBy: string): Promise<void> {
      await opened.store.saveResource(
        ApiResourceKind.eval_run,
        id,
        EvalRunSchema,
        create(EvalRunSchema, {
          metadata: { id, name: id, org: "acme" },
          spec: { subject: { case: "agentId", value: "agt_1" }, maxCostUsd: 5 },
          status: { audit: { specAudit: { createdBy: { id: createdBy } } } },
        }),
      );
    }

    const asked: string[] = [];
    function answering(kind: "allow" | "deny" | "unavailable"): Authorizer {
      return {
        authorize: (caller, check) => {
          asked.push(`${caller.identityId} ${IamPermission[check.permission]} ${check.resourceId}`);
          if (kind === "unavailable") return Promise.resolve({ kind, cause: new Error("engine down") });
          return Promise.resolve(kind === "allow" ? { kind } : { kind, reason: "not a viewer" });
        },
      };
    }

    function mint(answer: "allow" | "deny" | "unavailable" = "allow") {
      return newBuiltInEvalRunCaller({ store: opened.store, accounts, authorizer: answering(answer) });
    }

    it("a try acts as the eval run's creator, in the in-process identity shape", async () => {
      await evalRun("evr_by_id", PRIYA);
      asked.length = 0;
      expect(await mint().mintEvalRunCaller("acme", "evr_by_id")).toEqual({
        identityId: PRIYA,
        callerClass: "user",
        issuer: "",
        rawToken: "",
        email: "priya@example.com",
        displayName: "Priya",
      });
      expect(asked, "the creator must still edit the eval run's plugin").toEqual([`${PRIYA} can_edit plg_1`]);
      await evalRun("evr_by_sub", SUBJECT);
      expect((await mint().mintEvalRunCaller("acme", "evr_by_sub")).identityId).toBe(PRIYA);
    });

    it("refuses when the creator may no longer edit the plugin, and throws when the authorizer cannot answer", async () => {
      await evalRun("evr_left", PRIYA);
      const refused = await mint("deny")
        .mintEvalRunCaller("acme", "evr_left")
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(EvalRunCallerRefusedError);
      expect((refused as Error).message).toBe(creatorCannotEditSubjectMessage("evr_left", "plugin", "plg_1"));
      expect((refused as EvalRunCallerRefusedError).notGradedReason).toBe(CREATOR_CANNOT_RUN_EVAL_REASON);
      expect(CREATOR_CANNOT_RUN_EVAL_REASON).toBe("the eval run's creator can no longer run it");
      await expect(mint("unavailable").mintEvalRunCaller("acme", "evr_left")).rejects.toThrow("engine down");
    });

    it.each([
      ["the empty stamp", ""],
      ["the laptop's placeholder", "system"],
      ["a deleted account", accountIdFor("auth0|gone")],
    ])("%s is the seam's deterministic refusal", async (_label, stamp) => {
      await evalRun("evr_nobody", stamp);
      const failure = await mint()
        .mintEvalRunCaller("acme", "evr_nobody")
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(EvalRunCallerRefusedError);
      expect((failure as Error).message).toBe(evalRunHasNoPersonMessage("evr_nobody"));
    });

    it("a try of an eval run about an agent acts as its creator while they may edit the agent, and is refused naming it once not", async () => {
      await evalRunOnAgent("evr_agent_by_id", PRIYA);
      asked.length = 0;
      expect((await mint().mintEvalRunCaller("acme", "evr_agent_by_id")).identityId).toBe(PRIYA);
      expect(asked, "the creator must still edit the eval run's agent").toEqual([`${PRIYA} can_edit agt_1`]);

      const refused = await mint("deny")
        .mintEvalRunCaller("acme", "evr_agent_by_id")
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(EvalRunCallerRefusedError);
      expect((refused as Error).message).toBe(
        "the creator of eval run evr_agent_by_id may no longer edit agent agt_1, so its tries cannot act as them",
      );
      expect((refused as EvalRunCallerRefusedError).notGradedReason).toBe(CREATOR_CANNOT_RUN_EVAL_REASON);
    });

    it("an eval run naming no subject is the seam's deterministic refusal", async () => {
      await opened.store.saveResource(
        ApiResourceKind.eval_run,
        "evr_no_subject",
        EvalRunSchema,
        create(EvalRunSchema, {
          metadata: { id: "evr_no_subject", name: "evr_no_subject", org: "acme" },
          status: { audit: { specAudit: { createdBy: { id: PRIYA } } } },
        }),
      );
      const failure = await mint()
        .mintEvalRunCaller("acme", "evr_no_subject")
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(EvalRunCallerRefusedError);
      expect((failure as Error).message).toBe(evalRunHasNoSubjectMessage("evr_no_subject"));
    });

    it("an eval run that no longer exists is an infrastructure throw, never a refusal", async () => {
      const failure = await mint()
        .mintEvalRunCaller("acme", "evr_missing")
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ResourceNotFoundError);
    });
  });
});
