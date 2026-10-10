/**
 * Pins the built-in plugin-eval caller on both store drivers: a plugin
 * eval's tries act as the eval's creator, resolved from the row's creation
 * stamp as the grading caller's creator is (grading-caller.postgres.test.ts
 * beside this file), and only while that creator may still read the eval:
 * a creator who has left the organization (the authorizer refuses them on
 * the eval) is the seam's DETERMINISTIC refusal, as is an eval whose stamp
 * names no person this server knows; a missing eval and an authorizer that
 * cannot answer stay infrastructure throws.
 */
import { create } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { accountIdFor } from "../../domain/identityaccount/constants.js";
import { newResourceIdentityAccountStore } from "../../domain/identityaccount/resource-store.js";
import type { IdentityAccountStore } from "../../domain/identityaccount/store.js";
import { PluginEvalCallerRefusedError } from "../../extensions/plugin-eval-caller.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import {
  creatorCannotSeeEvalMessage,
  newBuiltInPluginEvalCaller,
  pluginEvalHasNoPersonMessage,
} from "../plugin-eval-caller.js";
import { driverFixtures, dropPostgresFixture } from "./drivers.js";
import type { OpenedStore } from "./drivers.js";

const SUBJECT = "auth0|priya";
const PRIYA = accountIdFor(SUBJECT);

afterAll(dropPostgresFixture);

describe.each(
  driverFixtures([ApiResourceKind.plugin_eval, ApiResourceKind.identity_account]),
)("the built-in plugin-eval caller on $name", (fixture) => {
  describe.skipIf(fixture.skip)("mintPluginEvalCaller", () => {
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

    async function pluginEval(id: string, createdBy: string): Promise<void> {
      await opened.store.saveResource(
        ApiResourceKind.plugin_eval,
        id,
        PluginEvalSchema,
        create(PluginEvalSchema, {
          metadata: { id, name: id, org: "acme" },
          spec: { pluginId: "plg_1", maxCostUsd: 5 },
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
      return newBuiltInPluginEvalCaller({ store: opened.store, accounts, authorizer: answering(answer) });
    }

    it("a try acts as the eval's creator, in the in-process identity shape", async () => {
      await pluginEval("pev_by_id", PRIYA);
      asked.length = 0;
      expect(await mint().mintPluginEvalCaller("acme", "pev_by_id")).toEqual({
        identityId: PRIYA,
        callerClass: "user",
        issuer: "",
        rawToken: "",
        email: "priya@example.com",
        displayName: "Priya",
      });
      expect(asked, "the creator must still read the eval").toEqual([`${PRIYA} can_view pev_by_id`]);
      await pluginEval("pev_by_sub", SUBJECT);
      expect((await mint().mintPluginEvalCaller("acme", "pev_by_sub")).identityId).toBe(PRIYA);
    });

    it("refuses when the creator may no longer read the eval, and throws when the authorizer cannot answer", async () => {
      await pluginEval("pev_left", PRIYA);
      const refused = await mint("deny")
        .mintPluginEvalCaller("acme", "pev_left")
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(PluginEvalCallerRefusedError);
      expect((refused as Error).message).toBe(creatorCannotSeeEvalMessage("pev_left"));
      await expect(mint("unavailable").mintPluginEvalCaller("acme", "pev_left")).rejects.toThrow("engine down");
    });

    it.each([
      ["the empty stamp", ""],
      ["the laptop's placeholder", "system"],
      ["a deleted account", accountIdFor("auth0|gone")],
    ])("%s is the seam's deterministic refusal", async (_label, stamp) => {
      await pluginEval("pev_nobody", stamp);
      const failure = await mint()
        .mintPluginEvalCaller("acme", "pev_nobody")
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(PluginEvalCallerRefusedError);
      expect((failure as Error).message).toBe(pluginEvalHasNoPersonMessage("pev_nobody"));
    });

    it("an eval that no longer exists is an infrastructure throw, never a refusal", async () => {
      const failure = await mint()
        .mintPluginEvalCaller("acme", "pev_missing")
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ResourceNotFoundError);
    });
  });
});
