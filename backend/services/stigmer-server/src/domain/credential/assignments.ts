/**
 * GuardCredentialAssignments — the write rule for the credentials a
 * surface assigns (`credentials` on a schedule, a share, a channel and a
 * platform client): the values the runs it starts use, since those runs
 * have no person whose own credentials could be used.
 *
 * Every assignment carries its writer, stamped by the server (a value a
 * client sends is never read):
 *
 *   - An assignment the write INTRODUCES is the caller's: its writer is
 *     the caller, who must be allowed to use its credential (`can_use`),
 *     or the write is refused PERMISSION_DENIED. A run re-asks the same
 *     question of the writer when it starts (resolve.ts), so a writer who
 *     loses the grant stops the assignment working.
 *   - An assignment the write KEEPS (the same requirement and the same
 *     source as one the stored row carries) keeps its writer: an edit that
 *     echoes someone else's assignment back is not theirs to re-judge.
 *   - A write that changes what CONSUMES the assignments (the agent a
 *     schedule, share or channel starts) introduces every assignment it
 *     keeps: each is judged against the caller and re-stamped with them,
 *     because the values now reach another agent's shell.
 *
 * A person's own credential is assigned only on a schedule its owner
 * created, by that owner: a schedule is the one surface whose runs are a
 * person's own, unattended. It is refused on a share, a channel and a
 * platform client, whose runs belong to nobody. An edit that keeps a
 * person's credential assignment is that person's alone, so an admin
 * editing a member's schedule cannot keep the member's key flowing to an
 * agent of the admin's choosing.
 *
 * The server acting as itself (the `internal` class) writes assignments
 * with no writer, which a run does not re-check, as at every
 * authorization step.
 *
 * Placement: after NormalizeReferences and ValidateReferences, so every
 * reference is absolute and every credential an assignment names exists.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { CredentialAssignment } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  failedPreconditionError,
  internalError,
  permissionDeniedError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { createdByOf } from "../../pipeline/steps/authorization-facts.js";
import { evaluateAuthorizer } from "../../pipeline/steps/authorize.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import type { Store } from "../../store/interface.js";
import { ownerOf, targetKey } from "./steps.js";
import { credentialByReference, credentialsOfOrg } from "./values.js";

/** How one surface kind keeps its assignments and names what consumes them. */
export interface AssignmentSurface<M> {
  /** The surface in a refusal's words: "schedule", "share link", "channel", "platform client". */
  readonly noun: string;
  /** Whether a person's own credential may be assigned here (a schedule alone). */
  readonly personsOwn: boolean;
  /** The row's assignments, the live array the step stamps writers into. */
  assignmentsOf(row: M): CredentialAssignment[];
  /** What consumes the assignments, as one comparable string ("" for a surface that names none). */
  consumerOf(row: M): string;
}

/** An assignment as one comparable string: its requirement and its source, never its writer. */
function assignmentKey(assignment: CredentialAssignment): string {
  const requirement = assignment.requirement;
  const declarer =
    requirement?.declarer === undefined ? "" : (targetKey(requirement.declarer) ?? "");
  const source = assignment.source;
  let from = "";
  switch (source.case) {
    case "credential":
      from = `credential:${source.value.credential?.org ?? ""}/${source.value.credential?.slug ?? ""}#${source.value.field}`;
      break;
    case "literal":
      from = `literal:${source.value}`;
      break;
    case undefined:
      break;
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhaustive: never = source;
      throw new Error(`unknown assignment source: ${JSON.stringify(exhaustive)}`);
    }
  }
  return `${declarer}|${requirement?.key ?? ""}|${from}`;
}

export function newGuardCredentialAssignmentsStep<Desc extends DescMessage>(
  store: Store,
  authorizer: Authorizer,
  surface: AssignmentSurface<MessageShape<Desc>>,
): PipelineStep<Desc> {
  return {
    name: "GuardCredentialAssignments",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const row = ctx.newState;
      const assignments = surface.assignmentsOf(row);
      const caller = ctx.callerIdentity;
      const internal = caller.callerClass === "internal";
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as MessageShape<Desc> | undefined;
      const stored = new Map<string, CredentialAssignment>();
      for (const held of existing === undefined ? [] : surface.assignmentsOf(existing)) {
        stored.set(assignmentKey(held), held);
      }
      const consumerChanged =
        existing !== undefined && surface.consumerOf(existing) !== surface.consumerOf(row);
      const creator =
        existing === undefined ? caller.identityId : createdByOf(existing);

      let credentials: Credential[] | undefined;
      const credentialOf = async (assignment: CredentialAssignment): Promise<Credential | undefined> => {
        const ref =
          assignment.source.case === "credential" ? assignment.source.value.credential : undefined;
        if (ref === undefined) {
          return undefined;
        }
        if (credentials === undefined) {
          try {
            credentials = await credentialsOfOrg(store, metadataOf(row)?.org ?? "");
          } catch (error) {
            throw internalError(error, "failed to read the organization's credentials");
          }
        }
        return credentialByReference(credentials, ref);
      };

      for (const assignment of assignments) {
        const kept = consumerChanged ? undefined : stored.get(assignmentKey(assignment));
        const credential = await credentialOf(assignment);
        const owner = credential === undefined ? undefined : ownerOf(credential);
        const slug = credential?.metadata?.slug ?? "";

        if (owner?.kind === "person") {
          if (!surface.personsOwn) {
            throw failedPreconditionError(
              `credential '${slug}' is a person's own and cannot be assigned on a ${surface.noun}: its runs have no person behind them. Assign one of the organization's credentials instead`,
            );
          }
          if (!internal && kept !== undefined && caller.identityId !== owner.person) {
            throw permissionDeniedError(
              `this ${surface.noun} keeps an assignment of credential '${slug}', which belongs to another person; only that person may edit a ${surface.noun} that uses their credential, or remove the assignment`,
            );
          }
          if (kept === undefined && owner.person !== creator) {
            throw failedPreconditionError(
              `credential '${slug}' is a person's own and can be assigned only on a ${surface.noun} that person created`,
            );
          }
        }

        if (kept !== undefined) {
          assignment.writer = kept.writer;
          continue;
        }
        assignment.writer = internal ? "" : caller.identityId;
        if (internal || credential === undefined) {
          continue;
        }
        await requireUse(authorizer, caller, credential, surface.noun);
      }
    },
  };
}

/** The writer's `can_use` on a credential an assignment introduces. */
async function requireUse(
  authorizer: Authorizer,
  caller: CallerIdentity,
  credential: Credential,
  noun: string,
): Promise<void> {
  const decision = await evaluateAuthorizer(authorizer, caller, {
    permission: IamPermission.can_use,
    resourceKind: ApiResourceKind.credential,
    resourceId: credential.metadata?.id ?? "",
  });
  if (decision.kind === "allow") {
    return;
  }
  if (decision.kind === "deny" || decision.kind === "not-found") {
    throw permissionDeniedError(
      `credential '${credential.metadata?.slug ?? ""}' is not one you may use, so you cannot assign it on a ${noun}; assign a credential of your own or one the organization lets you use`,
    );
  }
  throw internalError(decision.cause, "failed to authorize an assigned credential");
}
