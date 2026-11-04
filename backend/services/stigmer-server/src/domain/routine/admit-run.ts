/**
 * AdmitRoutineRun — a routine its runs could never start in is refused when
 * it is saved, rather than at every fire (stigmer/stigmer#2832). Each fire
 * creates a fresh conversation from the routine (fired-session.ts), and
 * that conversation's create refuses it for reasons already true at the
 * save. This step builds that conversation in memory and asks it what the
 * session create chain asks after the routine's link
 * (domain/session/controller.ts), in the same order, with the same
 * functions and the same sentences:
 *
 *   1. the agent version the routine names, pinned as ResolveSessionAgent
 *      pins it (resolveAgentPin): a tag or hash the agent does not hold is
 *      refused here, on every server;
 *   2. the Environment the conversation would run in, resolved as
 *      ResolveSessionEnvironment resolves it (the routine's own, else the
 *      agent version's default, else the organization's): a routine naming
 *      one where no server-started sandbox runs its fires is refused;
 *   3. a plugin's local program where the hosted sandbox cannot start one
 *      (RefuseLocalPrograms, domain/run/local-programs.ts);
 *   4. the Environment's rules (AdmitSessionEnvironment,
 *      domain/run/environment-admission.ts): networking or packages the
 *      driver cannot serve, an MCP server or a git repository whose host
 *      the Environment does not list.
 *
 * Nothing is written: the conversation lives only for the check. No viewer
 * is asked of the Environment, as at session create: ValidateReferences has
 * just asked the writer's can_view of the one the routine names.
 *
 * Which updates are asked. An update is asked when, comparing the merged
 * state with the stored row (never the field mask: a declarative apply
 * masks every path), it changes what a fire runs in (the agent, its
 * version, the resources or the Environment; harness reaches none of the
 * rules) or turns the routine back on. Any other edit (a rename, the
 * message, the schedule, the run settings, the vaults, disabling) is not
 * asked, so a routine an Environment edit broke after its save can still
 * be paused, renamed or fixed one field at a time. Resume (the platform's
 * pause latch) is not asked; the next fire asks again.
 *
 * Fires keep their own check: the Environment, the agent's current
 * version, the organization's default and the driver can all change after
 * the save.
 *
 * Placement: after ValidateReferences and CheckRoutineFiles, which judged
 * the references this step reads, and before VaultAttachments, ClaimName
 * and Persist, so a refusal claims no name and arms no schedule.
 *
 * Tests: __tests__/admit-run.test.ts; routine.composed.test.ts on the
 * composed server.
 */
import { create, equals } from "@bufbuild/protobuf";

