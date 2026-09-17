// Pins the GitHub source over zipballs built in-test: a good tree lands with
// its top directory stripped; every cap refuses naming itself, from the
// central directory before anything inflates; an escaping path, a second
// top-level directory and a lying declared size refuse; 404 and a network
// failure carry their own exit codes.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExitCode } from "../errors/index.js";
import {
  GITHUB_ZIPBALL_LIMITS,
  fetchGitHubTree,
  zipballUrl,
} from "./github.js";

let dest: string;

beforeEach(() => {
  dest = mkdtempSync(join(tmpdir(), "stigmer-github-tree-"));
});

afterEach(() => {
  rmSync(dest, { recursive: true, force: true });
});

const encoder = new TextEncoder();

function zipball(files: Record<string, string | Uint8Array>): Uint8Array {
  const tree: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    tree[path] =
      typeof content === "string" ? encoder.encode(content) : content;
  }
  return zipSync(tree, { level: 6 });
}

function serving(
  bytes: Uint8Array,
  init: { status?: number; contentLength?: number } = {},
): typeof globalThis.fetch {
  return async () => {
    const headers = new Headers();
    if (init.contentLength !== undefined)
      headers.set("content-length", String(init.contentLength));
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(
      init.status === undefined || init.status === 200 ? body : "nope",
      {
        status: init.status ?? 200,
        headers,
      },
    );
  };
}

/**
 * The same archive with one entry's central-directory record rewritten: a
 * declaration that lies (`uncompressedSize`) or a checksum that does not
 * match (`crc32`). The payload is untouched, so only a reader that budgets
 * from the central directory and verifies the CRC can refuse it.
 */
function declaring(
  bytes: Uint8Array,
  entryName: string,
  patch: { uncompressedSize?: number; crc32?: number },
): Uint8Array {
  const patched = new Uint8Array(bytes);
  const view = new DataView(
    patched.buffer,
    patched.byteOffset,
    patched.byteLength,
  );
  const name = encoder.encode(entryName);
  for (let offset = 0; offset + 46 <= patched.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const recorded = patched.subarray(offset + 46, offset + 46 + nameLength);
    if (
      recorded.length === name.length &&
      recorded.every((byte, i) => byte === name[i])
    ) {
      if (patch.crc32 !== undefined)
        view.setUint32(offset + 16, patch.crc32, true);
      if (patch.uncompressedSize !== undefined)
        view.setUint32(offset + 24, patch.uncompressedSize, true);
      return patched;
    }
  }
  throw new Error(`no central directory record for ${entryName}`);
}

async function refusal(
  promise: Promise<unknown>,
): Promise<{ message: string; exitCode: number }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { message: string; exitCode: number };
    return { message: e.message, exitCode: e.exitCode };
  }
  throw new Error("expected a refusal");
}

describe("zipballUrl", () => {
  it("names codeload's HEAD by default and the ref when given", () => {
    expect(zipballUrl({ repo: "cursor/plugins" })).toBe(
      "https://codeload.github.com/cursor/plugins/zip/HEAD",
    );
    expect(zipballUrl({ repo: "cursor/plugins", ref: "v1" })).toBe(
      "https://codeload.github.com/cursor/plugins/zip/v1",
    );
  });
});

