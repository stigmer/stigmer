/**
 * What every member of a plugin inherits from the plugin: the
 * organization, the two reserved labels (the plugin's id for membership,
 * the archive digest for convergence) and the visibility. One function
 * stamps a child's metadata so the four materialisers cannot disagree on
 * how a member is marked, and one type carries the plugin's identity into
 * them so none reaches back into the head.
 */
import { create } from "@bufbuild/protobuf";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { ApiResourceMetadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import {
  PLUGIN_LABEL,
  PLUGIN_VERSION_LABEL,
} from "../../../pipeline/apiresource-labels.js";

/** The plugin, as its members see it. */
export interface PluginIdentity {
  readonly org: string;
  /** The plugin's resource id — the membership label's value. */
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  /** The archive digest — the convergence label's value. */
  readonly digest: string;
  /** The level every member takes; unspecified means the child kind's default. */
  readonly visibility: ApiResourceVisibility;
}

/** The two labels a member carries, and nothing else the plugin owns. */
export function memberLabels(identity: PluginIdentity): Record<string, string> {
  return {
    [PLUGIN_LABEL]: identity.id,
    [PLUGIN_VERSION_LABEL]: identity.digest,
  };
}

/**
 * A member's metadata: the plugin's org and visibility, the member's own
 * name and slug, the plugin's labels merged OVER any the overlay author
 * wrote (an author may label their agent; they may not claim membership of
 * another plugin, and the sanitiser has already refused every reserved key
 * an author tried).
 */
export function memberMetadata(
  identity: PluginIdentity,
  member: { readonly name: string; readonly slug: string },
  authored?: ApiResourceMetadata,
): ApiResourceMetadata {
  const metadata =
    authored === undefined ? create(ApiResourceMetadataSchema, {}) : authored;
  metadata.org = identity.org;
  metadata.name = member.name;
  metadata.slug = member.slug;
  metadata.id = "";
  if (
    identity.visibility !==
    ApiResourceVisibility.api_resource_visibility_unspecified
  ) {
    metadata.visibility = identity.visibility;
  }
  metadata.labels = { ...metadata.labels, ...memberLabels(identity) };
  return metadata;
}
