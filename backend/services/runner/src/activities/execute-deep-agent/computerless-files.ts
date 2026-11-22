/**
 * The Stigmer engine's file layer for a conversation without a computer:
 * the same paths the prompts name, standing on no filesystem. It replaces
 * the workspace backend and the platform route a turn with a computer gets
 * (`cas-capture-backend.ts`, `platform-route.ts`), for the parent graph and
 * every sub-agent alike; nothing in it can open a file on the runner, run a
 * command, or reach another conversation.
 *
 *  - `/` (everything not routed below): the agent's notes, kept in the
 *    conversation's saved state by deepagents' own `StateBackend`, which
 *    the `task` tool shares with every sub-agent (its `files` channel), as
 *    the workspace is shared today. A note is bounded
 *    ({@link MAX_NOTE_BYTES}) and so are all of them
 *    ({@link MAX_NOTES_BYTES}), well under the cloud's 4 MiB on one saved
 *    step; a write past either is refused with a sentence. The built-in
 *    `delete` tool is not offered (`deepagents-profiles.ts`), so a note
 *    frees its share by being edited down.
 *  - `/.stigmer/skills/`, `/.stigmer/plugins/`: the turn's skills and
 *    plugins from the store (`store-content-backend.ts` over the turn's
 *    skill reader, `shared/archive-reader.ts`).
 *  - `/.stigmer/uploads/`, `/.stigmer/inputs/`: the conversation's Files
 *    and an eval try's reference folders, read from the store when opened
 *    (`shared/inputs-reader.ts`); read-only.
 *  - `/.stigmer/outputs/`: this turn's outputs, held by the runner and
 *    returned as Files when the turn ends (`shared/outputs-buffer.ts`),
 *    listed over what the conversation's agent saved in earlier turns. An
 *    edit of an earlier output saves this turn's version; deleting one is
 *    refused, since it is already one of the person's Files.
 *  - `/large_tool_results/`, `/conversation_history/`: what is set aside
 *    from the context, its bytes in the runner's artifact storage
 *    (`shared/offload-store.ts`), only each path's key in the saved state,
 *    under {@link OFFLOAD_KEYS_ROOT}, which the notes never show. Routed
 *    only where the runner has artifact storage, so `routesOffloads` admits
 *    the layer only then; without it a long result is cut and not kept, as
 *    a turn without an offload route is today.
 *  - Any other path under `/.stigmer/`: nothing, read-only, in the
 *    platform route's own words.
 *
 * The prompts are unchanged but for one sentence of the working rules
 * (`prompt-builder.ts`). Plan mode's write-deny rules apply to the layer
 * as they apply to the workspace.
 */

import { posix } from "node:path";

import { CompositeBackend, StateBackend } from "deepagents";
import type {
  AnyBackendProtocol,
  BackendProtocolV2,
  DeleteResult,
  EditResult,
  FileDownloadResponse,
  FileUploadResponse,
  GlobResult,
  GrepResult,
  LsResult,
  ReadRawResult,
  ReadResult,
  WriteResult,
} from "deepagents";

import type { TurnStoreFiles } from "../../harness/types.js";
import type { TurnArchiveFiles } from "../../shared/archive-reader.js";
import { OUTPUTS_SUBDIR } from "../../shared/outputs.js";
import { OutputLimitError, OutputPathError, type TurnOutputFiles } from "../../shared/outputs-buffer.js";
import { InputFileNotFoundError, type TurnInputFiles } from "../../shared/inputs-reader.js";
import type { TurnOffloads } from "../../shared/offload-store.js";
import { editLoosely } from "./loose-edit.js";
import {
  DEEPAGENTS_HISTORY_ROOT,
  DEEPAGENTS_OFFLOAD_ROOT,
  OUTPUTS_ROUTE_PREFIX,
  PlatformRoutedBackend,
  readOnlyPlatformContent,
} from "./platform-route.js";
import { StoreContentBackend, type StoreFileInfo, type StoreFileSource } from "./store-content-backend.js";

