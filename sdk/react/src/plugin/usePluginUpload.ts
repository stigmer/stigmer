"use client";

/**
 * Behaviour hook behind the upload path: a folder or a zip the user handed
 * over becomes a `PreparedInstall`, or a refusal the component renders.
 *
 * The pick arrives three ways (a `webkitdirectory` input's files, a drop's
 * items walked into root-relative pairs, a `.zip` file) and each becomes a
 * `LocalPick` through `sources/local.ts`; the preparation is the one every
 * client runs. The hook owns the phases (`idle`, `preparing`, `prepared`,
 * `refused`) and nothing visual, so a host that wants its own drop zone
 * imports the hook alone.
 *
 * A drop walks `DataTransferItem.webkitGetAsEntry()` directory entries
 * with `readEntries` until a batch comes back empty (the API hands out at
 * most a hundred per call), which is the only way a browser exposes a
 * dropped folder's contents; a dropped `.zip` file is read as a zip.
 */

import { useCallback, useMemo, useState } from "react";
import {
  type LocalFile,
  type LocalPick,
  LocalPluginError,
  folderPick,
  folderPickFromInput,
  prepareLocalPlugin,
  zipPick,
} from "./sources/local.js";
import { PluginReadRefusal, type PreparedInstall } from "./sources/read.js";

export type PluginUploadPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "preparing"; readonly name: string }
  | { readonly kind: "prepared"; readonly prepared: PreparedInstall }
  /** The reader's refusal (`PluginReadRefusal`), a local refusal (`LocalPluginError`), or anything else the read threw. */
  | { readonly kind: "refused"; readonly error: Error; readonly pick: LocalPick["kind"] | null };

/** Return value of {@link usePluginUpload}. */
export interface UsePluginUploadReturn {
  readonly phase: PluginUploadPhase;
  /** The files of an `<input type="file" webkitdirectory multiple>` pick. */
  readonly fromFolderInput: (files: ArrayLike<File>) => Promise<void>;
  /** One `.zip` file, from an input or a drop. */
  readonly fromZip: (file: File) => Promise<void>;
  /** The items of a drop: a directory is walked, a `.zip` is read, anything else is refused. */
  readonly fromDrop: (items: DataTransferItemList, files: FileList) => Promise<void>;
  /** Back to the drop zone. */
  readonly reset: () => void;
}

const ZIP_EXTENSION = /\.zip$/i;

export function usePluginUpload(): UsePluginUploadReturn {
  const [phase, setPhase] = useState<PluginUploadPhase>({ kind: "idle" });

  const prepare = useCallback(async (pick: () => Promise<LocalPick>, name: string, kind: LocalPick["kind"]) => {
    setPhase({ kind: "preparing", name });
    try {
      const prepared = await prepareLocalPlugin(await pick());
      setPhase({ kind: "prepared", prepared });
    } catch (error) {
      setPhase({
        kind: "refused",
        error: error instanceof Error ? error : new Error(String(error)),
        pick: kind,
      });
    }
  }, []);

  const fromFolderInput = useCallback(
    (files: ArrayLike<File>) => {
      const first = files[0];
      const name = first?.webkitRelativePath.split("/")[0] || "folder";
      return prepare(async () => folderPickFromInput(files), name, "folder");
    },
    [prepare],
  );

  const fromZip = useCallback((file: File) => prepare(() => zipPick(file), file.name, "zip"), [prepare]);

  const fromDrop = useCallback(
    async (items: DataTransferItemList, files: FileList) => {
      const entry = items[0]?.webkitGetAsEntry?.() ?? null;
      if (entry !== null && entry.isDirectory) {
        return prepare(
          async () => folderPick(entry.name, await walkDirectory(entry as FileSystemDirectoryEntry, "")),
          entry.name,
          "folder",
        );
      }
      const file = files[0];
      if (file !== undefined && ZIP_EXTENSION.test(file.name)) return fromZip(file);
      setPhase({
        kind: "refused",
        error: new LocalPluginError("drop a plugin folder or a .zip of one", "empty"),
        pick: null,
      });
    },
    [prepare, fromZip],
  );

  const reset = useCallback(() => setPhase({ kind: "idle" }), []);

  return useMemo(() => ({ phase, fromFolderInput, fromZip, fromDrop, reset }), [phase, fromFolderInput, fromZip, fromDrop, reset]);
}

/** Every file under a dropped directory entry as root-relative pairs; `readEntries` is drained batch by batch. */
async function walkDirectory(directory: FileSystemDirectoryEntry, prefix: string): Promise<LocalFile[]> {
  const out: LocalFile[] = [];
  const reader = directory.createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    for (const entry of batch) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory) {
        out.push(...(await walkDirectory(entry as FileSystemDirectoryEntry, path)));
      } else if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
        out.push({ path, file });
      }
    }
  }
  return out;
}

/** Whether `error` is the reader's "no manifest" refusal of a folder pick: the shape a browser that drops dotfiles produces. */
export function looksLikeDroppedDotfiles(phase: PluginUploadPhase): boolean {
  return (
    phase.kind === "refused" &&
    phase.pick === "folder" &&
    phase.error instanceof PluginReadRefusal &&
    phase.error.errors.some((finding) => finding.kind === "no-manifest")
  );
}
