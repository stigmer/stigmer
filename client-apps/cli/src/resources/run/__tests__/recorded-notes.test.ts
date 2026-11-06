// The notes the docs' terminal recordings show `stigmer run --download`
// writing after a turn are the CLI's own words. Each recording the terminal
// kit holds (sdk/ink/src/__tests__/__recordings__/) that declares an
// `afterTurn` (sdk/ink/src/recordings.ts) is replayed here through the view's
// per-turn action, `turnDownloader`, against a client whose turn returned the
// Files the recording says were saved, each its declared size. The lines it
// says, trimmed as the live view trims them (../../stream/ink.tsx), must be
// the recording's notes exactly, so a change to the CLI's words fails here,
// naming the recording to mint again (`npx vitest run -u` in sdk/ink).
//
// The held files are read by path: the CLI compiles only its own sources, and
// the recording's file is what the docs play.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { create } from "@bufbuild/protobuf";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Stigmer, Turn } from "@stigmer/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { turnDownloader } from "../stream.js";

/** What a held recording declares its host does after the turn (sdk/ink/src/recordings.ts, `AfterTurn`). */
interface HeldRecording {
  readonly name: string;
  readonly afterTurn?: {
    readonly saved: readonly { readonly path: string; readonly bytes: number }[];
    readonly notes: readonly string[];
  };
}

const HELD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../sdk/ink/src/__tests__/__recordings__");

/** Every held recording that saves its turn's outputs. */
const SAVING: readonly HeldRecording[] = readdirSync(HELD_DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(join(HELD_DIR, file), "utf8")) as HeldRecording)
  .filter((held) => held.afterTurn !== undefined);

const RUN_ID = "run_1";

/** A client whose run completed and returned `saved`, each File's bytes served at its own link. */
function clientReturning(saved: NonNullable<HeldRecording["afterTurn"]>["saved"]): Stigmer {
  const files = saved.map((entry, i) =>
    create(FileSchema, {
      metadata: { id: `file_${i}`, org: "acme" },
      spec: { filename: basename(entry.path) },
      status: { runId: RUN_ID, outputPath: entry.path, sizeBytes: BigInt(entry.bytes) },
    }),
  );
  return {
    run: { get: async () => create(RunSchema, { metadata: { id: RUN_ID, org: "acme" }, status: { phase: RunPhase.RUN_COMPLETED } }) },
    file: {
      listAll: async function* () {
        yield* files;
      },
      getDownloadUrl: async (id: string) => ({ url: `https://files.example/${id}` }),
    },
  } as unknown as Stigmer;
}

let outputDir: string | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  if (outputDir !== undefined) rmSync(outputDir, { recursive: true, force: true });
  outputDir = undefined;
});

describe("the notes the docs' terminal recordings show --download writing", () => {
  it("holds at least one recording that saves its turn's outputs", () => {
    expect(SAVING.map((held) => held.name)).toContain("first-job");
  });

  it.each(SAVING)("are the lines the CLI says when it saves $name's turn", async (held) => {
    const { saved, notes } = held.afterTurn!;
    const sizes = new Map(saved.map((entry, i) => [`https://files.example/file_${i}`, entry.bytes]));
    vi.stubGlobal("fetch", async (url: string) => new Response(new Uint8Array(sizes.get(url) ?? 0)));
    outputDir = mkdtempSync(join(tmpdir(), "recorded-notes-"));

    const said: string[] = [];
    const save = turnDownloader(clientReturning(saved), outputDir, RUN_ID)!;
    await save({ runId: RUN_ID } as Turn, false, (line) => void said.push(line.trim()));

    expect(said, `mint ${held.name} again in sdk/ink (npx vitest run -u) when the CLI's words change`).toEqual(notes);
    expect(saved.map((entry) => statSync(join(outputDir!, entry.path)).size)).toEqual(saved.map((entry) => entry.bytes));
  });
});