/** The largest note: a quarter of the notes' budget. */
export const MAX_NOTE_BYTES = 256 * 1024;

/** The most all of a conversation's notes hold, far under the cloud's 4 MiB on one saved step. */
export const MAX_NOTES_BYTES = 1024 * 1024;

/** Where the saved state keeps each set-aside result's key: outside every path a note can take. */
export const OFFLOAD_KEYS_ROOT = "/.stigmer-set-aside/";

/** The folders under `.stigmer/` the conversation's inputs are read from. */
const INPUT_FOLDERS = ["uploads", "inputs"] as const;

/** The layer for one turn, shared by the parent graph and every sub-agent graph. */
export function computerlessFileBackend(files: TurnStoreFiles, archives: TurnArchiveFiles | undefined): PlatformRoutedBackend {
  const state = new StateBackend();
  const notes = new NotesBackend(state);
  const outputs = new StoredOutputsBackend(files.outputs, files.inputs);
  const routes: Record<string, AnyBackendProtocol> = {};
  for (const folder of archives?.folders ?? []) routes[`/${folder}/`] = new StoreContentBackend(folder, archives!);
  for (const folder of INPUT_FOLDERS) routes[`/${folder}/`] = new StoreContentBackend(folder, inputsUnder(files.inputs, folder), true);
  routes[`/${OUTPUTS_SUBDIR}/`] = outputs;
  const offloads =
    files.offloads === undefined
      ? {}
      : Object.fromEntries(
          [DEEPAGENTS_OFFLOAD_ROOT, DEEPAGENTS_HISTORY_ROOT].map((prefix) => [prefix, new SetAsideBackend(prefix, files.offloads!, state)]),
        );
  return new PlatformRoutedBackend(notes, new CompositeBackend(new NoOtherPlatformContent(), routes), outputs, offloads);
}

/** The reader's inputs under one folder. */
function inputsUnder(inputs: TurnInputFiles, folder: string): StoreFileSource {
  return {
    list: async () => (await inputs.list()).filter((file) => file.path.startsWith(`${folder}/`)),
    read: (path) => inputs.read(path),
  };
}

