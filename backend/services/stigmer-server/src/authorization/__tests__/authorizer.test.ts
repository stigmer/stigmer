/**
 * Pins the built-in Authorizer arm by arm, on both store drivers, against
 * the cloud's driver it mirrors (stigmer-cloud src/authorizer/
 * fga-authorizer.ts): the four pre-check denials with the Java copy; the
 * unserved-kind denial (the server-side half of "nobody sets public
visibility on a self-host"); not-found for a
 * missing target and a DENIAL for a missing row of an exempt kind (the
 * cloud's probe scope, so account ids cannot be enumerated); allow and
 * deny from the model over a seeded organization — the owner, an admin, a
 * member, an outsider, an unprovisioned subject; the alias rule (a row
 * stamped with the raw subject, read by the caller the verifier resolved
 * to the account); an empty reason on a model denial so the annotation's
 * copy wins; and every fault — a store outage, a person that names
 * nobody, a broken model — as `unavailable` with its cause, never a
 * denial and never a throw. The read count of one blueprint check is
 * pinned as the cost the plan states.
 */
import { create } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import { createLogger } from "../../boot/logger.js";
import {
  IAM_POLICY_API_VERSION,
  IAM_POLICY_KIND,
  policyIdFor,
} from "../../domain/iampolicy/constants.js";
import { newResourceIamPolicyStore } from "../../domain/iampolicy/resource-store.js";
import type { IamPolicyStore } from "../../domain/iampolicy/store.js";
import { orgRole } from "../../domain/iampolicy/__tests__/support.js";
import { accountIdFor } from "../../domain/identityaccount/constants.js";
import { newResourceIdentityAccountStore } from "../../domain/identityaccount/resource-store.js";
import type { IdentityAccountStore } from "../../domain/identityaccount/store.js";
import type { AuthzCheck, AuthzDecision } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { Store } from "../../store/interface.js";
import {
  EMPTY_IDENTITY_DENY_REASON,
  EMPTY_RESOURCE_ID_DENY_REASON,
  NOT_FOUND_EXEMPT_KINDS,
  UNKNOWN_KIND_DENY_REASON,
  UNKNOWN_PERMISSION_DENY_REASON,
  UNSERVED_KIND_DENY_REASON,
  newBuiltInAuthorizer,
} from "../authorizer.js";
import { builtInModel, newModel } from "../model/index.js";
import type { KindDeclaration } from "../model/rewrite.js";
import { computed, declareKind } from "../model/rewrite.js";
import { driverFixtures, dropPostgresFixture } from "./drivers.js";
import type { OpenedStore } from "./drivers.js";
import { fixtureRow } from "./support.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

// The people. Each has a subject and the account the subject derives.
const FOUNDER = person("auth0|founder");
const ADMIN = person("auth0|admin");
const MEMBER = person("auth0|member");
const OUTSIDER = person("auth0|outsider");
const STRANGER = person("auth0|stranger"); // never provisioned

function person(subject: string) {
  return { subject, accountId: accountIdFor(subject) };
}

/** A caller a verifier resolved to the account (the OSS verifiers' shape). */
function resolved(who: { accountId: string }): CallerIdentity {
  return {
    identityId: who.accountId,
    callerClass: "user",
    issuer: "https://issuer.example",
    rawToken: "opaque",
  };
}

/** A caller left idp-shaped, carrying `sub` in a decodable token (a composition verifier's shape; an unprovisioned subject). */
function idpShaped(who: { subject: string }): CallerIdentity {
  const payload = Buffer.from(JSON.stringify({ sub: who.subject })).toString(
    "base64url",
  );
  return {
    identityId: who.subject,
    callerClass: "user",
    issuer: "https://issuer.example",
    rawToken: `h.${payload}.unsigned`,
  };
}

function check(
  permission: IamPermission,
  resourceKind: ApiResourceKind,
  resourceId: string,
): AuthzCheck {
  return { permission, resourceKind, resourceId };
}

function declared(type: string): KindDeclaration {
  const declaration = builtInModel.byType(type);
  if (declaration === undefined) {
    throw new Error(`${type} is declared`);
  }
  return declaration;
}

const SEEDED_KINDS: ReadonlyArray<ApiResourceKind> = [
  ApiResourceKind.iam_policy,
  ApiResourceKind.identity_account,
  ApiResourceKind.organization,
  ApiResourceKind.agent,
  ApiResourceKind.session,
  ApiResourceKind.oauth_app,
];

afterAll(dropPostgresFixture);

