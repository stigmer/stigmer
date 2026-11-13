// Pins SummarizationCard over the fold's compaction item
// (`agent.thread_context_compacted`): a hairline marker saying the earlier
// messages were summarized, with the time it happened, and no time for an
// item without one.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SummarizationCard } from "../SummarizationCard";

afterEach(cleanup);

describe("SummarizationCard", () => {
  it("says the earlier messages were summarized, with the time it happened", () => {
    const { container } = render(
      <SummarizationCard
        compacted={{ kind: "compacted", id: "c1", processedAt: "2026-08-13T10:15:00.000Z" }}
      />,
    );
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Earlier messages summarized");
    expect(screen.getByRole("status").textContent).toContain("Earlier messages summarized · ");
    const time = container.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe("2026-08-13T10:15:00.000Z");
    expect(time?.textContent).not.toBe("");
  });

  it("shows the raw value for a time it cannot read, and no time when there is none", () => {
    const bad = render(<SummarizationCard compacted={{ kind: "compacted", id: "c1", processedAt: "soon" }} />);
    expect(bad.container.querySelector("time")?.textContent).toBe("soon");
    cleanup();

    const none = render(<SummarizationCard compacted={{ kind: "compacted", id: "c2", processedAt: "" }} />);
    expect(none.container.querySelector("time")).toBeNull();
  });
});
