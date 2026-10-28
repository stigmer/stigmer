/**
 * ResolveSessionEnvironment — records which Environment a conversation runs
 * in, and whose choice it was, on status.environment and
 * status.environment_source. In order:
 *
 *   1. the conversation's own spec.environment_ref (source session, or
 *      routine when a routine's fire made the conversation: the run starter
 *      copied the invocation's reference into the spec);
 *   2. its agent's default, AgentSpec.environment_ref at the version
 *      ResolveSessionAgent pinned (source agent);
 *   3. its organization's default,
 *      OrganizationPreferences.default_environment_ref (source
 *      organization);
 *   4. else none.
 *
 * The defaults apply only to a conversation whose sandbox this server
 * starts (domain/run/environment-admission.ts EnvironmentPolicy.governs).
 * Anywhere else (the desktop app, the CLI) the conversation records none,
 * and one it names itself is refused here, before it is saved.
 *
 * A stamp, not a copy into the spec as harness is: the spec keeps only the
 * person's own choice, so the record says whether a default supplied it.
 * The reference holds the Environment's id; responses name it by its
 * current slug, as any stored reference. Re-resolved on every write until
 * the conversation has run (has-run.ts), then kept:
 * a conversation keeps the Environment it started with, and
 * ValidateEnvironmentImmutability refuses a change to its own choice. The
 * Environment's contents are read again at every sandbox start, so an edit
 * still reaches it.
 *
 * Placement: after ResolveSessionAgent, which pins the agent version step 2
 * reads, and after ValidateReferences, which judged spec.environment_ref
 * (existence and the writer's can_view).
 *
 * Tests: __tests__/resolve-session-environment.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type { Session, SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { EnvironmentSource, ExecutionTarget } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { SessionStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/status_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";

import { failedPreconditionError, internalError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { sessionHasRun } from "./has-run.js";
import { readRunAgentSpec } from "../agent/run-defaults.js";
import { LOCAL_ENVIRONMENT_MESSAGE } from "../run/environment-admission.js";
import type { EnvironmentPolicy } from "../run/environment-admission.js";

type SessionDesc = typeof SessionSchema;

/** Whether a reference names anything. */
function names(ref: ApiResourceReference | undefined): ref is ApiResourceReference {
  return ref !== undefined && (ref.id !== "" || ref.slug !== "");
}

/** The stamp a resolved reference becomes: held by id, as every stored reference. */
function stampOf(ref: ApiResourceReference, org: string): ApiResourceReference {
  return create(ApiResourceReferenceSchema, {
    org: ref.org !== "" ? ref.org : org,
    kind: ApiResourceKind.environment,
    id: ref.id,
    slug: ref.slug,
  });
}

/** The Environment a conversation resolves to, and whose choice it was; `undefined` for none. */
export async function resolveSessionEnvironment(
  store: Store,
  policy: EnvironmentPolicy,
  session: Session,
): Promise<{ readonly ref: ApiResourceReference; readonly source: EnvironmentSource } | undefined> {
  const own = session.spec?.environmentRef;
  const org = session.metadata?.org ?? "";
  if (!policy.governs(session.spec?.executionTarget ?? ExecutionTarget.UNSPECIFIED)) {
    if (names(own)) {
      throw failedPreconditionError(LOCAL_ENVIRONMENT_MESSAGE);
    }
    return undefined;
  }
  if (names(own)) {
    const source = (session.status?.routineId ?? "") !== "" ? EnvironmentSource.ROUTINE : EnvironmentSource.SESSION;
    return { ref: stampOf(own, org), source };
  }
  const agentSpec = await readRunAgentSpec(store, session.status?.agentId ?? "", session.status?.agentVersionHash ?? "");
  if (names(agentSpec?.environmentRef)) {
    return { ref: stampOf(agentSpec.environmentRef, org), source: EnvironmentSource.AGENT };
  }
  const preferred = await organizationDefault(store, org);
  if (names(preferred)) {
    return { ref: stampOf(preferred, org), source: EnvironmentSource.ORGANIZATION };
  }
  return undefined;
}

async function organizationDefault(store: Store, org: string): Promise<ApiResourceReference | undefined> {
  if (org === "") {
    return undefined;
  }
  try {
    const organization = await store.getResource(ApiResourceKind.organization, org, OrganizationSchema);
    return organization.spec?.preferences?.defaultEnvironmentRef;
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw internalError(error, "failed to read the organization's default environment");
  }
}

export function newResolveSessionEnvironmentStep(
  store: Store,
  policy: EnvironmentPolicy,
): PipelineStep<SessionDesc> {
  return {
    name: "ResolveSessionEnvironment",
    async execute(ctx: RequestContext<SessionDesc>): Promise<void> {
      const session = ctx.newState;
      const status = (session.status ??= create(SessionStatusSchema));
      const stored = ctx.get(EXISTING_RESOURCE_KEY) as Session | undefined;
      if (stored !== undefined && (await sessionHasRun(store, ctx, stored))) {
        status.environment = stored.status?.environment;
        status.environmentSource = stored.status?.environmentSource ?? EnvironmentSource.UNSPECIFIED;
        return;
      }
      const resolved = await resolveSessionEnvironment(store, policy, session);
      status.environment = resolved?.ref;
      status.environmentSource = resolved?.source ?? EnvironmentSource.UNSPECIFIED;
    },
  };
}

/**
 * ValidateEnvironmentImmutability — the harness rule for the conversation's
 * own choice: once the conversation has run (has-run.ts), an update may not
 * name another Environment, or drop the one it named. Runs after
 * NormalizeReferences, so both sides are held by id.
 */
export function newValidateEnvironmentImmutabilityStep(store: Store): PipelineStep<SessionDesc> {
  return {
    name: "ValidateEnvironmentImmutability",
    async execute(ctx: RequestContext<SessionDesc>): Promise<void> {
      const stored = ctx.get(EXISTING_RESOURCE_KEY) as Session | undefined;
      if (stored === undefined || (stored.spec?.environmentRef?.id ?? "") === (ctx.newState.spec?.environmentRef?.id ?? "")) {
        return;
      }
      if (await sessionHasRun(store, ctx, stored)) {
        throw failedPreconditionError(
          "a conversation's environment cannot be changed after its first turn: start a new conversation to use another",
        );
      }
    },
  };
}
