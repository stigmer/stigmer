/**
 * The routine's purge (domain/organization/purge/kind-purge.ts): every
 * routine of an organization being deleted, removed with its delete
 * chain's cleanup (controller.ts `deleteRoutine`): the row, its access,
 * its clock artifact in the engine, its fire ledger. The purge runs it in
 * the quiesce stage, before anything else, so nothing fires while the rest
 * of the organization is removed.
 *
 * The artifact teardown and the ledger removal are best-effort in the
 * chain, as here: an orphaned artifact cannot fire past revalidation and
 * the reconciliation pass removes it, and orphaned ledger rows answer no
 * query and are pruned by retention.
 */
import { RoutineSchema } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineCommandController } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupGrantsStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newReleaseNamesStep } from "../../pipeline/steps/names.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";
import type { ClockProvider } from "./clock.js";
import {
  newDeleteRoutineFiresStep,
  newTeardownRoutineArtifactStep,
} from "./clock.js";

export interface RoutinePurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The routine clock the controller tears artifacts down through. */
  readonly routineClock: ClockProvider;
}

export function newRoutinePurge(deps: RoutinePurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.routine,
    schema: RoutineSchema,
    input: RoutineCommandController.method.delete.input,
    steps: [
      newDeleteResourceStep(deps.store),
      newReleaseNamesStep(deps.store, deps.logger, ApiResourceKind.routine),
      newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger),
      newTeardownRoutineArtifactStep(deps.routineClock, deps.logger),
      newDeleteRoutineFiresStep(deps.store, deps.logger),
    ],
  });
}
