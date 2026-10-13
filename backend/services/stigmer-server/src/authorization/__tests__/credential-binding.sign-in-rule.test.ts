/**
 * The credential binding's organization sign-in rule
 * (../credential-binding.ts, extensions/organization-sign-in-rule.ts): an
 * organization may require that the people acting in it signed in a
 * particular way, and the binding asks the composed rule.
 *
 * What it pins:
 *   - the rule only refuses, and only after the inner driver allowed: an
 *     inner deny stays the inner deny and the rule is never asked, so a
 *     refusal never tells an outsider a target exists;
 *   - a refused person's denial carries the rule's refusal, bound or not
 *     (a platform account's key bound to the organization is refused too);
 *   - only people are asked: a service account, a run and the server
 *     itself are never refused;
 *   - a target's organization: the organization itself, a row's own, an
 *     organization's service account's; a person's own account and an API
 *     key belong to none and are never refused;
 *   - no rule, or no organization requiring anything, reads nothing more
 *     and answers the inner driver's answer;
 *   - the rule is asked once per organization per caller object, a failed
 *     answer is asked again, and a fault is `unavailable`, never an allow;
 *   - the list read scope drops a refused person's candidates and ids
 *     inside the organization, and keeps the organization's own row;
 *   - `signInRefusal`, the seat for lanes without the Authorizer, answers
 *     the rule's refusal by organization.
 */
import type { Message } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
  AuthzRefusal,
} from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type {
  ListEntryMeta,
  ListReadScope,
} from "../../extensions/list-read-scope.js";
import type { OrganizationSignInRule } from "../../extensions/organization-sign-in-rule.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import {
  bindAuthorizer,
  bindListReadScope,
  newCredentialBinding,
} from "../credential-binding.js";
import type { CredentialBindingDeps } from "../credential-binding.js";
import { fixtureRow, storedDeclaration } from "./support.js";

const ACME = "org_acme";
const OTHER = "org_other";

const email: CallerIdentity = {
  identityId: "ida_raj_email",
  callerClass: "user",
  issuer: "",
  rawToken: "stk_raj",
};

const REFUSAL: AuthzRefusal = {
  reason: "SSO_REQUIRED",
  message: "This organization requires you to sign in through Acme Okta.",
  metadata: { org: ACME, provider: "acme-okta" },
};

function row(type: string, id: string, org: string): {
  kind: ApiResourceKind;
  id: string;
  row: Message;
} {
  const declaration = storedDeclaration(type);
  return {
    kind: declaration.kind,
    id,
    row: fixtureRow(declaration, {
      id,
      org,
      visibility: ApiResourceVisibility.visibility_org,
      createdBy: "ida_bob",
    }),
  };
}

const ROWS = [
  row("agent", "agt_acme", ACME),
  row("agent", "agt_other", OTHER),
  row("session", "ses_acme", ACME),
];

/** A rule that requires sign-in in `requiring` and refuses every person but `admitted`. */
function rule(
  requiring: ReadonlyArray<string>,
  admitted: ReadonlySet<string> = new Set(),
): OrganizationSignInRule & { asked: string[]; failNext(): void } {
  const asked: string[] = [];
  let fail = false;
  return {
    asked,
    failNext: () => {
      fail = true;
    },
    requiringOrgs: () => Promise.resolve(new Set(requiring)),
    refusal(caller, org) {
      asked.push(`${caller.identityId}@${org}`);
      if (fail) {
        fail = false;
        return Promise.reject(new Error("rule store unavailable"));
      }
      return Promise.resolve(admitted.has(caller.identityId) ? undefined : REFUSAL);
    },
  };
}

function deps(
  signInRule: OrganizationSignInRule | undefined,
): { readonly deps: CredentialBindingDeps; readonly reads: string[] } {
  const byKey = new Map(ROWS.map((r) => [`${r.kind}:${r.id}`, r.row]));
  const reads: string[] = [];
  const getResource = (kind: ApiResourceKind, id: string): Promise<Message> => {
    reads.push(`${ApiResourceKind[kind]}:${id}`);
    const found = byKey.get(`${kind}:${id}`);
    return found === undefined
      ? Promise.reject(new ResourceNotFoundError(`${kind}:${id}`))
      : Promise.resolve(found);
  };
  const accounts = [
    create(IdentityAccountSchema, {
      metadata: { id: "ida_acme_robot", org: ACME },
      spec: {
        idpId: "stgm_sa|acme|01",
        provisioningMode: IdentityAccountProvisioningMode.service_account,
      },
    }),
    create(IdentityAccountSchema, {
      metadata: { id: "ida_raj_email" },
      spec: { idpId: "auth0|raj", provisioningMode: IdentityAccountProvisioningMode.direct },
    }),
  ];
  return {
    reads,
    deps: {
      // The fixture rows were built with each kind's own schema; the cast
      // only drops the generic decode.
      store: { getResource } as unknown as Pick<Store, "getResource">,
      policies: { findById: () => Promise.resolve(undefined) },
      platformClients: { findById: () => Promise.resolve(undefined) },
      identityAccounts: {
        findById: (id) => Promise.resolve(accounts.find((a) => a.metadata?.id === id)),
      },
      ...(signInRule === undefined ? {} : { signInRule }),
    },
  };
}

