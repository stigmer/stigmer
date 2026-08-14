import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { zipSync, strToU8 } from "fflate";
import { StigmerError, type Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { SkillFileBrowser } from "../SkillFileBrowser";

function wrapperFor(stigmer: Stigmer) {
  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
  );
}

/** Connect's Unimplemented code — what a pre-transfer-lane server answers. */
const CODE_UNIMPLEMENTED = 12;

/**
 * Builds a real ZIP (via fflate, the same library the unpacker uses) and a
 * Stigmer client whose `skill.getArtifact` serves it — so tests exercise the
 * genuine fetch → unzip → browse path instead of stubbing the unpacker.
 * The download-URL mint answers Unimplemented (a pre-transfer-lane server),
 * pinning that the browser degrades to the unary lane it always used.
 */
function makeStigmerServing(files: Record<string, Uint8Array>) {
  const getArtifact = vi.fn().mockResolvedValue({ artifact: zipSync(files) });
  const getArtifactDownloadUrl = vi
    .fn()
    .mockRejectedValue(new StigmerError("unknown", "unimplemented", CODE_UNIMPLEMENTED));
  return { skill: { getArtifact, getArtifactDownloadUrl } } as unknown as Stigmer;
}

function renderBrowser(stigmer: Stigmer) {
  return render(<SkillFileBrowser artifactStorageKey="skills/test/pkg.zip" />, {
    wrapper: wrapperFor(stigmer),
  });
}

const PLACEHOLDER = "Select a file to view its contents";

afterEach(() => {
  vi.clearAllMocks();
});

describe("SkillFileBrowser", () => {
  it("renders SKILL.md content without any click for a single-file package", async () => {
    // Regression: the content lookup used to be memoized against a frozen
    // getter, so a one-file package stayed stuck on the placeholder forever.
    const stigmer = makeStigmerServing({
      "SKILL.md": strToU8("# Docs Skill\n\nAnswers questions about Stigmer."),
    });
    renderBrowser(stigmer);

    expect(
      await screen.findByRole("heading", { name: "Docs Skill" }),
    ).toBeTruthy();
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
  });

  it("prefers SKILL.md as the default in a multi-file package and switches on click", async () => {
    const stigmer = makeStigmerServing({
      "SKILL.md": strToU8("# Manifest"),
      "scripts/validate.py": strToU8('print("validated")'),
    });
    renderBrowser(stigmer);

    expect(
      await screen.findByRole("heading", { name: "Manifest" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "validate.py" }));
    expect(screen.getByText('print("validated")')).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Manifest" }),
    ).toBeNull();
  });

  it("falls back to the first file in tree order when there is no root SKILL.md", async () => {
    // buildFileTree sorts by localeCompare, so "alpha/inner.md" renders above
    // "beta.md" — the default selection must match what the user sees on top.
    const stigmer = makeStigmerServing({
      "beta.md": strToU8("# Beta"),
      "alpha/inner.md": strToU8("# Inner Alpha"),
    });
    renderBrowser(stigmer);

    expect(
      await screen.findByRole("heading", { name: "Inner Alpha" }),
    ).toBeTruthy();
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
  });

  it("shows an empty file as (empty) content, not the placeholder", async () => {
    const stigmer = makeStigmerServing({
      "SKILL.md": strToU8("# Manifest"),
      "notes.txt": new Uint8Array(0),
    });
    renderBrowser(stigmer);

    await screen.findByRole("heading", { name: "Manifest" });
    fireEvent.click(screen.getByRole("button", { name: "notes.txt" }));

    // The viewer switched away from the manifest and, despite the file's
    // empty content, did not regress to the "select a file" placeholder.
    expect(screen.queryByRole("heading", { name: "Manifest" })).toBeNull();
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
  });
});
