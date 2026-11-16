// The kit's form parts, by what a person and a screen reader get from them:
// a field's label names its control and its hint or error describes it, an
// error replaces the hint and marks the control invalid; a field is the
// button's height at each size; a choice group is one radiogroup that the
// arrow keys move through, skipping a disabled choice; the file drop's
// button opens the picker and hands back what was chosen; a form's foot puts
// the act first on a page and last in a dialog, and waits while it runs.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { BUTTON_SIZE_CLASSES } from "../../../button/buttonClasses.js";
import { ChoiceGroup } from "../ChoiceGroup.js";
import { Checkbox, HiddenFileInput, Select, TextArea, TextInput } from "../controls.js";
import { Field, FieldError } from "../Field.js";
import { FIELD_SIZE_CLASSES, fieldControlClasses } from "../fieldClasses.js";
import { FileDrop } from "../FileDrop.js";
import { FormFooter } from "../FormFooter.js";
import { SwitchField } from "../SwitchField.js";

afterEach(cleanup);

/** The height utility of a class string (`stg:h-8`). */
function heightOf(classes: string): string | undefined {
  return classes.split(/\s+/).find((c) => /^stg:h-\d/.test(c));
}

describe("Field", () => {
  it("names its control with its label and describes it with its hint", () => {
    render(
      <Field label="Name" hint="The name in links and files.">
        <TextInput defaultValue="daily-variance-report" />
      </Field>,
    );
    const box = screen.getByRole("textbox", { name: "Name" });
    expect(box.getAttribute("aria-invalid")).toBeNull();
    const described = document.getElementById(box.getAttribute("aria-describedby") ?? "");
    expect(described?.textContent).toBe("The name in links and files.");
  });

  it("shows an error instead of the hint, announces it, and marks the control invalid", () => {
    render(
      <Field label="Name" hint="The name in links and files." error="Give the routine a name.">
        <TextInput />
      </Field>,
    );
    const box = screen.getByRole("textbox", { name: "Name" });
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(box.className).toContain("stg:border-status-failed");
    expect(screen.queryByText("The name in links and files.")).toBeNull();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Give the routine a name.");
    expect(box.getAttribute("aria-describedby")).toBe(alert.id);
  });

  it("says a field is optional after its label", () => {
    render(
      <Field label="Budget per run (USD)" optional>
        <TextInput />
      </Field>,
    );
    expect(screen.getByRole("textbox", { name: "Budget per run (USD) (optional)" })).toBeDefined();
  });

  it("takes its id from the field, and keeps a control's own descriptions beside its field's", () => {
    render(
      <>
        <p id="outside">Read this first.</p>
        <Field id="message" label="Message" hint="Leave empty to send the routine's own message.">
          <TextArea aria-describedby="outside" />
        </Field>
      </>,
    );
    const box = screen.getByRole("textbox", { name: "Message" });
    expect(box.id).toBe("message");
    expect(box.getAttribute("aria-describedby")?.split(" ")[0]).toBe("outside");
    expect(box.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
  });

  it("wires a select the same way", () => {
    render(
      <Field label="Time zone" error="Pick a time zone.">
        <Select defaultValue="">
          <option value="">None</option>
        </Select>
      </Field>,
    );
    expect(screen.getByRole("combobox", { name: "Time zone" }).getAttribute("aria-invalid")).toBe("true");
  });

  it("draws an error line on its own, with the words directly in the alert", () => {
    render(<FieldError>The slug is taken.</FieldError>);
    const alert = screen.getByText("The slug is taken.");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.className).toContain("stg:text-status-failed");
  });
});

describe("sizes", () => {
  it("is the button's height at each size, so a field and the button beside it line up", () => {
    expect(heightOf(FIELD_SIZE_CLASSES.sm)).toBe(heightOf(BUTTON_SIZE_CLASSES.sm));
    expect(heightOf(FIELD_SIZE_CLASSES.xs)).toBe(heightOf(BUTTON_SIZE_CLASSES.xs));
    expect(heightOf(FIELD_SIZE_CLASSES.sm)).toBe("stg:h-8");
    expect(heightOf(FIELD_SIZE_CLASSES.xs)).toBe("stg:h-7");
  });

  it("draws 14px text by default and 12px small, with the button's corner and focus ring", () => {
    expect(fieldControlClasses()).toContain("stg:text-sm");
    expect(fieldControlClasses({ size: "xs" })).toContain("stg:text-xs");
    expect(fieldControlClasses()).toContain("stg:rounded-lg");
    expect(fieldControlClasses()).toContain("stg:focus-visible:ring-2");
  });

  it("draws no frame when bare, inside another control's frame", () => {
    render(<TextInput appearance="bare" aria-label="Search models" />);
    const box = screen.getByRole("textbox", { name: "Search models" });
    expect(box.className).toContain("stg:border-0");
    expect(box.className).not.toContain("stg:h-8");
  });

  it("lets a caller's class win over the field's own where they conflict", () => {
    render(<TextInput aria-label="Search agents" className="stg:h-10 stg:pl-8" />);
    const classes = screen.getByRole("textbox", { name: "Search agents" }).className.split(" ");
    expect(classes).toContain("stg:pl-8");
    expect(classes).toContain("stg:h-10");
    expect(classes).not.toContain("stg:h-8");
  });
});