/** The UTF-8 size of a note's text. */
function bytesOf(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** Whether a state path is one of the keys {@link SetAsideBackend} keeps, never a note. */
function isSetAsideKey(path: string): boolean {
  return path === OFFLOAD_KEYS_ROOT.slice(0, -1) || path.startsWith(OFFLOAD_KEYS_ROOT);
}

/**
 * The agent's notes in the conversation's saved state (the header): deepagents'
 * `StateBackend`, with the budget held, an edit quoted loosely landing as it
 * does in the workspace (`loose-edit.ts`), and the set-aside keys out of
 * every answer.
 */
export class NotesBackend implements BackendProtocolV2 {
  constructor(private readonly state: StateBackend) {}

  async ls(path: string): Promise<LsResult> {
    const result = await this.state.ls(path);
    return { ...result, files: (result.files ?? []).filter((file) => !isSetAsideKey(file.path)) };
  }

  async read(filePath: string, offset?: number, limit?: number): Promise<ReadResult> {
    if (isSetAsideKey(filePath)) return { error: `File '${filePath}' not found` };
    return this.state.read(filePath, offset, limit);
  }

  async readRaw(filePath: string): Promise<ReadRawResult> {
    if (isSetAsideKey(filePath)) return { error: `File '${filePath}' not found` };
    return this.state.readRaw(filePath);
  }

  async grep(pattern: string, path?: string | null, glob?: string | null, maxCount?: number | null): Promise<GrepResult> {
    const result = await this.state.grep(pattern, path ?? "/", glob ?? null, maxCount ?? null);
    return { ...result, matches: (result.matches ?? []).filter((match) => !isSetAsideKey(match.path)) };
  }

  async glob(pattern: string, path = "/"): Promise<GlobResult> {
    const result = await this.state.glob(pattern, path);
    return { ...result, files: (result.files ?? []).filter((file) => !isSetAsideKey(file.path)) };
  }

  async write(filePath: string, content: string): Promise<WriteResult> {
    const refused = (await this.refusal(filePath, bytesOf(content))) ?? undefined;
    if (refused !== undefined) return { error: refused };
    return this.state.write(filePath, content);
  }

  async edit(filePath: string, oldString: string, newString: string, replaceAll?: boolean): Promise<EditResult> {
    if (isSetAsideKey(filePath)) return { error: `Error: File '${filePath}' not found` };
    return editLoosely(this, filePath, oldString, newString, replaceAll, async (exactOld, exactNew) => {
      const current = await this.textOf(filePath);
      if (current !== undefined && exactOld !== "") {
        const occurrences = current.split(exactOld).length - 1;
        const replaced = replaceAll === true ? occurrences : Math.min(occurrences, 1);
        const after = bytesOf(current) + replaced * (bytesOf(exactNew) - bytesOf(exactOld));
        const refused = await this.refusal(filePath, after);
        if (refused !== undefined) return { error: refused };
      }
      return this.state.edit(filePath, exactOld, exactNew, replaceAll);
    });
  }

  async delete(filePath: string): Promise<DeleteResult> {
    if (isSetAsideKey(filePath)) return { error: `Error: File '${filePath}' not found` };
    return this.state.delete(filePath);
  }

  async uploadFiles(files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    return files.map(([path]) => ({ path, error: "permission_denied" }));
  }

  async downloadFiles(paths: string[]): Promise<FileDownloadResponse[]> {
    const responses: FileDownloadResponse[] = [];
    for (const path of paths) {
      const text = isSetAsideKey(path) ? undefined : await this.textOf(path);
      responses.push(text === undefined ? { path, content: null, error: "file_not_found" } : { path, content: Buffer.from(text, "utf8"), error: null });
    }
    return responses;
  }

  /** Why a note may not become `size` bytes at `filePath`, or `undefined` when it may. */
  private async refusal(filePath: string, size: number): Promise<string | undefined> {
    if (!filePath.startsWith("/") || isSetAsideKey(filePath)) {
      return `Error: '${filePath}' is not a path for a note; notes are kept at paths like '/notes.md'`;
    }
    if (size > MAX_NOTE_BYTES) {
      return (
        `Error: '${filePath}' would be ${size} bytes. Notes are kept with this conversation, up to ${MAX_NOTE_BYTES} bytes each; ` +
        `keep it shorter, or save a deliverable for the person in ${OUTPUTS_ROUTE_PREFIX.slice(1)}`
      );
    }
    // Every note measured as the one being written is, in UTF-8 bytes:
    // the listing's sizes count UTF-16 units, which undercount most
    // scripts other than Latin's.
    let others = 0;
    for (const file of (await this.glob("**", "/")).files ?? []) {
      if (file.path === filePath || file.is_dir) continue;
      others += bytesOf((await this.textOf(file.path)) ?? "");
    }
    if (others + size > MAX_NOTES_BYTES) {
      return (
        `Error: writing '${filePath}' would bring this conversation's notes to ${others + size} bytes, over the ${MAX_NOTES_BYTES}-byte budget. ` +
        `Edit a note down to free space, or save a deliverable for the person in ${OUTPUTS_ROUTE_PREFIX.slice(1)}`
      );
    }
    return undefined;
  }

  /** A note's text, or `undefined` when there is none or it is not text. */
  private async textOf(filePath: string): Promise<string | undefined> {
    const raw = await this.state.readRaw(filePath);
    const content = raw.data?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return (content as string[]).join("\n");
    return undefined;
  }
}

/**
 * `.stigmer/outputs/` without a disk (the header): the turn's buffer listed
 * over the conversation's earlier outputs, read through the turn's reader.
 */
export class StoredOutputsBackend extends StoreContentBackend {
  constructor(
    private readonly buffer: TurnOutputFiles,
    private readonly inputs: TurnInputFiles,
  ) {
    super(OUTPUTS_SUBDIR, mergedOutputs(buffer, inputs), true);
  }

  override async write(filePath: string, content = ""): Promise<WriteResult> {
    return this.save(filePath, Buffer.from(content, "utf8"));
  }

  override async edit(filePath: string, oldString = "", newString = "", replaceAll?: boolean): Promise<EditResult> {
    return editLoosely(this, filePath, oldString, newString, replaceAll, async (exactOld, exactNew) => {
      const found = await this.open(filePath);
      if ("error" in found) return { error: `Error: File '${this.platformPath(filePath)}' not found` };
      const content = Buffer.from(found.bytes).toString("utf8");
      const replaced = replaceString(content, exactOld, exactNew, replaceAll === true);
      if (typeof replaced === "string") return { error: replaced };
      const saved = await this.save(filePath, Buffer.from(replaced[0], "utf8"));
      return saved.error !== undefined ? { error: saved.error } : { path: filePath, occurrences: replaced[1] };
    });
  }

  override async delete(filePath: string): Promise<DeleteResult> {
    if (posix.normalize(filePath) === "/") {
      return { error: `Error: '${OUTPUTS_ROUTE_PREFIX.slice(0, -1)}' is the outputs folder and stays; delete the files inside it instead` };
    }
    try {
      if (await this.buffer.delete(filePath)) return { path: filePath };
    } catch (err) {
      return { error: `Error: ${err instanceof Error ? err.message : String(err)}` };
    }
    const earlier = (await this.files_()).has(posix.normalize(filePath.startsWith("/") ? filePath : `/${filePath}`));
    return {
      error: earlier
        ? `Error: '${this.platformPath(filePath)}' was returned to the person in an earlier turn and stays one of the conversation's Files; save a new version instead`
        : `Error: File '${this.platformPath(filePath)}' not found`,
    };
  }

  override uploadFiles(files: Array<[string, Uint8Array]>): FileUploadResponse[] {
    return files.map(([path]) => ({ path, error: "permission_denied" }));
  }

  private async save(filePath: string, bytes: Uint8Array): Promise<WriteResult> {
    try {
      await this.buffer.write(filePath, bytes);
      return { path: filePath };
    } catch (err) {
      if (err instanceof OutputLimitError || err instanceof OutputPathError) return { error: `Error: ${err.message}` };
      throw err;
    }
  }
}

/** This turn's outputs over the earlier ones, as one source under `outputs/`; this turn's version of a path wins. */
function mergedOutputs(buffer: TurnOutputFiles, inputs: TurnInputFiles): StoreFileSource {
  const prefix = `${OUTPUTS_SUBDIR}/`;
  return {
    async list() {
      const files = new Map<string, StoreFileInfo>();
      for (const file of await inputs.list()) if (file.path.startsWith(prefix)) files.set(file.path, { path: file.path, size: file.size });
      for (const file of await buffer.list()) files.set(`${prefix}${file.path}`, { path: `${prefix}${file.path}`, size: file.size });
      return [...files.values()];
    },
    async read(path) {
      return (await buffer.read(path.slice(prefix.length))) ?? inputs.read(path);
    },
  };
}

/**
 * One of deepagents' offload roots without a disk (the header): a write
 * stores the bytes through the runner and keeps the key in the saved state
 * under {@link OFFLOAD_KEYS_ROOT}; a read finds the key there and asks the
 * runner for the bytes, in this turn or a later one.
 */
export class SetAsideBackend extends StoreContentBackend {
  constructor(
    private readonly prefix: string,
    private readonly offloads: TurnOffloads,
    private readonly state: StateBackend,
  ) {
    super(prefix.slice(1, -1), setAsideSource(prefix, offloads, state), true);
  }

  override async write(filePath: string, content = ""): Promise<WriteResult> {
    try {
      const key = await this.offloads.put(Buffer.from(content, "utf8"));
      const kept = await this.state.write(keyPathOf(this.prefix, filePath), `${key}\n${bytesOf(content)}`);
      return kept.error !== undefined ? { error: kept.error } : { path: filePath };
    } catch (err) {
      return { error: `Error: the result could not be set aside: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  override async edit(filePath: string): Promise<EditResult> {
    return { error: `Error: '${this.platformPath(filePath)}' is set aside from the conversation and is read-only` };
  }

  override async delete(filePath: string): Promise<DeleteResult> {
    return { error: `Error: '${this.platformPath(filePath)}' is set aside from the conversation and stays` };
  }

  override uploadFiles(files: Array<[string, Uint8Array]>): FileUploadResponse[] {
    return files.map(([path]) => ({ path, error: "permission_denied" }));
  }
}

/** Where the saved state keeps the key of `routedPath` under the offload root `prefix`. */
function keyPathOf(prefix: string, routedPath: string): string {
  return `${OFFLOAD_KEYS_ROOT}${prefix.slice(1, -1)}${routedPath.startsWith("/") ? routedPath : `/${routedPath}`}`;
}

/** The set-aside results under one offload root, by their keys in the saved state. */
function setAsideSource(prefix: string, offloads: TurnOffloads, state: StateBackend): StoreFileSource {
  const folder = prefix.slice(1, -1);
  const keysDir = `${OFFLOAD_KEYS_ROOT}${folder}/`;
  const keyOf = async (path: string): Promise<{ readonly key: string; readonly size: number } | undefined> => {
    const raw = await state.readRaw(`${OFFLOAD_KEYS_ROOT}${path}`);
    const content = raw.data?.content;
    if (typeof content !== "string") return undefined;
    const [key = "", size = "0"] = content.split("\n");
    return { key, size: Number(size) };
  };
  return {
    async list() {
      const files: StoreFileInfo[] = [];
      for (const file of (await state.glob("**", keysDir)).files ?? []) {
        if (file.is_dir) continue;
        const path = `${folder}/${file.path.slice(keysDir.length)}`;
        const found = await keyOf(path);
        if (found !== undefined) files.push({ path, size: found.size });
      }
      return files;
    },
    async read(path) {
      const found = await keyOf(path);
      if (found === undefined) throw new InputFileNotFoundError(path);
      return offloads.read(found.key);
    },
  };
}

/** deepagents' exact replacement (1.14 `performStringReplacement`), its words kept: the replaced text and the count, or the error. */
function replaceString(content: string, oldString: string, newString: string, replaceAll: boolean): [string, number] | string {
  if (content === "" && oldString === "") return [newString, 0];
  if (oldString === "") return "Error: oldString cannot be empty when file has content";
  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) return `Error: String not found in file: '${oldString}'`;
  if (occurrences > 1 && !replaceAll) {
    return `Error: String '${oldString}' has multiple occurrences (appears ${occurrences} times) in file. Use replace_all=True to replace all instances, or provide a more specific string with surrounding context.`;
  }
  return [content.split(oldString).join(newString), occurrences];
}

/**
 * `.stigmer/` itself and any path under it no route serves: nothing to
 * list or read, every write refused in the platform route's words.
 */
class NoOtherPlatformContent implements BackendProtocolV2 {
  ls(): LsResult {
    return { files: [] };
  }

  read(filePath: string): ReadResult {
    return { error: `Error reading file '${filePath}': ENOENT: no such file or directory` };
  }

  readRaw(filePath: string): ReadRawResult {
    return { error: `Error reading file '${filePath}': ENOENT: no such file or directory` };
  }

  grep(): GrepResult {
    return { matches: [] };
  }

  glob(): GlobResult {
    return { files: [] };
  }

  write(filePath: string): WriteResult {
    return { error: readOnlyPlatformContent(filePath) };
  }

  edit(filePath: string): EditResult {
    return { error: readOnlyPlatformContent(filePath) };
  }

  delete(filePath: string): DeleteResult {
    return { error: readOnlyPlatformContent(filePath) };
  }

  uploadFiles(files: Array<[string, Uint8Array]>): FileUploadResponse[] {
    return files.map(([path]) => ({ path, error: "permission_denied" }));
  }

  downloadFiles(paths: string[]): FileDownloadResponse[] {
    return paths.map((path) => ({ path, content: null, error: "file_not_found" }));
  }
}
