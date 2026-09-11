/**
 * Pins the trusted-local operator account (operator.ts; T01_1_review.md
 * A2): the server knows its one principal from config, so the server
 * states the fact at boot instead of asking three clients to provision
 * it. `ensureOperatorAccount` is create-if-absent under the derived id of
 * `local|<operator email, or "system">`:
 *
 *   - a fresh store gets exactly one account, provisioning_mode direct,
 *     profile from the operator identity (display name → metadata.name,
 *     email → spec.email; the unconfigured laptop has an empty profile,
 *     which is the truth — spec.email is not a required field);
 *   - a later call never touches the row: preferences set through
 *     `update` survive a reboot, and a changed display name is edited like
 *     any profile, never re-synced from config;
 *   - a changed operator email is a different subject, so a different
 *     account — the email IS the identity (boot/config.ts
 *     loadOperatorIdentity);
 *   - two ensures racing (a two-replica boot) converge to one row by
 *     primary key.
 *
 * Whether the stage runs at all — only when no authentication posture is
 * on — is pinned where the posture is decided: boot/__tests__.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { accountIdFor, localIdpIdFor } from "../constants.js";
import { ensureOperatorAccount } from "../operator.js";
import { newResourceIdentityAccountStore } from "../resource-store.js";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(() => {
  temp.cleanup();
});

describe("ensureOperatorAccount", () => {
  it("creates the configured operator's account once, under the derived id", async () => {
    const accounts = newResourceIdentityAccountStore(temp.store);
    const account = await ensureOperatorAccount(accounts, {
      email: "operator@example.com",
      displayName: "The Operator",
    });

    expect(account.metadata?.id).toBe(
      accountIdFor("local|operator@example.com"),
    );
    expect(account.metadata?.name).toBe("The Operator");
    expect(account.spec).toMatchObject({
      idpId: localIdpIdFor("operator@example.com"),
      email: "operator@example.com",
      provisioningMode: IdentityAccountProvisioningMode.direct,
      isMachineAccount: false,
    });
    expect(account.status?.audit?.specAudit?.event).toBe("created");
    expect(
      await temp.store.listResources(ApiResourceKind.identity_account),
    ).toHaveLength(1);
  });

  it("the unconfigured laptop is the 'system' operator with an empty profile", async () => {
    const accounts = newResourceIdentityAccountStore(temp.store);
    const account = await ensureOperatorAccount(accounts, {
      email: "",
      displayName: "",
    });

    expect(account.metadata?.id).toBe(accountIdFor("local|system"));
    expect(account.spec?.idpId).toBe("local|system");
    expect(account.spec?.email).toBe("");
    expect(account.metadata?.name).toBe("system");
  });

  it("a second boot never touches the row — preferences and an edited name survive", async () => {
    const accounts = newResourceIdentityAccountStore(temp.store);
    const operator = {
      email: "operator@example.com",
      displayName: "The Operator",
    };
    const created = await ensureOperatorAccount(accounts, operator);

    const edited = create(IdentityAccountSchema, {
      ...created,
      metadata: { ...created.metadata, name: "Renamed by the console" },
      spec: { ...created.spec, preferences: { defaultHarness: "cursor" } },
    });
    await accounts.update(edited);

    const again = await ensureOperatorAccount(accounts, {
      ...operator,
      displayName: "A New Config Name",
    });
    expect(again.metadata?.name).toBe("Renamed by the console");
    expect(again.spec?.preferences?.defaultHarness).toBe("cursor");
    expect(
      await temp.store.listResources(ApiResourceKind.identity_account),
    ).toHaveLength(1);
  });

  it("a changed operator email is a different subject, so a different account", async () => {
    const accounts = newResourceIdentityAccountStore(temp.store);
    await ensureOperatorAccount(accounts, {
      email: "old@example.com",
      displayName: "",
    });
    const next = await ensureOperatorAccount(accounts, {
      email: "new@example.com",
      displayName: "",
    });

    expect(next.metadata?.id).toBe(accountIdFor("local|new@example.com"));
    expect(
      await temp.store.listResources(ApiResourceKind.identity_account),
    ).toHaveLength(2);
  });

  it("two ensures racing converge to one row", async () => {
    const accounts = newResourceIdentityAccountStore(temp.store);
    const operator = {
      email: "operator@example.com",
      displayName: "The Operator",
    };
    const [a, b] = await Promise.all([
      ensureOperatorAccount(accounts, operator),
      ensureOperatorAccount(accounts, operator),
    ]);

    expect(a.metadata?.id).toBe(b.metadata?.id);
    expect(
      await temp.store.listResources(ApiResourceKind.identity_account),
    ).toHaveLength(1);
  });
});
