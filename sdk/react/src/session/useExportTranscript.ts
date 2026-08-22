"use client";

import { useCallback, useMemo, useState } from "react";
import {
  fetchSessionTranscript,
  resolvedSubject,
  transcriptToJson,
  transcriptToMarkdown,
  type SessionTranscript,
} from "@stigmer/sdk";
import { toast } from "../feedback/toast.js";
import { useStigmer } from "../hooks.js";
import { downloadTextFile } from "../internal/download.js";
import { generateSlug } from "../internal/slug.js";
import { toError } from "../internal/toError.js";

/** Options for {@link useExportTranscript}. */
export interface UseExportTranscriptOptions {
  /**
   * Keep turns replaced by edit-and-resubmit in the export, marked as
   * superseded. Defaults to `false` — the conversation as the viewer
   * shows it.
   */
  readonly includeSuperseded?: boolean;
}

/** Return value of {@link useExportTranscript}. */
export interface UseExportTranscriptReturn {
  /** Copy the whole conversation as Markdown to the clipboard. */
  readonly copyMarkdown: () => Promise<void>;
  /** Download the whole conversation as a Markdown file. */
  readonly downloadMarkdown: () => Promise<void>;
  /** Download the whole conversation as a structured JSON file. */
  readonly downloadJson: () => Promise<void>;
  /** `true` while a transcript fetch (and offload resolution) is in flight. */
  readonly isExporting: boolean;
  /** The last export failure, or `null`. Cleared when a new export starts. */
  readonly error: Error | null;
}

/**
 * Behavior hook that exports a session's whole conversation — thinking,
 * tool calls with offloaded outputs resolved, sub-agent turns, timestamps —
 * as Markdown (copy or download) or structured JSON (stigmer/stigmer#814).
 *
 * Lazy: nothing is fetched until an action is invoked. Each action fetches
 * the canonical transcript via `fetchSessionTranscript` (the SDK's one
 * authoritative assembly), so every export surface produces identical
 * content. Feedback follows the `useExportResource` convention: toasts for
 * success/failure, plus a typed `error` for hosts that render their own.
 *
 * @example
 * ```tsx
 * const exporter = useExportTranscript(sessionId);
 *
 * <ActionMenu.Item onSelect={exporter.copyMarkdown}>Copy transcript</ActionMenu.Item>
 * <ActionMenu.Item onSelect={exporter.downloadMarkdown}>Download .md</ActionMenu.Item>
 * <ActionMenu.Item onSelect={exporter.downloadJson}>Download .json</ActionMenu.Item>
 * ```
 */
export function useExportTranscript(
  sessionId: string | null,
  options?: UseExportTranscriptOptions,
): UseExportTranscriptReturn {
  const stigmer = useStigmer();
  const includeSuperseded = options?.includeSuperseded === true;
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchTranscript = useCallback((): Promise<SessionTranscript> => {
    if (!sessionId) {
      return Promise.reject(
        new Error(
          "Cannot export a transcript without a session id. Pass the session's " +
            "id to useExportTranscript once the session exists.",
        ),
      );
    }
    return fetchSessionTranscript(stigmer, sessionId, { includeSuperseded });
  }, [stigmer, sessionId, includeSuperseded]);

  const copyMarkdown = useCallback(async (): Promise<void> => {
    setError(null);
    setIsExporting(true);
    const markdown = fetchTranscript().then(
      (t) => transcriptToMarkdown(t, { generatedAt: new Date().toISOString() }),
    );
    try {
      // The transcript is fetched before it can be copied, and WebKit (the
      // desktop app's webview) only honors clipboard writes inside the user
      // gesture's task — a plain writeText after the await is rejected
      // there. ClipboardItem accepts a promise, letting the write start
      // synchronously in the gesture while the content resolves.
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": markdown.then(
              (text) => new Blob([text], { type: "text/plain" }),
            ),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(await markdown);
      }
      toast.success("Transcript copied to clipboard");
    } catch (e) {
      const err = toError(e);
      setError(err);
      toast.error(`Couldn't copy the transcript: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  }, [fetchTranscript]);

  const download = useCallback(
    async (serialize: (t: SessionTranscript) => { content: string; extension: string; mimeType: string }): Promise<void> => {
      setError(null);
      setIsExporting(true);
      try {
        const transcript = await fetchTranscript();
        const { content, extension, mimeType } = serialize(transcript);
        downloadTextFile(
          content,
          `${transcriptFilename(transcript)}.${extension}`,
          mimeType,
        );
      } catch (e) {
        const err = toError(e);
        setError(err);
        toast.error(`Couldn't export the transcript: ${err.message}`);
      } finally {
        setIsExporting(false);
      }
    },
    [fetchTranscript],
  );

  const downloadMarkdown = useCallback(
    () =>
      download((t) => ({
        content: transcriptToMarkdown(t, {
          generatedAt: new Date().toISOString(),
        }),
        extension: "md",
        mimeType: "text/markdown",
      })),
    [download],
  );

  const downloadJson = useCallback(
    () =>
      download((t) => ({
        content: JSON.stringify(transcriptToJson(t), null, 2),
        extension: "json",
        mimeType: "application/json",
      })),
    [download],
  );

  return useMemo(
    () => ({ copyMarkdown, downloadMarkdown, downloadJson, isExporting, error }),
    [copyMarkdown, downloadMarkdown, downloadJson, isExporting, error],
  );
}

/** `<subject-slug>-transcript`, falling back to the session id. */
function transcriptFilename(transcript: SessionTranscript): string {
  const subject = resolvedSubject(transcript.session.spec?.subject);
  const slug = subject ? generateSlug(subject).slice(0, 60) : "";
  return `${slug || transcript.session.metadata?.id || "session"}-transcript`;
}
