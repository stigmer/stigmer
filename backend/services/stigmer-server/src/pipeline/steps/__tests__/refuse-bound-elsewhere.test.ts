/**
 * Pins RefuseBoundElsewhere (refuse-bound-elsewhere.ts) and the persist
 * step's use of it: a credential bound to one organization is refused,
 * with the binding's sentence, before it writes a run, a connect or any row
 * filed in another organization; its own organization, an unbound caller
 * and an empty organization (left to the lane's own validation) pass. The
 * persist step refuses before the store is touched.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { BOUND_ELSEWHERE_DENY_REASON } from "../../../authorization/credential-binding.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type { Store } from "../../../store/interface.js";
import { RequestContext } from "../../request-context.js";
import { newPersistStep } from "../persist.js";
import {
  newRefuseBoundElsewhereStep,
  refuseBoundElsewhere,
} from "../refuse-bound-elsewhere.js";

const person: CallerIdentity = {
  identityId: "ida_alice",
  callerClass: "user",
  issuer: "",
  rawToken: "stk_x",
};
const boundToAcme: CallerIdentity = { ...person, boundOrg: "org_acme" };

function runIn(org: string, caller: CallerIdentity) {
  return new RequestContext(
    AgentRunSchema,
    create(AgentRunSchema, {
      metadata: { id: "aex_1", name: "run", org },
    }),
    caller,
    ApiResourceKind.agent_run,
  );
}

function refusalOf(act: () => unknown): ConnectError {
  try {
    act();
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected a refusal");
}

describe("refuseBoundElsewhere", () => {
  it("refuses a bound credential in another organization with the binding's sentence", () => {
    const refused = refusalOf(() =>
      refuseBoundElsewhere(boundToAcme, "org_globex"),
    );
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(BOUND_ELSEWHERE_DENY_REASON);
  });

  it("passes its own organization, an unbound caller and an empty organization", () => {
    expect(() => refuseBoundElsewhere(boundToAcme, "org_acme")).not.toThrow();
    expect(() => refuseBoundElsewhere(person, "org_globex")).not.toThrow();
    expect(() => refuseBoundElsewhere(boundToAcme, "")).not.toThrow();
    expect(() => refuseBoundElsewhere(undefined, "org_globex")).not.toThrow();
  });
});

describe("the step and the persist backstop", () => {
  it("the step refuses a run filed in another organization, and passes one in its own", async () => {
    const step = newRefuseBoundElsewhereStep<typeof AgentRunSchema>();
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
    const persist = newPersistStep<typeof AgentRunSchema>(store);
    await expect(
      persist.execute(runIn("org_globex", boundToAcme)),
    ).rejects.toMatchObject({
      code: Code.PermissionDenied,
    });
    expect(saved).toEqual([]);
    await persist.execute(runIn("org_globex", person));
    expect(saved).toEqual(["aex_1"]);
  });

  it("persist leaves an API key to the binding's own rule: its metadata.org is not the organization it is limited to", async () => {
    const saved: string[] = [];
    const store = {
      saveResource: async (_kind: ApiResourceKind, id: string) => {
        saved.push(id);
      },
    } as unknown as Store;
    const persist = newPersistStep<typeof ApiKeySchema>(store);
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
