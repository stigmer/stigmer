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

import type { Authorizer, AuthzDecision } from "../../extensions/authorizer.js";
import { internalError } from "../errors.js";
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
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      if (ctx.callerIdentity.callerClass === "internal") {
        return;
      }
      if (getOption(method, is_public) || getOption(method, is_skip_authorization)) {
        return;
      }
      if (!hasOption(method, rpcAuthorizationConfig)) {
        return;
      }
      const config = getOption(method, rpcAuthorizationConfig);

      const decision = await runAuthorizer(authorizer, ctx, config);
      switch (decision.kind) {
        case "allow":
          return;
        case "deny":
          throw new ConnectError(
            config.errorMsg !== ""
              ? config.errorMsg
              : decision.reason !== ""
                ? decision.reason
                : AUTHORIZATION_DENIED_FALLBACK_MESSAGE,
            Code.PermissionDenied,
          );
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
    },
  };
}

/**
 * An Authorizer that THROWS is an evaluation failure by definition —
 * normalized into the unavailable arm so a buggy implementation can never
 * soften an outage into a denial by accident.
 */
async function runAuthorizer<Desc extends DescMessage>(
  authorizer: Authorizer,
  ctx: RequestContext<Desc>,
  config: RpcAuthorizationConfig,
): Promise<AuthzDecision> {
  try {
    return await authorizer.authorize(ctx.callerIdentity, {
      permission: config.permission,
      resourceKind: resolveResourceKind(ctx.input, config),
      resourceId: resolveResourceId(ctx.input, config),
    });
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
