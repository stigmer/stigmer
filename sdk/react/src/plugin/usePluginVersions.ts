"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  ListPluginVersionsInputSchema,
  type PluginVersionEntry as ProtoPluginVersionEntry,
} from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useCursorPages } from "../internal/useCursorPages.js";
import type { VersionEntry } from "../version-history/types.js";

/** Return value of {@link usePluginVersions}. */
export interface UsePluginVersionsReturn {
  /** Version entries mapped to the generic timeline format (newest first). */
  readonly versions: readonly VersionEntry[];
  /** `true` when the plugin has no recorded versions. */
  readonly isEmpty: boolean;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null`. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
  /** `true` while the server holds entries beyond those loaded. */
  readonly hasMore: boolean;
  /** Load the next page. No-op while one is loading or when nothing follows. */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` read is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. */
  readonly loadMoreError: Error | null;
}

/**
 * Data hook that fetches the version history of an installed plugin and
 * maps it to the generic {@link VersionEntry} the `VersionTimeline` renders.
 * A version's id is its archive digest; its tag is the manifest version
 * when that fits the tag pattern. The history pages newest first
 * (`hasMore` / `loadMore` for older versions). Pass `null` to skip fetching.
 */
export function usePluginVersions(org: string | null, slug: string | null): UsePluginVersionsReturn {
  const stigmer = useStigmer();

  const pages = useCursorPages<ProtoPluginVersionEntry>(
    org && slug
      ? (pageToken) => stigmer.plugin.listVersions(create(ListPluginVersionsInputSchema, { org, slug, pageToken }))
      : null,
    [org, slug, stigmer],
    (entry) => entry.digest,
  );
  const raw = pages.items;
  const { hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch } = pages;

  const versions = useMemo(() => raw.map(toVersionEntry), [raw]);
  const isEmpty = versions.length === 0;

  return useMemo(
    () => ({ versions, isEmpty, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch }),
    [versions, isEmpty, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch],
  );
}

function toVersionEntry(proto: ProtoPluginVersionEntry): VersionEntry {
  return {
    id: proto.digest,
    timestamp: proto.pushedAt ? timestampDate(proto.pushedAt) : new Date(0),
    actor: proto.pushedBy
      ? { id: proto.pushedBy.id, avatar: proto.pushedBy.avatar || undefined, displayName: undefined }
      : undefined,
    label: proto.digest.slice(0, 12),
    sublabel: proto.message || undefined,
    isCurrent: proto.isCurrent,
    tag: proto.tag || undefined,
  };
}