function allowing(answer: AuthzDecision = { kind: "allow" }): Authorizer & {
  checks: AuthzCheck[];
} {
  const checks: AuthzCheck[] = [];
  return {
    checks,
    authorize(_caller, check) {
      checks.push(check);
      return Promise.resolve(answer);
    },
  };
}

function on(kind: ApiResourceKind, id: string): AuthzCheck {
  return { permission: IamPermission.can_view, resourceKind: kind, resourceId: id };
}

describe("the sign-in rule on the bound Authorizer", () => {
  it("turns an allow inside a requiring organization into the rule's refusal", async () => {
    const acme = rule([ACME]);
    const bound = bindAuthorizer(allowing(), newCredentialBinding(deps(acme).deps));
    expect(await bound.authorize(email, on(ApiResourceKind.agent, "agt_acme"))).toEqual({
      kind: "deny",
      reason: REFUSAL.message,
      refusal: REFUSAL,
    });
    expect(acme.asked).toEqual([`ida_raj_email@${ACME}`]);
  });

  it("never asks the rule after an inner denial, so a refusal tells an outsider nothing", async () => {
    const acme = rule([ACME]);
    const inner = allowing({ kind: "deny", reason: "not yours" });
    const bound = bindAuthorizer(inner, newCredentialBinding(deps(acme).deps));
    expect(await bound.authorize(email, on(ApiResourceKind.agent, "agt_acme"))).toEqual({
      kind: "deny",
      reason: "not yours",
    });
    expect(
      await bindAuthorizer(
        allowing({ kind: "not-found" }),
        newCredentialBinding(deps(acme).deps),
      ).authorize(email, on(ApiResourceKind.agent, "agt_gone")),
    ).toEqual({ kind: "not-found" });
    expect(acme.asked).toEqual([]);
  });

  it("admits the person the rule admits, and every target outside the requiring organization", async () => {
    const acme = rule([ACME], new Set(["ida_raj_email"]));
    const bound = bindAuthorizer(allowing(), newCredentialBinding(deps(acme).deps));
    expect(await bound.authorize(email, on(ApiResourceKind.agent, "agt_acme"))).toEqual({
      kind: "allow",
    });
    const strict = rule([ACME]);
    const other = bindAuthorizer(allowing(), newCredentialBinding(deps(strict).deps));
    expect(await other.authorize(email, on(ApiResourceKind.agent, "agt_other"))).toEqual({
      kind: "allow",
    });
    expect(strict.asked).toEqual([]);
  });

  it("refuses a credential bound to the requiring organization too", async () => {
    const acme = rule([ACME]);
    const bound = bindAuthorizer(allowing(), newCredentialBinding(deps(acme).deps));
    const key: CallerIdentity = { ...email, boundOrg: ACME };
    const decision = await bound.authorize(key, on(ApiResourceKind.session, "ses_acme"));
    expect(decision).toMatchObject({ kind: "deny", refusal: REFUSAL });
  });

  it("refuses the organization itself and its service accounts, never a person's own account or key", async () => {
    const acme = rule([ACME]);
    const bound = bindAuthorizer(allowing(), newCredentialBinding(deps(acme).deps));
    expect(await bound.authorize(email, on(ApiResourceKind.organization, ACME))).toMatchObject({
      kind: "deny",
      refusal: REFUSAL,
    });
    expect(
      await bound.authorize(email, on(ApiResourceKind.identity_account, "ida_acme_robot")),
    ).toMatchObject({ kind: "deny", refusal: REFUSAL });
    expect(
      await bound.authorize(email, on(ApiResourceKind.identity_account, "ida_raj_email")),
    ).toEqual({ kind: "allow" });
    expect(await bound.authorize(email, on(ApiResourceKind.api_key, "key_raj"))).toEqual({
      kind: "allow",
    });
  });

  it("asks about people only, whatever the transport", async () => {
    const acme = rule([ACME]);
    const bound = bindAuthorizer(allowing(), newCredentialBinding(deps(acme).deps));
    for (const callerClass of ["service_account", "runner", "machine", "internal", "schedule"]) {
      expect(
        await bound.authorize({ ...email, callerClass }, on(ApiResourceKind.agent, "agt_acme")),
      ).toEqual({ kind: "allow" });
    }
    expect(acme.asked).toEqual([]);
    const composed: CallerIdentity = { ...email, origin: "in-process" };
    expect(await bound.authorize(composed, on(ApiResourceKind.agent, "agt_acme"))).toMatchObject({
      kind: "deny",
      refusal: REFUSAL,
    });
  });

  it("reads nothing more with no rule, or while no organization requires anything", async () => {
    for (const signInRule of [undefined, rule([])]) {
      const f = deps(signInRule);
      const inner = allowing();
      const bound = bindAuthorizer(inner, newCredentialBinding(f.deps));
      expect(await bound.authorize(email, on(ApiResourceKind.agent, "agt_acme"))).toEqual({
        kind: "allow",
      });
      expect(f.reads).toEqual([]);
    }
  });

  it("asks the rule once per organization per caller, and again after a failure, which is unavailable", async () => {
    const acme = rule([ACME]);
    const binding = newCredentialBinding(deps(acme).deps);
    const bound = bindAuthorizer(allowing(), binding);
    await bound.authorize(email, on(ApiResourceKind.agent, "agt_acme"));
    await bound.authorize(email, on(ApiResourceKind.session, "ses_acme"));
    expect(acme.asked).toHaveLength(1);

    const failing = rule([ACME]);
    const flaky = bindAuthorizer(allowing(), newCredentialBinding(deps(failing).deps));
    const caller: CallerIdentity = { ...email };
    failing.failNext();
    expect((await flaky.authorize(caller, on(ApiResourceKind.agent, "agt_acme"))).kind).toBe(
      "unavailable",
    );
    expect(await flaky.authorize(caller, on(ApiResourceKind.agent, "agt_acme"))).toMatchObject({
      kind: "deny",
      refusal: REFUSAL,
    });
    expect(failing.asked).toHaveLength(2);
  });
});

