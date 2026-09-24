/**
 * The built-in Authorizer — open source's driver for the one
 * authorization decision seam (extensions/authorizer.ts), composed under
 * the built-in posture (posture.ts): the cloud's model evaluated over the
 * tuples this row would have had, derived on the fly (evaluator.ts over
 * derived-tuples.ts). Every arm below mirrors the cloud's driver
 * (stigmer-cloud src/authorizer/fga-authorizer.ts) by name and copy, so
 * the two editions answer one question the same way and the drift test
 * can pin the arms and not only the model.
 *
 * The arms, in order:
 *   1. The cloud's four pre-checks with the Java service's copy, each a
 *      `deny` with the reason: an unspecified permission, an empty
 *      identity, an empty resource id, the unknown kind. No wire caller
 *      reaches the unknown kind since the kind refusals landed; the
 *      arm is the backstop, not a path.
 *   2. A kind this edition does not serve is `deny` (`kindServedByEdition`,
 *      the predicate 2b's `checkMyPermission` arm 1 uses, so the console
 *      and the server agree by construction). `platform` is the one that
 *      can arrive, through an operator capability no self-host holds.
 *   3. The caller as a person (person.ts) and one derived tuple source for
 *      them; the target loaded ONCE through the source's memoised loader,
 *      so the read that decides not-found is the read the derivation
 *      uses.
 *   4. A missing target is `not-found` — the Authorize step answers the
 *      load-first chain's NOT_FOUND (stigmer#224) — EXCEPT for the kinds
 *      the cloud never probes (NOT_FOUND_EXEMPT_KINDS): there a missing
 *      row is evaluated like any other and denies, so an authenticated
 *      member cannot learn which account ids exist. Present or exempt, the
 *      row is then evaluated: the cloud asks OpenFGA whether or not the row
 *      exists, and so does this driver.
 *   5. `checkRelation`. True is `allow`; false is `deny` with an EMPTY
 *      reason, so the method annotation's byte-pinned `error_msg` wins on
 *      the wire, exactly the cloud's genuine-denial path.
 *
 * Faults. Everything past the pre-checks runs under one guard: a store
 * fault, a person that names nobody (`personFor`), an evaluation fault
 * (a cycle, the depth bound, an undeclared target — a registry gap the
 * edition pin makes unreachable) all answer `unavailable` with the cause,
 * which the Authorize step maps to INTERNAL. A denial is never a softened
 * outage and an outage is never a denial; the driver itself never throws.
 *
 * Logging. One debug line per deny and per not-found, naming the person's
 * account id, the permission and the object — what an operator needs to
 * answer "why can Alice not see this" — and never the token. Allows are
 * silent; they are the common case.
 *
 * Cost, per check (measured at slice 4): the target row (1), the caller's
 * account (1 primary-key read; 2 for a caller a composition verifier left
 * idp-shaped), the person's IamPolicy rows (1 scan of the port, once per
 * source; one more per team the person holds, which open source never
 * has — derived-tuples.ts), and one row per parent hop the model walks.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import type { Logger } from "../boot/logger.js";
import type { IamPolicyStore } from "../domain/iampolicy/store.js";
import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../extensions/authorizer.js";
import type { CallerIdentity } from "../extensions/identity.js";
import {
  kindEnumName,
  kindServedByEdition,
} from "../pipeline/apiresource-meta.js";
import type { Store } from "../store/interface.js";
import { newDerivedTupleSource } from "./derived-tuples.js";
import { checkRelation } from "./evaluator.js";
import type { Model } from "./model/index.js";
import { builtInModel } from "./model/index.js";
import type { AccountsByCaller } from "./person.js";
import { resolvePerson } from "./person.js";
import type { ObjectRef } from "./tuples.js";
import { formatObjectRef } from "./tuples.js";

/**
 * Kinds whose missing row is a denial, never `not-found` (arm 4): the
 * cloud's `PROBE_EXEMPT_KINDS` (stigmer-cloud
 * src/authorizer/fga-authorizer.ts) restricted to the kinds this edition
 * serves — `platform`, `identity_provider` and `invitation` are refused by
 * arm 2 before any row is asked about. The cloud exempts them because
 * their rows live in its own tables, out of its probe's reach; matching
 * the set here keeps the wire identical across editions (an unknown
 * platform client's id is PERMISSION_DENIED with the annotation's copy in
 * both). The cloud's model drift test pins every kind here inside its
 * `PROBE_EXEMPT_KINDS`, which is why this set is exported; a kind that
 * moves into open source joins this set in the same change.
 *
 * `iam_policy` is reachable as a target through the IamPolicy RPCs' own
 * `resource.kind` (a caller may name it); the grant scope refuses such a
 * target after the Authorize step in both editions, and the arm here
 * keeps the wire the same on the way there.
 */
