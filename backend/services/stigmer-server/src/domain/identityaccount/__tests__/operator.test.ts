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
 * The row goes through the domain's ONE create path (the same chain the
 * create RPC runs), built here over the temp store with the permissive
 * authorizer and no lifecycle driver — the no-extension composition.
 *
 * Whether the stage runs at all — only when no authentication posture is
 * on — is pinned where the posture is decided: boot/__tests__.
 */
import { clone, create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityAccountPreferencesSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";

import { createLogger } from "../../../boot/logger.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { accountIdFor, localIdpIdFor } from "../constants.js";
import { newCreateAccountPath } from "../controller.js";
import { ensureOperatorAccount } from "../operator.js";
import type { OperatorAccountDeps } from "../operator.js";
import { newResourceIdentityAccountStore } from "../resource-store.js";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(() => {
  temp.cleanup();
});

/** The domain over the temp store: the port and its one create path. */
function domainOver(store: TempStore["store"]): OperatorAccountDeps {
  const accounts = newResourceIdentityAccountStore(store);
  return {
    accounts,
    createAccount: newCreateAccountPath(
      {
        accounts,
        logger: createLogger({
          level: "error",
          pretty: false,
          write: () => {},
        }),
        authorizer: newPermissiveSingleTeamAuthorizer(),
        authorizationLifecycle: undefined,
      },
      ApiResourceKind.identity_account,
    ),
  };
}

describe("ensureOperatorAccount", () => {
  it("creates the configured operator's account once, under the derived id", async () => {
    const accounts = domainOver(temp.store);
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
    const accounts = domainOver(temp.store);
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
    const accounts = domainOver(temp.store);
    const operator = {
      email: "operator@example.com",
      displayName: "The Operator",
    };
    const created = await ensureOperatorAccount(accounts, operator);

    // The console's writes: a renamed profile and a preference, through
    // the port the update RPC persists with.
    const edited = clone(IdentityAccountSchema, created);
    if (edited.metadata === undefined || edited.spec === undefined) {
      throw new Error(
        "the create path answered an account without metadata or spec",
      );
    }
    edited.metadata.name = "Renamed by the console";
    edited.spec.preferences = create(IdentityAccountPreferencesSchema, {
      defaultHarness: "cursor",
    });
    await accounts.accounts.update(edited);

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
    const accounts = domainOver(temp.store);
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
    const accounts = domainOver(temp.store);
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
