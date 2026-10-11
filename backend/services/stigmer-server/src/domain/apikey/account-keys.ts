/**
 * Every key that speaks for an account, removed when the account is
 * deleted: the identity-account delete runs this before the account's row
 * goes (domain/identityaccount/controller.ts), so a deleted person's keys
 * do not come back when the same person signs up again under the same
 * subject, and therefore the same derived account id (stigmer/stigmer#1771),
 * and a deleted service account's keys end at once.
 *
 * The keys are read by owner through the key list index (queries.ts), by
 * the names its keys are stamped with (queries.ts `ownerNamesOf`): its id,
 * and a direct account's own subject.
 * Each is removed as the organization purge removes a key
 * (purge.ts, the kind purge's row removal): its access rows through the
 * grant path, then the key's own delete chain's cleanup (its row, then its
 * tuples). Nothing is caught: a fault fails the account's delete with the
 * account in place, and the same delete, retried, finishes the job.
 */
import { create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import {
  RESOURCE_ID_KEY,
  newDeleteResourceStep,
} from "../../pipeline/steps/delete.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import type { IamPolicyGrantPath } from "../iampolicy/grant-path.js";
import { keysOwnedBy } from "./queries.js";

export interface AccountKeysDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly grantPath: Pick<IamPolicyGrantPath, "cleanupResource">;
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

/** Deletes every key owned by any of `owners`, as `caller`; answers how many. */
export async function deleteKeysOwnedBy(
  deps: AccountKeysDeps,
  owners: ReadonlyArray<string>,
  caller: CallerIdentity,
): Promise<number> {
  const keys = await keysOwnedBy(deps.store, owners);
  const input = ApiKeyCommandController.method.delete.input;
  for (const key of keys) {
    const id = key.metadata?.id ?? "";
    if (id === "") {
      throw new Error("an API key row with no id cannot be deleted");
    }
    await deps.grantPath.cleanupResource(
      create(ApiResourceRefSchema, {
        kind: kindEnumName(ApiResourceKind.api_key),
        id,
      }),
      caller,
    );
    const ctx = new RequestContext(
      input,
      create(input, { value: id }),
      caller,
      ApiResourceKind.api_key,
    );
    ctx.set(RESOURCE_ID_KEY, id);
    ctx.set(EXISTING_RESOURCE_KEY, key);
    await newPipeline<typeof input>("apikey-delete-for-account", deps.logger)
      .addStep(newDeleteResourceStep(deps.store))
      .addStep(
        newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
      )
      .build()
      .execute(ctx);
  }
  return keys.length;
}
