import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ArtifactContentRenderer } from "../ArtifactContentRenderer";

afterEach(cleanup);

describe("ArtifactContentRenderer — markdown", () => {
  const wrappedPlan = "```markdown\n# Plan\n\n1. First\n2. Second\n```";

  it("unwraps a model-wrapped ```markdown plan in the Rendered view", () => {
    const { container } = render(
      <ArtifactContentRenderer content={wrappedPlan} fileName="plan.md" />,
    );

    // Rendered is the default tab: the heading/list render as real elements and
    // the plan is not trapped inside a single <pre>.
    expect(container.querySelector("h1")).not.toBeNull();
    expect(container.querySelector("ol")).not.toBeNull();
    expect(container.querySelector("pre")).toBeNull();
  });

  it("keeps the Source view byte-faithful to the stored artifact", () => {
    const { container } = render(
      <ArtifactContentRenderer content={wrappedPlan} fileName="plan.md" />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Source" }));

    // Source shows the raw bytes — including the enclosing fence we hid in the
    // Rendered view — so a download/copy stays faithful to what the agent wrote.
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain("```markdown");
  });

  it("leaves an already-rich markdown plan unchanged", () => {
    const { container } = render(
      <ArtifactContentRenderer
        content={"# Plan\n\n- only step"}
        fileName="plan.md"
      />,
    );

    expect(container.querySelector("h1")).not.toBeNull();
    expect(container.querySelector("pre")).toBeNull();
  });
});