describe("Checkbox", () => {
  it("is a native checkbox its label names and toggles", () => {
    const onChange = vi.fn();
    render(
      <label>
        <Checkbox onChange={(e) => onChange(e.target.checked)} />
        Also allow package registries
      </label>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Also allow package registries" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("ChoiceGroup", () => {
  function Cadence({ disabledWeekly = false }: { readonly disabledWeekly?: boolean }) {
    const [value, setValue] = useState("daily");
    return (
      <ChoiceGroup
        aria-label="Cadence"
        value={value}
        onChange={setValue}
        options={[
          { value: "hourly", label: "Hourly" },
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly", disabled: disabledWeekly },
          { value: "monthly", label: "Monthly" },
        ]}
      />
    );
  }

  it("is one radiogroup whose chosen radio is the one Tab reaches", () => {
    render(<Cadence />);
    expect(screen.getByRole("radiogroup", { name: "Cadence" })).toBeDefined();
    const daily = screen.getByRole("radio", { name: "Daily" });
    expect(daily.getAttribute("aria-checked")).toBe("true");
    expect(daily.tabIndex).toBe(0);
    expect(screen.getByRole("radio", { name: "Hourly" }).tabIndex).toBe(-1);
  });

  it("moves the choice with the arrow keys and wraps, Home and End go to the ends", () => {
    render(<Cadence />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Daily" }), { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Weekly" }).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Weekly" }));
    fireEvent.keyDown(screen.getByRole("radio", { name: "Weekly" }), { key: "End" });
    expect(screen.getByRole("radio", { name: "Monthly" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Monthly" }), { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Hourly" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Hourly" }), { key: "ArrowUp" });
    expect(screen.getByRole("radio", { name: "Monthly" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Monthly" }), { key: "Home" });
    expect(screen.getByRole("radio", { name: "Hourly" }).getAttribute("aria-checked")).toBe("true");
  });

  it("skips a choice that can't be chosen", () => {
    render(<Cadence disabledWeekly />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Daily" }), { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Monthly" }).getAttribute("aria-checked")).toBe("true");
  });

  it("draws each choice of a list with its line under it", () => {
    render(
      <ChoiceGroup
        variant="list"
        aria-label="Network"
        value="limited"
        onChange={() => undefined}
        options={[
          { value: "any", label: "Any website", description: "The sandbox may reach any website." },
          { value: "limited", label: "Listed websites only", description: "The sandbox may reach only the websites below." },
        ]}
      />,
    );
    const chosen = screen.getByRole("radio", { name: /Listed websites only/ });
    expect(chosen.getAttribute("aria-checked")).toBe("true");
    expect(chosen.textContent).toContain("The sandbox may reach only the websites below.");
  });

  it("takes a numeric value as well as a string", () => {
    const onChange = vi.fn();
    render(<ChoiceGroup aria-label="Filter" value={0} onChange={onChange} options={[{ value: 0, label: "All" }, { value: 1, label: "Needs a person" }]} />);
    fireEvent.click(screen.getByRole("radio", { name: "Needs a person" }));
    expect(onChange).toHaveBeenCalledWith(1);
  });
});

describe("FileDrop", () => {
  it("opens the picker from its button, which the keyboard reaches, and hands back the chosen file", () => {
    const onFiles = vi.fn();
    const { container } = render(<FileDrop title="Drop a skill's .zip here" hint="Up to 10 MB." accept=".zip" onFiles={onFiles} />);
    const button = screen.getByRole("button", { name: "Choose a file" });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(click).toHaveBeenCalled();
    expect(input.accept).toBe(".zip");
    const file = new File(["SKILL"], "month-end-close.zip", { type: "application/zip" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it("takes a dropped file, and only the first unless it takes several", () => {
    const onFiles = vi.fn();
    render(<FileDrop title="Drop a plugin's .zip here" onFiles={onFiles} />);
    const zone = screen.getByText("Drop a plugin's .zip here").parentElement as HTMLElement;
    const a = new File(["a"], "a.zip");
    const b = new File(["b"], "b.zip");
    fireEvent.drop(zone, { dataTransfer: { files: [a, b] } });
    expect(onFiles).toHaveBeenCalledWith([a]);
  });

  it("keeps the hidden input out of the tab order and away from a screen reader", () => {
    const { container } = render(<HiddenFileInput accept=".yaml" />);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.tabIndex).toBe(-1);
    expect(input.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("SwitchField", () => {
  it("is a switch its label names and its line describes", () => {
    const onChange = vi.fn();
    render(<SwitchField label="Turn it on now" hint="Leave off to create it staged." checked={false} onCheckedChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Turn it on now" });
    expect(document.getElementById(sw.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Leave off to create it staged.");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("FormFooter", () => {
  it("puts the act first and Cancel beside it on a page", () => {
    const onCancel = vi.fn();
    render(<FormFooter submitLabel="Create routine" onCancel={onCancel} />);
    const [first, second] = screen.getAllByRole("button");
    expect(first.textContent).toBe("Create routine");
    expect(first.getAttribute("type")).toBe("submit");
    expect(second.textContent).toBe("Cancel");
    fireEvent.click(second);
    expect(onCancel).toHaveBeenCalled();
  });

  it("puts Cancel first and the act at the end in a dialog", () => {
    render(<FormFooter submitLabel="Remove" submitVariant="destructive" submitType="button" align="end" onCancel={() => undefined} />);
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(["Cancel", "Remove"]);
  });

  it("waits while the act runs, keeping its words, and draws the form's failure above the acts", () => {
    render(<FormFooter submitLabel="Create routine" busy onCancel={() => undefined} failure={<p role="alert">Couldn't create the routine.</p>} />);
    const act = screen.getByRole("button", { name: "Create routine" }) as HTMLButtonElement;
    expect(act.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    const failure = screen.getByRole("alert");
    expect(failure.compareDocumentPosition(act) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws no Cancel without one", () => {
    render(<FormFooter submitLabel="Save" />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
