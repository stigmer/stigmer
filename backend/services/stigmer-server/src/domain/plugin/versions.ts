/**
 * Where a plugin keeps its version: the archive's digest is the hash, the
 * manifest version the tag when it fits. One binding serves the query
 * side's getByReference and listVersions and every server-side read of a
 * plugin a run lists (`loadPluginByReference`), so the two can never
 * disagree about what a version holds.
 */
import { create } from "@bufbuild/protobuf";

import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import {
  ListPluginVersionsResponseSchema,
  PluginVersionEntrySchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import type {
  ListPluginVersionsResponse,
  PluginVersionEntry,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import type { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { loadByReferenceWithVersion } from "../../pipeline/steps/version-history.js";
import type { VersionHistoryBinding } from "../../pipeline/steps/version-history.js";
import type { Store } from "../../store/interface.js";
import { pluginLiveTag } from "./push.js";

type ListVersionsDesc = typeof PluginQueryController.method.listVersions.input;

export /** Where a plugin keeps its hash and its tag, and how its history renders. */
const pluginVersionBinding: VersionHistoryBinding<
  typeof PluginSchema,
  ListVersionsDesc,
  PluginVersionEntry,
  ListPluginVersionsResponse
> = {
  kind: ApiResourceKind.plugin,
  schema: PluginSchema,
  noun: "plugin",
  headHashOf: (plugin) => plugin.status?.digest ?? "",
  liveTagOf: pluginLiveTag,
  // No overlayTag: a plugin's tag is its manifest version, which is
  // content, so a fetched version is never rewritten to another tag.
  input: (req) => req,
  mapEntry: (plugin, isCurrent, tag) => {
    const entry = create(PluginVersionEntrySchema, { isCurrent, tag });
    if (plugin.status !== undefined) {
      entry.digest = plugin.status.digest;
      entry.artifactStorageKey = plugin.status.artifactStorageKey;
      const specAudit = plugin.status.audit?.specAudit;
      if (specAudit !== undefined) {
        entry.pushedAt = specAudit.updatedAt ?? specAudit.createdAt;
        entry.pushedBy = specAudit.updatedBy ?? specAudit.createdBy;
      }
    }
    if (plugin.metadata?.version !== undefined) {
      entry.message = plugin.metadata.version.message;
    }
    return entry;
  },
  response: (versions, nextPageToken, totalCount) =>
    create(ListPluginVersionsResponseSchema, {
      versions,
      nextPageToken,
      totalCount,
    }),
};

/**
 * The plugin a reference names, at its version (the installed one when it
 * names none), the reference's organization or `org` when it names none.
 * NotFound names the plugin or the version; asks no authorization.
 */
export function loadPluginByReference(
  store: Store,
  ref: ApiResourceReference,
  org: string,
): Promise<Plugin> {
  return loadByReferenceWithVersion(store, pluginVersionBinding, {
    ...ref,
    org: ref.org === "" ? org : ref.org,
  });
}
