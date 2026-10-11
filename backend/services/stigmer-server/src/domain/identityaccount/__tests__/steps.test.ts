/**
 * Pins the identity-account steps that tell an organization's service
 * account apart from a person (../steps.ts), against the in-memory account
 * port, where each arm is reached directly; the composed suites prove the
 * chains these steps sit in.
 *
 * What it pins:
 *   - AssignBackendFields keeps the reserved subject namespaces disjoint in
 *     both directions: the direct arm refuses a `stgm_sa|` subject, as it
 *     refuses `stgm_pc|`, with INVALID_ARGUMENT before anything is
 *     written; the service_account arm writes mode `service_account`,
 *     never the machine flag, no provider ref and none of a person's
 *     fields, whatever the request carried; a service-account provisioning
 *     whose subject lacks its prefix is the creating path's bug, INTERNAL;
 *   - RenameServiceAccount keeps the slug equal to the name, so the name
 *     stays unique among the organization's service accounts: a name
 *     another service account of the organization holds is ALREADY_EXISTS
 *     with the SERVICE_ACCOUNT_NAME_TAKEN reason, the account may keep (or
 *     re-save) its own name, a name held in another organization is free,
 *     the person fields are cleared, and a person's account passes
 *     untouched.
 */
import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import {
  reservedSubjectMessage,
  serviceAccountNameTakenMessage,
  serviceAccountSubjectFor,
} from "../constants.js";
import type { AccountProvisioning } from "../provisioning.js";
import { SERVICE_ACCOUNT_NAME_TAKEN } from "../service-accounts.js";
import {
  newAssignBackendFieldsStep,
  newRenameServiceAccountStep,
} from "../steps.js";
import { fakeIdentityAccountStore } from "./support.js";
import type { FakeIdentityAccountStore } from "./support.js";

const ORG = "org_acme";
const OTHER_ORG = "org_other";

type AccountContext = RequestContext<typeof IdentityAccountSchema>;

function contextFor(account: IdentityAccount): AccountContext {
  return new RequestContext(
    IdentityAccountSchema,
    account,
    testCallerIdentity(),
    ApiResourceKind.identity_account,
  );
}

/** A create request as a caller of the create path sends it: person fields set, backend fields lying. */
function createRequest(idpId: string): IdentityAccount {
  return create(IdentityAccountSchema, {
    metadata: { name: "ci-deploy" },
    spec: {
      idpId,
      email: "someone@example.com",
      firstName: "Some",
      lastName: "One",
      pictureUrl: "https://example.com/p.png",
      isMachineAccount: true,
      provisioningMode: IdentityAccountProvisioningMode.direct,
      identityProviderRef: {
        org: "acme",
        kind: ApiResourceKind.identity_provider,
        slug: "acme-okta",
      },
    },
  });
}

function serviceAccountRow(id: string, name: string, slug: string, org = ORG) {
  return create(IdentityAccountSchema, {
    metadata: { id, name, slug, org },
    spec: {
      idpId: `stgm_sa|${org}|${id}`,
      provisioningMode: IdentityAccountProvisioningMode.service_account,
    },
  });
}

async function refusal(run: () => unknown): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the step to refuse");
}

function reasonOf(error: ConnectError): string | undefined {
  return error.findDetails(ErrorInfoSchema)[0]?.reason;
}

async function assign(
  provisioning: AccountProvisioning,
  idpId: string,
): Promise<AccountContext> {
  const ctx = contextFor(createRequest(idpId));
  await newAssignBackendFieldsStep(provisioning).execute(ctx);
  return ctx;
}

describe("AssignBackendFields — the reserved subject namespaces", () => {
  it("the direct arm refuses a service-account subject with INVALID_ARGUMENT and the reserved-prefix copy", async () => {
    const subject = serviceAccountSubjectFor(ORG);
    const error = await refusal(() => assign({ mode: "direct" }, subject));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(reservedSubjectMessage(subject));
  });

  it("the direct arm still refuses a platform-client subject", async () => {
    const subject = `stgm_pc|${ORG}|user-1`;
    const error = await refusal(() => assign({ mode: "direct" }, subject));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(reservedSubjectMessage(subject));
  });

  it("the direct arm admits a subject in no reserved namespace as a direct account", async () => {
    const ctx = await assign({ mode: "direct" }, "auth0|person");
    expect(ctx.newState.spec?.provisioningMode).toBe(
      IdentityAccountProvisioningMode.direct,
    );
  });

  it("the service_account arm writes its mode and clears every person field and the machine flag", async () => {
    const ctx = await assign(
      { mode: "service_account", org: ORG },
      serviceAccountSubjectFor(ORG),
    );
    const spec = ctx.newState.spec;
    expect(spec?.provisioningMode).toBe(
      IdentityAccountProvisioningMode.service_account,
    );
    expect(spec?.isMachineAccount).toBe(false);
    expect(spec?.identityProviderRef).toBeUndefined();
    expect(spec?.email).toBe("");
    expect(spec?.firstName).toBe("");
    expect(spec?.lastName).toBe("");
    expect(spec?.pictureUrl).toBe("");
  });

  it("a service-account provisioning whose subject lacks the reserved prefix is INTERNAL — the creating path's bug", async () => {
    for (const subject of ["auth0|person", `stgm_pc|${ORG}|user-1`]) {
      const error = await refusal(() =>
        assign({ mode: "service_account", org: ORG }, subject),
      );
      expect(error.code).toBe(Code.Internal);
    }
  });
});

