// Tests for the typed value control: per-FieldType dispatch and the
// canonical encodings it emits.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  FieldDeclarationSchema,
  FieldType,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/spec_pb";
import { FieldValueControl } from "../FieldValueControl";

afterEach(() => cleanup());

function field(type: FieldType, extras: { enumValues?: string[] } = {}) {
  return create(FieldDeclarationSchema, {
    name: "f",
    type,
    enumValues: extras.enumValues ?? [],
  });
}

describe("FieldValueControl dispatch", () => {
  it("renders a text input for plain strings", () => {
    render(
      <FieldValueControl
        field={field(FieldType.string)}
        value={undefined}
        onChange={vi.fn()}
        aria-label="f"
      />,
    );
    expect((screen.getByLabelText("f") as HTMLInputElement).type).toBe("text");
  });

  it("renders an enum select when enum_values are declared", () => {
    const onChange = vi.fn();
    render(
      <FieldValueControl
        field={field(FieldType.string, { enumValues: ["confirmed", "cancelled"] })}
        value={undefined}
        onChange={onChange}
        aria-label="f"
      />,
    );
    const select = screen.getByLabelText("f") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "",
      "confirmed",
      "cancelled",
    ]);
    fireEvent.change(select, { target: { value: "confirmed" } });
    expect(onChange).toHaveBeenCalledWith("confirmed");
  });

  it("emits numbers (not strings) for numeric fields", () => {
    const onChange = vi.fn();
    render(
      <FieldValueControl
        field={field(FieldType.integer)}
        value={undefined}
        onChange={onChange}
        aria-label="f"
      />,
    );
    fireEvent.change(screen.getByLabelText("f"), { target: { value: "42" } });
    expect(onChange).toHaveBeenCalledWith(42);
  });

  it("bool renders a tri-state select — unset is distinct from false", () => {
    const onChange = vi.fn();
    render(
      <FieldValueControl
        field={field(FieldType.bool)}
        value={undefined}
        onChange={onChange}
        aria-label="f"
      />,
    );
    const select = screen.getByLabelText("f") as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "false" } });
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("date and time render native pickers", () => {
    const { rerender } = render(
      <FieldValueControl
        field={field(FieldType.date)}
        value={undefined}
        onChange={vi.fn()}
        aria-label="f"
      />,
    );
    expect((screen.getByLabelText("f") as HTMLInputElement).type).toBe("date");
    rerender(
      <FieldValueControl
        field={field(FieldType.time)}
        value={undefined}
        onChange={vi.fn()}
        aria-label="f"
      />,
    );
    expect((screen.getByLabelText("f") as HTMLInputElement).type).toBe("time");
  });

  it("timestamp converts the local picker value to RFC 3339 UTC", () => {
    const onChange = vi.fn();
    render(
      <FieldValueControl
        field={field(FieldType.timestamp)}
        value={undefined}
        onChange={onChange}
        aria-label="f"
      />,
    );
    fireEvent.change(screen.getByLabelText("f"), {
      target: { value: "2026-07-22T10:00:00" },
    });
    const emitted = onChange.mock.calls[0][0] as string;
    // Local wall time converts to a UTC instant — exact hour depends on
    // the test host's zone, so assert the canonical UTC shape.
    expect(emitted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Date.parse(emitted)).toBe(new Date("2026-07-22T10:00:00").getTime());
  });

  it("json keeps invalid input local and emits only valid JSON", () => {
    const onChange = vi.fn();
    render(
      <FieldValueControl
        field={field(FieldType.json)}
        value={undefined}
        onChange={onChange}
        aria-label="f"
      />,
    );
    const textarea = screen.getByLabelText("f");
    fireEvent.change(textarea, { target: { value: '{"a":' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Invalid JSON");

    fireEvent.change(textarea, { target: { value: '{"a": 1}' } });
    expect(onChange).toHaveBeenCalledWith({ a: 1 });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("empty input emits undefined (the field will not travel)", () => {
    const onChange = vi.fn();
    render(
      <FieldValueControl
        field={field(FieldType.string)}
        value={"x"}
        onChange={onChange}
        aria-label="f"
      />,
    );
    fireEvent.change(screen.getByLabelText("f"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
