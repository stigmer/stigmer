import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PlanDocumentMessage } from "../PlanDocumentMessage";

afterEach(cleanup);

describe("PlanDocumentMessage", () => {
  it("lifts the leading H1 into the header and renders the body as markdown", () => {
    render(
      <PlanDocumentMessage
        content={"# Migration Plan\n\n## Phase 1\n\n- step one"}
      />,
    );

    const doc = screen.getByRole("article", { name: "Plan document" });
    expect(doc).toBeTruthy();
    expect(doc.querySelector("header")!.textContent).toContain(
      "Migration Plan",
    );
    // The lifted title does not repeat inside the prose body.
    expect(doc.querySelectorAll("h1")).toHaveLength(0);
  });

  it("falls back to a 'Plan' header when the document has no leading H1", () => {
    render(<PlanDocumentMessage content="Just prose, no heading." />);

    const doc = screen.getByRole("article", { name: "Plan document" });
    expect(doc.querySelector("header")!.textContent).toContain("Plan");
    expect(doc.textContent).toContain("Just prose, no heading.");
  });

  it("unwraps a whole-body BARE fence (plan-scoped fence handling)", () => {
    render(
      <PlanDocumentMessage content={"```\n# Fenced Plan\n\nBody text\n```"} />,
    );

    const doc = screen.getByRole("article", { name: "Plan document" });
    // Unwrapped: the H1 became the header title, the body is prose (not a
    // flat code block).
    expect(doc.querySelector("header")!.textContent).toContain("Fenced Plan");
    expect(doc.querySelector("pre")).toBeNull();
    expect(doc.textContent).toContain("Body text");
  });

  it("keeps an inner code fence as a code block", () => {
    render(
      <PlanDocumentMessage
        content={"# Plan\n\n```ts\nconst x = 1;\n```"}
      />,
    );

    const doc = screen.getByRole("article", { name: "Plan document" });
    expect(doc.querySelector("pre")).not.toBeNull();
  });
});
