/**
 * Pins the read-only pair: a description list of terms and values, the
 * value in the page's body text (not the 11px and 12px the detail panels
 * drew their own pairs at), set in the mono face for an identifier, and
 * nothing drawn for a pair with no value.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReadOnlyField, ReadOnlyFields } from "../ReadOnlyField";

afterEach(cleanup);

describe("ReadOnlyField", () => {
  it("draws each pair as a term and its value in one named description list, at the body size", () => {
    const { container } = render(
      <ReadOnlyFields aria-label="The app">
        <ReadOnlyField label="Client ID" mono>
          app_7f3a
        </ReadOnlyField>
        <ReadOnlyField label="Created">12 November 2026</ReadOnlyField>
      </ReadOnlyFields>,
    );
    const list = container.querySelector("dl");
    expect(list?.getAttribute("aria-label")).toBe("The app");
    expect(list?.className).toContain("stg:text-sm");
    expect([...container.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Client ID", "Created"]);
    expect([...container.querySelectorAll("dd")].map((d) => d.textContent)).toEqual(["app_7f3a", "12 November 2026"]);
    expect(screen.getByText("app_7f3a").className).toContain("stg:font-mono");
    expect(screen.getByText("12 November 2026").className).not.toContain("stg:font-mono");
    expect(screen.getByText("Client ID").className).toContain("stg:text-muted-foreground");
  });

  it("puts the label beside its value from the small breakpoint and under it on a phone", () => {
    const { container } = render(
      <ReadOnlyFields>
        <ReadOnlyField label="Issuer">https://login.northwind.example</ReadOnlyField>
      </ReadOnlyFields>,
    );
    const pair = container.querySelector("dt")?.parentElement;
    expect(pair?.className).toContain("stg:grid");
    expect(pair?.className).toContain("stg:sm:grid-cols-[minmax(7.5rem,12.5rem)_minmax(0,1fr)]");
  });

  it("draws nothing for a pair with no value", () => {
    const { container } = render(
      <ReadOnlyFields>
        <ReadOnlyField label="Updated">{""}</ReadOnlyField>
        <ReadOnlyField label="Deleted">{null}</ReadOnlyField>
        <ReadOnlyField label="Created">today</ReadOnlyField>
      </ReadOnlyFields>,
    );
    expect([...container.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Created"]);
  });
});
