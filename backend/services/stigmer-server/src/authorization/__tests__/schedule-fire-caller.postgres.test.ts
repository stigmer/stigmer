/**
 * Pins the built-in schedule fire caller on both store drivers: a fire
 * acts as the schedule's creator — resolved from the row's stamp as an
 * account id (3.15+) or as the raw issuer subject (the 3.14.x stamp) —
 * in the exact identity shape `accountAsCaller` builds; a schedule whose
 * stamp names no person this server knows (`""`, `"system"`, a
 * trusted-local email, a deleted account) is the seam's DETERMINISTIC
 * refusal with the copy the schedule's status will carry; a missing
 * schedule row and a store fault stay infrastructure throws.
 */
import { create } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { accountIdFor } from "../../domain/identityaccount/constants.js";
import { newResourceIdentityAccountStore } from "../../domain/identityaccount/resource-store.js";
import type { IdentityAccountStore } from "../../domain/identityaccount/store.js";
import { ScheduleFireCallerRefusedError } from "../../extensions/schedule-fire-caller.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import {
  newBuiltInScheduleFireCaller,
  scheduleHasNoPersonMessage,
} from "../schedule-fire-caller.js";
import { driverFixtures, dropPostgresFixture } from "./drivers.js";
import type { OpenedStore } from "./drivers.js";

const SUBJECT = "auth0|carol";
const CAROL = accountIdFor(SUBJECT);

afterAll(dropPostgresFixture);

describe.each(
  driverFixtures([ApiResourceKind.schedule, ApiResourceKind.identity_account]),
)("the built-in schedule fire caller on $name", (fixture) => {
  describe.skipIf(fixture.skip)("mintFireCaller", () => {
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

    async function schedule(id: string, createdBy: string): Promise<void> {
      await opened.store.saveResource(
        ApiResourceKind.schedule,
        id,
        ScheduleSchema,
        create(ScheduleSchema, {
          metadata: { id, name: id, org: "acme" },
          status: { audit: { specAudit: { createdBy: { id: createdBy } } } },
        }),
      );
    }

    function mint() {
      return newBuiltInScheduleFireCaller({ store: opened.store, accounts });
    }

    it("a schedule stamped with the creator's account id fires as that account, in the in-process identity shape", async () => {
      await schedule("sch_by_id", CAROL);
      expect(await mint().mintFireCaller("acme", "sch_by_id")).toEqual({
        identityId: CAROL,
        callerClass: "user",
        issuer: "",
        rawToken: "",
        email: "carol@example.com",
        displayName: "Carol Danvers",
      });
    });

    it("a schedule stamped with the raw issuer subject (the 3.14.x shape) resolves to the same account", async () => {
      await schedule("sch_by_sub", SUBJECT);
      expect(
        (await mint().mintFireCaller("acme", "sch_by_sub")).identityId,
      ).toBe(CAROL);
    });

    it.each([
      ["the empty stamp", ""],
      ["the laptop's placeholder", "system"],
      ["a trusted-local email stamp", "operator@example.com"],
      ["a deleted account", accountIdFor("auth0|gone")],
    ])(
      "%s is the seam's deterministic refusal, with the copy the schedule's status carries",
      async (_label, stamp) => {
        await schedule("sch_nobody", stamp);
        const failure = await mint()
          .mintFireCaller("acme", "sch_nobody")
          .catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(ScheduleFireCallerRefusedError);
        expect((failure as Error).message).toBe(
          scheduleHasNoPersonMessage("sch_nobody"),
        );
      },
    );

    it("a schedule that no longer exists is an infrastructure throw, never a refusal", async () => {
      const failure = await mint()
        .mintFireCaller("acme", "sch_missing")
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ResourceNotFoundError);
    });

    it("a store fault reading the schedule propagates as the fault it is", async () => {
      const fault = new Error("connection reset");
      const failing = newBuiltInScheduleFireCaller({
        store: { ...opened.store, getResource: () => Promise.reject(fault) },
        accounts,
      });
      await expect(failing.mintFireCaller("acme", "sch_by_id")).rejects.toBe(
        fault,
      );
    });
  });
});
