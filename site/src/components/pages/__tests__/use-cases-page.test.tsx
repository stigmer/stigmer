/**
 * The use-cases page and the homepage cards that link into it.
 *
 * Pins that every job on the page says whose product it is, what the
 * customer asks for, what the agent hands back and where it asks first (the
 * shape of an example in the vocabulary's positioning section), and that
 * every homepage card's `/use-cases#<id>` lands on an entry of the page.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { USE_CASES } from "@/lib/use-cases";
import { UseCases } from "@/components/sections/UseCases";
import { UseCasesPage } from "../UseCasesPage";

afterEach(cleanup);

describe("UseCasesPage", () => {
  it("gives each job its product, ask, result and where it asks first", () => {
    const { container } = render(<UseCasesPage />);

    for (const useCase of USE_CASES) {
      const entry = container.querySelector(`article#${useCase.id}`);
      expect(entry, useCase.id).not.toBeNull();
      const text = entry!.textContent ?? "";
      for (const field of [useCase.product, useCase.asks, useCase.handsBack, useCase.asksFirst]) {
        expect(text, useCase.id).toContain(field);
      }
    }
  });

  it("is the target of every homepage card", () => {
    render(<UseCases />);
    const anchors = screen
      .getAllByRole("link", { name: /See the job/ })
      .map((link) => link.getAttribute("href") ?? "");
    cleanup();
    const { container } = render(<UseCasesPage />);

    expect(anchors.length).toBeGreaterThan(0);
    for (const href of anchors) {
      expect(href).toMatch(/^\/use-cases#/);
      expect(container.querySelector(`article#${href.split("#")[1]}`), href).not.toBeNull();
    }
  });
});
