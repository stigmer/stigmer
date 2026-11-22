/**
 * The turn's skills and plugins as a read-only file tree the Stigmer
 * engine's file tools read, standing on no filesystem: every answer comes
 * from the turn's reader (`shared/archive-reader.ts`), which lists a
 * skill's files from the store and fetches one file's bytes when it is
 * opened. Mounted at `/.stigmer/skills/` and `/.stigmer/plugins/` beside the
 * platform folder's own route (`platform-route.ts`), so the paths the
 * prompts name are unchanged, in every conversation, with a computer or
 * without one; a conversation with a computer still has the read-only disk
 * copy its commands run, but the text the model reads through its file
 * tools is always the verified version.
 *
 * Built the way {@link NoPlatformContentBackend} is: a hand-written V2
 * backend. Its answers equal what the platform route's `FilesystemBackend`
 * gives for the same files, which a parity test holds
 * (`__tests__/store-content-backend.test.ts`):
 *
 *  - `ls` lists a folder's entries from the listing (a folder is any prefix
 *    of a listed path), folders with a trailing slash; a file or a missing
 *    path lists nothing.
 *  - `read` pages text 500 lines at a time by deepagents' own pagination,
 *    says an empty file is empty, answers a non-text file with its bytes and
 *    a MIME type from its extension, and a folder as not found.
 *  - `grep` is literal, as deepagents' own fallback search is: no pattern is
 *    compiled from the model's text. It skips non-text files and files over
 *    10 MB, and opens only the files it searches; `glob` matches listed
 *    paths, reading none.
 *  - Writes, edits and deletes are refused with the platform route's
 *    sentence (`readOnlyPlatformContent`).
 *
 * deepagents does not export its MIME rule, so the non-text-plain entries of
 * its table (deepagents 1.14 `getMimeType`) are copied here; every other
 * extension is text/plain there and here. The parity test reads every entry
 * of this table through both backends, so a drift in either is caught.
 *
 * A path's text in a message names it as the platform route would
 * (`/skills/<name>/…`), and a path in a result is relative to this route.
 *
 * The same tree serves every read-only folder a conversation without a
 * computer reads from the store (`computerless-files.ts`): its Files under
 * `uploads/`, an eval try's reference folders under `inputs/`, and, live
 * and writable through a subclass there, its outputs and the results it set
 * aside. Each hands a {@link StoreFileSource}; a live one is listed on every
 * call, since a write changes it.
 */

import { posix } from "node:path";

import type {
  BackendProtocolV2,
  DeleteResult,
  EditResult,
  FileDownloadResponse,
  FileInfo,
  FileUploadResponse,
  GlobResult,
  GrepMatch,
  GrepResult,
  LsResult,
  ReadRawResult,
  ReadResult,
  WriteResult,
} from "deepagents";
import { applyGrepMaxCount, normalizeReadPagination } from "deepagents";
import picomatch from "picomatch";

import { ArchiveFileNotFoundError } from "../../shared/archive-reader.js";
import { InputFileNotFoundError } from "../../shared/inputs-reader.js";
import { readOnlyPlatformContent } from "./platform-route.js";

/** One file of a store-backed tree, by its path under the platform folder (`<route>/…`). */
export interface StoreFileInfo {
  readonly path: string;
  readonly size: number;
}

/** What a store-backed tree lists and reads; a path it does not hold throws a not-found error of the reader's. */
export interface StoreFileSource {
  list(): Promise<readonly StoreFileInfo[]>;
  read(path: string): Promise<Uint8Array>;
}

/** Whether a reader's error says the path is not one of its files. */
export function isNotFound(err: unknown): boolean {
  return err instanceof ArchiveFileNotFoundError || err instanceof InputFileNotFoundError;
}


/** deepagents' "this file is empty" reminder (1.14 `EMPTY_CONTENT_WARNING`). */
const EMPTY_CONTENT_WARNING = "System reminder: File exists but has empty contents";

/** The largest file `grep` searches, as deepagents' filesystem backend's default (10 MB). */
const GREP_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** A listing's timestamps: the store keeps none, so every file reports the epoch. */
const NO_TIME = new Date(0).toISOString();

