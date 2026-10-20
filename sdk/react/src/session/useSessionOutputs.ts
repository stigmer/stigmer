"use client";

/**
 * Pure derivation of what a conversation's agent saved: the Files its turns
 * returned (what agents saved in their outputs folder), one entry per output
 * path, newest turn winning, with the earlier versions behind it.
 *
 * Trade-offs:
 * - Only Files a turn returned are listed; a person's uploads carry no run
 *   id and stay out (they are the conversation's inputs, listed by
 *   `useSessionGivenFiles`).
 * - Identity is the output path, so a later turn saving `reports/q3.md` again
 *   takes the entry, the way a folder shows one file per path; the earlier
 *   Files at that path stay reachable in `earlier`, so no turn's output is
 *   lost from view.
 */

import { useMemo } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { isTerminalPhase } from "../run/run-phases.js";

/**
 * One output File, with what content views and Apply gating need about the
 * turn that returned it.
 */
export interface SessionOutputEntry {
  /** The File the latest turn to save at this path returned. */
  readonly file: StigmerFile;
  /**
   * The older Files saved at the same output path by earlier turns, newest
   * first (the oldest last). Empty when one turn saved the path.
   */
  readonly earlier: readonly StigmerFile[];
  /** ID of the run that returned this File. */
  readonly runId: string;
  /** Whether the run that returned it has ended. */
  readonly isTerminal: boolean;
  /**
   * `true` when another entry shares this File's filename at a different
   * output path. Consumers render the path's folder to tell them apart.
   */
  readonly hasNameCollision: boolean;
}

/** Return value of {@link useSessionOutputs}. */
export interface UseSessionOutputsReturn {
  /** One entry per output path, sorted by filename. */
  readonly outputs: readonly SessionOutputEntry[];
  /** `true` when at least one turn returned a File. */
  readonly hasOutputs: boolean;
  /** Number of entries (output paths, not versions). */
  readonly outputCount: number;
}

/**
 * The stable identity of an output within a conversation: its output path
 * (where the agent saved it under the outputs folder), falling back to the
 * filename.
 *
 * This is the SINGLE source of truth for output identity across three sites
 * that must agree or a tab could fail to resolve its File:
 * 1. de-duplication here (newest turn wins per key),
 * 2. the virtual-document tab `path` when an output opens in the editor area
 *    (see `SessionViewer` / `useSessionPanel.openArtifact`), and
 * 3. the `outputKey → entry` lookup that renders the open tab's document.
 *
 * Its basename doubles as the editor tab's label (paths render as their last
 * `/` segment in `EditorTabs`).
 */
export function outputKey(file: StigmerFile): string {
  return file.status?.outputPath || file.spec?.filename || file.metadata?.id || "";
}

/**
 * Pure derivation hook that lists the Files a conversation's turns returned,
 * one per output path, sorted by filename — like a file explorer over the
 * conversation's outputs.
 *
 * @param files - The conversation's Files, newest first (`useSessionFiles`).
 * @param runs - The conversation's runs, in chronological order. A File's
 *   turn decides which of two Files at one path wins (the later turn) and
 *   whether the File's turn has ended.
 *
 * @example
 * ```tsx
 * const { files } = useSessionFiles(org, sessionId, refreshKey);
 * const { outputs } = useSessionOutputs(files, runs);
 * ```
 */
export function useSessionOutputs(
  files: readonly StigmerFile[],
  runs: readonly Run[],
): UseSessionOutputsReturn {
  return useMemo(() => deriveSessionOutputs(files, runs), [files, runs]);
}

/**
 * The derivation behind {@link useSessionOutputs}, for non-hook callers
 * and tests.
 */
export function deriveSessionOutputs(
  files: readonly StigmerFile[],
  runs: readonly Run[],
): UseSessionOutputsReturn {
  const runOrder = new Map<string, { readonly index: number; readonly terminal: boolean }>();
  runs.forEach((run, index) => {
    const id = run.metadata?.id;
    if (!id) return;
    runOrder.set(id, {
      index,
      terminal: isTerminalPhase(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED),
    });
  });

  // Oldest first, so a later write to the same key wins: by the turn's place
  // in the conversation, then by list position (the list is newest first).
  // A File whose run is not loaded registered at that run's end, so it ranks
  // before every loaded run and counts as ended.
  const outputs = files
    .map((file, position) => ({ file, position, runId: file.status?.runId ?? "" }))
    .filter((output) => output.runId !== "")
    .sort((a, b) => {
      const ia = runOrder.get(a.runId)?.index ?? -1;
      const ib = runOrder.get(b.runId)?.index ?? -1;
      return ia !== ib ? ia - ib : b.position - a.position;
    });

  const entryMap = new Map<string, SessionOutputEntry>();
  for (const { file, runId } of outputs) {
    const key = outputKey(file);
    const previous = entryMap.get(key);
    entryMap.set(key, {
      file,
      earlier: previous ? [previous.file, ...previous.earlier] : [],
      runId,
      isTerminal: runOrder.get(runId)?.terminal ?? true,
      hasNameCollision: false,
    });
  }

  const entries = Array.from(entryMap.values());
  entries.sort((a, b) =>
    filenameOf(a.file).localeCompare(filenameOf(b.file), undefined, { sensitivity: "base" }),
  );

  const nameCount = new Map<string, number>();
  for (const entry of entries) {
    const lower = filenameOf(entry.file).toLowerCase();
    nameCount.set(lower, (nameCount.get(lower) ?? 0) + 1);
  }
  const result = entries.map((entry) =>
    (nameCount.get(filenameOf(entry.file).toLowerCase()) ?? 0) > 1
      ? { ...entry, hasNameCollision: true }
      : entry,
  );

  return {
    outputs: result,
    hasOutputs: result.length > 0,
    outputCount: result.length,
  };
}

function filenameOf(file: StigmerFile): string {
  return file.spec?.filename ?? "";
}
