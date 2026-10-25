/**
 * The workspace's own instruction files (`AGENTS.md`, else `CLAUDE.md`): which
 * are read, and the words they are shown to the model in, for every engine
 * that shows them in its own prompt (the native engine,
 * `execute-deep-agent/repository-instructions.ts`, and the Claude engine,
 * `execute-claude/prompt.ts`; Cursor reads its own through its setting
 * sources).
 *
 * Many repositories keep a short file for coding agents that says how the
 * project builds, tests and is laid out. The roots' files (the workspace
 * root and each entry's root directory) go in the system prompt, beneath
 * the agent's instructions, read once per turn at setup, so an edit reaches
 * the next turn and the prompt is constant within one. The native engine
 * also shows a deeper folder's file with the first read beneath it
 * (`middleware/folder-instructions.ts`).
 *
 * WHICH FILE, PER DIRECTORY
 * -------------------------
 * `AGENTS.md` if it reads, else `CLAUDE.md`. "If it reads", not "if it
 * exists": a repository whose `AGENTS.md` is a symlink to its `CLAUDE.md`
 * (a common way to serve both tools) is refused by a reader that does not
 * follow links, and still gets the `CLAUDE.md` text. Never both: one usually
 * points at or copies the other, so both would double the tokens. An empty
 * file reads as absent. `CLAUDE.local.md` and `.claude/CLAUDE.md` are one
 * person's settings, not the repository's notes, and are never read.
 *
 * HOW A FILE IS READ
 * ------------------
 * Through the engine's own reader ({@link InstructionReader}): the native
 * engine's file backend, the Claude engine's confined read of the
 * workspace. Either answers "not there" for a file it will not read, so
 * nothing the agent could not already read is shown to it. Paths are in the
 * engine's own dialect (`/` the workspace root for the native engine, real
 * paths for Claude), the dialect the closing line tells the model to read
 * the rest in.
 *
 * A SIZE BOUND PER FILE
 * ---------------------
 * Each file is cut at the run's `max_tool_result_chars`, the bound the
 * operator already sets on how much one source may put in front of the
 * model, at a line end (`text-cut.ts`), with a closing line naming the path
 * to read the rest from.
 *
 * Model-facing text, so a prompt: its words live in
 * {@link REPOSITORY_INSTRUCTIONS_TEXT} alone. Each file is wrapped in an
 * `<instructions path="…">` tag rather than a heading, because these files
 * carry their own `#` headings, which would scramble the prompt's outline. A
 * file's own closing tag is neutralised and a quote in its path escaped, so
 * no text a repository wrote leaves its block; and the file's text is only
 * ever scanned in linear time (`trimTrailingLineEnds`), since a repository
 * can plant a file shaped to make a backtracking pattern stall the runner.
 */

import { isAbsolute, posix, relative } from "node:path";
import { headCutIndex, trimTrailingLineEnds } from "./text-cut.js";

/** A file's text as the engine reads it, or undefined when it is missing, refused, binary or empty. */
export type InstructionReader = (path: string) => Promise<string | undefined>;

/** The names a directory's instructions may have, in the order one is chosen (the header). */
export const INSTRUCTION_FILE_NAMES: readonly string[] = ["AGENTS.md", "CLAUDE.md"];

/** One instruction file as it is shown. */
export interface InstructionFile {
  /** Its path as the file tools name it (`/AGENTS.md`, `/pkg/AGENTS.md`). */
  readonly path: string;
  /** The text shown: the file's, cut at the bound with the closing line when longer. */
  readonly text: string;
  /** The file's own length, in characters. */
  readonly chars: number;
  /** Whether it was cut at the bound. */
  readonly cut: boolean;
}

/** The words this module shows the model, their one home (the header). */
export const REPOSITORY_INSTRUCTIONS_TEXT = {
  heading: "## Repository instructions",
  framing:
    "The workspace's own instruction files, written by the people who keep it. " +
    "Follow them for work in this workspace. " +
    "Where they conflict with your instructions above, your instructions win.",
  folder: (dir: string): string => `This folder's own instructions, for work under \`${dir}\`:`,
  cut: (at: number, of: number, path: string): string =>
    `[cut at ${at} of ${of} characters; read ${path} for the rest]`,
} as const;

