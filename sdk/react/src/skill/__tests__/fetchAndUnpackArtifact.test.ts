// Pins for the artifact fetch lane selection (stigmer#701): URL-first via
// getArtifactDownloadUrl, with the two deliberate browser degrade arms —
// Unimplemented mint (pre-lane server) and a failed URL fetch (the shape a
// missing bucket CORS policy takes in a browser).
import { describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { StigmerError, type Stigmer } from "@stigmer/sdk";
import { fetchAndUnpackArtifact } from "../internal/fetchAndUnpackArtifact.js";

const CODE_UNIMPLEMENTED = 12;
const ZIP = zipSync({ "SKILL.md": strToU8("# hi") });

function stigmerWith(overrides: {
  mint?: ReturnType<typeof vi.fn>;
  unary?: ReturnType<typeof vi.fn>;
  fetch?: unknown;
}): Stigmer {
  return {
    skill: {
      getArtifactDownloadUrl: overrides.mint,
      getArtifact: overrides.unary,
    },
    fetch: overrides.fetch,
  } as unknown as Stigmer;
}

describe("fetchAndUnpackArtifact lane selection", () => {
  it("fetches via the minted download URL, never the unary lane", async () => {
    const mint = vi.fn().mockResolvedValue({ url: "https://r2.example/skills/get" });
    const unary = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(ZIP).buffer, { status: 200 }));

    const result = await fetchAndUnpackArtifact(
      stigmerWith({ mint, unary, fetch: fetchImpl }),
      "skills/org/skill/hash.zip",
    );

    expect(fetchImpl).toHaveBeenCalledWith("https://r2.example/skills/get");
    expect(unary).not.toHaveBeenCalled();
    expect(result.contentMap.get("SKILL.md")).toBe("# hi");
  });

  it("degrades to the unary lane when the mint answers Unimplemented (pre-lane server)", async () => {
    const mint = vi
      .fn()
      .mockRejectedValue(new StigmerError("unknown", "unimplemented", CODE_UNIMPLEMENTED));
    const unary = vi.fn().mockResolvedValue({ artifact: ZIP });

    const result = await fetchAndUnpackArtifact(
      stigmerWith({ mint, unary }),
      "skills/org/skill/hash.zip",
    );

    expect(unary).toHaveBeenCalledTimes(1);
    expect(result.contentMap.get("SKILL.md")).toBe("# hi");
  });

  it("degrades to the unary lane when the URL fetch itself fails (browser CORS shape), warning once", async () => {
    const mint = vi.fn().mockResolvedValue({ url: "https://r2.example/skills/get" });
    const unary = vi.fn().mockResolvedValue({ artifact: ZIP });
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const result = await fetchAndUnpackArtifact(
        stigmerWith({ mint, unary, fetch: fetchImpl }),
        "skills/org/skill/hash.zip",
      );
      expect(unary).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(result.contentMap.get("SKILL.md")).toBe("# hi");
    } finally {
      warn.mockRestore();
    }
  });

  it("propagates a non-Unimplemented mint failure — a real error must not be masked", async () => {
    const mint = vi
      .fn()
      .mockRejectedValue(new StigmerError("not-found", "no such artifact", 5));
    const unary = vi.fn();

    await expect(
      fetchAndUnpackArtifact(stigmerWith({ mint, unary }), "skills/org/skill/hash.zip"),
    ).rejects.toThrow(/no such artifact/);
    expect(unary).not.toHaveBeenCalled();
  });
});
