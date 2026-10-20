"use client";

/**
 * The picker a routine names its Files with: the Library's Files (those of
 * no conversation the caller can see), chosen into a list, each with a
 * remove button, plus "Upload a file", which uploads to the Library and
 * picks the result.
 *
 * Trade-offs:
 * - The list offered is the Library's set, not every File the caller can
 *   see: a conversation's Files belong to that conversation and go with it,
 *   so a routine that named one would break when the conversation is
 *   deleted.
 * - Order carries no meaning (each File lands at its own name), so the
 *   picker offers no reordering.
 * - The server asks again at save whether each File exists, is the
 *   organization's and is viewable by the writer, and refuses deleting a
 *   File a routine names; the picker only offers what can pass.
 */

import { useCallback, useId, useMemo, useRef } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { cn } from "@stigmer/design-tokens";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { LIST_PAGE_MAX, readEveryPage } from "../internal/everyPage.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { listLibraryFilesPage } from "./fileListFn.js";
import { FileUploadButton } from "./FileUploadButton.js";

const NO_FILES: readonly StigmerFile[] = [];

/** Props for {@link FilePicker}. */
export interface FilePickerProps {
  /** Organization id to list Files from (a slug is also accepted). */
  readonly org: string;
  /** The chosen Files' ids. */
  readonly value: readonly string[];
  /** Called when the choice changes. */
  readonly onChange: (fileIds: string[]) => void;
  /** Disable all interactions. */
  readonly disabled?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Multi-select over the Library's Files, with an upload that picks what it
 * uploaded.
 *
 * @example
 * ```tsx
 * <FilePicker org="acme" value={fileIds} onChange={setFileIds} />
 * ```
 */
export function FilePicker({ org, value, onChange, disabled = false, className }: FilePickerProps) {
  const stigmer = useStigmer();
  const selectId = useId();
  const { data: files, isLoading, error, refetch } = useFetch<readonly StigmerFile[]>(
    org
      ? () =>
          readEveryPage((pageToken) =>
            listLibraryFilesPage(stigmer, org, { pageSize: LIST_PAGE_MAX, pageToken }),
          )
      : null,
    [stigmer, org],
    NO_FILES,
  );

  const chosen = useMemo(() => new Set(value), [value]);
  const available = useMemo(
    () => files.filter((file) => !chosen.has(file.metadata?.id ?? "")),
    [files, chosen],
  );
  const nameOf = useCallback(
    (id: string) => files.find((file) => file.metadata?.id === id)?.spec?.filename ?? id,
    [files],
  );

  // The latest choice, so uploads that finish together each add to what
  // the one before them added rather than to the value of their render.
  const latest = useRef(value);
  latest.current = value;
  const add = useCallback(
    (id: string) => {
      if (!id || latest.current.includes(id)) return;
      const next = [...latest.current, id];
      latest.current = next;
      onChange(next);
    },
    [onChange],
  );

  const handleUploaded = useCallback(
    (file: StigmerFile) => {
      refetch();
      add(file.metadata?.id ?? "");
    },
    [refetch, add],
  );

  return (
    <div className={cn("stg:space-y-3", className)} role="group" aria-label="Files">
      {value.length > 0 && (
        <ul role="list" aria-label="Chosen files" className={`${UNSTYLED_LIST} stg:space-y-1`}>
          {value.map((id) => (
            <li
              key={id}
              className="stg:flex stg:items-center stg:gap-2 stg:rounded-md stg:border stg:border-border stg:px-2.5 stg:py-1.5 stg:text-sm"
            >
              <span className="stg:min-w-0 stg:flex-1 stg:truncate stg:text-foreground">{nameOf(id)}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((chosenId) => chosenId !== id))}
                aria-label={`Remove ${nameOf(id)}`}
                className="stg:shrink-0 stg:text-xs stg:text-muted-foreground stg:transition-colors stg:hover:text-foreground stg:disabled:opacity-50 stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-2">
        <label htmlFor={selectId} className="stg:sr-only">
          Add a file
        </label>
        <select
          id={selectId}
          value=""
          disabled={disabled || isLoading || available.length === 0}
          onChange={(event) => add(event.target.value)}
          className="stg:h-8 stg:min-w-0 stg:flex-1 stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2 stg:text-sm stg:text-foreground stg:disabled:opacity-50 stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
        >
          <option value="" disabled>
            {isLoading
              ? "Loading files…"
              : available.length === 0
                ? files.length === 0
                  ? "No files in the Library yet"
                  : "Every file is chosen"
                : "Add a file from the Library…"}
          </option>
          {available.map((file) => (
            <option key={file.metadata?.id} value={file.metadata?.id}>
              {file.spec?.filename}
            </option>
          ))}
        </select>
        {!disabled && <FileUploadButton org={org} label="Upload a file" onUploaded={handleUploaded} />}
      </div>

      {error && (
        <p role="alert" className="stg:text-xs stg:text-destructive">
          {error.message}
        </p>
      )}
    </div>
  );
}
