/**
 * Subagents — the agent's list of saved agents it may hand work to
 * (spec.subagents), checked and pinned when the agent is saved, as Claude
 * Managed Agents pins a predefined agent when the agent listing it is
 * created or updated.
 *
 * Three steps:
 *
 *   - ValidateSubagentList runs with ValidateHooks, after NormalizeReferences
 *     resolved each reference to its agent's id and before any is judged:
 *     an agent may not list itself (by id, or on a create by the slug it is
 *     about to claim). INVALID_ARGUMENT. It reads nothing. A listed agent
 *     that is deleted and remade under its name is a different id, judged
 *     as one the write introduces.
 *   - ValidateSubagentNames runs directly after ValidateReferences: the list
 *     names each slug once, by the names the listed agents hold now (two
 *     agents of one slug from two organizations would share it), since a
 *     turn names a subagent by its slug. INVALID_ARGUMENT. It runs only once
 *     the reference rule has admitted every listed agent, so its copy never
 *     names an agent of another organization the writer has no standing to
 *     learn about (pipeline/steps/references.ts, clause iii).
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
 *          reference the write introduces, and a kept reference whose pin
 *          the write moves, must name an agent the writer may run
 *          (checkWriter's rules: same organization, the server's own calls
 *          exempt). An introduced reference is judged before step 1, so a
 *          refusal tells the writer nothing about the agent's versions. Whoever runs the
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
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import {
  checkWriter,
  collectSpecReferences,
  loadReferenceTargets,
  loadReferenced,
  missingReferencesMessage,
  referenceDisplayNames,
  referenceKey,
  referenceTargetKind,
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

/**
 * Whether a reference names this agent itself: by its id, or, on a create,
 * by the slug the agent is about to claim, which no name table entry holds
 * yet, so NormalizeReferences left it as written.
 */
function namesSelf(
  ref: ApiResourceReference,
  self: { readonly org: string; readonly id: string; readonly slug: string },
): boolean {
  if (ref.id !== "") {
    return ref.id === self.id;
  }
  return self.slug !== "" && ref.slug === self.slug && ref.org === self.org;
}

/** ValidateSubagentList — the module header's first step; runs after NormalizeReferences, so it compares ids. */
export function newValidateSubagentListStep(): PipelineStep<AgentDesc> {
  return {
    name: "ValidateSubagentList",
    execute(ctx: RequestContext<AgentDesc>): void {
      const metadata = ctx.newState.metadata;
      const self = {
        org: metadata?.org ?? "",
        id: metadata?.id ?? "",
        slug: metadata?.slug ?? "",
      };
      const listed = (ctx.newState.spec?.subagents ?? []).filter(
        (ref) => ref.id !== "" || ref.slug !== "",
      );
      for (const ref of listed) {
        if (namesSelf(ref, self)) {
          throw invalidArgumentError(selfListedMessage(self.slug));
        }
      }
    },
  };
}

/** ValidateSubagentNames — the module header's second step; runs after ValidateReferences admitted every listed agent. */
export function newValidateSubagentNamesStep(
  store: Store,
): PipelineStep<AgentDesc> {
  return {
    name: "ValidateSubagentNames",
    async execute(ctx: RequestContext<AgentDesc>): Promise<void> {
      const listed = (ctx.newState.spec?.subagents ?? []).filter(
        (ref) => ref.id !== "" || ref.slug !== "",
      );
      // A turn names a subagent by its slug, so two listed agents may not
      // share the name they hold now, whatever their ids and organizations.
      const seen = new Set<string>();
      for (const name of await referenceDisplayNames(store, ApiResourceKind.agent, listed)) {
        if (seen.has(name)) {
          throw invalidArgumentError(listedTwiceMessage(name));
        }
        seen.add(name);
      }
    },
  };
}