/** `text` within `maxChars`, cut at a line end with the closing line (the header). */
function bounded(path: string, text: string, maxChars: number): InstructionFile {
  if (text.length <= maxChars) return { path, text, chars: text.length, cut: false };
  const at = headCutIndex(text, maxChars);
  const head = text.slice(0, at);
  const joint = head.endsWith("\n") || head.length === 0 ? "" : "\n";
  return { path, text: `${head}${joint}${REPOSITORY_INSTRUCTIONS_TEXT.cut(at, text.length, path)}`, chars: text.length, cut: true };
}

/** A directory's instruction file by the per-directory rule, or undefined when none reads. */
export async function readDirectoryInstructionsWith(
  read: InstructionReader,
  dir: string,
  maxChars: number,
): Promise<InstructionFile | undefined> {
  for (const name of INSTRUCTION_FILE_NAMES) {
    const path = posix.join(dir, name);
    const text = await read(path);
    if (text !== undefined && text.trim() !== "") return bounded(path, text, maxChars);
  }
  return undefined;
}

/** Every root's instruction file, in the roots' order. */
export async function readRootInstructionsWith(
  read: InstructionReader,
  roots: readonly string[],
  maxChars: number,
): Promise<InstructionFile[]> {
  const files: InstructionFile[] = [];
  for (const root of roots) {
    const file = await readDirectoryInstructionsWith(read, root, maxChars);
    if (file !== undefined) files.push(file);
  }
  return files;
}

/**
 * The directories whose files are the roots' (the header): the workspace
 * root `/`, then each entry's root directory as the file tools name it,
 * derived from its `rootDir` as the native workspace section derives an
 * entry's place (`execute-deep-agent/prompt-builder.ts`). The native
 * engine's dialect. An entry outside the workspace is left out;
 * each directory appears once.
 */
export function workspaceRoots(primaryDir: string, entryRootDirs: readonly string[]): string[] {
  const roots = ["/"];
  for (const rootDir of entryRootDirs) {
    const rel = relative(primaryDir, rootDir);
    if (rel.startsWith("..") || isAbsolute(rel)) continue;
    const root = posix.join("/", rel.split("\\").join("/"));
    if (!roots.includes(root)) roots.push(root);
  }
  return roots;
}

/**
 * The directories strictly between the nearest root holding `filePath` and
 * the file, shallowest first: where a read's folder notes come from. Empty
 * for a file directly in a root, or a path that is not workspace-absolute.
 */
export function nestedDirectories(filePath: string, roots: readonly string[]): string[] {
  if (!filePath.startsWith("/")) return [];
  const dir = posix.dirname(posix.normalize(filePath));
  const holds = (root: string): boolean => root === "/" || dir === root || dir.startsWith(`${root}/`);
  const nearest = roots.filter(holds).reduce<string | undefined>(
    (best, root) => (best === undefined || root.length > best.length ? root : best),
    undefined,
  );
  if (nearest === undefined || dir === nearest) return [];
  const below = dir.slice(nearest === "/" ? 1 : nearest.length + 1).split("/");
  return below.map((_, index) => posix.join(nearest, ...below.slice(0, index + 1)));
}

/** A closing tag inside a file's own text; no quantifier, so matching it is linear. */
const CLOSING_TAG = /<\/instructions>/gi;

/** One file in its tag, which nothing in the file can close (the header). */
function block(file: InstructionFile): string {
  const path = file.path.replaceAll('"', "&quot;");
  const text = trimTrailingLineEnds(file.text).replace(CLOSING_TAG, "<\\/instructions>");
  return `<instructions path="${path}">\n${text}\n</instructions>`;
}

/**
 * The system prompt's `## Repository instructions` section over the roots'
 * files, opening with its own blank line as every section of that prompt
 * does; empty when there are none, so a workspace without one renders
 * today's prompt byte for byte.
 */
export function renderRepositoryInstructions(files: readonly InstructionFile[]): string {
  if (files.length === 0) return "";
  return `\n\n${REPOSITORY_INSTRUCTIONS_TEXT.heading}\n\n${REPOSITORY_INSTRUCTIONS_TEXT.framing}\n\n${files.map(block).join("\n\n")}`;
}

/** What a read carries of its folders' files: each under its folder's line, shallowest first. */
export function renderFolderInstructions(files: readonly InstructionFile[]): string {
  return files
    .map((file) => `${REPOSITORY_INSTRUCTIONS_TEXT.folder(`${posix.dirname(file.path)}/`)}\n\n${block(file)}`)
    .join("\n\n");
}
