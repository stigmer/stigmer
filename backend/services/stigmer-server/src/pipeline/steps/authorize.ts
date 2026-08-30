/**
 * Authorize — the ONE shared authorization step (O2, 20260827.01; DD-007
 * §3), added explicitly as the FIRST .addStep of every pipeline chain
 * (ruling Q1: visible and greppable — step order is OSS-owned contract,
 * never hidden behind a chain-builder wrapper).
 *
 * The step reads the same declarative proto method options the Java
 * edition's authorization step reads — `(ai.stigmer.commons.rpc.config)`,
 * `is_public` (50057), `is_skip_authorization` (50058) — resolves the
 * check target from the request, and maps the Authorizer's three decision
 * arms to the wire:
 *
 *   allow       → the chain proceeds;
 *   deny        → PERMISSION_DENIED, carrying the annotation's byte-pinned
 *                 `error_msg` (the reason arm is the fallback copy);
 *   not-found   → NOT_FOUND with the load-first chain's copy (the C2
 *                 ruling-Q1 refinement: a resource-scoped check on a
 *                 nonexistent id answers what Java's load-before-authorize
 *                 order answers, stigmer#224);
 *   unavailable → INTERNAL — an authorization-backend outage is NEVER
 *                 softened into a denial (the verified Java StepResult
 *                 lesson, DD-007's wire-visible contract).
 *
 * Skip arms, in order: the `internal` caller class (the in-process chain's
 * own calls — the TS rendering of the Java in-process authorization skip,
 * ruling Q4), `is_public`, `is_skip_authorization`, and methods carrying
 * no config at all (no authorization requirement is declared; the O2
 * coverage inventory records every such method, so C1/C2 inherit the map
 * instead of discovering it).
 *
 * Resolution never throws: an unresolvable `field_path` yields an empty
 * resource id and an unresolvable `resource_kind_path` yields the unknown
 * kind — the check still reaches the Authorizer, which owns the decision.
 * A thrown resolution would be a NEW wire behavior on requests that are
 * legal today (byte-identity forbids it); an implementation that wants to
 * refuse empty ids does so as a deny, visibly.
 *
 * `authorizeDirect` is the SAME evaluation exported for the direct
 * handlers — the config-annotated methods that deliberately run no
 * pipeline (streams cannot run in the pipeline executor; the rest are
 * ported direct forms, docs/authorization-coverage.md). One evaluation,
 * two entry shapes; a direct handler calls it after its own input
 * validation and before any load or side effect, mirroring the Java
 * edition's validate → authorize handler order (C2 Stage 4 ruling,
 * 20260827.10). The optional target override serves the one lane whose
 * true target is server-side state rather than caller input
 * (completeOAuthConnect authorizes the PENDING RECORD's server id — a
 * caller-supplied id would be a confused-deputy hole, the Java
 * McpServerCompleteOAuthConnectHandler discipline).
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { DescMethod, DescMessage, Message } from "@bufbuild/protobuf";
import { getOption, hasOption } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { RpcAuthorizationConfig } from "@stigmer/protos/ai/stigmer/commons/rpc/authorization_config_pb";
import {
  config as rpcAuthorizationConfig,
  is_public,
  is_skip_authorization,
} from "@stigmer/protos/ai/stigmer/commons/rpc/method_options_pb";

import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { getKindName } from "../apiresource-meta.js";
import { internalError, notFoundError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";

/**
 * The wire copy for the unavailable arm — static and sanitized (#478):
 * the backend's real error rides ConnectError.cause into the server log,
 * never to an anonymous caller.
 */
export const AUTHORIZATION_UNAVAILABLE_MESSAGE =
  "authorization check could not be completed";

/** The deny copy when the method's annotation carries no error_msg. */
export const AUTHORIZATION_DENIED_FALLBACK_MESSAGE = "permission denied";

/**
 * The OSS default Authorizer: the permissive single-team posture (DD-007
 * §3) — one trust domain, every authenticated caller may do everything,
 * exactly the pre-O2 behavior. Installed by the composition root when no
 * extension registers an Authorizer (the default lives with the consumer
 * that defines its semantics — registry.ts contract).
 */
export function newPermissiveSingleTeamAuthorizer(): Authorizer {
  return {
    authorize(): Promise<AuthzDecision> {
      return Promise.resolve({ kind: "allow" });
    },
  };
}

/**
 * Builds the Authorize step for one RPC method. The descriptor comes in
 * at construction (descriptors are static imports — the apiresource.ts
 * idiom); the caller identity comes from the RequestContext at execution.
 */
export function newAuthorizeStep<Desc extends DescMessage>(
  method: DescMethod,
  authorizer: Authorizer,
): PipelineStep<Desc> {
  return {
    name: "Authorize",
    execute(ctx: RequestContext<Desc>): Promise<void> {
      return authorizeDirect(method, authorizer, ctx.callerIdentity, ctx.input);
    },
  };
}

/**
 * The one lane whose authorization target is server-side state rather
 * than a request field (see the module header). `resourceId` replaces the
 * annotation's `field_path`/`resource_id` resolution; everything else —
 * skip arms, kind, permission, copy — still comes from the annotation.
 */
export interface AuthorizeTargetOverride {
  readonly resourceId: string;
}

