/**
 * AuthorizeResolvedTarget — the ONE mid-chain authorization step: the
 * question a lane can only ask once its chain has loaded something the
 * position-1 annotation could not key on.
 *
 * The `Authorize` step resolves its target from the REQUEST (a field path
 * over the input), so it cannot serve two shapes of lane, and both are
 * `is_skip_authorization` on the wire for that reason alone:
 *
 *   - a read by reference: the request carries an org and a slug, the
 *     target is the row the loader finds, and the question is exactly the
 *     one the kind's `get` asks by id — `can_view` on that row, with the
 *     `get` annotation's byte-pinned copy. `loadedTargetAsMethod(get)` is
 *     that resolver: it reads the row under TARGET_RESOURCE_KEY and asks the
 *     sibling `get` descriptor's annotation about its id, so the two lanes
 *     cannot drift (one annotation owns the permission and the copy; a
 *     `get` that is itself a skip makes the reference read a skip too).
 *   - a parent-gated create: the request names a parent (an agent to
 *     schedule, share, channel-bind or instantiate; a workflow to
 *     instantiate), the domain's resolve step loads and stashes it, and the
 *     question is the caller's standing on that parent (or on the row's
 *     organization), with the copy the lane has always answered.
 *
 * The step owns nothing but the position and the evaluation: a PURE
 * resolver over the request context names the questions (kind, id,
 * permission, copy), in the order the lane asks them; the first refusal
 * answers. The evaluation is `authorizeTarget` (authorize.ts): allow
 * proceeds, deny is PERMISSION_DENIED with the copy, not-found is NOT_FOUND
 * as the load-first chain would answer, unavailable is INTERNAL, and the
 * `internal` class alone is exempt — the annotation's skip arms do not
 * apply, because the caller IS the enforcement the annotation opted out of.
 *
 * Two contracts a resolver keeps. It returns an EMPTY list only for an arm
 * the lane has modelled as "nothing to ask" (a default instance the server
 * composed for the run's human, whose access already follows the parent);
 * an absent stash, a parent the chain guaranteed and did not deliver, is a
 * chain invariant broken and the resolver THROWS, so a mis-ordered chain
 * fails loudly instead of silently reopening the lane. And it names the
 * questions in the anti-probing order: the organization's bar before the
 * parent's where both are asked, so an outsider learns nothing about the
 * parent's grants from which copy came back.
 *
 * Position: immediately after the step that loads what the resolver reads,
 * before the duplicate check, before any engine or store side effect, and
 * before any step whose refusal would reveal the loaded row (a same-org
 * rule that names the parent's organization, an enrichment that reads the
 * row's connections).
 *
 * The step's name is the shared vocabulary for every NEW lane. The lanes
 * that carried a hand-written copy of this body before it existed keep
 * their frozen names through `stepName` — the version ladder's own
 * precedent (LoadSkillByReference and LoadPluginByReference are one
 * factory) — because a step name is never renamed.
 *
 * Sibling: `AuthorizeRunTarget` runs the same evaluation over the record
 * being built (`ctx.newState`) and carries the run-gate doctrine an
 * edition's lane admission keys on; this step reads what the chain LOADED
 * and carries no doctrine of its own.
 */
import type { DescMessage, DescMethod, Message } from "@bufbuild/protobuf";

import type { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { metadataOf } from "./shapes.js";
import { TARGET_RESOURCE_KEY } from "./load-target.js";
import {
  authorizeTarget,
  resolveAnnotatedCheck,
  type AuthorizationTarget,
} from "./authorize.js";

/** The step's shared name; a folded lane passes its own frozen name instead. */
export const AUTHORIZE_RESOLVED_TARGET_STEP = "AuthorizeResolvedTarget";

/**
 * Names the questions a lane asks, in order, over the request context after
 * its chain has loaded the target. Pure: no store, no clock, no side effect.
 * Empty means the lane has nothing to ask on this request; an invariant the
 * chain broke (an absent stash) is a throw, never an empty list.
 */
export type ResolvedTargetResolver<Desc extends DescMessage> = (
  ctx: RequestContext<Desc>,
) => ReadonlyArray<AuthorizationTarget>;

export function newAuthorizeResolvedTargetStep<Desc extends DescMessage>(
  authorizer: Authorizer,
  resolve: ResolvedTargetResolver<Desc>,
  stepName: string = AUTHORIZE_RESOLVED_TARGET_STEP,
): PipelineStep<Desc> {
  return {
    name: stepName,
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      for (const target of resolve(ctx)) {
        await authorizeTarget(authorizer, ctx.callerIdentity, target);
      }
    },
  };
}

/** The request shape every `getByReference` lane runs on. */
export type GetByReferenceDesc = typeof ApiResourceReferenceSchema;

/**
 * The reads' resolver: the row the loader stashed under TARGET_RESOURCE_KEY,
 * authorized exactly as `get` would authorize it by id. The `get`
 * descriptor's annotation supplies the kind, the permission and the copy;
 * the loaded row's id is the target override (a reference has no `value`
 * field for the annotation's path to read). A `get` that is public, skip
 * or unannotated makes this a no-op — the reference read is never stricter
 * than the read by id, and never laxer.
 */
export function loadedTargetAsMethod(
  get: DescMethod,
): ResolvedTargetResolver<GetByReferenceDesc> {
  return (ctx) => {
    const loaded = ctx.get(TARGET_RESOURCE_KEY) as Message | undefined;
    const id = loaded === undefined ? undefined : metadataOf(loaded)?.id;
    if (id === undefined) {
      throw new Error(
        `${AUTHORIZE_RESOLVED_TARGET_STEP}: no loaded target with metadata under ${TARGET_RESOURCE_KEY}; the loader must run first`,
      );
    }
    const target = resolveAnnotatedCheck(get, ctx.input, { resourceId: id });
    return target === undefined ? [] : [target];
  };
}
