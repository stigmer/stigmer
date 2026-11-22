/**
 * A turn's outputs without a computer (`../outputs-buffer.ts`) and their
 * set-aside twin (`../offload-store.ts`): the buffer holds what the turn
 * saved, refuses a path that leaves the folder and a write past each bound
 * with a sentence, and the set-aside store reads back only a key of this
 * conversation whose bytes match it.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { MAX_BUFFERED_OUTPUT_BYTES, MAX_BUFFERED_TURN_BYTES, newOutputsBuffer, OutputLimitError, OutputPathError } from "../outputs-buffer.js";
import { MAX_OFFLOAD_BYTES, newTurnOffloads, OffloadKeyError } from "../offload-store.js";
import { MAX_OUTPUTS_PER_TURN } from "../outputs.js";
import { makeInMemoryArtifactStorage } from "../../__test-utils__/fake-artifact-storage.js";

const bytes = (size: number): Uint8Array => new Uint8Array(size);

describe("the outputs buffer", () => {
  it("holds what the turn saved by its path in the folder, and drops what it deletes", async () => {
    const buffer = newOutputsBuffer();
    await buffer.write("/report.md", new TextEncoder().encode("v1"));
    await buffer.write("drafts/../report.md", new TextEncoder().encode("v2"));
    expect(await buffer.list()).toEqual([{ path: "report.md", size: 2 }]);
    expect([...buffer.snapshot().keys()]).toEqual(["report.md"]);
    expect(await buffer.delete("report.md")).toBe(true);
    expect(await buffer.delete("report.md")).toBe(false);
  });

  it("refuses a path that leaves the folder or that the server would refuse", async () => {
    const buffer = newOutputsBuffer();
    for (const path of ["../escape.md", "/", "", "a/", "a\\b.md", "bell\u0007.md", `${"n".repeat(256)}.md`, `${"d/".repeat(600)}x.md`]) {
      await expect(buffer.write(path, bytes(1)), path).rejects.toBeInstanceOf(OutputPathError);
    }
  });

  it("refuses an output past its bound, and a turn past its bound, naming each", async () => {
    const buffer = newOutputsBuffer();
    await expect(buffer.write("huge.bin", bytes(MAX_BUFFERED_OUTPUT_BYTES + 1))).rejects.toThrow(/saves outputs up to 8388608 bytes each/);
    const per = MAX_BUFFERED_OUTPUT_BYTES;
    for (let i = 0; i < MAX_BUFFERED_TURN_BYTES / per; i += 1) await buffer.write(`part-${i}.bin`, bytes(per));
    await expect(buffer.write("one-more.bin", bytes(1))).rejects.toBeInstanceOf(OutputLimitError);
    // Replacing an output counts its new size, not both.
    await buffer.write("part-0.bin", bytes(per));
  });
});

describe("the outputs buffer's count", () => {
  it("refuses a turn's output past the most one turn returns, and lists its outputs by path", async () => {
    const buffer = newOutputsBuffer();
    for (let i = MAX_OUTPUTS_PER_TURN - 1; i >= 0; i -= 1) await buffer.write(`o-${String(i).padStart(3, "0")}.txt`, bytes(1));
    await expect(buffer.write("one-more.txt", bytes(1))).rejects.toThrow(/already saved 500 outputs/);
    await buffer.write("o-000.txt", bytes(2));
    expect([...buffer.snapshot().keys()].slice(0, 2)).toEqual(["o-000.txt", "o-001.txt"]);
  });
});

describe("the set-aside store", () => {
  it("stores under this run and session and reads back only this conversation's keys", async () => {
    const { storage } = makeInMemoryArtifactStorage();
    const mine = newTurnOffloads(storage, "run_1", "ses_1");
    const key = await mine.put(new TextEncoder().encode("long result"));
    expect(key).toBe(`artifacts/run_1/offloads/ses_1/${createHash("sha256").update("long result").digest("hex")}`);
    expect(Buffer.from(await newTurnOffloads(storage, "run_2", "ses_1").read(key)).toString(), "a later turn of the conversation").toBe("long result");
    await expect(newTurnOffloads(storage, "run_9", "ses_other").read(key), "another conversation's turn").rejects.toBeInstanceOf(OffloadKeyError);
    await expect(mine.read("artifacts/run_1/toolcalls/x.txt")).rejects.toBeInstanceOf(OffloadKeyError);
  });

  it("uploads with a bare MIME type, which the server's artifact lane takes", async () => {
    const { storage } = makeInMemoryArtifactStorage();
    const key = await newTurnOffloads(storage, "run_1", "ses_1").put(new TextEncoder().encode("long result"));
    const contentType = storage.upload.mock.calls[0]?.[2] as string;
    // The lane's rule (stigmer-server artifactstorage/runner-lane/key-rules.ts MIME_TYPE_PATTERN): type/subtype, no parameters.
    expect(contentType).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*$/);
    expect(storage.upload).toHaveBeenCalledWith(key, expect.any(Buffer), contentType);
  });

  it("refuses a result past its bound", async () => {
    const { storage } = makeInMemoryArtifactStorage();
    await expect(newTurnOffloads(storage, "run_1", "ses_1").put(bytes(MAX_OFFLOAD_BYTES + 1))).rejects.toBeInstanceOf(OffloadKeyError);
  });

  it("refuses bytes that do not match their key", async () => {
    const { storage } = makeInMemoryArtifactStorage();
    const offloads = newTurnOffloads(storage, "run_1", "ses_1");
    const key = await offloads.put(new TextEncoder().encode("original"));
    await storage.upload(key, Buffer.from("tampered"));
    await expect(offloads.read(key)).rejects.toThrow(/does not hold what was set aside/);
  });
});
