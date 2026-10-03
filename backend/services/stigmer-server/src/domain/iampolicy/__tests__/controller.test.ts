/**
 * Pins controller.ts (20260913.01 slice 5) at the handler level, over a
 * router transport with fakes — the query/search controller.test.ts
 * shape — so every arm of the fourteen RPCs is proven without booting a
 * server; the composed proof over real boots is iampolicy.test.ts.
 *
 * Fakes: the domain's in-memory IamPolicyStore (support.ts) with a real
 * grant path over it; the identity-account fake store for
 * `accountForCaller` and display enrichment; a RECORDING Authorizer whose
 * decision each arm sets; a recording AuthorizationQueryEngine; the
 * open-source grant scope unless an arm installs another; a stamping
 * interceptor that sets the caller the chassis would have stamped (the
 * verifier chain is the chassis's business, proven in its own tests).
 *
 * What the arms pin (T01_1_review.md Q-OR-7, Q-OR-8; Q-S5-1..3, Q-S5-10):
 *   - the three system RPCs admit machine and internal callers and refuse
 *     a wire user PERMISSION_DENIED with the annotation's own copy;
 *   - checkMyPermission's full order, incl. the arms the Authorizer is
 *     NEVER consulted on, and the account id (not the stamped email) the
 *     contextual arm hands the engine;
 *   - checkAuthorization's and listAuthorizedResourceIds's principal-trust
 *     rule against the caller's ACCOUNT; listAuthorizedPrincipalIds's
 *     annotation-driven check; the wire-kind refusals on every lane;
 *   - get loads before it authorizes (NOT_FOUND with no Authorizer call;
 *     the row's kind and id as the target); delete authorizes before it
 *     loads; create validates the role before it writes, then runs the
 *     `iam-policy-create:pre-side-effect-gate` slot, whose refusal leaves
 *     no row; bootstrapPolicy never runs that slot;
 *   - owner is assigned by owners: an admin is refused granting owner,
 *     revoking it and removing an owner, after position 1 and before any
 *     write; an owner is allowed each; the last owner is kept; the
 *     bootstrap twins run neither owner step.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import type { Client, Interceptor, Transport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import { IamPolicyQueryController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/query_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import {
  IamPermission,
  IamRole,
} from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import { createLogger } from "../../../boot/logger.js";
import type { AuthorizationQueryEngine } from "../../../extensions/authorization-queries.js";
import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type { PolicyGrantScope } from "../../../extensions/policy-grant-scope.js";
import { createApiResourceInterceptor } from "../../../pipeline/interceptors/apiresource.js";
import type { PipelineStep } from "../../../pipeline/pipeline.js";
import {
  callerIdentityKey,
  trustedLocalIdentityFor,
} from "../../../pipeline/interceptors/auth.js";
import { AUTHORIZATION_UNAVAILABLE_MESSAGE } from "../../../pipeline/steps/authorize.js";
import { fakeIdentityAccountStore } from "../../identityaccount/__tests__/support.js";
import {
  accountIdFor,
  localIdpIdFor,
} from "../../identityaccount/constants.js";
import {
  AUTHENTICATION_REQUIRED_MESSAGE,
  AUTHORIZATION_QUERIES_UNIMPLEMENTED_MESSAGE,
  LAST_OWNER_MESSAGE,
  OWNER_ASSIGNMENT_DENIED_MESSAGE,
  policyIdFor,
  policyNotFoundMessage,
  principalNotGrantableMessage,
  roleNotGrantableMessage,
  unknownPermissionMessage,
  unknownPrincipalKindMessage,
  unknownResourceKindMessage,
} from "../constants.js";
import { registerIamPolicyServices } from "../controller.js";
import { newIamPolicyGrantPath } from "../grant-path.js";
import { newOrganizationOnlyGrantScope } from "../grant-scope.js";
import {
  NO_STORED_RESOURCES,
  fakeIamPolicyStore,
  orgRole,
  triple,
} from "./support.js";

const silent = createLogger({ level: "error", pretty: false, write: () => {} });

const OPERATOR_EMAIL = "operator@example.com";
const OPERATOR_ID = accountIdFor(localIdpIdFor(OPERATOR_EMAIL));
const ALICE_ID = "ida_alice";

/** The trusted-local operator: stamped by EMAIL, resolves to an account (the Q-S4-1 fact). */
const operator: CallerIdentity = trustedLocalIdentityFor({
  email: OPERATOR_EMAIL,
  displayName: "The Operator",
});
/** A provisioned user whose verifier re-stamped the account id (the cloud's shape). */
const alice: CallerIdentity = {
  identityId: ALICE_ID,
  callerClass: "user",
  issuer: "https://issuer.example",
  rawToken: "opaque",
};
const machine: CallerIdentity = {
  identityId: "ida_platform",
  callerClass: "machine",
  issuer: "https://issuer.example",
  rawToken: "opaque",
};
const internal: CallerIdentity = {
  ...operator,
  callerClass: "internal",
  origin: "in-process",
};
const anonymous: CallerIdentity = { ...alice, identityId: "" };

function stampCaller(identity: CallerIdentity): Interceptor {
  return (next) => (request) => {
    request.contextValues.set(callerIdentityKey, identity);
    return next(request);
  };
}

