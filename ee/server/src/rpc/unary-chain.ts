/**
 * The composition's unary RPC chain — the ONE shape every extension-
 * registered ConnectRPC handler runs: RequestContext (the stamped caller
 * from position 1) → Authorize (descriptor-driven from the proto method
 * options) → ValidateProto → the NAMED domain step, all through the OSS
 * pipeline primitives so an unexpected fault answers the sanitized-Internal
 * contract (never a leaked storage message) and a ConnectError refusal the
 * domain step throws passes through byte-identically.
 *
 * The chain authorizes before it validates, the library's own order, so a
 * caller with no rights learns nothing from a validation message. The order
 * is a step-order fact inside the server, not wire contract: the
 * conformance rows send structurally valid inputs, so their status codes
 * hold either way.
 *
 * One chain for every unit's handlers, so no unit restates it. The
 * domain step carries the caller's NAME so the pipeline's failure logs
 * stay diagnostic, the way the OSS controllers name every step; a generic
 * "Execute" would tell an operator nothing. Sibling of http/ (the HTTP
 * lanes' primitives): the gRPC lanes' primitive.
 *
 * A kind the composition serves itself (one no OSS controller serves)
 * runs the OSS steps its lanes need between ValidateProto and its domain
 * step, through `shaping`, with the RequestContext carrying the kind for
 * the steps that read it:
 *   - a create: ResolveSlug, the composition's own CheckDuplicate over its
 *     table, BuildNewState (which picks the id prefix from the kind's
 *     proto meta);
 *   - an update: the composition's own loader over its table, then
 *     BuildUpdateState;
 *   - a read by reference: the composition's own loader, then
 *     AuthorizeResolvedTarget, which authorizes the loaded row as `get`;
 *     the loader answers a miss NOT_FOUND only to a caller who could see
 *     the kind's rows in that organization (iam/reference-miss.ts).
 * The shape is unchanged for every other lane: Authorize → ValidateProto
 * → [shaping] → domain, and an RPC that shapes nothing passes nothing.
 */
import type { DescMessage, DescMethod, MessageShape } from "@bufbuild/protobuf";
import type { HandlerContext } from "@connectrpc/connect";
import type { Authorizer, Logger, PipelineStep } from "@stigmer/server";
import {
  callerIdentityOf,
  newAuthorizeStep,
  newPipeline,
  newValidateProtoStep,
  RequestContext,
} from "@stigmer/server";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

export interface UnaryChainDeps {
  readonly authorizer: Authorizer;
  readonly logger: Logger;
}

export interface UnaryChainNames {
  /** The pipeline's name in logs, e.g. "team-list-by-org". */
  readonly chain: string;
  /** The domain step's name in logs, e.g. "ListTeams". */
  readonly step: string;
}

export interface UnaryChainShaping<Desc extends DescMessage> {
  /**
   * The kind the lane serves, stamped on the RequestContext for the OSS
   * steps that read it (BuildNewState's id prefix and visibility default,
   * the failure copy of the steps that name the kind).
   */
  readonly kind: ApiResourceKind;
  /** Steps run after ValidateProto and before the domain step, in order. */
  readonly steps: ReadonlyArray<PipelineStep<Desc>>;
}

/**
 * Runs one RPC through the chain and answers the domain step's result.
 * The domain step receives the RequestContext (validated input, caller,
 * and the shaped newState when `shaping` ran) and returns the response;
 * it throws ConnectErrors for refusals.
 */
export async function runUnaryChain<Desc extends DescMessage, Out>(
  names: UnaryChainNames,
  method: DescMethod & { readonly input: Desc },
  input: MessageShape<Desc>,
  ctx: HandlerContext,
  deps: UnaryChainDeps,
  domain: (reqCtx: RequestContext<Desc>) => Promise<Out>,
  shaping?: UnaryChainShaping<Desc>,
): Promise<Out> {
  const reqCtx = new RequestContext(
    method.input,
    input,
    callerIdentityOf(ctx),
    shaping?.kind ?? ApiResourceKind.api_resource_kind_unknown,
  );
  let out: Out | undefined;
  let produced = false;
  const domainStep: PipelineStep<Desc> = {
    name: names.step,
    execute: async (stepCtx: RequestContext<Desc>): Promise<void> => {
      out = await domain(stepCtx);
      produced = true;
    },
  };
  const builder = newPipeline<Desc>(names.chain, deps.logger)
    .addStep(newAuthorizeStep(method, deps.authorizer))
    .addStep(newValidateProtoStep());
  for (const step of shaping?.steps ?? []) {
    builder.addStep(step);
  }
  await builder.addStep(domainStep).build().execute(reqCtx);
  if (!produced) {
    throw new Error(`chain ${names.chain} completed without a response`);
  }
  return out as Out;
}
