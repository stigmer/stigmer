/**
 * What a plugin eval's try attaches, per arm: the one place that decides
 * what "with the plugin" and "without the plugin" mean.
 *
 *   - with: the built-in assistant with the plugin under test listed in the
 *     session's `plugins`, at the archive the eval stamped (the reference's
 *     version is its digest), so the try runs the plugin whole: its skills,
 *     its agents, its hooks and its MCP servers;
 *   - without: the built-in assistant with nothing attached.
 *
 * Both arms run the same assistant, so the difference between them is the
 * plugin and nothing else: no prompt of an agent rides along, and
 * `status.provisional_delta` is false (PROVISIONAL_DELTA).
 *
 * Proven by __tests__/arm.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { toolServerSegment } from "@stigmer/plugin-package";

/** Whether the arms' comparison also measures something beside the plugin (the module header). */
export const PROVISIONAL_DELTA = false;

/** A try's arm. */
export type EvalArm = "with" | "without";

/** What the arms need to know of the installed plugin. */
export interface PluginAttachmentFacts {
  /** The plugin's organization. */
  readonly org: string;
  /** The plugin's slug, which the with-plugin arm's reference names. */
  readonly slug: string;
  /** The archive the eval stamped, which the reference pins. */
  readonly digest: string;
  /**
   * Each of the plugin's MCP servers as a turn names it,
   * `plugin_<plugin>_<server>` (`toolServerSegment`), in entry order: the
   * names a try's lists turn the servers off by, and the ones its trace
   * reads.
   */
  readonly serverSegments: ReadonlyArray<string>;
}

/** What a try's session attaches. */
export interface ArmAttachment {
  /** The plugins the session lists; empty runs the assistant alone. */
  readonly plugins: ReadonlyArray<ApiResourceReference>;
}

export function armAttachment(
  arm: EvalArm,
  plugin: Pick<PluginAttachmentFacts, "org" | "slug" | "digest">,
): ArmAttachment {
  switch (arm) {
    case "without":
      return { plugins: [] };
    case "with":
      return {
        plugins: [
          create(ApiResourceReferenceSchema, {
            org: plugin.org,
            kind: ApiResourceKind.plugin,
            slug: plugin.slug,
            version: plugin.digest,
          }),
        ],
      };
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhausted: never = arm;
      return exhausted;
    }
  }
}

/** The plugin's facts, from the row the eval loaded at the digest it stamped. */
export function pluginAttachmentFacts(plugin: Plugin, digest: string): PluginAttachmentFacts {
  const name = plugin.metadata?.name ?? "";
  return {
    org: plugin.metadata?.org ?? "",
    slug: plugin.metadata?.slug ?? "",
    digest,
    serverSegments: (plugin.status?.mcpServers ?? []).map((server) => toolServerSegment(name, server.name)),
  };
}