describe("fetchGitHubTree", () => {
  it("extracts the tree with the zipball's top directory stripped", async () => {
    const bytes = zipball({
      "plugins-HEAD/.cursor-plugin/marketplace.json": JSON.stringify({
        name: "cursor-plugins",
        plugins: [],
      }),
      "plugins-HEAD/thermos/.cursor-plugin/plugin.json": JSON.stringify({
        name: "thermos",
      }),
      "plugins-HEAD/thermos/skills/x/SKILL.md":
        "---\nname: x\ndescription: d\n---\nbody\n",
    });
    await fetchGitHubTree(
      { repo: "cursor/plugins" },
      { destDir: dest, fetchImpl: serving(bytes) },
    );
    expect(existsSync(join(dest, "plugins-HEAD"))).toBe(false);
    expect(
      JSON.parse(
        readFileSync(join(dest, ".cursor-plugin", "marketplace.json"), "utf8"),
      ).name,
    ).toBe("cursor-plugins");
    expect(
      readFileSync(join(dest, "thermos", "skills", "x", "SKILL.md"), "utf8"),
    ).toContain("body");
  });

  it("refuses an archive over the download cap from content-length, before reading the body", async () => {
    const bytes = zipball({ "r-HEAD/marketplace.json": "{}" });
    const outcome = await refusal(
      fetchGitHubTree(
        { repo: "a/b" },
        {
          destDir: dest,
          fetchImpl: serving(bytes, {
            contentLength: GITHUB_ZIPBALL_LIMITS.downloadBytes + 1,
          }),
        },
      ),
    );
    expect(outcome.message).toMatch(/over the 64\.0 MiB download cap/);
    expect(outcome.exitCode).toBe(ExitCode.Usage);
  });

  it("refuses more entries than the cap from the central directory", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= GITHUB_ZIPBALL_LIMITS.entries; i += 1)
      files[`r-HEAD/f${i}`] = "";
    const outcome = await refusal(
      fetchGitHubTree(
        { repo: "a/b" },
        { destDir: dest, fetchImpl: serving(zipball(files)) },
      ),
    );
    expect(outcome.message).toMatch(/entries, over the 20000 cap/);
    expect(existsSync(join(dest, "f0"))).toBe(false);
  });

  it("refuses a declared inflated size over the cap from the central directory, before inflating", async () => {
    const bytes = declaring(
      zipball({ "r-HEAD/marketplace.json": "{}", "r-HEAD/big.bin": "tiny" }),
      "r-HEAD/big.bin",
      {
        uncompressedSize: GITHUB_ZIPBALL_LIMITS.inflatedBytes + 1,
      },
    );
    const outcome = await refusal(
      fetchGitHubTree(
        { repo: "a/b" },
        { destDir: dest, fetchImpl: serving(bytes) },
      ),
    );
    expect(outcome.message).toMatch(
      /inflates to 256\.0 MiB, over the 256\.0 MiB cap/,
    );
    expect(existsSync(join(dest, "marketplace.json"))).toBe(false);
  });

  it("refuses an entry whose declared size undercounts what it inflates to", async () => {
    const bytes = declaring(
      zipball({
        "r-HEAD/marketplace.json": "{}",
        "r-HEAD/liar.txt": "twelve bytes, and then some more text",
      }),
      "r-HEAD/liar.txt",
      { uncompressedSize: 3 },
    );
    const outcome = await refusal(
      fetchGitHubTree(
        { repo: "a/b" },
        { destDir: dest, fetchImpl: serving(bytes) },
      ),
    );
    expect(outcome.message).toMatch(
      /entry 'liar\.txt' inflated past its declared size/,
    );
  });

  it("refuses an entry whose bytes do not match its checksum", async () => {
    const bytes = declaring(
      zipball({
        "r-HEAD/marketplace.json": "{}",
        "r-HEAD/tampered.txt": "some content here",
      }),
      "r-HEAD/tampered.txt",
      { crc32: 0xdeadbeef },
    );
    const outcome = await refusal(
      fetchGitHubTree(
        { repo: "a/b" },
        { destDir: dest, fetchImpl: serving(bytes) },
      ),
    );
    expect(outcome.message).toMatch(
      /entry 'tampered\.txt' failed its checksum/,
    );
  });

  it("refuses an entry that would escape the destination", async () => {
    const outcome = await refusal(
      fetchGitHubTree(
        { repo: "a/b" },
        {
          destDir: dest,
          fetchImpl: serving(
            zipball({ "r-HEAD/marketplace.json": "{}", "r-HEAD/../evil": "x" }),
          ),
        },
      ),
    );
    expect(outcome.message).toMatch(/would escape the destination directory/);
    expect(existsSync(join(dest, "..", "evil"))).toBe(false);
  });

  it("refuses an archive with more than one top-level directory", async () => {
    const outcome = await refusal(
      fetchGitHubTree(
        { repo: "a/b" },
        {
          destDir: dest,
          fetchImpl: serving(
            zipball({
              "one/marketplace.json": "{}",
              "two/marketplace.json": "{}",
            }),
          ),
        },
      ),
    );
    expect(outcome.message).toMatch(
      /more than one top-level directory \('one' and 'two'\)/,
    );
  });

  it("refuses bytes that are not a zip", async () => {
    const outcome = await refusal(
      fetchGitHubTree(
        { repo: "a/b" },
        {
          destDir: dest,
          fetchImpl: serving(encoder.encode("<html>not a zip</html>")),
        },
      ),
    );
    expect(outcome.message).toMatch(/not a readable zip/);
  });

  it("maps 404 to NotFound and a network failure to Connection, each with its own sentence", async () => {
    const missing = await refusal(
      fetchGitHubTree(
        { repo: "a/b", ref: "v9" },
        {
          destDir: dest,
          fetchImpl: serving(new Uint8Array(), { status: 404 }),
        },
      ),
    );
    expect(missing.message).toBe(
      "GitHub has no public repository 'a/b' at ref 'v9'",
    );
    expect(missing.exitCode).toBe(ExitCode.NotFound);

    const offline = await refusal(
      fetchGitHubTree(
        { repo: "a/b" },
        {
          destDir: dest,
          fetchImpl: async () => {
            throw new Error("ENOTFOUND");
          },
        },
      ),
    );
    expect(offline.message).toBe("could not reach GitHub for a/b");
    expect(offline.exitCode).toBe(ExitCode.Connection);
  });
});