/**
 * The Authorize evaluation for direct handlers: identical skip arms,
 * target resolution, and decision-to-wire mapping as the pipeline step
 * (which delegates here). Throws the mapped ConnectError on any
 * non-allow arm; resolves on allow and on every skip arm.
 */
export async function authorizeDirect(
  method: DescMethod,
  authorizer: Authorizer,
  identity: CallerIdentity,
  input: Message,
  override?: AuthorizeTargetOverride,
): Promise<void> {
  if (identity.callerClass === "internal") {
    return;
  }
  if (
    getOption(method, is_public) ||
    getOption(method, is_skip_authorization)
  ) {
    return;
  }
  if (!hasOption(method, rpcAuthorizationConfig)) {
    return;
  }
  const config = getOption(method, rpcAuthorizationConfig);

  return authorizeResolvedResource(
    authorizer,
    identity,
    {
      permission: config.permission,
      resourceKind: resolveResourceKind(input, config),
      resourceId: override?.resourceId ?? resolveResourceId(input, config),
    },
    config.errorMsg,
  );
}

/**
 * The SAME evaluation for a check whose target the HANDLER resolved —
 * the mid-chain resolved-id pattern DD-007 names ("the pattern the two
 * traced ListVersions handlers port onto", shipped by
 * 20260830.01.sp.list-read-scoping ruling Q8). It serves the
 * `is_skip_authorization` lanes whose Java baseline runs a hand-rolled
 * check the declarative annotation cannot express (a mid-chain resolved
 * id, a two-field target dispatch): the skip annotation makes the
 * position-1 step a no-op, and the handler calls THIS at the Java
 * baseline's exact position instead. Skip arms deliberately reduce to
 * the `internal` class alone — the annotation skips do not apply because
 * the caller IS the enforcement the annotation opted out of.
 *
 * `errorMsg` is the lane's byte-pinned deny copy (the Java handler's
 * error_msg); empty falls back to the Authorizer's reason, then the
 * shared fallback — the authorizeDirect precedence exactly.
 */
export async function authorizeResolvedResource(
  authorizer: Authorizer,
  identity: CallerIdentity,
  check: AuthzCheck,
  errorMsg: string,
): Promise<void> {
  if (identity.callerClass === "internal") {
    return;
  }
  const decision = await runAuthorizer(authorizer, identity, check);
  switch (decision.kind) {
    case "allow":
      return;
    case "deny":
      throw new ConnectError(
        errorMsg !== ""
          ? errorMsg
          : decision.reason !== ""
            ? decision.reason
            : AUTHORIZATION_DENIED_FALLBACK_MESSAGE,
        Code.PermissionDenied,
      );
    case "not-found": {
      // The ruling-Q1 arm: the exact copy the load-first chain would
      // answer for the missing id (LoadTarget's notFoundError), so
      // the wire cannot distinguish which step spoke.
      if (
        check.resourceId === "" ||
        check.resourceKind === ApiResourceKind.api_resource_kind_unknown
      ) {
        throw internalError(
          new Error(
            "authorizer answered not-found for a non-resource-scoped check",
          ),
          AUTHORIZATION_UNAVAILABLE_MESSAGE,
        );
      }
      throw notFoundError(getKindName(check.resourceKind), check.resourceId);
    }
    case "unavailable":
      throw internalError(decision.cause, AUTHORIZATION_UNAVAILABLE_MESSAGE);
    default: {
      const exhaustive: never = decision;
      throw internalError(
        new Error(`unknown decision ${JSON.stringify(exhaustive)}`),
        AUTHORIZATION_UNAVAILABLE_MESSAGE,
      );
    }
  }
}

/**
 * An Authorizer that THROWS is an evaluation failure by definition —
 * normalized into the unavailable arm so a buggy implementation can never
 * soften an outage into a denial by accident.
 */
async function runAuthorizer(
  authorizer: Authorizer,
  identity: CallerIdentity,
  check: AuthzCheck,
): Promise<AuthzDecision> {
  try {
    return await authorizer.authorize(identity, check);
  } catch (error) {
    return {
      kind: "unavailable",
      cause: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/** Static kind, or the resource_kind_path read, or unknown — never a throw. */
function resolveResourceKind(
  input: Message,
  config: RpcAuthorizationConfig,
): ApiResourceKind {
  if (config.resourceKindPath === "") {
    return config.resourceKind;
  }
  const value = resolveDotPath(input, config.resourceKindPath);
  return typeof value === "number"
    ? (value as ApiResourceKind)
    : ApiResourceKind.api_resource_kind_unknown;
}

/** Static resource_id, or the field_path read, or "" — never a throw. */
function resolveResourceId(
  input: Message,
  config: RpcAuthorizationConfig,
): string {
  if (config.resourceId !== "") {
    return config.resourceId;
  }
  if (config.fieldPath === "") {
    return "";
  }
  const value = resolveDotPath(input, config.fieldPath);
  return typeof value === "string" ? value : "";
}

/**
 * Walks a proto-snake-case dot path ("metadata.org") over the generated
 * message's camelCase properties. Undefined at any absent link — the
 * caller maps that to its empty value.
 */
function resolveDotPath(input: Message, path: string): unknown {
  let current: unknown = input;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[snakeToCamel(segment)];
  }
  return current;
}

/** "agent_execution_id" → "agentExecutionId" (protobuf-es property names). */
function snakeToCamel(segment: string): string {
  return segment.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}