describe("NOT_FOUND_EXEMPT_KINDS", () => {
  it("is the cloud's probe exemption restricted to the kinds this edition serves — identity_account, iam_policy and platform_client", () => {
    expect([...NOT_FOUND_EXEMPT_KINDS].sort()).toEqual(
      [
        ApiResourceKind.identity_account,
        ApiResourceKind.iam_policy,
        ApiResourceKind.platform_client,
      ].sort(),
    );
  });
});

describe.each(driverFixtures(SEEDED_KINDS))(
  "the built-in Authorizer on $name",
  (fixture) => {
    describe.skipIf(fixture.skip)("authorize", () => {
      let opened: OpenedStore;
      let policies: IamPolicyStore;
      let accounts: IdentityAccountStore;
      let storeReads: number;

      /** The generic store with its reads counted (the cost pin). */
      function countingStore(inner: Store): Store {
        return {
          ...inner,
          getResource(kind, id, schema) {
            storeReads += 1;
            return inner.getResource(kind, id, schema);
          },
        };
      }

      function authorizer(
        overrides: { store?: Store; edition?: ServerEdition } = {},
      ) {
        return newBuiltInAuthorizer({
          store: overrides.store ?? countingStore(opened.store),
          policies,
          accounts,
          edition: overrides.edition ?? ServerEdition.oss,
          logger: silentLogger,
        });
      }

      async function provision(who: { subject: string; accountId: string }) {
        await accounts.save(
          create(IdentityAccountSchema, {
            metadata: { id: who.accountId, name: who.subject },
            spec: {
              idpId: who.subject,
              provisioningMode: IdentityAccountProvisioningMode.direct,
            },
          }),
        );
      }

      async function grant(spec: ReturnType<typeof orgRole>) {
        await policies.save(
          create(IamPolicySchema, {
            apiVersion: IAM_POLICY_API_VERSION,
            kind: IAM_POLICY_KIND,
            metadata: { id: policyIdFor(spec) },
            spec,
          }),
        );
      }

      async function seed(
        type: string,
        id: string,
        facts: {
          org: string;
          visibility: ApiResourceVisibility;
          createdBy: string;
          spec?: Record<string, unknown>;
        },
      ) {
        const declaration = declared(type);
        await opened.store.saveResource(
          declaration.kind,
          id,
          declaration.schema,
          fixtureRow(declaration, { id, ...facts }),
        );
      }

      beforeEach(async () => {
        opened = await fixture.open();
        storeReads = 0;
        policies = newResourceIamPolicyStore(opened.store);
        accounts = newResourceIdentityAccountStore(opened.store);
        for (const who of [FOUNDER, ADMIN, MEMBER, OUTSIDER]) {
          await provision(who);
        }
        await seed("organization", "acme", {
          org: "",
          visibility: ApiResourceVisibility.visibility_private,
          createdBy: FOUNDER.accountId,
        });
        await grant(orgRole(FOUNDER.accountId, "owner", "acme"));
        await grant(orgRole(ADMIN.accountId, "admin", "acme"));
        await grant(orgRole(MEMBER.accountId, "member", "acme"));
        // The founder's blueprints: one private, one org-visible, one
        // public; the org-visible one stamped with the founder's RAW
        // subject (a row a 3.14.x verifier wrote), the others with the id.
        await seed("agent", "agt_private", {
          org: "acme",
          visibility: ApiResourceVisibility.visibility_private,
          createdBy: FOUNDER.accountId,
        });
        await seed("agent", "agt_org", {
          org: "acme",
          visibility: ApiResourceVisibility.visibility_org,
          createdBy: FOUNDER.subject,
        });
        await seed("agent", "agt_public", {
          org: "acme",
          visibility: ApiResourceVisibility.visibility_public,
          createdBy: FOUNDER.accountId,
        });
        // The member's own session — personal: nobody else reads it.
        await seed("session", "ses_member", {
          org: "acme",
          visibility: ApiResourceVisibility.api_resource_visibility_unspecified,
          createdBy: MEMBER.accountId,
        });
      });

      afterEach(async () => {
        await opened.close();
      });

      describe("the pre-check arms, in the cloud's order and copy", () => {
        it.each([
          [
            "an unspecified permission",
            resolved(FOUNDER),
            check(
              IamPermission.unspecified,
              ApiResourceKind.agent,
              "agt_private",
            ),
            UNKNOWN_PERMISSION_DENY_REASON,
          ],
          [
            "an empty identity",
            { ...resolved(FOUNDER), identityId: "" },
            check(IamPermission.can_view, ApiResourceKind.agent, "agt_private"),
            EMPTY_IDENTITY_DENY_REASON,
          ],
          [
            "an empty resource id",
            resolved(FOUNDER),
            check(IamPermission.can_view, ApiResourceKind.agent, ""),
            EMPTY_RESOURCE_ID_DENY_REASON,
          ],
          [
            "the unknown kind",
            resolved(FOUNDER),
            check(
              IamPermission.can_view,
              ApiResourceKind.api_resource_kind_unknown,
              "x",
            ),
            UNKNOWN_KIND_DENY_REASON,
          ],
          [
            "a kind this edition does not serve (platform — nobody sets public visibility)",
            resolved(FOUNDER),
            check(
              IamPermission.can_set_public_visibility,
              ApiResourceKind.platform,
              "stigmer",
            ),
            UNSERVED_KIND_DENY_REASON,
          ],
        ])(
          "%s is a deny with the reason",
          async (_label, caller, c, reason) => {
            expect(await authorizer().authorize(caller, c)).toEqual({
              kind: "deny",
              reason,
            });
            expect(storeReads, "no row was read").toBe(0);
          },
        );
      });

      describe("the model's answers", () => {
        it("the owner reads and edits their private agent; an admin reads and edits it; a member reads neither way", async () => {
          const view = check(
            IamPermission.can_view,
            ApiResourceKind.agent,
            "agt_private",
          );
          const edit = check(
            IamPermission.can_edit,
            ApiResourceKind.agent,
            "agt_private",
          );
          const auth = authorizer();
          expect(await auth.authorize(resolved(FOUNDER), view)).toEqual({
            kind: "allow",
          });
          expect(await auth.authorize(resolved(FOUNDER), edit)).toEqual({
            kind: "allow",
          });
          expect(await auth.authorize(resolved(ADMIN), view)).toEqual({
            kind: "allow",
          });
          expect(await auth.authorize(resolved(ADMIN), edit)).toEqual({
            kind: "allow",
          });
          expect(await auth.authorize(resolved(MEMBER), view)).toEqual({
            kind: "deny",
            reason: "",
          });
          expect(await auth.authorize(resolved(MEMBER), edit)).toEqual({
            kind: "deny",
            reason: "",
          });
        });

        it("a member reads an org-visible agent and may not edit it; the alias rule lets its raw-subject-stamped owner edit", async () => {
          const view = check(
            IamPermission.can_view,
            ApiResourceKind.agent,
            "agt_org",
          );
          const edit = check(
            IamPermission.can_edit,
            ApiResourceKind.agent,
            "agt_org",
          );
          const auth = authorizer();
          expect(await auth.authorize(resolved(MEMBER), view)).toEqual({
            kind: "allow",
          });
          expect(await auth.authorize(resolved(MEMBER), edit)).toEqual({
            kind: "deny",
            reason: "",
          });
          // The row is stamped `auth0|founder`; the caller is `ida_...`.
          // The account's subject is the alias that matches.
          expect(await auth.authorize(resolved(FOUNDER), edit)).toEqual({
            kind: "allow",
          });
        });

        it("an OAuth app is read by its creator and the organization's admins, and changed by its creator alone — the one org-scoped kind whose owner has no admin arm", async () => {
          // No pinned store document covers oauth_app (the security read's
          // fact 11), so its distinctive line is pinned here: `viewer` has
          // `admin from organization`, `can_edit` and `can_delete` do not.
          await seed("oauth_app", "oap_vendor", {
            org: "acme",
            visibility:
              ApiResourceVisibility.api_resource_visibility_unspecified,
            createdBy: MEMBER.accountId,
          });
          const view = check(
            IamPermission.can_view,
            ApiResourceKind.oauth_app,
            "oap_vendor",
          );
          const edit = check(
            IamPermission.can_edit,
            ApiResourceKind.oauth_app,
            "oap_vendor",
          );
          const remove = check(
            IamPermission.can_delete,
            ApiResourceKind.oauth_app,
            "oap_vendor",
          );
          const auth = authorizer();
          for (const c of [view, edit, remove]) {
            expect(await auth.authorize(resolved(MEMBER), c)).toEqual({
              kind: "allow",
            });
          }
          expect(await auth.authorize(resolved(ADMIN), view)).toEqual({
            kind: "allow",
          });
          expect(await auth.authorize(resolved(ADMIN), edit)).toEqual({
            kind: "deny",
            reason: "",
          });
          expect(await auth.authorize(resolved(ADMIN), remove)).toEqual({
            kind: "deny",
            reason: "",
          });
          // The organization's OWNER is an admin by the ladder: reads, does not change.
          expect(await auth.authorize(resolved(FOUNDER), view)).toEqual({
            kind: "allow",
          });
          expect(await auth.authorize(resolved(FOUNDER), edit)).toEqual({
            kind: "deny",
            reason: "",
          });
          expect(await auth.authorize(resolved(OUTSIDER), view)).toEqual({
            kind: "deny",
            reason: "",
          });
        });

        it("an outsider on an EXISTING resource is DENIED, never not-found — the cloud's answer (finding 20 closed)", async () => {
          const auth = authorizer();
          expect(
            await auth.authorize(
              resolved(OUTSIDER),
              check(IamPermission.can_view, ApiResourceKind.agent, "agt_org"),
            ),
          ).toEqual({ kind: "deny", reason: "" });
          expect(
            await auth.authorize(
              resolved(OUTSIDER),
              check(
                IamPermission.can_view,
                ApiResourceKind.organization,
                "acme",
              ),
            ),
          ).toEqual({ kind: "deny", reason: "" });
        });

        it("a member's session is theirs alone: the admin and the owner of the organization are denied", async () => {
          const view = check(
            IamPermission.can_view,
            ApiResourceKind.session,
            "ses_member",
          );
          const auth = authorizer();
          expect(await auth.authorize(resolved(MEMBER), view)).toEqual({
            kind: "allow",
          });
          expect(await auth.authorize(resolved(ADMIN), view)).toEqual({
            kind: "deny",
            reason: "",
          });
          expect(await auth.authorize(resolved(FOUNDER), view)).toEqual({
            kind: "deny",
            reason: "",
          });
        });

        it("an unprovisioned subject reads a PUBLIC agent (the point-check context honours the wildcard) and nothing private", async () => {
          const auth = authorizer();
          expect(
            await auth.authorize(
              idpShaped(STRANGER),
              check(
                IamPermission.can_view,
                ApiResourceKind.agent,
                "agt_public",
              ),
            ),
          ).toEqual({ kind: "allow" });
          expect(
            await auth.authorize(
              idpShaped(STRANGER),
              check(
                IamPermission.can_view,
                ApiResourceKind.agent,
                "agt_private",
              ),
            ),
          ).toEqual({ kind: "deny", reason: "" });
          expect(
            await auth.authorize(
              idpShaped(STRANGER),
              check(
                IamPermission.can_create_agent,
                ApiResourceKind.organization,
                "acme",
              ),
            ),
          ).toEqual({ kind: "deny", reason: "" });
        });

        it("a member may not create an agent (`admin`) and may create a session (`member`); an admin may create an agent", async () => {
          const auth = authorizer();
          expect(
            await auth.authorize(
              resolved(MEMBER),
              check(
                IamPermission.can_create_agent,
                ApiResourceKind.organization,
                "acme",
              ),
            ),
          ).toEqual({ kind: "deny", reason: "" });
          expect(
            await auth.authorize(
              resolved(MEMBER),
              check(
                IamPermission.can_create_session,
                ApiResourceKind.organization,
                "acme",
              ),
            ),
          ).toEqual({ kind: "allow" });
          expect(
            await auth.authorize(
              resolved(ADMIN),
              check(
                IamPermission.can_create_agent,
                ApiResourceKind.organization,
                "acme",
              ),
            ),
          ).toEqual({ kind: "allow" });
        });

        it("a person reads their own account and nobody else's (`owner` is self)", async () => {
          const auth = authorizer();
          expect(
            await auth.authorize(
              resolved(MEMBER),
              check(
                IamPermission.can_view,
                ApiResourceKind.identity_account,
                MEMBER.accountId,
              ),
            ),
          ).toEqual({ kind: "allow" });
          expect(
            await auth.authorize(
              resolved(ADMIN),
              check(
                IamPermission.can_view,
                ApiResourceKind.identity_account,
                MEMBER.accountId,
              ),
            ),
          ).toEqual({ kind: "deny", reason: "" });
        });
      });

      describe("the not-found arm", () => {
        it("a target that does not exist is not-found, for a member and for an outsider alike", async () => {
          const missing = check(
            IamPermission.can_view,
            ApiResourceKind.agent,
            "agt_missing",
          );
          const auth = authorizer();
          expect(await auth.authorize(resolved(MEMBER), missing)).toEqual({
            kind: "not-found",
          });
          expect(await auth.authorize(resolved(OUTSIDER), missing)).toEqual({
            kind: "not-found",
          });
        });

        it("an organization named by a row but no longer held is not-found — you cannot create in an organization that does not exist", async () => {
          expect(
            await authorizer().authorize(
              resolved(FOUNDER),
              check(
                IamPermission.can_create_agent,
                ApiResourceKind.organization,
                "ghost",
              ),
            ),
          ).toEqual({ kind: "not-found" });
        });

        it("a missing row of an EXEMPT kind is a denial, so an authenticated caller cannot enumerate account ids (the cloud's probe scope)", async () => {
          expect(
            await authorizer().authorize(
              resolved(MEMBER),
              check(
                IamPermission.can_view,
                ApiResourceKind.identity_account,
                accountIdFor("auth0|nobody"),
              ),
            ),
          ).toEqual({ kind: "deny", reason: "" });
          expect(
            await authorizer().authorize(
              resolved(MEMBER),
              check(
                IamPermission.can_view,
                ApiResourceKind.iam_policy,
                "pol_missing",
              ),
            ),
          ).toEqual({ kind: "deny", reason: "" });
        });
      });

      describe("faults are `unavailable`, never a denial and never a throw", () => {
        it("a store fault reading the target carries its cause", async () => {
          const fault = new Error("connection reset");
          const decision = await authorizer({
            store: {
              ...opened.store,
              getResource: () => Promise.reject(fault),
            },
          }).authorize(
            resolved(FOUNDER),
            check(IamPermission.can_view, ApiResourceKind.agent, "agt_private"),
          );
          expect(decision.kind).toBe("unavailable");
          expect((decision as { cause: Error }).cause).toBe(fault);
        });

        it("a caller who names no person (the laptop's placeholder) is a fault, not a denial", async () => {
          const decision = await authorizer().authorize(
            {
              ...resolved(FOUNDER),
              identityId: "system",
              rawToken: "",
              issuer: "",
            },
            check(IamPermission.can_view, ApiResourceKind.agent, "agt_private"),
          );
          expect(decision.kind).toBe("unavailable");
          expect((decision as { cause: Error }).cause.message).toContain(
            "names no person",
          );
        });

        it("a broken model (a relation cycle) is a fault, not a lockout", async () => {
          const cyclic = declareKind({
            kind: ApiResourceKind.agent,
            schema: declared("agent").schema,
            source: "test",
            relations: [
              ["a", computed("b")],
              ["b", computed("a")],
              ["can_view", computed("a")],
            ],
          });
          const decision = await newBuiltInAuthorizer({
            store: opened.store,
            policies,
            accounts,
            edition: ServerEdition.oss,
            logger: silentLogger,
            model: newModel([cyclic]),
          }).authorize(
            resolved(FOUNDER),
            check(IamPermission.can_view, ApiResourceKind.agent, "agt_private"),
          );
          expect(decision.kind).toBe("unavailable");
          expect((decision as { cause: Error }).cause.name).toBe(
            "AuthorizationEvaluationError",
          );
        });
      });

      describe("cost", () => {
        it("one blueprint point check reads the target once and the account once — three reads through the port and the store in all", async () => {
          const reads = { store: 0, accounts: 0, policies: 0 };
          const auth = newBuiltInAuthorizer({
            store: {
              ...opened.store,
              getResource(kind, id, schema) {
                reads.store += 1;
                return opened.store.getResource(kind, id, schema);
              },
            },
            policies: {
              ...policies,
              findByPrincipal(principalKind, principalId) {
                reads.policies += 1;
                return policies.findByPrincipal(principalKind, principalId);
              },
            },
            accounts: {
              findById(id) {
                reads.accounts += 1;
                return accounts.findById(id);
              },
              findDirectByIdpId(idpId) {
                reads.accounts += 1;
                return accounts.findDirectByIdpId(idpId);
              },
            },
            edition: ServerEdition.oss,
            logger: silentLogger,
          });
          const decision: AuthzDecision = await auth.authorize(
            resolved(MEMBER),
            check(IamPermission.can_view, ApiResourceKind.agent, "agt_org"),
          );
          expect(decision).toEqual({ kind: "allow" });
          // The agent row once (the loader's memo serves the derivation
          // and the walk); the organization row once (the `viewer`
          // userset hop); the member's account once (resolved by id).
          expect(reads).toEqual({ store: 2, accounts: 1, policies: 1 });
        });
      });
    });
  },
);
