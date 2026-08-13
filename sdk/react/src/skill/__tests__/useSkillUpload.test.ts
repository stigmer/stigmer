import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { zipSync, strToU8 } from "fflate";
import { useSkillUpload } from "../useSkillUpload";

const SKILL_MD = "---\nname: my-skill\ndescription: A test skill\n---\n# My Skill\n";

/** Build a real ZIP (fflate, the same library the hook unpacks with) as a File. */
function zipFile(files: Record<string, Uint8Array>): File {
  return new File([zipSync(files)], "skill.zip", { type: "application/zip" });
}

async function process(files: Record<string, Uint8Array>) {
  const { result } = renderHook(() => useSkillUpload());
  await act(() => result.current.processFile(zipFile(files)));
  return result;
}

describe("useSkillUpload", () => {
  it("accepts a root SKILL.md and produces a preview", async () => {
    const result = await process({
      "SKILL.md": strToU8(SKILL_MD),
      "references/schema.md": strToU8("# Schema"),
    });

    expect(result.current.validationError).toBeNull();
    expect(result.current.preview?.name).toBe("my-skill");
    expect(result.current.preview?.description).toBe("A test skill");
    expect(result.current.artifact).not.toBeNull();
  });

  // The layout contract is root-only on both editions (DD-018, #452). The
  // preview exists to catch the "zipped the folder instead of its contents"
  // mistake BEFORE upload — accepting nested here and failing at push is the
  // exact confusion issue #684 pins.
  it("rejects a nested-only SKILL.md with the zip-the-contents hint", async () => {
    const result = await process({
      "my-skill/SKILL.md": strToU8(SKILL_MD),
      "my-skill/references/schema.md": strToU8("# Schema"),
    });

    expect(result.current.preview).toBeNull();
    expect(result.current.artifact).toBeNull();
    expect(result.current.validationError).toBe(
      "Found my-skill/SKILL.md — SKILL.md must be at the archive root. " +
        "Zip the skill folder's contents, not the folder itself.",
    );
  });

  it("detects a deeply nested SKILL.md for the hint (any depth, server parity)", async () => {
    const result = await process({
      "wrapper/my-skill/SKILL.md": strToU8(SKILL_MD),
    });

    expect(result.current.preview).toBeNull();
    expect(result.current.validationError).toContain("Found wrapper/my-skill/SKILL.md");
  });

  it("rejects an archive with no SKILL.md anywhere with the plain root-level message", async () => {
    const result = await process({
      "README.md": strToU8("# Not a skill"),
    });

    expect(result.current.preview).toBeNull();
    expect(result.current.validationError).toBe(
      "ZIP must contain a SKILL.md file at the root level",
    );
  });
});
