"use client";

/**
 * "Make a test case" on a run, opened under its scores: the server builds
 * the case (`eval.buildCaseFromRun`): the turn's request, the conversation
 * before it, each tool answer the run got as a stand-in, and a rubric to
 * fill in seeded with why the run went wrong. The person either downloads
 * that case folder as a zip whose one top-level directory is the case's
 * name, or adds it to one of the organization's evals as a new version
 * (`eval.addCaseFromRun`); the evals are listed only once the panel opens,
 * every page of them, the next read when the person asks for more. While
 * they load the panel says so, and a list that fails is shown as such,
 * never as an organization with no evals.
 * What the case leaves out (the server's notes) is listed after a
 * download, and the panel says that adding a case shows the conversation
 * to everyone who can read the eval.
 *
 * Pinned by `__tests__/MakeTestCasePanel.test.tsx`. All visual properties
 * flow through `--stgm-*` tokens.
 */

import { useState } from "react";
import { create } from "@bufbuild/protobuf";
import {
  AddEvalCaseFromRunRequestSchema,
  BuildEvalCaseFromRunRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/eval/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { cn } from "@stigmer/theme";
import { useEvals } from "../eval-run/useEvals.js";
import { useStigmer } from "../hooks.js";
import { downloadBinaryFile } from "../internal/download.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";

/** Props for {@link MakeTestCasePanel}. */
export interface MakeTestCasePanelProps {
  /** The run the case is made from. */
  readonly runId: string;
  /** The run's organization, whose evals the case may join. */
  readonly org: string;
}

const ACTION_CLASSES = cn(
  "stg:inline-flex stg:h-7 stg:items-center stg:rounded-md stg:border stg:border-border stg:px-2 stg:text-xs stg:text-foreground stg:transition",
  "stg:hover:bg-accent-hover",
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
  "stg:disabled:cursor-not-allowed stg:disabled:opacity-50",
);

/** Downloads a run as a test case, or adds it to an eval (the module header). */
export function MakeTestCasePanel({ runId, org }: MakeTestCasePanelProps) {
  const stigmer = useStigmer();
  const { evals, isLoading, error: listError, hasMore, loadMore, isLoadingMore, loadMoreError } = useEvals(org);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [notes, setNotes] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const evalId = chosen !== "" ? chosen : (evals[0]?.metadata?.id ?? "");

  const act = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const onDownload = (): Promise<void> =>
    act(async () => {
      const built = await stigmer.eval.buildCaseFromRun(
        create(BuildEvalCaseFromRunRequestSchema, { runId }),
      );
      downloadBinaryFile(built.artifact, `${built.caseName}.zip`, "application/zip");
      setNotes(built.notes);
      setStatus(`Downloaded ${built.caseName}.zip. Unzip it into an evals/ folder and fill in its rubric.`);
    });

  const onAdd = (): Promise<void> =>
    act(async () => {
      const added = await stigmer.eval.addCaseFromRun(
        create(AddEvalCaseFromRunRequestSchema, {
          runId,
          eval: { kind: ApiResourceKind.eval, org, id: evalId },
        }),
      );
      setNotes([]);
      setStatus(`Added to ${added.metadata?.slug ?? "the eval"} as a new version.`);
    });

  return (
    <div
      role="group"
      aria-label="Make a test case"
      className="stg:flex stg:flex-col stg:gap-2 stg:rounded-md stg:border stg:border-border stg:p-2 stg:text-xs stg:text-muted-foreground"
    >
      <p>
        A test case from this answer: its request, the conversation before it and the answers its tools gave, with a
        rubric to fill in.
      </p>
      <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-2">
        <button type="button" disabled={busy} onClick={() => void onDownload()} className={ACTION_CLASSES}>
          Download the case folder
        </button>
        {evals.length > 0 && (
          <>
            <select
              aria-label="Eval"
              value={evalId}
              disabled={busy}
              onChange={(event) => setChosen(event.target.value)}
              className="stg:h-7 stg:rounded-md stg:border stg:border-border stg:bg-background stg:px-1 stg:text-xs stg:text-foreground"
            >
              {evals.map((entry) => (
                <option key={entry.metadata?.id} value={entry.metadata?.id ?? ""}>
                  {entry.metadata?.slug}
                </option>
              ))}
            </select>
            <button type="button" disabled={busy} onClick={() => void onAdd()} className={ACTION_CLASSES}>
              Add to eval
            </button>
          </>
        )}
        {hasMore && (
          <button type="button" disabled={isLoadingMore} onClick={loadMore} className={ACTION_CLASSES}>
            Load more evals
          </button>
        )}
      </div>
      {isLoading ? (
        <p>Loading the organization's evals…</p>
      ) : listError !== null ? (
        <p role="alert" className="stg:text-destructive">
          The organization's evals could not be listed: {listError.message}
        </p>
      ) : evals.length > 0 ? (
        <p>Everyone who can read the eval will see this conversation.</p>
      ) : (
        <p>No evals in this organization yet: push one with stigmer push eval to add cases to it here.</p>
      )}
      {loadMoreError !== null && (
        <p role="alert" className="stg:text-destructive">
          More evals could not be listed: {loadMoreError.message}
        </p>
      )}
      {status !== null && <p role="status">{status}</p>}
      {notes.length > 0 && (
        <ul aria-label="What the case leaves out" className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:gap-0.5")}>
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {error !== null && (
        <p role="alert" className="stg:text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