/** deepagents 1.14 `MIME_TYPES`, its non-text/plain entries (the header). */
export const NON_PLAIN_MIME_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".aiff": "audio/aiff",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mpeg": "video/mpeg",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".flv": "video/x-flv",
  ".mpg": "video/mpeg",
  ".wmv": "video/x-ms-wmv",
  ".3gpp": "video/3gpp",
  ".pdf": "application/pdf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".csv": "text/csv",
  ".xml": "text/xml",
  ".json": "application/json",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".cjs": "application/javascript",
};

export function mimeTypeOf(path: string): string {
  return NON_PLAIN_MIME_TYPES[posix.extname(path).toLocaleLowerCase()] ?? "text/plain";
}

export function isText(mimeType: string): boolean {
  return mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/javascript" || mimeType === "image/svg+xml";
}

/** One route's files: the reader's listing under `route/`, by route-relative path (`/<name>/…`). */
export class StoreContentBackend implements BackendProtocolV2 {
  private listing: Promise<ReadonlyMap<string, StoreFileInfo>> | undefined;

  /** `live`: list on every call (a tree a write changes), never once per backend. */
  constructor(
    protected readonly route: string,
    private readonly files: StoreFileSource,
    private readonly live = false,
  ) {}

  async ls(path: string): Promise<LsResult> {
    const dir = asDir(path);
    const children = new Map<string, FileInfo>();
    for (const [filePath, file] of await this.files_()) {
      if (!filePath.startsWith(dir)) continue;
      const rest = filePath.slice(dir.length);
      const slash = rest.indexOf("/");
      if (slash === -1) {
        children.set(filePath, { path: filePath, is_dir: false, size: file.size, modified_at: NO_TIME });
      } else {
        const child = `${dir}${rest.slice(0, slash)}/`;
        children.set(child, { path: child, is_dir: true, size: 0, modified_at: NO_TIME });
      }
    }
    return { files: [...children.values()].sort((a, b) => a.path.localeCompare(b.path)) };
  }

  async read(filePath: string, offset = 0, limit = 500): Promise<ReadResult> {
    const found = await this.open(filePath);
    if ("error" in found) return { error: found.error };
    const mimeType = mimeTypeOf(filePath);
    if (!isText(mimeType)) return { content: found.bytes, mimeType };
    const content = Buffer.from(found.bytes).toString("utf8");
    if (content.trim() === "") return { content: EMPTY_CONTENT_WARNING, mimeType };
    const { offset: start, limit: count } = normalizeReadPagination(offset, limit);
    const lines = content.split("\n");
    const totalLines = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
    if (start >= totalLines) return { error: `Line offset ${start} exceeds file length (${totalLines} lines)` };
    const selected = lines.slice(start, Math.min(start + count, lines.length));
    if (selected.length === 0 || count === 0) return { content: selected.join("\n"), mimeType };
    const endLine = Math.min(start + count, totalLines);
    return {
      content: selected.join("\n"),
      mimeType,
      totalLines,
      startLine: start + 1,
      endLine,
      nextOffset: endLine < totalLines ? endLine : undefined,
    };
  }

  async readRaw(filePath: string): Promise<ReadRawResult> {
    const found = await this.open(filePath);
    if ("error" in found) return { error: found.error };
    const mimeType = mimeTypeOf(filePath);
    const content = isText(mimeType) ? Buffer.from(found.bytes).toString("utf8") : found.bytes;
    return { data: { content, mimeType, created_at: NO_TIME, modified_at: NO_TIME } };
  }