interface RecordingAuthorizer extends Authorizer {
  readonly checks: AuthzCheck[];
  /** One answer for every check, or one per check (a throw is an outage). */
  decision: AuthzDecision | ((check: AuthzCheck) => AuthzDecision);
}

function recordingAuthorizer(): RecordingAuthorizer {
  const checks: AuthzCheck[] = [];
  const authorizer: RecordingAuthorizer = {
    checks,
    decision: { kind: "allow" },
    authorize(_caller, check) {
      checks.push(check);
      if (typeof authorizer.decision === "function") {
        return Promise.resolve(authorizer.decision(check));
      }
      return Promise.resolve(authorizer.decision);
    },
  };
  return authorizer;
}

interface RecordingEngine extends AuthorizationQueryEngine {
  readonly calls: Array<{ method: string; args: unknown[] }>;
}

function recordingEngine(): RecordingEngine {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  return {
    calls,
    check(policy, contextual) {
      calls.push({ method: "check", args: [policy, contextual] });
      return Promise.resolve(true);
    },
    listResourceIds(principal, relation, resourceKind, contextual) {
      calls.push({
        method: "listResourceIds",
        args: [principal, relation, resourceKind, contextual],
      });
      return Promise.resolve(["r1"]);
    },
    listPrincipalIds(resource, relation, principalKind, contextual) {
      calls.push({
        method: "listPrincipalIds",
        args: [resource, relation, principalKind, contextual],
      });
      return Promise.resolve(["p1"]);
    },
  };
}

interface Harness {
  readonly command: Client<typeof IamPolicyCommandController>;
  readonly query: Client<typeof IamPolicyQueryController>;
  readonly authorizer: RecordingAuthorizer;
  readonly engine: RecordingEngine | undefined;
  readonly policies: ReturnType<typeof fakeIamPolicyStore>;
}

async function harness(options: {
  caller: CallerIdentity;
  engine?: boolean;
  edition?: ServerEdition;
  scope?: PolicyGrantScope;
  createGate?: PipelineStep<DescMessage>;
}): Promise<Harness> {
  const policies = fakeIamPolicyStore();
  const accounts = fakeIdentityAccountStore();
  await accounts.save(
    create(IdentityAccountSchema, {
      metadata: { id: OPERATOR_ID, name: "The Operator" },
      spec: {
        idpId: localIdpIdFor(OPERATOR_EMAIL),
        email: OPERATOR_EMAIL,
        provisioningMode: IdentityAccountProvisioningMode.direct,
      },
    }),
  );
  await accounts.save(
    create(IdentityAccountSchema, {
      metadata: { id: ALICE_ID, name: "alice@example.com" },
      spec: {
        idpId: "auth0|alice",
        email: "alice@example.com",
        firstName: "Alice",
        provisioningMode: IdentityAccountProvisioningMode.direct,
      },
    }),
  );
  const authorizer = recordingAuthorizer();
  const engine = options.engine === true ? recordingEngine() : undefined;
  const grantPath = newIamPolicyGrantPath({
    resources: NO_STORED_RESOURCES,
    policies,
    lifecycle: undefined,
    logger: silent,
  });
  const transport: Transport = createRouterTransport(
    (router) => {
      registerIamPolicyServices(router, {
        grantPath,
        policies,
        accounts,
        authorizer,
        grantScope: options.scope ?? newOrganizationOnlyGrantScope(),
        queries: engine,
        principalDisplay: undefined,
        gateSteps: new Map(
          options.createGate === undefined
            ? []
            : [
                [
                  "iam-policy-create:pre-side-effect-gate",
                  [options.createGate],
                ],
              ],
        ),
        edition: options.edition ?? ServerEdition.oss,
        logger: silent,
      });
    },
    {
      router: {
        interceptors: [
          createApiResourceInterceptor(),
          stampCaller(options.caller),
        ],
      },
    },
  );
  return {
    command: createClient(IamPolicyCommandController, transport),
    query: createClient(IamPolicyQueryController, transport),
    authorizer,
    engine,
    policies,
  };
}

async function refusal(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
}

const ref = (kind: string, id: string) =>
  create(ApiResourceRefSchema, { kind, id });
const structural: IamPolicySpec = triple(
  { kind: "organization", id: "acme" },
  "organization",
  { kind: "agent", id: "agt_1" },
);

