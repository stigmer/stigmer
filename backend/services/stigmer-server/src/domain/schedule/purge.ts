/**
 * The schedule's purge (domain/organization/purge/kind-purge.ts): every
 * schedule of an organization being deleted, removed with its delete
 * chain's cleanup (controller.ts `deleteSchedule`): the row, its access,
 * its clock artifact in the engine, its fire ledger. The purge runs it in
 * the quiesce stage, before anything else, so nothing fires while the rest
 * of the organization is removed.
 *
 * The artifact teardown and the ledger removal are best-effort in the
 * chain, as here: an orphaned artifact cannot fire past revalidation and
 * the reconciliation pass removes it, and orphaned ledger rows answer no
 * query and are pruned by retention.
 */
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleCommandController } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";
import type { ClockProvider } from "./clock.js";
import {
  newDeleteScheduleRunsStep,
  newTeardownScheduleArtifactStep,
} from "./clock.js";

export interface SchedulePurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The schedule clock the controller tears artifacts down through. */
  readonly scheduleClock: ClockProvider;
}

export function newSchedulePurge(deps: SchedulePurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.schedule,
    schema: ScheduleSchema,
    input: ScheduleCommandController.method.delete.input,
    steps: [
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
      newTeardownScheduleArtifactStep(deps.scheduleClock, deps.logger),
      newDeleteScheduleRunsStep(deps.store, deps.logger),
    ],
  });
}
