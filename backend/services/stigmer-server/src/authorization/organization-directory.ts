/**
 * The built-in organization directory — open source's driver for the
 * organization-directory seam (extensions/organization-directory.ts),
 * composed under the built-in posture. The cloud's directory answers
 * `findMyOrganizations` with OpenFGA's list-objects for
 * `organization#can_view`; this one answers the same question over the
 * derived source: the candidates are the organizations the person's own
 * IamPolicy rows name (on open source a person reaches an organization
 * through a role row and nothing else — the derivation writes no
 * organization tuple), and each candidate is kept when
 * `can_view` holds for the person, evaluated by the same evaluator the
 * Authorizer uses. An evaluation rather than a relation filter, so the
 * answer stays right if the grant scope ever widens past the four roles,
 * and stays equal to the cloud's today.
 *
 * `refusesEnumeration` is TRUE, the cloud's posture: `find` is
 * skip-authorization by annotation, so under an enforcing server it would
 * hand every member every organization row — the list that lies. The
 * first-party clients list through `findMyOrganizations`. Trusted-local
 * composes no directory and keeps enumerating (one caller, nothing to
 * hide from).
 *
 * A caller who resolves to no account (an idp-shaped subject before
 * provisioning) holds no rows and is answered `[]`, never a fault: the
 * conformance sibling's readiness probe is this very RPC with a fresh
 * subject. The `internal` class — the server acting as itself over the
 * in-process transport — is answered `ALL_ORGANIZATIONS`: the Authorize
 * step treats that class as the in-process authorization skip (pipeline/
 * interceptors/auth.ts, ruling Q4), and a directory answer IS an
 * authorization answer, so a server-internal hop sees what the permissive
 * default showed it. `findMyOrganizations` is skip-authorization by
 * annotation, which is why this driver meets that caller at all: a
 * skip lane hands the directory the identity the interceptor stamped,
 * and no Authorize arm ran before it. Every other caller gets the
 * evaluated list.
 * The controller loads each id it is handed and skips the ones whose row
 * is gone (grants can outlive rows); the source has already loaded the
 * row once for the evaluation — two primary-key reads per organization,
 * a handful per person, and the contract's own read is the controller's.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { IamPolicyStore } from "../domain/iampolicy/store.js";
import type { CallerIdentity } from "../extensions/identity.js";
import type { OrganizationDirectory } from "../extensions/organization-directory.js";
import { ALL_ORGANIZATIONS } from "../extensions/organization-directory.js";
import { kindEnumName } from "../pipeline/apiresource-meta.js";
import type { Store } from "../store/interface.js";
import { newDerivedTupleSource } from "./derived-tuples.js";
import { checkRelation } from "./evaluator.js";
import type { Model } from "./model/index.js";
import { builtInModel } from "./model/index.js";
import type { AccountsByCaller } from "./person.js";
import { resolvePerson } from "./person.js";

export interface BuiltInOrganizationDirectoryDeps {
  readonly store: Store;
  readonly policies: IamPolicyStore;
  readonly accounts: AccountsByCaller;
  readonly model?: Model;
}

const ORGANIZATION = kindEnumName(ApiResourceKind.organization);

export function newBuiltInOrganizationDirectory(
  deps: BuiltInOrganizationDirectoryDeps,
): OrganizationDirectory {
  const model = deps.model ?? builtInModel;
  return {
    refusesEnumeration: true,

    async listMyOrganizationIds(
      caller: CallerIdentity,
    ): Promise<ReadonlyArray<string> | typeof ALL_ORGANIZATIONS> {
      if (caller.callerClass === "internal") {
        return ALL_ORGANIZATIONS;
      }
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
      // The candidates come from the source's ONE read of the person's
      // rows — the same read `tuplesOf` will serve the evaluation from.
      const candidates = new Set<string>();
      for (const tuple of await source.personTuples()) {
        if (tuple.object.type === ORGANIZATION && tuple.object.id !== "") {
          candidates.add(tuple.object.id);
        }
      }
      const visible: string[] = [];
      for (const id of candidates) {
        if (
          await checkRelation(
            { model, source },
            { type: ORGANIZATION, id },
            "can_view",
            person,
          )
        ) {
          visible.push(id);
        }
      }
      return visible;
    },
  };
}
