/**
 * NormalizeReferences + ValidateReferences — port
 * steps/normalize_references.go and steps/validate_references.go, sharing
 * one spec walker (as the Go files share theirs).
 *
 * NormalizeReferences fills EMPTY org fields in ApiResourceReference
 * messages inside the spec from the resource's own metadata.org, so stored
 * references are absolute; explicit orgs (cross-org refs) are preserved.
 * Only the spec is walked — status is system-generated and already
 * absolute. Runs after BuildNewState/BuildUpdateState, before Persist.
 *
 * ValidateReferences verifies spec references point at existing resources
 * — strict FAILED_PRECONDITION for missing MCP servers (an agent whose MCP
 * server is missing cannot execute its declared tools). Runs AFTER
 * NormalizeReferences so orgs are resolved.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ReflectMessage } from "@bufbuild/protobuf/reflect";

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Store } from "../../store/interface.js";
import { failedPreconditionError, internalError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { findResourceBySlug } from "./helpers.js";
import { messageFieldByName, metadataOf } from "./shapes.js";

const API_RESOURCE_REFERENCE_TYPE =
  "ai.stigmer.commons.apiresource.ApiResourceReference";

export function newNormalizeReferencesStep<Desc extends DescMessage>(): PipelineStep<Desc> {
  return {
    name: "NormalizeReferences",
    execute(ctx: RequestContext<Desc>): void {
      const metadata = metadataOf(ctx.newState);
      if (metadata === undefined) {
        throw internalError(new Error("resource metadata is nil"), "normalize references");
      }
      // No org to resolve from — skip silently; required-org validation is
      // the validation step's responsibility, not this one's.
      if (metadata.org === "") {
        return;
      }
      forEachSpecReference(ctx.schema, ctx.newState, (ref) => {
        const orgField = ref.fields.find((f) => f.name === "org");
        if (orgField !== undefined && (ref.get(orgField) as string) === "") {
          ref.set(orgField, metadata.org);
        }
      });
    },
  };
}

export function newValidateReferencesStep<Desc extends DescMessage>(
  store: Store,
): PipelineStep<Desc> {
  return {
    name: "ValidateReferences",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const refs: Array<{ kind: number; slug: string; org: string }> = [];
      forEachSpecReference(ctx.schema, ctx.newState, (ref) => {
        refs.push({
          kind: numberField(ref, "kind"),
          slug: stringField(ref, "slug"),
          org: stringField(ref, "org"),
        });
      });

      const missingMcpServers: string[] = [];
      for (const ref of refs) {
        if (ref.slug === "") {
          continue;
        }
        // Per-kind validation, exactly Go's switch: only mcp_server today.
        if (ref.kind === ApiResourceKind.mcp_server) {
          const found = await findResourceBySlug(
            store,
            ApiResourceKind.mcp_server,
            McpServerSchema,
            ref.slug,
            ref.org,
          );
          if (found === undefined) {
            missingMcpServers.push(`'${ref.slug}' (org: ${ref.org})`);
          }
        }
      }

      if (missingMcpServers.length > 0) {
        throw failedPreconditionError(
          `referenced MCP server(s) not found: ${missingMcpServers.join(", ")}. ` +
            "Verify the slug and org are correct. " +
            "Use 'stigmer get mcp-servers' to list available MCP servers.",
        );
      }
    },
  };
}

/**
 * Walks the resource's spec and invokes fn on every ApiResourceReference
 * (singular, repeated, and map-valued message fields, recursively) —
 * the shared traversal behind both steps (Go walkAndResolveOrg /
 * walkAndCollectRefs). Mutations through the ReflectMessage write through.
 */
function forEachSpecReference(
  schema: DescMessage,
  msg: Parameters<typeof reflect>[1],
  fn: (ref: ReflectMessage) => void,
): void {
  const root = reflect(schema, msg);
  const specField = messageFieldByName(root, "spec");
  if (specField === undefined || !root.isSet(specField)) {
    return;
  }
  walk(root.get(specField), fn);
}

function walk(msg: ReflectMessage, fn: (ref: ReflectMessage) => void): void {
  for (const field of msg.fields) {
    if (field.fieldKind === "list") {
      if (field.listKind !== "message") {
        continue;
      }
      for (const item of msg.get(field)) {
        visit(item as ReflectMessage, fn);
      }
    } else if (field.fieldKind === "map") {
      if (field.mapKind !== "message") {
        continue;
      }
      const map = msg.get(field);
      for (const [, value] of map) {
        visit(value as ReflectMessage, fn);
      }
    } else if (field.fieldKind === "message") {
      if (!msg.isSet(field)) {
        continue;
      }
      visit(msg.get(field), fn);
    }
  }
}

function visit(sub: ReflectMessage, fn: (ref: ReflectMessage) => void): void {
  if (sub.desc.typeName === API_RESOURCE_REFERENCE_TYPE) {
    fn(sub);
  } else {
    walk(sub, fn);
  }
}

function stringField(msg: ReflectMessage, name: string): string {
  const field = msg.fields.find((f) => f.name === name);
  if (field === undefined) {
    return "";
  }
  const value = msg.get(field);
  return typeof value === "string" ? value : "";
}

function numberField(msg: ReflectMessage, name: string): number {
  const field = msg.fields.find((f) => f.name === name);
  if (field === undefined) {
    return 0;
  }
  const value = msg.get(field);
  return typeof value === "number" ? value : 0;
}
