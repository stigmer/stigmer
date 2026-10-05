/**
 * RunTargetReachable — a run's credential is bound to the run's
 * organization (runnerauth/runner-subject-verifier.ts), so the runner reads
 * the run's target (the agent, workflow or workflow instance it executes)
 * as that binding. A target that binding cannot read would let the create
 * succeed and the run fail at its first read. This step asks the binding
 * the runner's question at create instead: the target must be inside the
 * run's organization, or shared across organizations along the model's one
 * path (authorization/credential-binding.ts). A target no row holds is left
 * to the steps that answer not-found; a read fault answers INTERNAL.
 *
 * Placed after the step that authorized the caller on the target, so only a
 * caller who may run it learns where it lives.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { CredentialBinding } from "../../extensions/credential-binding.js";
import { getKindName } from "../apiresource-meta.js";
import { internalError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import type { RunTarget } from "./authorize-run-target.js";
import { metadataOf } from "./shapes.js";

/** The refusal, naming the target so a caller can see what to share or move. */
export function runTargetUnreachableMessage(target: RunTarget): string {
  return (
    `a run uses only what its own organization can read: ${getKindName(target.resourceKind)} ` +
    `${target.resourceId} belongs to another organization and is not one its parent shares with child organizations`
  );
}

export function newRunTargetReachableStep<Desc extends DescMessage>(
  binding: CredentialBinding,
  resolve: (record: MessageShape<Desc>) => RunTarget | undefined,
): PipelineStep<Desc> {
  return {
    name: "RunTargetReachable",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const target = resolve(ctx.newState);
      const org = metadataOf(ctx.newState)?.org ?? "";
      if (target === undefined || org === "") {
        return;
      }
      let verdict;
      try {
        verdict = await binding.verdict(
          { ...ctx.callerIdentity, boundOrg: org },
          {
            kind: target.resourceKind,
            id: target.resourceId,
            permission: IamPermission[IamPermission.can_view],
          },
        );
      } catch (error) {
        throw internalError(error, "run target could not be checked");
      }
      if (verdict === "outside") {
        throw new ConnectError(
          runTargetUnreachableMessage(target),
          Code.FailedPrecondition,
        );
      }
    },
  };
}