  async grep(pattern: string, path?: string | null, glob?: string | null, maxCount?: number | null): Promise<GrepResult> {
    const base = path || "/";
    const listing = await this.files_();
    const inScope = listing.has(base) ? [base] : [...listing.keys()].filter((filePath) => filePath.startsWith(asDir(base)));
    const accepts = glob ? picomatch(glob) : undefined;
    const matches: GrepMatch[] = [];
    for (const filePath of inScope) {
      const file = listing.get(filePath)!;
      if (!isText(mimeTypeOf(filePath)) || file.size > GREP_MAX_FILE_BYTES) continue;
      if (accepts !== undefined && !accepts(posix.basename(filePath))) continue;
      const found = await this.open(filePath);
      if ("error" in found) continue;
      const lines = Buffer.from(found.bytes).toString("utf8").split("\n");
      lines.forEach((line, index) => {
        if (line.includes(pattern)) matches.push({ path: filePath, line: index + 1, text: line });
      });
    }
    return applyGrepMaxCount({ result: { matches }, maxCount });
  }

  async glob(pattern: string, path = "/"): Promise<GlobResult> {
    const dir = asDir(path);
    const accepts = picomatch(pattern.startsWith("/") ? pattern.slice(1) : pattern, { dot: true });
    const files: FileInfo[] = [];
    for (const [filePath, file] of await this.files_()) {
      if (filePath.startsWith(dir) && accepts(filePath.slice(dir.length))) {
        files.push({ path: filePath, is_dir: false, size: file.size, modified_at: NO_TIME });
      }
    }
    return { files: files.sort((a, b) => a.path.localeCompare(b.path)) };
  }

  async write(filePath: string, _content?: string): Promise<WriteResult> {
    return { error: readOnlyPlatformContent(this.platformPath(filePath)) };
  }

  async edit(filePath: string, _oldString?: string, _newString?: string, _replaceAll?: boolean): Promise<EditResult> {
    return { error: readOnlyPlatformContent(this.platformPath(filePath)) };
  }

  async delete(filePath: string): Promise<DeleteResult> {
    return { error: readOnlyPlatformContent(this.platformPath(filePath)) };
  }

  uploadFiles(files: Array<[string, Uint8Array]>): FileUploadResponse[] {
    return files.map(([path]) => ({ path, error: "permission_denied" }));
  }

  async downloadFiles(paths: string[]): Promise<FileDownloadResponse[]> {
    const responses: FileDownloadResponse[] = [];
    for (const path of paths) {
      const found = await this.open(path);
      responses.push("error" in found ? { path, content: null, error: "file_not_found" } : { path, content: found.bytes, error: null });
    }
    return responses;
  }

  /** The listing under this route, by route-relative path; read once per backend (every call when live), a failed read not kept. */
  protected files_(): Promise<ReadonlyMap<string, StoreFileInfo>> {
    if (this.live) this.listing = undefined;
    this.listing ??= this.files.list().then(
      (all) => {
        const prefix = `${this.route}/`;
        return new Map(all.filter((file) => file.path.startsWith(prefix)).map((file) => [`/${file.path.slice(prefix.length)}`, file]));
      },
      (err: unknown) => {
        // Never kept: the next call asks again.
        this.listing = undefined;
        throw err;
      },
    );
    return this.listing;
  }

  /** A file's bytes, or the answer deepagents' filesystem backend gives for a path that is not one. */
  protected async open(filePath: string): Promise<{ readonly bytes: Uint8Array } | { readonly error: string }> {
    const listing = await this.files_();
    const shown = this.platformPath(filePath);
    if (!listing.has(filePath)) {
      const isDir = [...listing.keys()].some((candidate) => candidate.startsWith(asDir(filePath)));
      return { error: isDir ? `File '${shown}' not found` : `Error reading file '${shown}': ENOENT: no such file or directory` };
    }
    try {
      return { bytes: await this.files.read(`${this.route}${filePath}`) };
    } catch (err) {
      if (isNotFound(err)) return { error: `Error reading file '${shown}': ENOENT: no such file or directory` };
      return { error: `Error reading file '${shown}': ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /** The path as the platform route's backend names it: under the platform folder. */
  protected platformPath(routedPath: string): string {
    return `/${this.route}${routedPath}`;
  }
}

/** A route-relative folder path with its trailing slash; `/` for the route's root. */
function asDir(path: string): string {
  const normalized = posix.normalize(path.startsWith("/") ? path : `/${path}`);
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}
