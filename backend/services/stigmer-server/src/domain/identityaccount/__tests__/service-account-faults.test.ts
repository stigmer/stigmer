/**
 * The create's refusals and fault arm the wire cannot reach, driven on
 * the handler directly over fake ports.
 *
 * Pins:
 *   - a request the server composes (no protovalidate in front of it) is
 *     still refused owner, and the unspecified role, INVALID_ARGUMENT with
 *     nothing created;
 *   - a name with no ASCII letter or digit fits to no slug and is refused
 *     INVALID_ARGUMENT with the domain's copy, before any read;
 *   - an organization whose accounts cannot be read answers INTERNAL with
 *     the lane's copy, never a name check that passed.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createContextValues } from "@connectrpc/connect";
import type { HandlerContext } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { CreateServiceAccountInputSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/io_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../../extensions/authorizer.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { callerIdentityKey } from "../../../pipeline/interceptors/auth.js";
import { testCallerIdentity, untouchable } from "../../../pipeline/__tests__/support.js";
import type { CreateAccount } from "../provisioning.js";
import { SERVICE_ACCOUNT_NAME_UNUSABLE_MESSAGE, createServiceAccount } from "../service-accounts.js";
import type { ServiceAccountDeps } from "../service-accounts.js";
import type { IdentityAccountStore } from "../store.js";

const ALLOW_ALL: Authorizer = { authorize: () => Promise.resolve({ kind: "allow" }) };

function handlerContext(): HandlerContext {
  const values = createContextValues();
  values.set(callerIdentityKey, testCallerIdentity({ identityId: "ida_admin" }));
  return { signal: new AbortController().signal, values } as HandlerContext;
}

function deps(accounts: Pick<IdentityAccountStore, "findByOrg" | "findById">, created: string[]): ServiceAccountDeps {
  const createAccount: CreateAccount = (input) => {
    created.push(input.name);
    return Promise.reject(new Error("the create path must not be reached"));
  };
  return {
    accounts: new Proxy(accounts as IdentityAccountStore, {
      get: (target, member) =>
        member in target ? Reflect.get(target, member) : Reflect.get(untouchable<IdentityAccountStore>("accounts"), member),
    }),
    logger: silentLogger,
    authorizer: ALLOW_ALL,
    authorizationLifecycle: undefined,
    createAccount,
    grantPath: untouchable("grantPath"),
    signInRequired: true,
  };
}

async function refusal(work: Promise<unknown>): Promise<ConnectError> {
  const error = await work.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof ConnectError)) {
    throw new Error("expected a ConnectError");
  }
  return error;
}

const noAccounts = { findByOrg: () => Promise.resolve([]) };

/** The admin's own row, which the refusal of a service account reads: a person's. */
const findById = () => Promise.resolve(undefined);

describe("createServiceAccount, past the wire's validator", () => {
  it.each([IamRole.owner, IamRole.iam_role_unspecified])(
    "refuses the role %s INVALID_ARGUMENT and creates nothing",
    async (role) => {
      const created: string[] = [];
      const error = await refusal(
        createServiceAccount(
          deps({ ...noAccounts, findById }, created),
          create(CreateServiceAccountInputSchema, { org: "org_acme", name: "ci", role }),
          handlerContext(),
        ),
      );
      expect(error.code).toBe(Code.InvalidArgument);
      expect(created).toEqual([]);
    },
  );

  it("refuses a name that fits to no slug INVALID_ARGUMENT before any read", async () => {
    const created: string[] = [];
    const error = await refusal(
      createServiceAccount(
        deps({ findByOrg: () => Promise.reject(new Error("must not be read")), findById }, created),
        create(CreateServiceAccountInputSchema, { org: "org_acme", name: "部署", role: IamRole.member }),
        handlerContext(),
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(SERVICE_ACCOUNT_NAME_UNUSABLE_MESSAGE);
    expect(created).toEqual([]);
  });

  it("answers INTERNAL with the lane's copy when the organization's accounts cannot be read", async () => {
    const created: string[] = [];
    const error = await refusal(
      createServiceAccount(
        deps({ findByOrg: () => Promise.reject(new Error("account store down")), findById }, created),
        create(CreateServiceAccountInputSchema, { org: "org_acme", name: "ci", role: IamRole.member }),
        handlerContext(),
      ),
    );
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toContain("failed to list the organization's accounts");
    expect(created).toEqual([]);
  });
});
