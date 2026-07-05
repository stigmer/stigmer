"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { GetArtifactContentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** How long the transient `copied` flag stays true after a successful copy. */
const COPIED_FEEDBACK_MS = 2000;

/** Return value of {@link useArtifactCopy}. */
export interface UseArtifactCopyReturn {
  /**
   * Fetch the artifact's text at click time and write it to the clipboard.
   * No-op when the execution id is unknown or a copy is already in flight.
   * Resolves once the copy has been attempted.
   *
   * @param storageKey - Storage key of the artifact to copy.
   */
  readonly copy: (storageKey: string) => Promise<void>;

  /** `true` while the content is being fetched / written to the clipboard. */
  readonly isCopying: boolean;

  /**
   * `true` for a brief window after a successful copy (drives "Copied"
   * affordance feedback), then resets automatically.
   */
  readonly copied: boolean;

  /** Error from the last failed copy attempt, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Behavior hook that copies an execution artifact's text to the clipboard on
 * demand.
 *
 * The imperative sibling of {@link useArtifactDownload}: it fetches content at
 * click time via `getArtifactContent` (CORS-safe, through the Stigmer API)
 * rather than requiring the caller to have loaded it. This suits content-free
 * surfaces — a plan card that detects the artifact by convention and never
 * fetches until the user acts — where a mount-time {@link useArtifactContent}
 * would be wasteful.
 *
 * Returns an imperative `copy(storageKey)` action plus a transient `copied`
 * flag for feedback, mirroring the modal's copy affordance so every surface
 * shares one implementation.
 *
 * @param executionId - Execution that produced the artifacts, or `null` to
 *   disable (the action becomes a no-op).
 *
 * @example
 * ```tsx
 * const { copy, isCopying, copied } = useArtifactCopy(executionId);
 * <button onClick={() => copy(artifact.storageKey)} disabled={isCopying}>
 *   {copied ? "Copied" : "Copy"}
 * </button>
 * ```
 *
 * @see useArtifactDownload — imperative save-to-disk counterpart
 * @see useArtifactContent — declarative content reader (preview rendering)
 */
export function useArtifactCopy(
  executionId: string | null,
): UseArtifactCopyReturn {
  const stigmer = useStigmer();
  const [isCopying, setIsCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Clear the pending "copied" timer on unmount so a resolved copy never sets
  // state on an unmounted component.
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    };
  }, []);

  const copy = useCallback(
    async (storageKey: string) => {
      if (!executionId || !storageKey || isCopying) return;
      setIsCopying(true);
      setError(null);
      try {
        const result = await stigmer.agentExecution.getArtifactContent(
          create(GetArtifactContentRequestSchema, { executionId, storageKey }),
        );
        const text = new TextDecoder().decode(result.content);
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
      } catch (err) {
        setError(toError(err));
      } finally {
        setIsCopying(false);
      }
    },
    [executionId, stigmer, isCopying],
  );

  return useMemo(
    () => ({ copy, isCopying, copied, error }),
    [copy, isCopying, copied, error],
  );
}
