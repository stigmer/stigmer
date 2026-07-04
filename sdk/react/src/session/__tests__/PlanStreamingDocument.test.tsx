import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PlanStreamingDocument } from "../PlanStreamingDocument";

afterEach(cleanup);

describe("PlanStreamingDocument — live plan tab view", () => {
  it("is a busy article with a Writing status pill", () => {
    render(
      <PlanStreamingDocument displayText={"# Live Plan\n\nFirst section"} />,
    );

    const doc = screen.getByRole("article", { name: "Plan document" });
    expect(doc.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Writing…");
  });

  it("lifts the leading H1 into the header and renders the body as markdown", () => {
    render(
      <PlanStreamingDocument
        displayText={"# Live Plan\n\n## Phase 1\n\n- step one"}
      />,
    );

    const doc = screen.getByRole("article", { name: "Plan document" });
    expect(doc.querySelector("header")!.textContent).toContain("Live Plan");
    // The lifted title does not repeat inside the prose body.
    expect(doc.querySelectorAll("h1")).toHaveLength(0);
    expect(doc.textContent).toContain("step one");
  });

  it("renders headerless while the H1 line is still streaming in", () => {
    // extractLeadingH1 requires the heading to terminate (newline or end);
    // a lone "#" has no title yet — the document simply shows the raw text
    // until the title resolves. No fabricated placeholder header.
    render(<PlanStreamingDocument displayText={"# Re"} />);

    const doc = screen.getByRole("article", { name: "Plan document" });
    // "# Re" parses as a (partial) title, lifted into the header.
    expect(doc.querySelector("header")!.textContent).toContain("Re");
  });

  it("offers no Edit or Build controls — a plan in flight cannot be acted on", () => {
    render(<PlanStreamingDocument displayText={"# Live Plan\n\nBody"} />);

    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Build from plan")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
