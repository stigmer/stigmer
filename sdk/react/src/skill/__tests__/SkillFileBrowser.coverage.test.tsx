/**
 * SkillFileBrowser's failed fetch: a package the server cannot serve shows
 * the "Couldn't load the skill package." note with the failure's words,
 * and its "Try again" act fetches again so the files appear.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { zipSync, strToU8 } from "fflate";
import { StigmerError, type Stigmer } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { SkillFileBrowser } from "../SkillFileBrowser";

function wrapperFor(stigmer: Stigmer) {
  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
  );
}

/** Connect's Unimplemented code — what a pre-transfer-lane server answers. */
const CODE_UNIMPLEMENTED = 12;

afterEach(() => {
  vi.clearAllMocks();
});

describe("SkillFileBrowser", () => {
  it("shows a failed fetch and fetches again on Try again", async () => {
    const getArtifact = vi
      .fn()
      .mockRejectedValueOnce(new Error("artifact store offline"))
      .mockResolvedValue({ artifact: zipSync({ "SKILL.md": strToU8("# Recovered Skill") }) });
    const getArtifactDownloadUrl = vi
      .fn()
      .mockRejectedValue(new StigmerError("unknown", "unimplemented", CODE_UNIMPLEMENTED));
    const stigmer = { skill: { getArtifact, getArtifactDownloadUrl } } as unknown as Stigmer;

    render(<SkillFileBrowser artifactStorageKey="skills/coverage/failing.zip" />, {
      wrapper: wrapperFor(stigmer),
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load the skill package.");
    expect(alert.textContent).toContain("artifact store offline");

    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));

    expect(await screen.findByRole("heading", { name: "Recovered Skill" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