describe("the sign-in rule on the bound list read scope", () => {
  function everything(ids: ReadonlyArray<string>): ListReadScope {
    return {
      authorizedResourceIds: () => Promise.resolve(new Set(ids)),
      restrictListEntries: (_caller, _kind, entries) =>
        Promise.resolve(new Set(entries.map((entry) => entry.id))),
    };
  }
  function entry(id: string, org: string): ListEntryMeta {
    return {
      id,
      org,
      visibility: ApiResourceVisibility.visibility_org,
      createdBy: "",
      parentLinks: [],
      labels: {},
    };
  }

  it("drops a refused person's entries inside the organization and keeps the rest", async () => {
    const scope = bindListReadScope(
      everything([]),
      newCredentialBinding(deps(rule([ACME])).deps),
    );
    expect(
      await scope.restrictListEntries(email, ApiResourceKind.agent, [
        entry("agt_acme", ACME),
        entry("agt_other", OTHER),
      ]),
    ).toEqual(new Set(["agt_other"]));
  });

  it("keeps the organization's own row, so the person sees it exists", async () => {
    const scope = bindListReadScope(
      everything([ACME, OTHER]),
      newCredentialBinding(deps(rule([ACME])).deps),
    );
    expect(
      await scope.restrictListEntries(email, ApiResourceKind.organization, [
        entry(ACME, ""),
        entry(OTHER, ""),
      ]),
    ).toEqual(new Set([ACME, OTHER]));
    expect(await scope.authorizedResourceIds(email, ApiResourceKind.organization)).toEqual(
      new Set([ACME, OTHER]),
    );
  });

  it("drops a refused person's enumerated ids inside the organization, by each id's row", async () => {
    const f = deps(rule([ACME]));
    const scope = bindListReadScope(
      everything(["agt_acme", "agt_other"]),
      newCredentialBinding(f.deps),
    );
    expect(await scope.authorizedResourceIds(email, ApiResourceKind.agent)).toEqual(
      new Set(["agt_other"]),
    );
    expect(f.reads.sort()).toEqual(["agent:agt_acme", "agent:agt_other"]);
  });

  it("keeps an admitted person's entries whole", async () => {
    const scope = bindListReadScope(
      everything(["agt_acme"]),
      newCredentialBinding(deps(rule([ACME], new Set(["ida_raj_email"]))).deps),
    );
    expect(await scope.authorizedResourceIds(email, ApiResourceKind.agent)).toEqual(
      new Set(["agt_acme"]),
    );
  });
});

describe("signInRefusal, the seat for lanes without the Authorizer", () => {
  it("answers the rule's refusal in a requiring organization and nothing elsewhere", async () => {
    const binding = newCredentialBinding(deps(rule([ACME])).deps);
    expect(await binding.signInRefusal(email, ACME)).toEqual(REFUSAL);
    expect(await binding.signInRefusal(email, OTHER)).toBeUndefined();
    expect(
      await binding.signInRefusal({ ...email, callerClass: "service_account" }, ACME),
    ).toBeUndefined();
    expect(
      await newCredentialBinding(deps(undefined).deps).signInRefusal(email, ACME),
    ).toBeUndefined();
  });
});
