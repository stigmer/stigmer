// The lines the form sweep added that only run in a state the other tests
// don't reach: the parts' rarer branches (a hint or a group label drawn on
// its own, a frameless multi-line box, a key the choice group ignores, a list
// choice clicked or moved by key, a file dragged over and away) and the
// sweep's call sites (the agent wizard's error line, the select editor while
// it saves, the sources dialog's name field, the selection checkbox, Apply
// YAML's Choose a file).

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ChoiceGroup } from "../ChoiceGroup.js";
import { FieldHint, FieldLegend } from "../Field.js";
import { Checkbox, Radio } from "../controls.js";
import { areaControlClasses } from "../fieldClasses.js";
import { FileDrop } from "../FileDrop.js";
import { IdentityStep } from "../../../agent/steps/IdentityStep.js";
import { createInitialWizardData } from "../../../agent/steps/types.js";
import { InlineEditSelect } from "../../../inline-edit/InlineEditSelect.js";
import { SelectionCheckbox } from "../../../resource-workbench/components/SelectionCheckbox.js";
import { ManageSourcesDialog } from "../../../plugin/ManageSourcesDialog.js";
import { ApplyManifestDialog } from "../../../manifest/ApplyManifestDialog.js";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(cleanup);

vi.mock("../../../manifest/YamlEditor.js", () => ({ YamlEditor: () => <div data-testid="yaml-editor" /> }));
vi.mock("../../../manifest/useApplyManifest.js", () => ({
  useApplyManifest: () => ({
    content: "",
    setContent: () => {},
    readFile: () => {},
    entries: null,
    validationError: null,
    isValidating: false,
    hasRedactedSecrets: false,
    applyAll: async () => [],
    isApplying: false,
    reset: () => {},
  }),
}));

describe("the parts' rarer branches", () => {
  it("draws a hint and a group label on their own", () => {
    render(
      <>
        <FieldLegend optional>Whose cases run</FieldLegend>
        <FieldHint>Attach a plugin to run its cases.</FieldHint>
      </>,
    );
    expect(screen.getByText("Whose cases run").textContent).toBe("Whose cases run (optional)");
    expect(screen.getByText("Attach a plugin to run its cases.").className).toContain("stg:text-xs");
  });

  it("keeps a choice card's checkbox and radio for the keyboard and a screen reader, and draws nothing of its own", () => {
    render(
      <>
        <label>
          <Checkbox visuallyHidden />
          Every day
        </label>
        <label>
          <Radio visuallyHidden name="role" />
          Member
        </label>
      </>,
    );
    const box = screen.getByRole("checkbox", { name: "Every day" });
    const radio = screen.getByRole("radio", { name: "Member" });
    expect(box.className).toContain("stg:sr-only");
    expect(radio.className).toContain("stg:sr-only");
    expect(box.parentElement?.tagName).toBe("LABEL");
  });

  it("draws a frameless multi-line box inside another control's frame", () => {
    expect(areaControlClasses({ appearance: "bare" })).toContain("stg:border-0");
    expect(areaControlClasses({ appearance: "bare", size: "xs" })).toContain("stg:text-xs");
  });

  function Network() {
    const [value, setValue] = useState("any");
    return (
      <ChoiceGroup
        variant="list"
        aria-label="Network"
        value={value}
        onChange={setValue}
        options={[
          { value: "any", label: "Any website" },
          { value: "limited", label: "Listed websites only" },
        ]}
      />
    );
  }

  it("moves a list's choice by click and by key, and ignores a key that moves nothing", () => {
    render(<Network />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Any website" }), { key: "a" });
    expect(screen.getByRole("radio", { name: "Any website" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Listed websites only" }));
    expect(screen.getByRole("radio", { name: "Listed websites only" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Listed websites only" }), { key: "ArrowDown" });
    expect(screen.getByRole("radio", { name: "Any website" }).getAttribute("aria-checked")).toBe("true");
  });

  it("says Drop it to upload while a file is over it, and goes back when it leaves", () => {
    render(<FileDrop title="Drop a skill's .zip here" onFiles={() => {}} />);
    const zone = screen.getByText("Drop a skill's .zip here").parentElement as HTMLElement;
    fireEvent.dragOver(zone);
    expect(screen.getByText("Drop it to upload")).toBeDefined();
    fireEvent.dragLeave(zone);
    expect(screen.getByText("Drop a skill's .zip here")).toBeDefined();
  });
});

describe("the sweep's call sites", () => {
  it("shows the agent wizard's error under its fields", () => {
    render(<IdentityStep data={createInitialWizardData()} updateData={() => {}} validationError="Name is required" />);
    expect(screen.getByRole("alert").textContent).toBe("Name is required");
  });

  it("saves a choice from the select editor, and while it saves says so and holds the choices", () => {
    const OPTIONS = [
      { value: "org", label: "Organization" },
      { value: "private", label: "Private" },
    ];
    const onSave = vi.fn(async (_value: string) => true);
    const { rerender } = render(<InlineEditSelect value="org" options={OPTIONS} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button"));
    rerender(<InlineEditSelect value="org" options={OPTIONS} onSave={onSave} isSaving />);
    expect(screen.getByText("Saving")).toBeDefined();
    expect((screen.getByRole("radio", { name: "Private" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<InlineEditSelect value="org" options={OPTIONS} onSave={onSave} />);
    fireEvent.click(screen.getByRole("radio", { name: "Private" }));
    expect(onSave).toHaveBeenCalledWith("private");
  });

  it("keeps the selection checkbox's half-checked state", () => {
    const onChange = vi.fn();
    render(<SelectionCheckbox checked={false} indeterminate onChange={onChange} aria-label="Select all" />);
    const box = screen.getByRole("checkbox", { name: "Select all" }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("takes a name for a source the sources dialog adds", () => {
    render(
      <ManageSourcesDialog
        open
        onClose={() => {}}
        marketplaces={[]}
        unreadable={[]}
        isBuiltIn={() => false}
        add={async () => ({ ok: true }) as never}
        remove={() => null}
      />,
    );
    const name = screen.getByPlaceholderText("the catalogue's own name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "acme" } });
    expect(name.value).toBe("acme");
  });

  it("opens the system's file picker from Apply YAML's Choose a file", () => {
    const { container } = render(<ApplyManifestDialog open onOpenChange={() => {}} org="acme" />);
    const input = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Choose a file" }));
    expect(click).toHaveBeenCalled();
  });
});
