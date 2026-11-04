/**
 * The conversation a routine's fire starts, as a SessionSpec: one
 * projection read by both the run starter, which sends it with every fire
 * (temporal/routine/run-starter.ts), and the save-time admission, which
 * asks of it what that conversation's create would ask (admit-run.ts), so
 * the two cannot drift.
 *
 * The fresh per-fire session speaks the invocation's session half: it runs
 * the routine's agent at the version the routine names (none: the agent's
 * current version when the fire starts), and harness and resources come
 * from the owner's spec. An unspecified harness stays unset: the agent's
 * engine applies, else the platform default (OSS: Stigmer). Resources are
 * Files and git repositories (the contract refuses a folder); each File
 * becomes the new conversation's own copy when its session is created,
 * asked again of the owner the fire acts as. Credentials, when a repo is
 * private, ride a vault the routine names holding a GITHUB_TOKEN secret or
 * a connection for the repository's host. The conversation is titled by
 * the routine (its name, else its slug; an explicit subject also opts the
 * session out of generated titles).
 *
 * Proven by temporal/routine/__tests__ (what a fire sends) and
 * __tests__/admit-run.test.ts (what a save asks of it).
 */
import { clone, create } from "@bufbuild/protobuf";

import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { AgentInvocation } from "@stigmer/apis/ai/stigmer/agentic/run/v1/invocation_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { SessionSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import type { SessionSpec } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";

/** The routine's saved invocation: the agent, message, settings and session half each fire starts from. */
export function invocationOf(routine: Routine): AgentInvocation | undefined {
  return routine.spec?.agent;
}

/** The agent a fire runs, held by its organization and id. */
export interface FiredAgent {
  readonly org: string;
  readonly id: string;
}

/** The SessionSpec of the conversation one fire of `routine` starts, running `agent` (the module header). */
export function routineSessionSpec(
  routine: Routine,
  agent: FiredAgent,
): SessionSpec {
  const invocation = invocationOf(routine);
  const sessionSpec = create(SessionSpecSchema, {
    agentRef: create(ApiResourceReferenceSchema, {
      kind: ApiResourceKind.agent,
      org: agent.org,
      id: agent.id,
      version: invocation?.agentRef?.version ?? "",
    }),
    subject: routine.metadata?.name || (routine.metadata?.slug ?? ""),
    resources: invocation?.resources ?? [],
  });
  if (invocation !== undefined && invocation.harness !== Harness.UNSPECIFIED) {
    sessionSpec.harness = invocation.harness;
  }
  // The routine's Environment, when it names one, is the conversation's
  // own choice: the session records it with source routine
  // (domain/session/resolve-session-environment.ts), and each turn asks
  // the owner the fire acts as whether they may still view it.
  if (
    invocation?.environmentRef !== undefined &&
    invocation.environmentRef.id !== ""
  ) {
    sessionSpec.environmentRef = clone(
      ApiResourceReferenceSchema,
      invocation.environmentRef,
    );
  }
  return sessionSpec;
}
