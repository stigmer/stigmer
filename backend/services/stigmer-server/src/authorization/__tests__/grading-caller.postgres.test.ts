/**
 * Pins the built-in grading caller on both store drivers: an AI judge run
 * acts as the creator of the evaluator that asked for it, resolved from the
 * row's creation stamp as the schedule fire's creator is
 * (schedule-fire-caller.postgres.test.ts beside this file); an evaluator
 * whose stamp names no person this server knows is the seam's
 * DETERMINISTIC refusal; a missing evaluator stays an infrastructure throw.
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
import {
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

    function mint() {
      return newBuiltInGradingCaller({ store: opened.store, accounts });
    }

    it("a judge acts as the evaluator's creator, in the in-process identity shape", async () => {
      await evaluator("evl_by_id", PRIYA);
      expect(await mint().mintGradingCaller("acme", "evl_by_id")).toEqual({
        identityId: PRIYA,
        callerClass: "user",
        issuer: "",
        rawToken: "",
        email: "priya@example.com",
        displayName: "Priya",
      });
      await evaluator("evl_by_sub", SUBJECT);
      expect((await mint().mintGradingCaller("acme", "evl_by_sub")).identityId).toBe(PRIYA);
    });

    it.each([
      ["the empty stamp", ""],
      ["the laptop's placeholder", "system"],
      ["a creator who has left", accountIdFor("auth0|gone")],
    ])("%s is the seam's deterministic refusal", async (_label, stamp) => {
      await evaluator("evl_nobody", stamp);
      const failure = await mint()
        .mintGradingCaller("acme", "evl_nobody")
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(GradingCallerRefusedError);
      expect((failure as Error).message).toBe(evaluatorHasNoPersonMessage("evl_nobody"));
    });

    it("an evaluator that no longer exists is an infrastructure throw, never a refusal", async () => {
      const failure = await mint()
        .mintGradingCaller("acme", "evl_missing")
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ResourceNotFoundError);
    });
  });
});