export const NOT_FOUND_EXEMPT_KINDS: ReadonlySet<ApiResourceKind> = new Set([
  ApiResourceKind.identity_account,
  ApiResourceKind.iam_policy,
  ApiResourceKind.platform_client,
]);

/** The Java RequestAuthorizationService's pre-check copy, byte for byte (the cloud renders the same). */
export const UNKNOWN_PERMISSION_DENY_REASON =
  "authorization cannot be performed with unknown permission";
export const EMPTY_IDENTITY_DENY_REASON =
  "authorization cannot be performed on empty identity string";
export const EMPTY_RESOURCE_ID_DENY_REASON =
  "authorization cannot be performed on empty api-resource-id";
export const UNKNOWN_KIND_DENY_REASON =
  "authorization cannot be performed on unknown api-resource-kind";
/** This edition's own arm; the cloud has no unserved kind to deny. */
export const UNSERVED_KIND_DENY_REASON =
  "authorization cannot be performed on a kind this edition does not serve";

export interface BuiltInAuthorizerDeps {
  readonly store: Store;
  /** The port the grant path writes through — the person's rows are read from the same instance. */
  readonly policies: IamPolicyStore;
  /** The account port: the caller's account, and identity_account targets. */
  readonly accounts: AccountsByCaller;
  /** The served edition (`extensions.edition`); the built-in posture pins it to `oss` at boot. */
  readonly edition: ServerEdition;
  readonly logger: Logger;
  /** The declarations to evaluate; the built-in model unless a test says otherwise. */
  readonly model?: Model;
}

export function newBuiltInAuthorizer(deps: BuiltInAuthorizerDeps): Authorizer {
  const model = deps.model ?? builtInModel;
  return {
    async authorize(
      caller: CallerIdentity,
      check: AuthzCheck,
    ): Promise<AuthzDecision> {
      if (check.permission === IamPermission.unspecified) {
        return deny(UNKNOWN_PERMISSION_DENY_REASON);
      }
      if (caller.identityId === "") {
        return deny(EMPTY_IDENTITY_DENY_REASON);
      }
      if (check.resourceId === "") {
        return deny(EMPTY_RESOURCE_ID_DENY_REASON);
      }
      if (check.resourceKind === ApiResourceKind.api_resource_kind_unknown) {
        return deny(UNKNOWN_KIND_DENY_REASON);
      }
      if (!kindServedByEdition(check.resourceKind, deps.edition)) {
        return deny(UNSERVED_KIND_DENY_REASON);
      }

      const object: ObjectRef = {
        type: kindEnumName(check.resourceKind),
        id: check.resourceId,
      };
      const relation = IamPermission[check.permission];
      try {
        const person = await resolvePerson(deps.accounts, caller);
        const source = newDerivedTupleSource(
          {
            store: deps.store,
            policies: deps.policies,
            accounts: deps.accounts,
            model,
          },
          person,
        );
        const row = await source.loader.load(object);
        if (
          row === undefined &&
          !NOT_FOUND_EXEMPT_KINDS.has(check.resourceKind)
        ) {
          deps.logger.debug("authorization target not found", {
            account: person.accountId,
            permission: relation,
            object: formatObjectRef(object),
          });
          return { kind: "not-found" };
        }
        const allowed = await checkRelation(
          { model, source },
          object,
          relation,
          person,
        );
        if (allowed) {
          return { kind: "allow" };
        }
        deps.logger.debug("authorization denied", {
          account: person.accountId,
          permission: relation,
          object: formatObjectRef(object),
        });
        // Empty on purpose: the Authorize step then surfaces the method
        // annotation's byte-pinned error_msg (or its fallback copy), the
        // cloud's genuine-denial path.
        return deny("");
      } catch (error) {
        return {
          kind: "unavailable",
          cause: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },
  };
}

function deny(reason: string): AuthzDecision {
  return { kind: "deny", reason };
}