describe("the three system RPCs (Q-OR-7, Q-S5-10)", () => {
  const cases: ReadonlyArray<
    [name: string, copy: string, call: (h: Harness) => Promise<unknown>]
  > = [
    [
      "bootstrapPolicy",
      "unauthorized to bootstrap policy - can_bootstrap_iam permission required",
      (h) => h.command.bootstrapPolicy(structural),
    ],
    [
      "cleanupResourcePolicies",
      "unauthorized to cleanup resource policies - can_bootstrap_iam permission required",
      (h) => h.command.cleanupResourcePolicies(ref("agent", "agt_1")),
    ],
    [
      "bootstrapRevokeOrgAccess",
      "unauthorized to revoke organization access - can_bootstrap_iam permission required",
      (h) =>
        h.command.bootstrapRevokeOrgAccess({
          identityAccountId: ALICE_ID,
          org: "acme",
        }),
    ],
  ];

  for (const [name, copy, call] of cases) {
    it(`${name}: a wire user is PERMISSION_DENIED with the annotation's copy before the Authorizer is asked`, async () => {
      const h = await harness({ caller: alice });
      const error = await refusal(() => call(h));
      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(copy);
      expect(h.authorizer.checks).toEqual([]);
    });

    it(`${name}: a machine caller is admitted and the annotation's static platform check still runs`, async () => {
      const h = await harness({ caller: machine });
      await call(h);
      expect(h.authorizer.checks).toEqual([
        {
          permission: IamPermission.can_bootstrap_iam,
          resourceKind: ApiResourceKind.platform,
          resourceId: "stigmer",
        },
      ]);
    });

    it(`${name}: an internal caller is admitted and skips position 1`, async () => {
      const h = await harness({ caller: internal });
      await call(h);
      expect(h.authorizer.checks).toEqual([]);
    });
  }

  it("bootstrapPolicy writes structural relations no role validation would admit", async () => {
    const h = await harness({ caller: machine });
    const seeded = await h.command.bootstrapPolicy(structural);
    expect(seeded.metadata?.id).toBe(policyIdFor(structural));
    expect(h.policies.rows.size).toBe(1);
  });
});

describe("each lane hands the store its own door and its caller", () => {
  const member = orgRole(OPERATOR_ID, "member", "acme");

  it("create records a grant and delete a revoke, both as the chain's caller", async () => {
    const h = await harness({ caller: alice });
    await h.command.create(member);
    await h.command.delete(member);
    const actor = { id: alice.identityId, callerClass: "user" };
    expect(h.policies.changes.map((change) => [change.op, change.record])).toEqual([
      ["save", { actor, cause: "grant", organizationId: "acme" }],
      ["delete", { actor, cause: "revoke", organizationId: "acme" }],
    ]);
  });

  it("bootstrapPolicy records a structural change and cleanupResourcePolicies a deleted resource", async () => {
    const h = await harness({ caller: machine });
    await h.command.bootstrapPolicy(member);
    await h.command.cleanupResourcePolicies(ref("organization", "acme"));
    expect(h.policies.changes.map((change) => change.record?.cause)).toEqual([
      "structural",
      "resource_deleted",
    ]);
  });
});

