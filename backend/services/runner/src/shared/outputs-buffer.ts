/**
 * A turn's outputs without a computer: what the agent saves under
 * `.stigmer/outputs/` is held in the runner's memory, not on a disk, and
 * comes back as Files of the conversation when the turn ends, through the
 * same server door a turn with a computer uses (`outputs.ts`
 * `returnOutputFiles`).
 *
 * The buffer holds only what this turn wrote, by output path (relative to
 * the outputs folder, "/"-separated). What the conversation's agent saved
 * in earlier turns is not here: the server lists it again for the turn
 * (`RunFileMounts.outputs`) and the turn's reader serves it
 * (`inputs-reader.ts`); the engine's outputs route lists this buffer over
 * those, and an edit of an earlier output lands here as this turn's
 * version, which returns as a new File as an edited file on disk does.
 *
 * The runner holds every byte until the turn ends, and one runner serves
 * many turns, so the buffer is bounded: {@link MAX_BUFFERED_OUTPUT_BYTES}
 * an output, {@link MAX_BUFFERED_TURN_BYTES} and the contract's
 * {@link MAX_OUTPUTS_PER_TURN} outputs a turn. A write past a bound is
 * refused with a sentence the agent reads ({@link OutputLimitError}),
 * never cut.
 */

import { posix } from "node:path";

import { MAX_OUTPUTS_PER_TURN } from "./outputs.js";

/** The largest output a turn without a computer saves. */
export const MAX_BUFFERED_OUTPUT_BYTES = 8 * 1024 * 1024;

/** The most a turn without a computer saves in all. */
export const MAX_BUFFERED_TURN_BYTES = 32 * 1024 * 1024;

/** One output this turn saved. */
export interface BufferedOutputInfo {
  /** Relative to the outputs folder, "/"-separated. */
  readonly path: string;
  readonly size: number;
}

/** What the engine's outputs route writes this turn's outputs through. */
export interface TurnOutputFiles {
  /** Every output this turn saved. */
  list(): Promise<readonly BufferedOutputInfo[]>;
  /** One output's bytes, or `undefined` when this turn saved none at that path. */
  read(path: string): Promise<Uint8Array | undefined>;
  /** Save an output, replacing this turn's earlier version; {@link OutputLimitError} past a bound. */
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** Drop an output this turn saved; false when it saved none at that path. */
  delete(path: string): Promise<boolean>;
}

/** A write past one of the buffer's bounds. */
export class OutputLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutputLimitError";
  }
}

/** An output path that is not one: empty, absolute, or leaving the folder. */
export class OutputPathError extends Error {
  constructor(readonly path: string) {
    super(`'${path}' is not a path inside the outputs folder`);
    this.name = "OutputPathError";
  }
}

/** The runner's buffer for one turn. */
export interface OutputsBuffer extends TurnOutputFiles {
  /** What the turn saved, by output path, in the order of the paths. */
  snapshot(): ReadonlyMap<string, Uint8Array>;
}

/** The server's bounds on an output path (`domain/file/outputs.ts` `outputPathProblem`), held at the write so the agent hears a refusal then, not a dropped File at the turn's end. */
const MAX_OUTPUT_PATH_BYTES = 1024;
const MAX_FILENAME_CHARS = 255;
const REFUSED_PATH_CHARACTER = /[\\\u0000-\u001f\u007f]/;

/** An output path in its one form, or {@link OutputPathError}: relative, inside the folder, and one the server takes. */
export function outputPathOf(path: string): string {
  const trimmed = path.replace(/^\/+/, "");
  const normalized = posix.normalize(trimmed);
  const segments = normalized.split("/");
  if (
    trimmed === "" ||
    normalized.startsWith("/") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
    REFUSED_PATH_CHARACTER.test(normalized) ||
    Buffer.byteLength(normalized, "utf8") > MAX_OUTPUT_PATH_BYTES ||
    [...(segments[segments.length - 1] ?? "")].length > MAX_FILENAME_CHARS
  ) {
    throw new OutputPathError(path);
  }
  return normalized;
}

export function newOutputsBuffer(): OutputsBuffer {
  const outputs = new Map<string, Uint8Array>();
  const total = (): number => [...outputs.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  return {
    async list() {
      return [...outputs].map(([path, bytes]) => ({ path, size: bytes.length }));
    },
    async read(path) {
      return outputs.get(outputPathOf(path));
    },
    async write(path, bytes) {
      const key = outputPathOf(path);
      if (bytes.length > MAX_BUFFERED_OUTPUT_BYTES) {
        throw new OutputLimitError(
          `'${key}' would be ${bytes.length} bytes; an agent without a computer saves outputs up to ${MAX_BUFFERED_OUTPUT_BYTES} bytes each`,
        );
      }
      if (!outputs.has(key) && outputs.size >= MAX_OUTPUTS_PER_TURN) {
        throw new OutputLimitError(`this turn already saved ${MAX_OUTPUTS_PER_TURN} outputs, the most one turn returns`);
      }
      const after = total() - (outputs.get(key)?.length ?? 0) + bytes.length;
      if (after > MAX_BUFFERED_TURN_BYTES) {
        throw new OutputLimitError(
          `saving '${key}' would bring this turn's outputs to ${after} bytes; an agent without a computer saves up to ${MAX_BUFFERED_TURN_BYTES} bytes a turn. Delete or shorten an output first`,
        );
      }
      outputs.set(key, bytes);
    },
    async delete(path) {
      return outputs.delete(outputPathOf(path));
    },
    snapshot() {
      return new Map([...outputs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    },
  };
}
