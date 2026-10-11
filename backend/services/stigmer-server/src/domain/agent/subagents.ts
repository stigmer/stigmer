/**
 * Subagents — the agent's list of saved agents it may hand work to
 * (spec.subagents), checked and pinned when the agent is saved, as Claude
 * Managed Agents pins a predefined agent when the agent listing it is
 * created or updated.
 *
 * Two steps:
 *
 *   - ValidateSubagentList runs with ValidateHooks, before any reference is
 *     looked up: an agent may not list itself, and lists each slug once,
 *     since a turn names a subagent by its slug (two agents of one slug from
 *     two organizations would share the name). Both are INVALID_ARGUMENT.
 *   - PinSubagents runs after ValidateReferences, which has already judged
 *     each reference's existence, organization and visibility floor
 *     (pipeline/steps/references.ts). For each reference it:
 *       1. resolves the version through the shared ladder
 *          (resolveVersionHash): a tag or a hash to its hash, empty or
 *          "latest" to the head's hash, and writes the hash into the
 *          reference, so what a write sends decides: a reference without a
 *          version takes the latest, one carrying a hash keeps it;
 *       2. refuses a version the agent does not hold, and a head with no
 *          hash (an agent written before agents were versioned), so a pin
 *          is never empty and never silently tracks the head;
 *       3. refuses a pinned version that lists subagents of its own: a
 *          subagent cannot hand work on (one level). The check cannot go
 *          stale, because a pinned version never changes;
 *       4. asks the writer clause with can_execute, on this field only: a
 *          reference the write introduces must name an agent the writer may
 *          run (checkWriter's rules: same organization, not already on the
 *          stored row, the server's own calls exempt). Whoever runs the
 *          parent runs its subagents, so listing one is a choice only
 *          someone who may run it makes. The clause is not the agent
 *          kind's (writerMust): a session, a share, a channel and a
 *          schedule reference an agent too, and their writers (a share's
 *          visitor, a lane) hold no standing on it.
 *
 * Pipeline position: before the version hash, so the pins are part of
 * what is hashed and what a version's snapshot carries.
 *
 * Proven by __tests__/agent-subagents.test.ts and the execution
 * conformance suite's subagent arms.
 */
import type { Message } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  permissionDeniedError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import {
  checkWriter,
  collectSpecReferences,
  missingReferencesMessage,
  referenceTargetKind,
  resolvedReferenceTargets,
} from "../../pipeline/steps/references.js";
import type {
  ReferenceParent,
  SpecReference,
} from "../../pipeline/steps/references.js";
import {
  loadVersion,
  resolveVersionHash,
} from "../../pipeline/steps/version-history.js";
import type { Store } from "../../store/interface.js";

import { agentVersionBinding } from "./versions.js";

type AgentDesc = typeof AgentSchema;

/** The refusal for an agent that lists itself. */
export function selfListedMessage(slug: string): string {
  return `subagents lists this agent itself ('${slug}'); an agent cannot hand work to itself`;
}

/** The refusal for a slug listed twice. */
export function listedTwiceMessage(slug: string): string {
  return `subagents lists two agents named '${slug}'; a turn names a subagent by its slug, so list each slug once`;
}

/** The refusal for a version the listed agent does not hold. */
export function subagentVersionNotFoundMessage(
  slug: string,
  version: string,
): string {
  return `subagent '${slug}' has no version '${version}'; name a tag or a version it has, or leave the version empty to take its latest`;
}

/** The refusal for a listed agent saved before agents were versioned. */
export function subagentUnversionedMessage(slug: string): string {
  return `subagent '${slug}' has no version yet: it was saved before agents were versioned. Save it once, then list it again`;
}

/** The refusal for a listed agent whose pinned version lists subagents (one level). */
export function nestedSubagentMessage(slug: string): string {
  return `subagent '${slug}' lists subagents of its own; a subagent cannot hand work on to another agent. List an agent without subagents, or remove its subagents and save it first`;
}

/** The writer clause's refusal on this field. */
export function subagentNotRunnableMessage(slug: string): string {
  return `subagent '${slug}' is not an agent you may run; list an agent you may run, or ask its owner to share it with you`;
}

/** Whether a reference names this agent itself. */
function namesSelf(
  ref: ApiResourceReference,
  org: string,
  slug: string,
): boolean {
  return ref.slug === slug && (ref.org === "" || ref.org === org);
}

