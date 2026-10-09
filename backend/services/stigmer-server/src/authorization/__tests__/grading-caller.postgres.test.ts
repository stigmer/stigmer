/**
 * Pins the built-in grading caller on both store drivers: an AI judge run
 * acts as the creator of the evaluator that asked for it, resolved from the
 * row's creation stamp as the schedule fire's creator is
 * (schedule-fire-caller.postgres.test.ts beside this file), and only for a
 * run that creator may see: a judge's session holds the run's
 * conversation, so a creator the authorizer refuses on the run is the
 * seam's DETERMINISTIC refusal, as is an evaluator whose stamp names no
 * person this server knows; a missing evaluator and an authorizer that
 * cannot answer stay infrastructure throws.
 */
import { create } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { accountIdFor } from "../../domain/identityaccount/constants.js";
import { newResourceIdentityAccountStore } from "../../domain/identityaccount/resource-store.js";
import type { IdentityAccountStore } from "../../domain/identityaccount/store.js";
import { GradingCallerRefusedError } from "../../extensions/grading-caller.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import {
  creatorCannotSeeRunMessage,
  evaluatorHasNoPersonMessage,
  newBuiltInGradingCaller,
} from "../grading-caller.js";
import { driverFixtures, dropPostgresFixture } from "./drivers.js";
import type { OpenedStore } from "./drivers.js";

const SUBJECT = "auth0|priya";
const PRIYA = accountIdFor(SUBJECT);

afterAll(dropPostgresFixture);

describe.each(
  driverFixtures([ApiResourceKind.evaluator, ApiResourceKind.identity_account]),
)("the built-in grading caller on $name", (fixture) => {
  describe.skipIf(fixture.skip)("mintGradingCaller", () => {
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

    async function evaluator(id: string, createdBy: string): Promise<void> {
      await opened.store.saveResource(
        ApiResourceKind.evaluator,
        id,
        EvaluatorSchema,
        create(EvaluatorSchema, {
          metadata: { id, name: id, org: "acme" },
          spec: { agentId: "agt_1", enabled: true, sampleRate: 1, monthlyLimitUsd: 10 },
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
      return newBuiltInGradingCaller({ store: opened.store, accounts, authorizer: answering(answer) });
    }

    it("a judge acts as the evaluator's creator, in the in-process identity shape", async () => {
      await evaluator("evl_by_id", PRIYA);
      asked.length = 0;
      expect(await mint().mintGradingCaller("acme", "evl_by_id", "run_1")).toEqual({
        identityId: PRIYA,
        callerClass: "user",
        issuer: "",
        rawToken: "",
        email: "priya@example.com",
        displayName: "Priya",
      });
      expect(asked, "the creator must see the graded run").toEqual([`${PRIYA} can_view run_1`]);
      await evaluator("evl_by_sub", SUBJECT);
      expect((await mint().mintGradingCaller("acme", "evl_by_sub", "run_1")).identityId).toBe(PRIYA);
    });

    it("refuses when the creator may not see the graded run, and throws when the authorizer cannot answer", async () => {
      await evaluator("evl_blind", PRIYA);
      const refused = await mint("deny")
        .mintGradingCaller("acme", "evl_blind", "run_private")
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(GradingCallerRefusedError);
      expect((refused as Error).message).toBe(creatorCannotSeeRunMessage("evl_blind", "run_private"));
      await expect(mint("unavailable").mintGradingCaller("acme", "evl_blind", "run_1")).rejects.toThrow("engine down");
    });

    it.each([
      ["the empty stamp", ""],
      ["the laptop's placeholder", "system"],
      ["a creator who has left", accountIdFor("auth0|gone")],
    ])("%s is the seam's deterministic refusal", async (_label, stamp) => {
      await evaluator("evl_nobody", stamp);
      const failure = await mint()
        .mintGradingCaller("acme", "evl_nobody", "run_1")
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(GradingCallerRefusedError);
      expect((failure as Error).message).toBe(evaluatorHasNoPersonMessage("evl_nobody"));
    });

    it("an evaluator that no longer exists is an infrastructure throw, never a refusal", async () => {
      const failure = await mint()
        .mintGradingCaller("acme", "evl_missing", "run_1")
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ResourceNotFoundError);
    });
  });
});