describe("RenameServiceAccount — the slug follows the name, unique in the organization", () => {
  function seeded(): FakeIdentityAccountStore {
    const accounts = fakeIdentityAccountStore();
    for (const row of [
      serviceAccountRow("ida_self", "ci-deploy", "ci-deploy"),
      serviceAccountRow("ida_taken", "nightly", "nightly"),
      serviceAccountRow("ida_elsewhere", "release", "release", OTHER_ORG),
    ]) {
      accounts.rows.set(row.metadata?.id ?? "", row);
    }
    return accounts;
  }

  /** The update chain's state for `existing` renamed to `name`, the request's person fields set. */
  function renaming(existing: IdentityAccount, name: string): AccountContext {
    const next = clone(IdentityAccountSchema, existing);
    if (next.metadata === undefined || next.spec === undefined) {
      throw new Error("fixture row needs metadata and spec");
    }
    next.metadata.name = name;
    next.spec.firstName = "Some";
    next.spec.lastName = "One";
    next.spec.pictureUrl = "https://example.com/p.png";
    const ctx = contextFor(next);
    ctx.set(EXISTING_RESOURCE_KEY, existing);
    return ctx;
  }

  function existing(accounts: FakeIdentityAccountStore, id: string) {
    const row = accounts.rows.get(id);
    if (row === undefined) throw new Error(`fixture row ${id} missing`);
    return row;
  }

  it("moves the slug to the new name", async () => {
    const accounts = seeded();
    const ctx = renaming(existing(accounts, "ida_self"), "CI Deploy Prod");
    await newRenameServiceAccountStep(accounts).execute(ctx);
    expect(ctx.newState.metadata?.slug).toBe("ci-deploy-prod");
    expect(ctx.newState.metadata?.name).toBe("CI Deploy Prod");
  });

  it("a name another service account of the organization holds is ALREADY_EXISTS with SERVICE_ACCOUNT_NAME_TAKEN", async () => {
    const accounts = seeded();
    const ctx = renaming(existing(accounts, "ida_self"), "nightly");
    const error = await refusal(() =>
      newRenameServiceAccountStep(accounts).execute(ctx),
    );
    expect(error.code).toBe(Code.AlreadyExists);
    expect(error.rawMessage).toBe(serviceAccountNameTakenMessage("nightly"));
    expect(reasonOf(error)).toBe(SERVICE_ACCOUNT_NAME_TAKEN);
  });

  it("a name a service account of another organization holds is free", async () => {
    const accounts = seeded();
    const ctx = renaming(existing(accounts, "ida_self"), "release");
    await newRenameServiceAccountStep(accounts).execute(ctx);
    expect(ctx.newState.metadata?.slug).toBe("release");
  });

  it("the account may keep its own name", async () => {
    const accounts = seeded();
    const ctx = renaming(existing(accounts, "ida_self"), "ci-deploy");
    await newRenameServiceAccountStep(accounts).execute(ctx);
    expect(ctx.newState.metadata?.slug).toBe("ci-deploy");
  });

  it("a rename to a spelling of its own slug is its own name, not a collision", async () => {
    const accounts = seeded();
    const row = existing(accounts, "ida_self");
    const ctx = renaming(row, "CI-Deploy");
    // The stored slug differs from the request's so the uniqueness read
    // runs, and the only holder of the slug is the account itself.
    const metadata = ctx.newState.metadata;
    if (metadata === undefined) throw new Error("fixture metadata missing");
    metadata.slug = "stale-slug";
    await newRenameServiceAccountStep(accounts).execute(ctx);
    expect(ctx.newState.metadata?.slug).toBe("ci-deploy");
  });

  it("clears the person fields whatever the request sent", async () => {
    const accounts = seeded();
    const ctx = renaming(existing(accounts, "ida_self"), "ci-deploy");
    await newRenameServiceAccountStep(accounts).execute(ctx);
    expect(ctx.newState.spec?.firstName).toBe("");
    expect(ctx.newState.spec?.lastName).toBe("");
    expect(ctx.newState.spec?.pictureUrl).toBe("");
  });

  it("a person's account passes untouched: its slug and name fields are the request's", async () => {
    const accounts = seeded();
    const person = create(IdentityAccountSchema, {
      metadata: { id: "ida_person", name: "alice@example.com", slug: "alice" },
      spec: {
        idpId: "auth0|alice",
        provisioningMode: IdentityAccountProvisioningMode.direct,
      },
    });
    // A person renamed to a service account's name: no uniqueness rule
    // applies, and the step reads nothing.
    const ctx = renaming(person, "nightly");
    let reads = 0;
    await newRenameServiceAccountStep({
      findByOrg: (org) => {
        reads += 1;
        return accounts.findByOrg(org);
      },
    }).execute(ctx);
    expect(reads).toBe(0);
    expect(ctx.newState.metadata?.slug).toBe("alice");
    expect(ctx.newState.spec?.firstName).toBe("Some");
    expect(ctx.newState.spec?.lastName).toBe("One");
    expect(ctx.newState.spec?.pictureUrl).toBe("https://example.com/p.png");
  });
});
