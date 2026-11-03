/**
 * The routine form's time zone field offers each zone by its current IANA
 * name, though the runtime's tz database (Chromium's, Node's) still returns
 * the old names of the zones IANA renamed, and a search by either name finds
 * it (stigmer#2888).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { allTimeZones, browserTimeZone, currentTimeZoneName, TimeZoneField } from "../TimeZoneField";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function field(value = "UTC") {
  const onChange = vi.fn();
  render(<TimeZoneField value={value} onChange={onChange} />);
  return { input: screen.getByRole("combobox", { name: "Time zone" }), onChange };
}

describe("TimeZoneField", () => {
  it("names a renamed zone by its current name, and any other zone as it is", () => {
    expect(currentTimeZoneName("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(currentTimeZoneName("Europe/Kiev")).toBe("Europe/Kyiv");
    expect(currentTimeZoneName("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(currentTimeZoneName("Europe/London")).toBe("Europe/London");
  });

  it("lists every zone by its current name, sorted, each once", () => {
    vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["Europe/London", "Asia/Calcutta", "Asia/Kolkata", "Africa/Asmera"]);
    expect(allTimeZones()).toEqual(["Africa/Asmara", "Asia/Kolkata", "Europe/London"]);
  });

  it("lists the runtime's zones by their current names", () => {
    const zones = allTimeZones();
    expect(zones).toContain("Asia/Kolkata");
    expect(zones).not.toContain("Asia/Calcutta");
  });

  it("finds a renamed zone by its current name and picks it", () => {
    const { input, onChange } = field();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Kolkata" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: "Asia/Kolkata" }));
    expect(onChange).toHaveBeenCalledWith("Asia/Kolkata");
  });

  it("finds a renamed zone by its old name, offering the current one", () => {
    const { input } = field();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Calcutta" } });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Asia/Kolkata"]);
  });

  it("marks a routine's zone saved under its old name as the one selected", () => {
    const { input } = field("Asia/Calcutta");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Kolkata" } });
    expect(screen.getByRole("option", { name: "Asia/Kolkata" }).getAttribute("aria-selected")).toBe("true");
  });

  it("offers the browser's zone by its current name, and UTC, on a runtime that cannot list zones", () => {
    vi.spyOn(Intl, "supportedValuesOf").mockImplementation(() => {
      throw new TypeError("Intl.supportedValuesOf is not a function");
    });
    const resolved = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions");
    resolved.mockReturnValue({ ...new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).resolvedOptions(), timeZone: "Asia/Calcutta" });
    expect(allTimeZones()).toEqual(["Asia/Kolkata", "UTC"]);
    resolved.mockReturnValue({ ...new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).resolvedOptions(), timeZone: "UTC" });
    expect(allTimeZones()).toEqual(["UTC"]);
  });

  it("defaults to the browser's zone by its current name", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      ...new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).resolvedOptions(),
      timeZone: "Asia/Calcutta",
    });
    expect(browserTimeZone()).toBe("Asia/Kolkata");
  });
});