/** PinSubagents — the module header's third step. */
export function newPinSubagentsStep(
  store: Store,
  authorizer: Authorizer,
): PipelineStep<AgentDesc> {
  return {
    name: "PinSubagents",
    async execute(ctx: RequestContext<AgentDesc>): Promise<void> {
      const refs = (ctx.newState.spec?.subagents ?? []).filter(
        (ref) => ref.id !== "" || ref.slug !== "",
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
      const parent: ReferenceParent = {
        org: metadata.org,
        visibility: metadata.visibility,
      };
      const stored = storedSubagents(ctx);
      // A reference the write introduces is judged before any version is
      // read, so a refusal tells the writer nothing about the agent's
      // versions or its own subagents.
      await judgeWriter(
        ctx,
        store,
        authorizer,
        refs.filter((ref) => heldPin(stored, ref) === undefined),
        parent,
      );
      const kept = new Map(refs.map((ref) => [ref, heldPin(stored, ref)]));
      for (const ref of refs) {
        ref.version = await pinnedHash(store, ref);
      }
      // A kept reference whose pin moves is judged too: moving it chooses
      // which version every surface of this agent runs.
      await judgeWriter(
        ctx,
        store,
        authorizer,
        refs.filter((ref) => {
          const held = kept.get(ref);
          return held !== undefined && held !== ref.version;
        }),
        parent,
      );
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
    head = await loadReferenced(store, ApiResourceKind.agent, AgentSchema, ref);
  } catch (error) {
    throw internalError(error, "failed to read a subagent");
  }
  if (head === undefined) {
    // ValidateReferences found it a moment ago; it has left since.
    throw subagentGone(ref);
  }
  const slug = head.metadata?.slug ?? "";
  const named = ref.version.trim();
  const hash = await resolveVersionHash(
    store,
    agentVersionBinding,
    head,
    named,
  );
  if (hash === undefined) {
    throw failedPreconditionError(
      subagentVersionNotFoundMessage(slug, named),
    );
  }
  if (hash === "") {
    throw failedPreconditionError(subagentUnversionedMessage(slug));
  }
  const pinned = await loadVersion(
    store,
    agentVersionBinding,
    head.metadata?.id ?? "",
    hash,
  );
  if (
    (pinned.resource.spec?.subagents ?? []).some(
      (s) => s.id !== "" || s.slug !== "",
    )
  ) {
    throw failedPreconditionError(nestedSubagentMessage(slug));
  }
  return hash;
}

/** The subagent references the stored row carries; none on a create. */
function storedSubagents(ctx: RequestContext<AgentDesc>): SpecReference[] {
  const existing = ctx.get(EXISTING_RESOURCE_KEY) as Message | undefined;
  return existing === undefined
    ? []
    : collectSpecReferences(AgentSchema, existing).filter(
        (held) => held.kind === ApiResourceKind.agent,
      );
}

/** The version the stored row pins `ref`'s agent at, or undefined when the write introduces it. */
function heldPin(
  stored: ReadonlyArray<SpecReference>,
  ref: ApiResourceReference,
): string | undefined {
  const wanted = referenceKey({ ...ref, kind: ApiResourceKind.agent });
  return stored.find((held) => referenceKey(held) === wanted)?.version;
}

/**
 * Step 4 of the module header: can_execute on each of `refs`, which the
 * caller has already chosen (the references the write introduces, then
 * the kept ones whose pin it moves).
 */
async function judgeWriter(
  ctx: RequestContext<AgentDesc>,
  store: Store,
  authorizer: Authorizer,
  refs: ReadonlyArray<ApiResourceReference>,
  parent: ReferenceParent,
): Promise<void> {
  if (refs.length === 0) {
    return;
  }
  const specs = refs.map(
    (ref): SpecReference => ({
      kind: ApiResourceKind.agent,
      id: ref.id,
      slug: ref.slug,
      org: ref.org,
      version: ref.version,
    }),
  );
  const targets = await loadReferenceTargets(store, specs, parent.org);
  for (const [i, ref] of refs.entries()) {
    const spec = specs[i]!;
    const verdict = await checkWriter(
      targets,
      parent,
      spec,
      { authorizer, caller: ctx.callerIdentity, stored: [] },
      IamPermission.can_execute,
    );
    if (verdict.kind === "not-viewable") {
      throw permissionDeniedError(
        subagentNotRunnableMessage(targets.slugOf(spec) ?? ref.slug),
      );
    }
    if (verdict.kind === "missing") {
      throw subagentGone({ ...ref, slug: targets.slugOf(spec) ?? ref.slug });
    }
  }
}

/**
 * The reference rule's own missing-target refusal, for a listed agent that
 * left after ValidateReferences found it: named by its slug when one is
 * known, else by the id the reference holds.
 */
function subagentGone(ref: Pick<ApiResourceReference, "org" | "id" | "slug">): Error {
  const entry = referenceTargetKind(ApiResourceKind.agent);
  if (entry === undefined) {
    /* v8 ignore next -- @preserve: the reference rule table is a constant that holds an agent entry; no input reaches this */
    return internalError(
      new Error("reference rule table has no agent entry"),
      "pin subagents",
    );
  }
  return failedPreconditionError(
    missingReferencesMessage(entry, [
      { org: ref.org, slug: ref.slug !== "" ? ref.slug : ref.id },
    ]),
  );
}
