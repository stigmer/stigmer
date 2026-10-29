/**
 * The Stigmer harness's reader of the workspace's own instruction files: the
 * shared rule (`shared/repository-instructions.ts`, which says which file is
 * read per directory, how it is bounded and how it is shown) over this
 * engine's file backend.
 *
 * Every file is read through the graph's routed file backend's `readRaw`,
 * the read `read_file` makes: confined to the workspace, refusing a path
 * whose real location leaves it, opening the leaf without following a
 * symlink (`loose-edit.ts` reads for the same reason). A throw or an error
 * result is "not there", and a binary read is skipped. Whether a graph is
 * shown them at all is its tool scope's question (`turn-setup.ts`,
 * `subagent-transformer.ts`): an agent whose lists refuse a workspace read
 * gets the prompt without them.
 */

import { adaptBackendProtocol, type AnyBackendProtocol, type BackendProtocolV2 } from "deepagents";
import {
  readDirectoryInstructionsWith,
  readRootInstructionsWith,
  type InstructionFile,
  type InstructionReader,
} from "../../shared/repository-instructions.js";

export {
  INSTRUCTION_FILE_NAMES,
  REPOSITORY_INSTRUCTIONS_TEXT,
  nestedDirectories,
  renderFolderInstructions,
  renderRepositoryInstructions,
  workspaceRoots,
  type InstructionFile,
} from "../../shared/repository-instructions.js";

/** The backend's read of a file's text, or undefined when it is missing, refused or binary (the header). */
function backendReader(backend: AnyBackendProtocol): InstructionReader {
  const reader: BackendProtocolV2 = adaptBackendProtocol(backend);
  return async (path) => {
    try {
      const read = await reader.readRaw(path);
      const content = read.data?.content;
      return typeof content === "string" ? content : undefined;
    } catch {
      return undefined;
    }
  };
}

/** A directory's instruction file by the shared per-directory rule, or undefined when none reads. */
export function readDirectoryInstructions(backend: AnyBackendProtocol, dir: string, maxChars: number): Promise<InstructionFile | undefined> {
  return readDirectoryInstructionsWith(backendReader(backend), dir, maxChars);
}

/** Every root's instruction file, in the roots' order. */
export function readRootInstructions(backend: AnyBackendProtocol, roots: readonly string[], maxChars: number): Promise<InstructionFile[]> {
  return readRootInstructionsWith(backendReader(backend), roots, maxChars);
}
