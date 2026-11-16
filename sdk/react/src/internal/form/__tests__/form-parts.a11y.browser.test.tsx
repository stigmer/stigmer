// The form parts in a real browser against the shipped stylesheet, light and
// dark: a form of every part passes axe (labels, contrast, roles), a field
// and the button beside it measure the same height at each size, and a
// field's error is drawn under its field.

import "../../../../dist/styles.css";
import { afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { COLOR_MODES, auditA11y, renderAudited, resetAudit } from "../../../__tests__/helpers/a11y-audit.js";
import { Button } from "../../../button/Button.js";
import { ChoiceGroup } from "../ChoiceGroup.js";
import { Checkbox, Select, TextArea, TextInput } from "../controls.js";
import { Field } from "../Field.js";
import { FileDrop } from "../FileDrop.js";
import { FormFooter } from "../FormFooter.js";
import { SwitchField } from "../SwitchField.js";

afterEach(resetAudit);

function EveryPart() {
  return (
    <form aria-label="New routine" className="stg:flex stg:max-w-2xl stg:flex-col stg:gap-5 stg:p-6">
      <Field label="Name" hint="The name in links and files.">
        <TextInput defaultValue="daily-variance-report" />
      </Field>
      <Field label="Message" error="Write the message the agent gets on every run.">
        <TextArea rows={3} />
      </Field>
      <Field label="Time zone">
        <Select defaultValue="Asia/Kolkata">
          <option value="Asia/Kolkata">Asia/Kolkata</option>
          <option value="UTC">UTC</option>
        </Select>
      </Field>
      <ChoiceGroup
        aria-label="Cadence"
        value="daily"
        onChange={() => undefined}
        options={[
          { value: "hourly", label: "Hourly" },
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
        ]}
      />
      <label className="stg:flex stg:items-center stg:gap-2 stg:text-sm">
        <Checkbox defaultChecked />
        Also allow package registries and code hosts
      </label>
      <SwitchField label="Turn it on now" hint="Leave off to create it staged." checked={false} onCheckedChange={() => undefined} />
      <FileDrop title="Drop a skill's .zip here" hint="Up to 10 MB." onFiles={() => undefined} aria-label="Skill package" />
      <div className="stg:flex stg:items-center stg:gap-2">
        <TextInput aria-label="Address" defaultValue="https://ledger.acme.example/mcp" />
        <Button variant="outline">Add</Button>
      </div>
      <div className="stg:flex stg:items-center stg:gap-2">
        <TextInput size="xs" aria-label="Slug" defaultValue="ledger-reviewer" />
        <Button size="xs">Save</Button>
      </div>
      <FormFooter submitLabel="Create routine" onCancel={() => undefined} />
    </form>
  );
}

describe("Form parts a11y", () => {
  it.each(COLOR_MODES)("every part in a form passes axe (%s)", async (mode) => {
    const container = renderAudited(<EveryPart />, mode, { width: 760, height: 1200 });
    await screen.findByRole("form", { name: "New routine" });
    await auditA11y(container, `form parts · ${mode}`);
  });

  it("measures a field and the button beside it at one height, at each size", () => {
    renderAudited(<EveryPart />, "light", { width: 760, height: 1200 });
    const field = screen.getByRole("textbox", { name: "Address" }).getBoundingClientRect().height;
    const add = screen.getByRole("button", { name: "Add" }).getBoundingClientRect().height;
    expect(field).toBe(32);
    expect(add).toBe(field);
    const small = screen.getByRole("textbox", { name: "Slug" }).getBoundingClientRect().height;
    const save = screen.getByRole("button", { name: "Save" }).getBoundingClientRect().height;
    expect(small).toBe(28);
    expect(save).toBe(small);
  });

  it("draws a field's error under its field", () => {
    renderAudited(<EveryPart />, "light", { width: 760, height: 1200 });
    const box = screen.getByRole("textbox", { name: "Message" }).getBoundingClientRect();
    const error = screen.getByRole("alert").getBoundingClientRect();
    expect(error.top).toBeGreaterThanOrEqual(box.bottom);
  });
});