import type {
  Routine,
  RoutineSchema,
} from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import {
  EnvironmentSource,
  ExecutionTarget,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { SessionResourceSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import { SessionStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/status_pb";
import type { SessionStatus } from "@stigmer/apis/ai/stigmer/agentic/session/v1/status_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import {
  admitEnvironment,
  loadSessionEnvironment,
  sessionRunTree,
} from "../run/environment-admission.js";
import type { EnvironmentPolicy } from "../run/environment-admission.js";
import { refuseLocalPrograms } from "../run/local-programs.js";
import type { LocalProgramPolicy } from "../run/local-programs.js";
import { runServers } from "../run/run-servers.js";
import { resolveAgentPin } from "../session/resolve-session-agent.js";
import { resolveSessionEnvironment } from "../session/resolve-session-environment.js";
import { routineSessionSpec } from "./fired-session.js";

type RoutineDesc = typeof RoutineSchema;

/** What the admission reads: the store, who may run the agent, and the deployment's two rules. */
export interface RoutineRunAdmissionDeps {
  readonly store: Store;
  readonly authorizer: Authorizer;
  readonly environmentPolicy: EnvironmentPolicy;
  readonly localPrograms: LocalProgramPolicy;
}

/** The conversation one fire of `routine` would create, with the status its create chain stamps written into `status`. */
function firedSession(routine: Routine, status: SessionStatus): Session {
  const ref = routine.spec?.agent?.agentRef;
  const session = create(SessionSchema, {
    metadata: { org: routine.metadata?.org ?? "" },
    spec: routineSessionSpec(routine, {
      org: ref?.org ?? "",
      id: ref?.id ?? "",
    }),
  });
  session.status = status;
  return session;
}

/** Refuses a routine whose fires' conversations would be refused when made (the module header); returns when they would not. */
export async function admitRoutineRun(
  deps: RoutineRunAdmissionDeps,
  routine: Routine,
  caller: CallerIdentity,
): Promise<void> {
  // The link a fire's conversation carries (domain/session/routine-link.ts),
  // so its own Environment reads as the routine's, as at a fire.
  const status = create(SessionStatusSchema, {
    routineId: routine.metadata?.id ?? "",
  });
  const session = firedSession(routine, status);
  const ref =
    routine.spec?.agent?.agentRef ??
    create(ApiResourceReferenceSchema, { kind: ApiResourceKind.agent });
  const pin = await resolveAgentPin(deps.store, ref, {
    authorizer: deps.authorizer,
    caller,
  });
  status.agentId = pin.agentId;
  status.agentVersionHash = pin.versionHash;

  const resolved = await resolveSessionEnvironment(
    deps.store,
    deps.environmentPolicy,
    session,
  );
  status.environment = resolved?.ref;
  status.environmentSource = resolved?.source ?? EnvironmentSource.UNSPECIFIED;

  const target = session.spec?.executionTarget ?? ExecutionTarget.UNSPECIFIED;
  const refusesLocalPrograms = deps.localPrograms.refusesLocalPrograms(target);
  if (!refusesLocalPrograms && resolved === undefined) {
    return;
  }
  const tree = await sessionRunTree(deps.store, session);
  refuseLocalPrograms(deps.localPrograms, target, tree.plugins);
  if (resolved === undefined) {
    return;
  }
  await admitEnvironment({
    policy: deps.environmentPolicy,
    session,
    environment: await loadSessionEnvironment(deps.store, session),
    servers: runServers(tree),
  });
}

function sameReference(
  a: ApiResourceReference | undefined,
  b: ApiResourceReference | undefined,
): boolean {
  return (
    (a?.org ?? "") === (b?.org ?? "") &&
    (a?.id ?? "") === (b?.id ?? "") &&
    // A reference still written by a name nothing held carries no id.
    (a?.slug ?? "") === (b?.slug ?? "") &&
    (a?.version ?? "") === (b?.version ?? "")
  );
}

/** Whether an update leaves a fire's conversation as the stored routine's would be, and the routine as on or off as it was. */
export function updateAsksNothing(stored: Routine, next: Routine): boolean {
  const before = stored.spec?.agent;
  const after = next.spec?.agent;
  const beforeResources = before?.resources ?? [];
  const afterResources = after?.resources ?? [];
  return (
    sameReference(before?.agentRef, after?.agentRef) &&
    sameReference(before?.environmentRef, after?.environmentRef) &&
    beforeResources.length === afterResources.length &&
    beforeResources.every((resource, index) => {
      const other = afterResources[index];
      return (
        other !== undefined && equals(SessionResourceSchema, resource, other)
      );
    }) &&
    ((stored.spec?.enabled ?? false) || !(next.spec?.enabled ?? false))
  );
}

export function newAdmitRoutineRunStep(
  deps: RoutineRunAdmissionDeps,
): PipelineStep<RoutineDesc> {
  return {
    name: "AdmitRoutineRun",
    async execute(ctx: RequestContext<RoutineDesc>): Promise<void> {
      const stored = ctx.get(EXISTING_RESOURCE_KEY) as Routine | undefined;
      if (stored !== undefined && updateAsksNothing(stored, ctx.newState)) {
        return;
      }
      await admitRoutineRun(deps, ctx.newState, ctx.callerIdentity);
    },
  };
}
