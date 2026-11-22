/**
 * The reader of a turn without a computer (`../inputs-reader.ts`): it
 * serves exactly the paths the server answered, fetches a File when it is
 * opened and checks its size, refuses one over the cap without fetching it,
 * asks for fresh links once when the store refuses one, and keys its cache
 * by the run's organization, so one organization's turn never reads bytes
 * another's fetched.
 */
import { create } from "@bufbuild/protobuf";
import { FileMountSchema, type FileMount } from "@stigmer/apis/ai/stigmer/agentic/file/v1/run_files_pb";
import { describe, expect, it, vi } from "vitest";

import {
  InputFileNotFoundError,
  InputTooLargeError,
  MAX_INPUT_READ_BYTES,
  newInputCache,
  newTurnInputs,
  NO_TURN_INPUTS,
  type InputFetch,
  type RunFileSets,
} from "../inputs-reader.js";

function mount(fileId: string, mountPath: string, size: number, url = `https://store.example/${fileId}?sig=secret`): FileMount {
  return create(FileMountSchema, { fileId, mountPath, filename: mountPath, mimeType: "text/plain", sizeBytes: BigInt(size), url });
}

function served(bodies: Record<string, string>, status: (url: string) => number = () => 200): InputFetch & { readonly urls: string[] } {
  const urls: string[] = [];
  const fetcher = vi.fn(async (url: string) => {
    urls.push(url);
    const code = status(url);
    if (code !== 200) return new Response("no", { status: code });
    return new Response(bodies[new URL(url).pathname.slice(1)] ?? "");
  });
  return Object.assign(fetcher, { urls });
}

const SETS: RunFileSets = { entries: [mount("file_a", "brief.txt", 5)], outputs: [mount("file_o", "reply.md", 3)] };

