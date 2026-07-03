"use client";

import { useCallback, useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { StigmerError } from "@stigmer/sdk";
import {
  ListWorkflowVersionsInputSchema,
  type WorkflowVersionEntry as ProtoWorkflowVersionEntry,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/version_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import type { VersionEntry } from "../version-history/types.js";

const CODE_UNIMPLEMENTED = 12;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Return value of {@link useWorkflowVersions}. */
export interface UseWorkflowVersionsReturn {
  /** Version entries mapped to the generic timeline format (newest first). */
  readonly versions: readonly VersionEntry[];
  /** `true` when no versions are available (RPC unimplemented or empty response). */
  readonly isEmpty: boolean;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request (excludes UNIMPLEMENTED), or `null`. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
  /**
   * Look up the validated YAML for a version by its hash.
   * Returns `null` if the version hash is not found or has no YAML content.
   */
  readonly getValidatedYaml: (versionHash: string) => string | null;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

/**
 * Data hook that fetches version history for a workflow.
 *
 * Calls the `listVersions` RPC via the SDK client and maps the response
 * to generic {@link VersionEntry} objects for the `VersionTimeline`
 * component.
 *
 * **Graceful degradation**: If the backend returns UNIMPLEMENTED (the
 * RPC handler hasn't been deployed yet), the hook treats it as an empty
 * response — `versions` is `[]` and `isEmpty` is `true`. No error is
 * surfaced to the consumer.
 *
 * Pass `null` for `org` or `slug` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { versions, isEmpty, isLoading } = useWorkflowVersions("acme", "deploy-pipeline");
 *
 * if (!isEmpty) {
 *   return <VersionTimeline entries={versions} />;
 * }
 * ```
 */
export function useWorkflowVersions(
  org: string | null,
  slug: string | null,
): UseWorkflowVersionsReturn {
  const stigmer = useStigmer();

  const {
    data: rawVersions,
    isLoading,
    error,
    refetch,
  } = useFetch(
    org && slug
      ? async () => {
          try {
            const request = create(ListWorkflowVersionsInputSchema, {
              org,
              slug,
            });
            const response = await stigmer.workflow.listVersions(request);
            return response.versions;
          } catch (err) {
            if (isUnimplemented(err)) return [];
            throw err;
          }
        }
      : null,
    [org, slug, stigmer],
    [] as ProtoWorkflowVersionEntry[],
  );

  const versions = useMemo(
    () => rawVersions.map(mapProtoToVersionEntry),
    [rawVersions],
  );

  const validatedYamlMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of rawVersions) {
      if (entry.versionHash && entry.validatedYaml) {
        map.set(entry.versionHash, entry.validatedYaml);
      }
    }
    return map;
  }, [rawVersions]);

  const getValidatedYaml = useCallback(
    (versionHash: string): string | null =>
      validatedYamlMap.get(versionHash) ?? null,
    [validatedYamlMap],
  );

  const isEmpty = versions.length === 0;

  return useMemo(
    () => ({ versions, isEmpty, isLoading, error, refetch, getValidatedYaml }),
    [versions, isEmpty, isLoading, error, refetch, getValidatedYaml],
  );
}

// ---------------------------------------------------------------------------
// Proto → generic mapping
// ---------------------------------------------------------------------------

function mapProtoToVersionEntry(proto: ProtoWorkflowVersionEntry): VersionEntry {
  return {
    id: proto.versionHash,
    timestamp: proto.appliedAt ? timestampDate(proto.appliedAt) : new Date(0),
    actor: proto.appliedBy
      ? {
          id: proto.appliedBy.id,
          avatar: proto.appliedBy.avatar || undefined,
          displayName: undefined,
        }
      : undefined,
    label: proto.versionHash.slice(0, 12),
    sublabel: proto.message || undefined,
    isCurrent: proto.isCurrent,
    tag: proto.tag || undefined,
    gitProvenance: proto.gitProvenance
      ? {
          remoteUrl: proto.gitProvenance.remoteUrl,
          ref: proto.gitProvenance.ref,
          commit: proto.gitProvenance.commit,
        }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Error detection
// ---------------------------------------------------------------------------

function isUnimplemented(err: unknown): boolean {
  return err instanceof StigmerError && err.connectCode === CODE_UNIMPLEMENTED;
}
