/**
 * Pins what SkillUploader tells a person before and after they pick a
 * package: the drop zone says which packages it accepts, and a valid zip
 * turns into a preview that names the skill, counts its files and states
 * their total size, with nothing pushed until they confirm. The upload hook
 * unpacks a real zip; the client is hand-built and holds no existing skill.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { strToU8, zipSync } from "fflate";
import { StigmerContext } from "@stigmer/react-core";
import { SkillUploader } from "../SkillUploader";

const SKILL_MD = "---\nname: my-skill\ndescription: A test skill\n---\n# My Skill\n";
const SCHEMA_MD = "# Schema";

afterEach(cleanup);

function renderUploader() {
  const push = vi.fn();
  const client = {
    skill: {
      getByReference: async () => {
        throw new Error("not found");
      },
      push,
    },
  };
  const { container } = render(
    <StigmerContext.Provider value={client as never}>
      <SkillUploader org="org_acme" />
    </StigmerContext.Provider>,
  );
  return { container, push };
}

describe("SkillUploader", () => {
  it("says on the drop zone which packages it accepts", () => {
    renderUploader();

    const zone = screen.getByRole("button", { name: "Upload skill package" });
    expect(zone.textContent).toContain("Drop your skill package here");
    expect(zone.textContent).toContain("Accepts .zip files following the Anthropic Agent Skills format");
  });

  it("previews a picked package with its name, file count and total size", async () => {
    const { container, push } = renderUploader();
    const zip = zipSync({ "SKILL.md": strToU8(SKILL_MD), "references/schema.md": strToU8(SCHEMA_MD) });
    const file = new File([zip], "skill.zip", { type: "application/zip" });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("the drop zone has no file input");
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole("heading", { name: "Skill Package Preview" })).toBeTruthy();
    expect(screen.getByText("my-skill")).toBeTruthy();
    expect(screen.getByText("Files (2)")).toBeTruthy();
    expect(screen.getByText(`${SKILL_MD.length + SCHEMA_MD.length} B total`)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
