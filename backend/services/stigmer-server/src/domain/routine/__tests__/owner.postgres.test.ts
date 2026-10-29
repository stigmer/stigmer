/**
 * Pins who a routine's runs act as, on both store drivers: its owner,
 * resolved from the row's creator stamp as an account id (3.15+) or as the
 * raw issuer subject (the 3.14.x stamp); a routine whose stamp names no
 * person this server knows (`""`, `"system"`, a trusted-local email, a
 * deleted account) is the DETERMINISTIC refusal with the copy the
 * routine's status will carry; an account-store fault stays an
 * infrastructure throw. And the fire-caller seam's default presents that
 * owner in the exact identity shape `accountAsCaller` builds.
 */
import { create } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { driverFixtures, dropPostgresFixture } from "../../../authorization/__tests__/drivers.js";
import type { OpenedStore } from "../../../authorization/__tests__/drivers.js";
import { RoutineFireRefusedError } from "../../../extensions/routine-fire-caller.js";
import { accountIdFor } from "../../identityaccount/constants.js";
import { newResourceIdentityAccountStore } from "../../identityaccount/resource-store.js";
import type { IdentityAccountStore } from "../../identityaccount/store.js";
import { ownerAsFireCaller, resolveRoutineOwner, routineHasNoOwnerMessage } from "../owner.js";

const SUBJECT = "auth0|carol";
const CAROL = accountIdFor(SUBJECT);

afterAll(dropPostgresFixture);

function routine(id: string, createdBy: string): Routine {
  return create(RoutineSchema, {
    metadata: { id, name: id, org: "acme" },
    status: { audit: { specAudit: { createdBy: { id: createdBy } } } },
  });
}

describe.each(driverFixtures([ApiResourceKind.identity_account]))("a routine's owner on $name", (fixture) => {
  describe.skipIf(fixture.skip)("resolveRoutineOwner", () => {
    let opened: OpenedStore;
    let accounts: IdentityAccountStore;

    beforeEach(async () => {
      opened = await fixture.open();
      accounts = newResourceIdentityAccountStore(opened.store);
      await accounts.save(
        create(IdentityAccountSchema, {
          metadata: { id: CAROL, name: "Carol Danvers" },
          spec: {
            idpId: SUBJECT,
            email: "carol@example.com",
            provisioningMode: IdentityAccountProvisioningMode.direct,
          },
        }),
      );
    });

    afterEach(async () => {
      await opened.close();
    });

    it("a routine stamped with the creator's account id is that account's, presented in the in-process identity shape", async () => {
      const owner = await resolveRoutineOwner(accounts, routine("rtn_by_id", CAROL));
      expect(owner.metadata?.id).toBe(CAROL);
      expect(await ownerAsFireCaller.callerFor({ org: "acme", routineId: "rtn_by_id", owner })).toEqual({
        identityId: CAROL,
        callerClass: "user",
        issuer: "",
        rawToken: "",
        email: "carol@example.com",
        displayName: "Carol Danvers",
      });
    });

    it("a routine stamped with the raw issuer subject (the 3.14.x shape) resolves to the same account", async () => {
      expect((await resolveRoutineOwner(accounts, routine("rtn_by_sub", SUBJECT))).metadata?.id).toBe(CAROL);
    });

    it.each([
      ["the empty stamp", ""],
      ["the laptop's placeholder", "system"],
      ["a trusted-local email stamp", "operator@example.com"],
      ["a deleted account", accountIdFor("auth0|gone")],
    ])("%s is the deterministic refusal, with the copy the routine's status carries", async (_label, stamp) => {
      const failure = await resolveRoutineOwner(accounts, routine("rtn_nobody", stamp)).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(RoutineFireRefusedError);
      expect((failure as Error).message).toBe(routineHasNoOwnerMessage("rtn_nobody"));
    });

    it("an account-store fault propagates as the fault it is, never a refusal", async () => {
      const fault = new Error("connection reset");
      const failing = { ...accounts, findById: () => Promise.reject(fault) };
      await expect(resolveRoutineOwner(failing, routine("rtn_by_id", CAROL))).rejects.toBe(fault);
    });
  });
});