describe("checkMyPermission (Q-OR-8, Q-S5-3)", () => {
  const platform = ref("platform", "stigmer");
  const acme = ref("organization", "acme");

  it("an empty identity is UNAUTHENTICATED with the cloud's copy", async () => {
    const h = await harness({ caller: anonymous });
    const error = await refusal(() =>
      h.query.checkMyPermission({ resource: acme, relation: "can_view" }),
    );
    expect(error.code).toBe(Code.Unauthenticated);
    expect(error.rawMessage).toBe(AUTHENTICATION_REQUIRED_MESSAGE);
  });

  it("a relation that is no IamPermission name is INVALID_ARGUMENT, quoted, with nothing consulted", async () => {
    const h = await harness({ caller: alice });
    const error = await refusal(() =>
      h.query.checkMyPermission({ resource: acme, relation: "admin" }),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(unknownPermissionMessage("admin"));
    expect(h.authorizer.checks).toEqual([]);
  });

  it("an unknown resource kind is INVALID_ARGUMENT with the wire copy (Q-S5-2)", async () => {
    const h = await harness({ caller: alice });
    const error = await refusal(() =>
      h.query.checkMyPermission({
        resource: ref("Organization", "acme"),
        relation: "can_view",
      }),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(unknownResourceKindMessage("Organization"));
  });

  it("contextual policies without a composed engine are UNIMPLEMENTED with the edition named", async () => {
    const h = await harness({ caller: alice });
    const error = await refusal(() =>
      h.query.checkMyPermission({
        resource: acme,
        relation: "can_view",
        contextualPolicies: [orgRole(ALICE_ID, "viewer", "acme")],
      }),
    );
    expect(error.code).toBe(Code.Unimplemented);
    expect(error.rawMessage).toContain(
      AUTHORIZATION_QUERIES_UNIMPLEMENTED_MESSAGE,
    );
    expect(h.authorizer.checks).toEqual([]);
  });

  it("contextual policies ride the engine with the caller's ACCOUNT as the principal — even when the caller is stamped by email", async () => {
    const h = await harness({ caller: operator, engine: true });
    const contextual = [orgRole(OPERATOR_ID, "viewer", "acme")];
    const result = await h.query.checkMyPermission({
      resource: acme,
      relation: "can_view",
      contextualPolicies: contextual,
    });
    expect(result.isAuthorized).toBe(true);
    const [call] = h.engine?.calls ?? [];
    expect(call?.method).toBe("check");
    const [policy, passed] = call?.args as [IamPolicySpec, IamPolicySpec[]];
    expect(policy.principal?.kind).toBe("identity_account");
    expect(policy.principal?.id).toBe(OPERATOR_ID);
    expect(policy.relation).toBe("can_view");
    expect(policy.resource?.id).toBe("acme");
    expect(passed).toHaveLength(1);
    expect(h.authorizer.checks).toEqual([]);
  });

  it("arm 1: a kind this edition does not serve is false with the Authorizer never consulted (the settings navigation)", async () => {
    const h = await harness({ caller: alice });
    const result = await h.query.checkMyPermission({
      resource: platform,
      relation: "can_manage_model_pricing",
    });
    expect(result.isAuthorized).toBe(false);
    expect(h.authorizer.checks).toEqual([]);
  });

  it("arm 1 does not fire on an edition that serves the kind — enterprise asks its Authorizer about platform", async () => {
    const h = await harness({
      caller: alice,
      edition: ServerEdition.enterprise,
    });
    const result = await h.query.checkMyPermission({
      resource: platform,
      relation: "can_manage_model_pricing",
    });
    expect(result.isAuthorized).toBe(true);
    expect(h.authorizer.checks).toEqual([
      {
        permission: IamPermission.can_manage_model_pricing,
        resourceKind: ApiResourceKind.platform,
        resourceId: "stigmer",
      },
    ]);
  });

  it("arm 2: can_grant_access on a kind outside the scope is false with the Authorizer never consulted; on the organization it is the Authorizer's", async () => {
    const h = await harness({ caller: alice });
    const onAgent = await h.query.checkMyPermission({
      resource: ref("agent", "agt_1"),
      relation: "can_grant_access",
    });
    expect(onAgent.isAuthorized).toBe(false);
    expect(h.authorizer.checks).toEqual([]);
    const onOrg = await h.query.checkMyPermission({
      resource: acme,
      relation: "can_grant_access",
    });
    expect(onOrg.isAuthorized).toBe(true);
    expect(h.authorizer.checks).toEqual([
      {
        permission: IamPermission.can_grant_access,
        resourceKind: ApiResourceKind.organization,
        resourceId: "acme",
      },
    ]);
  });

  it("arm 2 asks only about can_grant_access — can_view_access on an agent reaches the Authorizer", async () => {
    const h = await harness({ caller: alice });
    await h.query.checkMyPermission({
      resource: ref("agent", "agt_1"),
      relation: "can_view_access",
    });
    expect(h.authorizer.checks).toHaveLength(1);
  });

  it("arm 3: deny and not-found are false; unavailable and a throwing Authorizer are INTERNAL, never false", async () => {
    const h = await harness({ caller: alice });
    h.authorizer.decision = { kind: "deny", reason: "" };
    expect(
      (
        await h.query.checkMyPermission({
          resource: acme,
          relation: "can_view",
        })
      ).isAuthorized,
    ).toBe(false);
    h.authorizer.decision = { kind: "not-found" };
    expect(
      (
        await h.query.checkMyPermission({
          resource: acme,
          relation: "can_view",
        })
      ).isAuthorized,
    ).toBe(false);
    h.authorizer.decision = {
      kind: "unavailable",
      cause: new Error("fga down"),
    };
    const unavailable = await refusal(() =>
      h.query.checkMyPermission({ resource: acme, relation: "can_view" }),
    );
    expect(unavailable.code).toBe(Code.Internal);
    expect(unavailable.rawMessage).toBe(AUTHORIZATION_UNAVAILABLE_MESSAGE);
    h.authorizer.decision = () => {
      throw new Error("boom");
    };
    const thrown = await refusal(() =>
      h.query.checkMyPermission({ resource: acme, relation: "can_view" }),
    );
    expect(thrown.code).toBe(Code.Internal);
    expect(thrown.rawMessage).toBe(AUTHORIZATION_UNAVAILABLE_MESSAGE);
  });
});

describe("checkAuthorization's principal-trust rule (the cloud's three refusals verbatim)", () => {
  const acmeAdmin = (principal: { kind: string; id: string }) =>
    triple(principal, "admin", { kind: "organization", id: "acme" });

  it("an empty identity is UNAUTHENTICATED", async () => {
    const h = await harness({ caller: anonymous, engine: true });
    const error = await refusal(() =>
      h.query.checkAuthorization({
        policy: acmeAdmin({ kind: "identity_account", id: ALICE_ID }),
      }),
    );
    expect(error.code).toBe(Code.Unauthenticated);
  });

  it("a user may only ask about an identity account", async () => {
    const h = await harness({ caller: alice, engine: true });
    const error = await refusal(() =>
      h.query.checkAuthorization({
        policy: acmeAdmin({ kind: "team", id: "tm_1" }),
      }),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(
      "Only self identity_account permission checks are supported",
    );
  });

  it("the _self alias is refused with the pointer at checkMyPermission", async () => {
    const h = await harness({ caller: alice, engine: true });
    const error = await refusal(() =>
      h.query.checkAuthorization({
        policy: acmeAdmin({ kind: "identity_account", id: "_self" }),
      }),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(
      "The '_self' principal alias is not supported — use checkMyPermission for self permission checks",
    );
  });

  it("a user asking about another principal is PERMISSION_DENIED", async () => {
    const h = await harness({ caller: alice, engine: true });
    const error = await refusal(() =>
      h.query.checkAuthorization({
        policy: acmeAdmin({ kind: "identity_account", id: "ida_bob" }),
      }),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe("Principal must be the authenticated caller");
    expect(h.engine?.calls).toEqual([]);
  });

  it("a user stamped by EMAIL may ask about their own ACCOUNT id — the trust rule compares accounts, not stamps", async () => {
    const h = await harness({ caller: operator, engine: true });
    const policy = acmeAdmin({ kind: "identity_account", id: OPERATOR_ID });
    const result = await h.query.checkAuthorization({ policy });
    expect(result.isAuthorized).toBe(true);
    expect(h.engine?.calls[0]?.method).toBe("check");
    expect((h.engine?.calls[0]?.args[0] as IamPolicySpec).principal?.id).toBe(
      OPERATOR_ID,
    );
  });

  it("a machine caller may ask about anyone", async () => {
    const h = await harness({ caller: machine, engine: true });
    await h.query.checkAuthorization({
      policy: acmeAdmin({ kind: "identity_account", id: "ida_bob" }),
    });
    expect(h.engine?.calls).toHaveLength(1);
  });

  it("a garbage kind in the policy is INVALID_ARGUMENT before any engine call", async () => {
    const h = await harness({ caller: machine, engine: true });
    const error = await refusal(() =>
      h.query.checkAuthorization({
        policy: acmeAdmin({ kind: "person", id: "x" }),
      }),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(unknownPrincipalKindMessage("person"));
    expect(h.engine?.calls).toEqual([]);
  });

  it("without a composed engine the trusted question is UNIMPLEMENTED with the edition named", async () => {
    const h = await harness({ caller: alice });
    const error = await refusal(() =>
      h.query.checkAuthorization({
        policy: acmeAdmin({ kind: "identity_account", id: ALICE_ID }),
      }),
    );
    expect(error.code).toBe(Code.Unimplemented);
    expect(error.rawMessage).toContain(
      AUTHORIZATION_QUERIES_UNIMPLEMENTED_MESSAGE,
    );
  });
});

describe("the two listings", () => {
  it("listAuthorizedResourceIds: a user may list only for their own account; the engine receives the proto's argument order", async () => {
    const h = await harness({ caller: alice, engine: true });
    const denied = await refusal(() =>
      h.query.listAuthorizedResourceIds({
        principal: ref("identity_account", "ida_bob"),
        resourceKind: "agent",
        relation: "can_view",
      }),
    );
    expect(denied.code).toBe(Code.PermissionDenied);
    const own = await h.query.listAuthorizedResourceIds({
      principal: ref("identity_account", ALICE_ID),
      resourceKind: "agent",
      relation: "can_view",
      contextualPolicies: [orgRole(ALICE_ID, "viewer", "acme")],
    });
    expect(own.resourceIds).toEqual(["r1"]);
    const [call] = h.engine?.calls ?? [];
    expect(call?.method).toBe("listResourceIds");
    expect((call?.args[0] as { id: string }).id).toBe(ALICE_ID);
    expect(call?.args[1]).toBe("can_view");
    expect(call?.args[2]).toBe("agent");
    expect(call?.args[3]).toHaveLength(1);
    expect(h.authorizer.checks).toEqual([]);
  });

  it("listAuthorizedResourceIds: a garbage resource_kind is INVALID_ARGUMENT; no engine, UNIMPLEMENTED", async () => {
    const withEngine = await harness({ caller: alice, engine: true });
    const garbage = await refusal(() =>
      withEngine.query.listAuthorizedResourceIds({
        principal: ref("identity_account", ALICE_ID),
        resourceKind: "Agent",
        relation: "can_view",
      }),
    );
    expect(garbage.code).toBe(Code.InvalidArgument);
    expect(garbage.rawMessage).toBe(unknownResourceKindMessage("Agent"));
    const without = await harness({ caller: alice });
    const missing = await refusal(() =>
      without.query.listAuthorizedResourceIds({
        principal: ref("identity_account", ALICE_ID),
        resourceKind: "agent",
        relation: "can_view",
      }),
    );
    expect(missing.code).toBe(Code.Unimplemented);
  });

  it("listAuthorizedPrincipalIds: the annotation drives the check on the resource; the engine receives the proto's order", async () => {
    const h = await harness({ caller: alice, engine: true });
    const result = await h.query.listAuthorizedPrincipalIds({
      resource: ref("agent", "agt_1"),
      principalKind: "identity_account",
      relation: "can_view",
    });
    expect(result.principalIds).toEqual(["p1"]);
    expect(h.authorizer.checks).toEqual([
      {
        permission: IamPermission.can_view_access,
        resourceKind: ApiResourceKind.agent,
        resourceId: "agt_1",
      },
    ]);
    const [call] = h.engine?.calls ?? [];
    expect(call?.method).toBe("listPrincipalIds");
    expect((call?.args[0] as { id: string }).id).toBe("agt_1");
    expect(call?.args[1]).toBe("can_view");
    expect(call?.args[2]).toBe("identity_account");
  });

  it("listAuthorizedPrincipalIds: a garbage principal_kind is INVALID_ARGUMENT with the principal sentence", async () => {
    const h = await harness({ caller: alice, engine: true });
    const error = await refusal(() =>
      h.query.listAuthorizedPrincipalIds({
        resource: ref("agent", "agt_1"),
        principalKind: "people",
        relation: "can_view",
      }),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(unknownPrincipalKindMessage("people"));
  });
});

describe("the row reads", () => {
  it("get loads THEN authorizes: NOT_FOUND with the pinned copy and no Authorizer call; a found row's resource is the target", async () => {
    const h = await harness({ caller: alice });
    const missing = await refusal(() =>
      h.query.get({ value: "iamp_00000000000000000000000000" }),
    );
    expect(missing.code).toBe(Code.NotFound);
    expect(missing.rawMessage).toBe(
      policyNotFoundMessage("iamp_00000000000000000000000000"),
    );
    expect(h.authorizer.checks).toEqual([]);

    const spec = orgRole(ALICE_ID, "member", "acme");
    await h.command.create(spec);
    h.authorizer.checks.length = 0;
    const got = await h.query.get({ value: policyIdFor(spec) });
    expect(got.spec?.relation).toBe("member");
    expect(h.authorizer.checks).toEqual([
      {
        permission: IamPermission.can_view_access,
        resourceKind: ApiResourceKind.organization,
        resourceId: "acme",
      },
    ]);
    h.authorizer.decision = { kind: "deny", reason: "" };
    const denied = await refusal(() =>
      h.query.get({ value: policyIdFor(spec) }),
    );
    expect(denied.code).toBe(Code.PermissionDenied);
    expect(denied.rawMessage).toBe("unauthorized to view access policies");
  });

  it("listResourceAccessByPrincipal, getPrincipalResourceRoles and getPrincipalsCount refuse a garbage kind", async () => {
    const h = await harness({ caller: alice });
    expect(
      (
        await refusal(() =>
          h.query.listResourceAccessByPrincipal({
            resource: ref("Org", "acme"),
          }),
        )
      ).rawMessage,
    ).toBe(unknownResourceKindMessage("Org"));
    expect(
      (
        await refusal(() =>
          h.query.getPrincipalResourceRoles({
            principal: ref("identity_account", ALICE_ID),
            resource: ref("Org", "acme"),
          }),
        )
      ).rawMessage,
    ).toBe(unknownResourceKindMessage("Org"));
    expect(
      (
        await refusal(() =>
          h.query.getPrincipalsCount({
            org: "acme",
            principalKind: "People",
          }),
        )
      ).rawMessage,
    ).toBe(unknownPrincipalKindMessage("People"));
  });

  it("getPrincipalsCount counts distinct principals over the assignable roles and is authorized on the organization", async () => {
    const h = await harness({ caller: alice });
    await h.command.create(orgRole(ALICE_ID, "admin", "acme"));
    await h.command.create(orgRole(ALICE_ID, "viewer", "acme"));
    await h.command.create(orgRole("ida_bob", "member", "acme"));
    h.authorizer.checks.length = 0;
    const count = await h.query.getPrincipalsCount({
      org: "acme",
      principalKind: "identity_account",
    });
    expect(count.count).toBe(2);
    expect(h.authorizer.checks).toEqual([
      {
        permission: IamPermission.can_view_access,
        resourceKind: ApiResourceKind.organization,
        resourceId: "acme",
      },
    ]);
  });

  it("listResourceAccessByPrincipal enriches the operator's row through the account port with the Q-S5-4 name", async () => {
    const h = await harness({ caller: machine });
    await h.command.create(orgRole(OPERATOR_ID, "owner", "acme"));
    const access = await h.query.listResourceAccessByPrincipal({
      resource: ref("organization", "acme"),
    });
    expect(access.entries).toHaveLength(1);
    expect(access.entries[0]?.principal?.name).toBe("The Operator");
    expect(access.entries[0]?.principal?.email).toBe(OPERATOR_EMAIL);
    expect(access.entries[0]?.roles.map((g) => g.role?.code)).toEqual([
      "owner",
    ]);
  });
});

describe("the write lanes' order", () => {
  it("delete authorizes BEFORE it loads: a denied caller hears PERMISSION_DENIED even for an absent triple (Q-OR-2)", async () => {
    const h = await harness({ caller: alice });
    h.authorizer.decision = { kind: "deny", reason: "" };
    const error = await refusal(() =>
      h.command.delete(orgRole("ida_nobody", "member", "acme")),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe("unauthorized to revoke access");
  });

  it("create validates the role BEFORE the write: a held row under a non-grantable role is INVALID_ARGUMENT, not the duplicate (the cloud's order, Q-S5-1)", async () => {
    const h = await harness({ caller: alice });
    const legacy = orgRole(ALICE_ID, "editor", "acme");
    await h.policies.save(
      create(IamPolicySchema, {
        metadata: { id: policyIdFor(legacy) },
        spec: legacy,
      }),
    );
    const error = await refusal(() => h.command.create(legacy));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(
      roleNotGrantableMessage("editor", "organization", [
        "owner",
        "admin",
        "member",
        "viewer",
      ]),
    );
  });

  it("create's target is the spec's resource, read by the annotation; revokeOrgAccess's is the organization", async () => {
    const h = await harness({ caller: alice });
    await h.command.create(orgRole(ALICE_ID, "member", "acme"));
    await h.command.revokeOrgAccess({
      identityAccountId: ALICE_ID,
      org: "acme",
    });
    expect(h.authorizer.checks).toEqual([
      {
        permission: IamPermission.can_grant_access,
        resourceKind: ApiResourceKind.organization,
        resourceId: "acme",
      },
      {
        permission: IamPermission.can_grant_access,
        resourceKind: ApiResourceKind.organization,
        resourceId: "acme",
      },
    ]);
    expect(h.policies.rows.size).toBe(0);
  });

  it("create grants to people only: an organization as the principal is INVALID_ARGUMENT after position 1, and no row is written (Q-S9-2)", async () => {
    // The row a person could otherwise write — organization:other holds
    // `member` on organization:acme — is exactly what findScopeTuple reads
    // as acme's structural parent, so the hierarchy walk would have listed
    // the other organization's members on acme's Members page. The
    // Authorizer IS consulted (the caller's right on acme is real); the
    // refusal is the step's, after it.
    const h = await harness({ caller: alice });
    const link = triple({ kind: "organization", id: "other" }, "member", {
      kind: "organization",
      id: "acme",
    });
    const error = await refusal(() => h.command.create(link));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(principalNotGrantableMessage("organization"));
    expect(h.authorizer.checks).toHaveLength(1);
    expect(h.policies.rows.size).toBe(0);
  });

  it("the same shape through bootstrapPolicy is a structural link and is admitted — the two lanes split on who the principal is", async () => {
    const h = await harness({ caller: internal });
    const link = triple({ kind: "organization", id: "other" }, "member", {
      kind: "organization",
      id: "acme",
    });
    const seeded = await h.command.bootstrapPolicy(link);
    expect(seeded.metadata?.id).toBe(policyIdFor(link));
    expect(h.policies.rows.size).toBe(1);
  });

  it("a scope that narrows the organization's roles is honoured by create", async () => {
    const viewerOnly: PolicyGrantScope = {
      grantableRoles: (kind) =>
        kind === ApiResourceKind.organization ? [IamRole.viewer] : [],
    };
    const h = await harness({ caller: alice, scope: viewerOnly });
    const error = await refusal(() =>
      h.command.create(orgRole(ALICE_ID, "admin", "acme")),
    );
    expect(error.rawMessage).toBe(
      roleNotGrantableMessage("admin", "organization", ["viewer"]),
    );
  });

  it("create runs the iam-policy-create gate slot after the role check and before the write; a refusing gate leaves no row", async () => {
    const seen: string[] = [];
    const refusingGate: PipelineStep<DescMessage> = {
      name: "RefuseForTest",
      execute() {
        seen.push("gate");
        throw new ConnectError("refused by the gate", Code.FailedPrecondition);
      },
    };
    const h = await harness({ caller: alice, createGate: refusingGate });
    // A role the step refuses never reaches the gate.
    await refusal(() => h.command.create(orgRole(ALICE_ID, "editor", "acme")));
    expect(seen).toEqual([]);
    const error = await refusal(() =>
      h.command.create(orgRole(ALICE_ID, "member", "acme")),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe("refused by the gate");
    expect(seen).toEqual(["gate"]);
    expect(h.policies.rows.size).toBe(0);
  });

  it("bootstrapPolicy, the platform's structural lane, never runs the create gate slot", async () => {
    const seen: string[] = [];
    const h = await harness({
      caller: internal,
      createGate: {
        name: "RecordForTest",
        execute() {
          seen.push("gate");
        },
      },
    });
    await h.command.bootstrapPolicy(orgRole(ALICE_ID, "member", "acme"));
    expect(seen).toEqual([]);
    expect(h.policies.rows.size).toBe(1);
  });
});

describe("owner is assigned by owners, on the three caller lanes", () => {
  /** alice is an admin of acme: she may grant access there, and may not assign owner. */
  const adminOfAcme = (check: AuthzCheck): AuthzDecision =>
    check.permission === IamPermission.can_assign_roles
      ? { kind: "deny", reason: "" }
      : { kind: "allow" };
  const assignRolesOnAcme: AuthzCheck = {
    permission: IamPermission.can_assign_roles,
    resourceKind: ApiResourceKind.organization,
    resourceId: "acme",
  };

  /** acme's roles, written straight through the grant path under the harness's store. */
  async function acmeWith(
    h: Harness,
    roles: ReadonlyArray<readonly [string, string]>,
  ): Promise<void> {
    const path = newIamPolicyGrantPath({
      resources: NO_STORED_RESOURCES,
      policies: h.policies,
      lifecycle: undefined,
      logger: silent,
    });
    for (const [account, role] of roles) {
      await path.grant(orgRole(account, role, "acme"), internal, "grant");
    }
  }

  it("an admin is refused granting owner, after the role check and before the gate and the write", async () => {
    const seen: string[] = [];
    const h = await harness({
      caller: alice,
      createGate: { name: "RecordForTest", execute: () => void seen.push("gate") },
    });
    h.authorizer.decision = adminOfAcme;
    const error = await refusal(() => h.command.create(orgRole("ida_bob", "owner", "acme")));
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(OWNER_ASSIGNMENT_DENIED_MESSAGE);
    expect(h.authorizer.checks.at(-1)).toEqual(assignRolesOnAcme);
    expect(seen).toEqual([]);
    expect(h.policies.rows.size).toBe(0);

    // Every role up to admin is still hers to grant, and asks nothing more.
    await h.command.create(orgRole("ida_bob", "admin", "acme"));
    expect(h.authorizer.checks.at(-1)?.permission).toBe(IamPermission.can_grant_access);
  });

  it("an admin is refused revoking owner and removing an owner, and neither row moves", async () => {
    const asAlice = await harness({ caller: alice });
    await acmeWith(asAlice, [["ida_root", "owner"], ["ida_rhea", "owner"]]);
    asAlice.authorizer.decision = adminOfAcme;

    const revoke = await refusal(() => asAlice.command.delete(orgRole("ida_rhea", "owner", "acme")));
    expect(revoke.code).toBe(Code.PermissionDenied);
    expect(revoke.rawMessage).toBe(OWNER_ASSIGNMENT_DENIED_MESSAGE);
    const remove = await refusal(() =>
      asAlice.command.revokeOrgAccess({ identityAccountId: "ida_rhea", org: "acme" }),
    );
    expect(remove.code).toBe(Code.PermissionDenied);
    expect(remove.rawMessage).toBe(OWNER_ASSIGNMENT_DENIED_MESSAGE);
    expect(asAlice.policies.rows.size).toBe(2);
  });

  it("an owner grants, revokes and removes owner, but never the last one", async () => {
    const h = await harness({ caller: alice });
    await acmeWith(h, [["ida_alice", "owner"]]);

    await h.command.create(orgRole("ida_bob", "owner", "acme"));
    await h.command.delete(orgRole("ida_bob", "owner", "acme"));
    await h.command.create(orgRole("ida_bob", "owner", "acme"));
    await h.command.revokeOrgAccess({ identityAccountId: "ida_bob", org: "acme" });
    expect([...h.policies.rows.values()].map((row) => row.spec?.principal?.id)).toEqual(["ida_alice"]);

    const revoke = await refusal(() => h.command.delete(orgRole("ida_alice", "owner", "acme")));
    expect(revoke.code).toBe(Code.FailedPrecondition);
    expect(revoke.rawMessage).toBe(LAST_OWNER_MESSAGE);
    const remove = await refusal(() =>
      h.command.revokeOrgAccess({ identityAccountId: "ida_alice", org: "acme" }),
    );
    expect(remove.code).toBe(Code.FailedPrecondition);
    expect(remove.rawMessage).toBe(LAST_OWNER_MESSAGE);
    expect(h.policies.rows.size).toBe(1);
  });

  it("the bootstrap twins run neither owner step: the platform removes the last owner", async () => {
    const h = await harness({ caller: machine });
    await acmeWith(h, [["ida_root", "owner"]]);
    h.authorizer.decision = adminOfAcme;
    await h.command.bootstrapRevokeOrgAccess({ identityAccountId: "ida_root", org: "acme" });
    expect(h.policies.rows.size).toBe(0);
    expect(h.authorizer.checks.map((check) => check.permission)).not.toContain(IamPermission.can_assign_roles);
  });
});

describe("a wire kind string is refused BEFORE position 1 on every annotated lane (Q-S6-1)", () => {
  // A kind string that names no kind names no authorization target, so
  // there is nothing to ask the Authorizer — the same reason
  // checkMyPermission refuses an unknown permission name first, and the
  // order the cloud's handlers kept (kindFromSpecString before
  // authorizeRpc). The Authorizer here DENIES everything: were it asked,
  // the answer would be PERMISSION_DENIED, so the INVALID_ARGUMENT and the
  // empty check log together pin the order.
  const cases: ReadonlyArray<
    [name: string, copy: string, call: (h: Harness) => Promise<unknown>]
  > = [
    [
      "create",
      unknownResourceKindMessage("Organization"),
      (h) =>
        h.command.create(
          triple({ kind: "identity_account", id: ALICE_ID }, "member", {
            kind: "Organization",
            id: "acme",
          }),
        ),
    ],
    [
      "delete",
      unknownResourceKindMessage("Organization"),
      (h) =>
        h.command.delete(
          triple({ kind: "identity_account", id: ALICE_ID }, "member", {
            kind: "Organization",
            id: "acme",
          }),
        ),
    ],
    [
      "listAuthorizedPrincipalIds",
      unknownResourceKindMessage("Organization"),
      (h) =>
        h.query.listAuthorizedPrincipalIds({
          resource: ref("Organization", "acme"),
          principalKind: "identity_account",
          relation: "can_view",
        }),
    ],
    [
      "listResourceAccessByPrincipal",
      unknownResourceKindMessage("Organization"),
      (h) =>
        h.query.listResourceAccessByPrincipal({
          resource: ref("Organization", "acme"),
        }),
    ],
    [
      "getPrincipalResourceRoles",
      unknownResourceKindMessage("Organization"),
      (h) =>
        h.query.getPrincipalResourceRoles({
          principal: ref("identity_account", ALICE_ID),
          resource: ref("Organization", "acme"),
        }),
    ],
    [
      "getPrincipalsCount",
      unknownPrincipalKindMessage("People"),
      (h) =>
        h.query.getPrincipalsCount({ org: "acme", principalKind: "People" }),
    ],
  ];

  for (const [name, copy, call] of cases) {
    it(`${name}: INVALID_ARGUMENT with the pinned copy and the Authorizer never consulted`, async () => {
      const h = await harness({ caller: alice });
      h.authorizer.decision = { kind: "deny", reason: "" };
      const error = await refusal(() => call(h));
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe(copy);
      expect(h.authorizer.checks).toEqual([]);
    });
  }
});