/** ValidateSubagentList — the module header's first step. */
export function newValidateSubagentListStep(): PipelineStep<AgentDesc> {
  return {
    name: "ValidateSubagentList",
    execute(ctx: RequestContext<AgentDesc>): void {
      const metadata = ctx.newState.metadata;
      const org = metadata?.org ?? "";
      const slug = metadata?.slug ?? "";
      const seen = new Set<string>();
      for (const ref of ctx.newState.spec?.subagents ?? []) {
        if (ref.slug === "") {
          continue;
        }
        if (slug !== "" && namesSelf(ref, org, slug)) {
          throw invalidArgumentError(selfListedMessage(slug));
        }
        if (seen.has(ref.slug)) {
          throw invalidArgumentError(listedTwiceMessage(ref.slug));
        }
        seen.add(ref.slug);
      }
    },
  };
}

/** PinSubagents — the module header's second step. */
export function newPinSubagentsStep(
  store: Store,
  authorizer: Authorizer,
): PipelineStep<AgentDesc> {
  return {
    name: "PinSubagents",
    async execute(ctx: RequestContext<AgentDesc>): Promise<void> {
      const refs = (ctx.newState.spec?.subagents ?? []).filter(
        (ref) => ref.slug !== "",
      );
      if (refs.length === 0) {
        return;
      }
      const metadata = ctx.newState.metadata;
      if (metadata === undefined) {
        throw internalError(
          new Error("resource metadata is nil"),
          "pin subagents",
        );
      }
      for (const ref of refs) {
        ref.version = await pinnedHash(store, ref);
      }
      await judgeWriter(ctx, authorizer, refs, {
        org: metadata.org,
        visibility: metadata.visibility,
      });
    },
  };
}

/** Steps 1 to 3 of the module header for one reference: its pinned hash. */
async function pinnedHash(
  store: Store,
  ref: ApiResourceReference,
): Promise<string> {
  let head;
  try {
    head = await findResourceBySlug(
      store,
      ApiResourceKind.agent,
      AgentSchema,
      ref.slug,
      ref.org,
    );
  } catch (error) {
    throw internalError(error, "failed to read a subagent");
  }
  if (head === undefined) {
    // ValidateReferences found it a moment ago; it has left since.
    throw subagentGone(ref);
  }
  const named = ref.version.trim();
  const hash = await resolveVersionHash(
    store,
    agentVersionBinding,
    head,
    named,
  );
  if (hash === undefined) {
    throw failedPreconditionError(
      subagentVersionNotFoundMessage(ref.slug, named),
    );
  }
  if (hash === "") {
    throw failedPreconditionError(subagentUnversionedMessage(ref.slug));
  }
  const pinned = await loadVersion(
    store,
    agentVersionBinding,
    head.metadata?.id ?? "",
    hash,
  );
  if ((pinned.resource.spec?.subagents ?? []).some((s) => s.slug !== "")) {
    throw failedPreconditionError(nestedSubagentMessage(ref.slug));
  }
  return hash;
}

/** Step 4 of the module header: can_execute on every reference the write introduces. */
async function judgeWriter(
  ctx: RequestContext<AgentDesc>,
  authorizer: Authorizer,
  refs: ReadonlyArray<ApiResourceReference>,
  parent: ReferenceParent,
): Promise<void> {
  const targets = resolvedReferenceTargets(ctx);
  if (targets === undefined) {
    throw internalError(
      new Error(
        "PinSubagents ran without resolved reference targets — the step must follow ValidateReferences",
      ),
      "pin subagents requires the resolved references",
    );
  }
  const existing = ctx.get(EXISTING_RESOURCE_KEY) as Message | undefined;
  const stored =
    existing === undefined
      ? []
      : collectSpecReferences(AgentSchema, existing).filter(
          (held) => held.kind === ApiResourceKind.agent,
        );
  for (const ref of refs) {
    const spec: SpecReference = {
      kind: ApiResourceKind.agent,
      slug: ref.slug,
      org: ref.org,
      version: ref.version,
    };
    const verdict = await checkWriter(
      targets,
      parent,
      spec,
      { authorizer, caller: ctx.callerIdentity, stored },
      IamPermission.can_execute,
    );
    if (verdict.kind === "not-viewable") {
      throw permissionDeniedError(subagentNotRunnableMessage(ref.slug));
    }
    if (verdict.kind === "missing") {
      throw subagentGone(ref);
    }
  }
}

/** The reference rule's own missing-target refusal, for a listed agent that left after ValidateReferences found it. */
function subagentGone(ref: ApiResourceReference): Error {
  const entry = referenceTargetKind(ApiResourceKind.agent);
  if (entry === undefined) {
    return internalError(
      new Error("reference rule table has no agent entry"),
      "pin subagents",
    );
  }
  return failedPreconditionError(missingReferencesMessage(entry, [ref]));
}