describe("the turn's inputs reader", () => {
  it("lists the conversation's Files, its earlier outputs and the eval references, under their folders", async () => {
    const reader = newTurnInputs({ org: "org_1", sets: SETS, references: new Map([["refs/a.txt", new Uint8Array([1, 2])]]), refetch: async () => SETS, fetch: served({}) });
    expect((await reader.list()).map((file) => file.path).sort()).toEqual(["inputs/refs/a.txt", "outputs/reply.md", "uploads/brief.txt"]);
    expect([...(await reader.read("inputs/refs/a.txt"))]).toEqual([1, 2]);
  });

  it("reads a File when it is opened, and nothing it was not handed", async () => {
    const fetch = served({ file_a: "hello" });
    const reader = newTurnInputs({ org: "org_1", sets: SETS, refetch: async () => SETS, fetch, cache: newInputCache(1024) });
    expect(fetch.urls).toEqual([]);
    expect(Buffer.from(await reader.read("uploads/brief.txt")).toString()).toBe("hello");
    await expect(reader.read("uploads/../../etc/hosts")).rejects.toBeInstanceOf(InputFileNotFoundError);
    await expect(reader.read("uploads/other.txt")).rejects.toBeInstanceOf(InputFileNotFoundError);
  });

  it("refuses a File whose bytes do not match its recorded size, naming no link", async () => {
    const reader = newTurnInputs({ org: "org_1", sets: SETS, refetch: async () => SETS, fetch: served({ file_a: "hello world" }), cache: newInputCache(1024) });
    const err = (await reader.read("uploads/brief.txt").then(() => undefined, (e: unknown) => e)) as Error;
    expect(err.message).toMatch(/arrived as 11 bytes/);
    expect(err.message).not.toContain("sig=secret");
  });

  it("refuses a File over the cap without fetching it", async () => {
    const fetch = served({});
    const big: RunFileSets = { entries: [mount("file_big", "big.bin", MAX_INPUT_READ_BYTES + 1)], outputs: [] };
    const reader = newTurnInputs({ org: "org_1", sets: big, refetch: async () => big, fetch });
    await expect(reader.read("uploads/big.bin")).rejects.toBeInstanceOf(InputTooLargeError);
    expect(fetch.urls).toEqual([]);
  });

  it.each([
    { store: "a bucket's signed link", refused: 403 },
    { store: "the local artifact lane", refused: 404 },
  ])("asks for fresh links once when $store refuses an expired one ($refused)", async ({ refused }) => {
    const fresh: RunFileSets = { entries: [mount("file_a", "brief.txt", 5, "https://store.example/file_a?sig=new")], outputs: [] };
    const fetch = served({ file_a: "hello" }, (url) => (url.includes("sig=secret") ? refused : 200));
    const refetch = vi.fn(async () => fresh);
    const reader = newTurnInputs({ org: "org_1", sets: SETS, refetch, fetch, cache: newInputCache(1024) });
    expect(Buffer.from(await reader.read("uploads/brief.txt")).toString()).toBe("hello");
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("keys its cache by organization: one organization's bytes never answer another's read", async () => {
    const cache = newInputCache(1024);
    const first = served({ file_a: "org-1" });
    await newTurnInputs({ org: "org_1", sets: SETS, refetch: async () => SETS, fetch: first, cache }).read("uploads/brief.txt");
    const second = served({ file_a: "org-2" });
    const read = await newTurnInputs({ org: "org_2", sets: SETS, refetch: async () => SETS, fetch: second, cache }).read("uploads/brief.txt");
    expect(second.urls, "the other organization's turn fetched for itself").toHaveLength(1);
    expect(Buffer.from(read).toString()).toBe("org-2");
  });

  it("takes a message's Files mid-turn", async () => {
    const reader = newTurnInputs({ org: "org_1", sets: SETS, refetch: async () => SETS, fetch: served({}) });
    reader.replace({ entries: [...SETS.entries, mount("file_b", "late.png", 3)], outputs: SETS.outputs });
    expect((await reader.list()).map((file) => file.path)).toContain("uploads/late.png");
  });

  it("answers a cached File from the cache, and names a refused fetch without its link", async () => {
    const cache = newInputCache(1024);
    const first = served({ file_a: "hello" });
    const reader = newTurnInputs({ org: "org_1", sets: SETS, refetch: async () => SETS, fetch: first, cache });
    await reader.read("uploads/brief.txt");
    await reader.read("uploads/brief.txt");
    expect(first.urls, "the second read is the cache's").toHaveLength(1);
    const failing = newTurnInputs({ org: "org_1", sets: SETS, refetch: async () => SETS, fetch: served({}, () => 500), cache });
    const err = (await failing.read("outputs/reply.md").then(() => undefined, (e: unknown) => e)) as Error;
    expect(err.message).toMatch(/HTTP 500/);
    expect(err.message).not.toContain("sig=secret");
  });

  it("finds a File gone when the fresh links no longer hold it", async () => {
    const fetch = served({ file_a: "hello" }, () => 403);
    const reader = newTurnInputs({ org: "org_1", sets: SETS, refetch: async () => ({ entries: [], outputs: [] }), fetch, cache: newInputCache(1024) });
    await expect(reader.read("uploads/brief.txt")).rejects.toBeInstanceOf(InputFileNotFoundError);
  });

  it("lists no File whose mount path would leave its folder", async () => {
    const odd: RunFileSets = { entries: [mount("file_x", "../escape.txt", 1), mount("file_y", ".", 1), mount("file_z", "ok.txt", 1)], outputs: [] };
    const reader = newTurnInputs({ org: "org_1", sets: odd, refetch: async () => odd, fetch: served({}) });
    expect((await reader.list()).map((file) => file.path)).toEqual(["uploads/ok.txt"]);
    expect(await NO_TURN_INPUTS.list()).toEqual([]);
    await expect(NO_TURN_INPUTS.read("uploads/a")).rejects.toBeInstanceOf(InputFileNotFoundError);
  });
});
