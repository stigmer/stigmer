/**
 * Pins RefuseBoundElsewhere (refuse-bound-elsewhere.ts) and the persist
 * step's use of it: the step asks the binding's `admitsOrganization` and
 * refuses, with the binding's sentence, before a bound credential writes a
 * run, a connect or any row filed in an organization it does not reach;
 * what the binding admits (here its own organization and a child of it),
 * an unbound caller and an empty organization (left to the lane's own
 * validation, never asked) pass. The persist step refuses before the store
 * is touched, and a credential bound to a parent saves a row in its child.
 * Which organizations a binding admits is the binding's own suite's
 * (authorization/__tests__/credential-binding.test.ts).
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ApiKeySchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { BOUND_ELSEWHERE_DENY_REASON } from "../../../authorization/credential-binding.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { boundOrgOf } from "../../../extensions/identity.js";
import type { Store } from "../../../store/interface.js";
import { RequestContext } from "../../request-context.js";
import { newPersistStep } from "../persist.js";
import {
  newRefuseBoundElsewhereStep,
  refuseBoundElsewhere,
} from "../refuse-bound-elsewhere.js";
import type { OrganizationAdmission } from "../refuse-bound-elsewhere.js";

const person: CallerIdentity = {
  identityId: "ida_alice",
  callerClass: "user",
  issuer: "",
  rawToken: "stk_x",
};
const boundToAcme: CallerIdentity = { ...person, boundOrg: "org_acme" };

/** org_acme_cust is a child of org_acme; the binding admits a bound organization and its children. */
const PARENTS: Readonly<Record<string, string>> = { org_acme_cust: "org_acme" };
const asked: string[] = [];
const binding: OrganizationAdmission = {
  admitsOrganization: (caller, org) => {
    asked.push(org);
    const bound = boundOrgOf(caller);
    return Promise.resolve(
      bound === undefined || org === bound || PARENTS[org] === bound,
    );
  },
};

function runIn(org: string, caller: CallerIdentity) {
  return new RequestContext(
    RunSchema,
    create(RunSchema, {
      metadata: { id: "run_1", name: "run", org },
    }),
    caller,
    ApiResourceKind.run,
  );
}

async function refusalOf(act: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await act();
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected a refusal");
}

describe("refuseBoundElsewhere", () => {
  it("refuses a bound credential in an organization the binding does not admit, with the binding's sentence", async () => {
    const refused = await refusalOf(() =>
      refuseBoundElsewhere(binding, boundToAcme, "org_globex"),
    );
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(BOUND_ELSEWHERE_DENY_REASON);
  });

  it("passes what the binding admits, an unbound caller and an empty organization, never asking about an empty one", async () => {
    asked.length = 0;
    await expect(
      refuseBoundElsewhere(binding, boundToAcme, "org_acme"),
    ).resolves.toBeUndefined();
    await expect(
      refuseBoundElsewhere(binding, boundToAcme, "org_acme_cust"),
    ).resolves.toBeUndefined();
    await expect(
      refuseBoundElsewhere(binding, person, "org_globex"),
    ).resolves.toBeUndefined();
    await expect(
      refuseBoundElsewhere(binding, boundToAcme, ""),
    ).resolves.toBeUndefined();
    await expect(
      refuseBoundElsewhere(binding, undefined, "org_globex"),
    ).resolves.toBeUndefined();
    expect(asked).toEqual(["org_acme", "org_acme_cust", "org_globex"]);
  });
});

describe("the step and the persist backstop", () => {
  it("the step refuses a run filed in another organization, and passes one in its own", async () => {
    const step = newRefuseBoundElsewhereStep<typeof RunSchema>(binding);
    await expect(
      step.execute(runIn("org_globex", boundToAcme)),
    ).rejects.toMatchObject({
      code: Code.PermissionDenied,
    });
    await expect(
      step.execute(runIn("org_acme", boundToAcme)),
    ).resolves.toBeUndefined();
  });

  it("persist saves nothing filed in another organization for a bound caller", async () => {
    const saved: string[] = [];
    const store = {
      saveResource: async (_kind: ApiResourceKind, id: string) => {
        saved.push(id);
      },
    } as unknown as Store;
    const persist = newPersistStep<typeof RunSchema>(store, binding);
    await expect(
      persist.execute(runIn("org_globex", boundToAcme)),
    ).rejects.toMatchObject({
      code: Code.PermissionDenied,
    });
    expect(saved).toEqual([]);
    await persist.execute(runIn("org_globex", person));
    expect(saved).toEqual(["run_1"]);
  });

  it("persist saves a row filed in a child of the bound organization", async () => {
    const saved: string[] = [];
    const store = {
      saveResource: async (_kind: ApiResourceKind, id: string) => {
        saved.push(id);
      },
    } as unknown as Store;
    await newPersistStep<typeof RunSchema>(store, binding).execute(
      runIn("org_acme_cust", boundToAcme),
    );
    expect(saved).toEqual(["run_1"]);
  });

  it("persist leaves an API key to the binding's own rule: its metadata.org is not the organization it is limited to", async () => {
    const saved: string[] = [];
    const store = {
      saveResource: async (_kind: ApiResourceKind, id: string) => {
        saved.push(id);
      },
    } as unknown as Store;
    const persist = newPersistStep<typeof ApiKeySchema>(store, binding);
    await persist.execute(
      new RequestContext(
        ApiKeySchema,
        create(ApiKeySchema, {
          metadata: { id: "key_1", name: "ci", org: "org_globex" },
          spec: { boundOrg: "org_acme" },
        }),
        boundToAcme,
        ApiResourceKind.api_key,
      ),
    );
    expect(saved).toEqual(["key_1"]);
  });
});
