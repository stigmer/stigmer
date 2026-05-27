import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { StructuredDataViewer } from "../execution-inspector/StructuredDataViewer";

afterEach(cleanup);

describe("StructuredDataViewer", () => {
  describe("empty data", () => {
    it("renders empty state for an empty object", () => {
      render(<StructuredDataViewer data={{}} />);
      expect(screen.getByText("No data fields")).toBeTruthy();
    });
  });

  describe("scalar values", () => {
    it("renders string scalar in a definition list", () => {
      render(<StructuredDataViewer data={{ agent_id: "aex_123" }} />);
      expect(screen.getByText("Agent Id")).toBeTruthy();
      expect(screen.getByText("aex_123")).toBeTruthy();
    });

    it("renders number scalar with monospace formatting", () => {
      render(<StructuredDataViewer data={{ retry_count: 3 }} />);
      expect(screen.getByText("Retry Count")).toBeTruthy();
      expect(screen.getByText("3")).toBeTruthy();
    });

    it("renders boolean scalar", () => {
      render(<StructuredDataViewer data={{ is_valid: true }} />);
      expect(screen.getByText("Is Valid")).toBeTruthy();
      expect(screen.getByText("true")).toBeTruthy();
    });

    it("renders null value as dash", () => {
      render(<StructuredDataViewer data={{ missing_field: null }} />);
      expect(screen.getByText("Missing Field")).toBeTruthy();
      expect(screen.getByText("—")).toBeTruthy();
    });

    it("renders multiple scalars in a single grid", () => {
      render(
        <StructuredDataViewer
          data={{ name: "test", count: 5, active: false }}
        />,
      );
      expect(screen.getByText("Name")).toBeTruthy();
      expect(screen.getByText("Count")).toBeTruthy();
      expect(screen.getByText("Active")).toBeTruthy();
    });
  });

  describe("long string prose detection", () => {
    it("renders short strings in monospace (< 120 chars)", () => {
      const shortValue = "A short string value";
      render(<StructuredDataViewer data={{ summary: shortValue }} />);
      const dd = screen.getByText(shortValue);
      expect(dd.closest("dd")).toBeTruthy();
    });

    it("renders long strings as prose paragraphs (> 120 chars)", () => {
      const longValue =
        "Garden Design Makeover shows stable DAU at 7,297 with healthy retention rates above industry benchmarks. " +
        "Critical attention needed for 3,159 D3 dropoffs concentrated in Cuba and India markets.";
      render(<StructuredDataViewer data={{ executive_summary: longValue }} />);
      const paragraph = screen.getByText(new RegExp("Garden Design Makeover"));
      expect(paragraph.tagName).toBe("P");
    });

    it("does not treat IDs/URLs > 120 chars as prose", () => {
      const longId = "aex_" + "a".repeat(200);
      render(<StructuredDataViewer data={{ execution_id: longId }} />);
      const element = screen.getByTitle(longId);
      expect(element).toBeTruthy();
    });
  });

  describe("nested objects", () => {
    it("renders depth-1 nested object as a collapsible section", () => {
      render(
        <StructuredDataViewer
          data={{
            structured: {
              executive_summary: "summary text",
              metric: 42,
            },
          }}
        />,
      );

      expect(screen.getByText("Structured")).toBeTruthy();
      expect(screen.getByText("Executive Summary")).toBeTruthy();
      expect(screen.getByText("summary text")).toBeTruthy();
    });

    it("falls back to JSON at depth >= 2", () => {
      render(
        <StructuredDataViewer
          data={{
            level1: {
              level2: {
                deep_value: "nested",
              },
            },
          }}
        />,
      );

      expect(screen.getByText("Level1")).toBeTruthy();
      expect(screen.getByText(/Level2/)).toBeTruthy();
    });
  });

  describe("arrays", () => {
    it("renders empty array with message", () => {
      render(<StructuredDataViewer data={{ items: [] }} />);
      expect(screen.getByText("Empty array")).toBeTruthy();
    });

    it("renders short scalar array inline", () => {
      render(
        <StructuredDataViewer data={{ tags: ["a", "b", "c"] }} />,
      );
      expect(screen.getByText("a, b, c")).toBeTruthy();
    });

    it("renders long scalar array as collapsible JSON", () => {
      const items = Array.from({ length: 10 }, (_, i) => `item-${i}`);
      render(<StructuredDataViewer data={{ items }} />);
      expect(screen.getByText(/Items.*10 items/)).toBeTruthy();
    });

    it("renders object array as structured items with count", () => {
      render(
        <StructuredDataViewer
          data={{
            errors: [
              { path: "/a", message: "required" },
              { path: "/b", message: "invalid" },
            ],
          }}
        />,
      );
      expect(screen.getByText(/Errors/)).toBeTruthy();
      expect(screen.getByText(/2 items/)).toBeTruthy();
      expect(screen.getByText("Item 1")).toBeTruthy();
      expect(screen.getByText("Item 2")).toBeTruthy();
    });

    it("renders scalar fields inside object array items", () => {
      render(
        <StructuredDataViewer
          data={{
            cohorts: [
              { name: "D1 New Users", size: 0, action_needed: false },
            ],
          }}
        />,
      );
      expect(screen.getByText("Size")).toBeTruthy();
      expect(screen.getByText("0")).toBeTruthy();
      expect(screen.getByText("Action Needed")).toBeTruthy();
      expect(screen.getByText("false")).toBeTruthy();
    });

    it("shows singular 'item' for single-element arrays", () => {
      render(
        <StructuredDataViewer
          data={{
            results: [{ status: "ok" }],
          }}
        />,
      );
      expect(screen.getByText(/1 item(?!s)/)).toBeTruthy();
    });

    it("renders mixed arrays (objects + scalars) as collapsible JSON", () => {
      render(
        <StructuredDataViewer
          data={{
            mixed: [{ key: "val" }, "plain string", 42],
          }}
        />,
      );
      expect(screen.getByText(/Mixed.*3 items/)).toBeTruthy();
    });
  });

  describe("object array label heuristic", () => {
    it("extracts name field as item subtitle", () => {
      render(
        <StructuredDataViewer
          data={{
            cohorts: [
              { name: "D1 New Users", size: 10 },
            ],
          }}
        />,
      );
      expect(screen.getByText("D1 New Users")).toBeTruthy();
    });

    it("extracts title field when name is absent", () => {
      render(
        <StructuredDataViewer
          data={{
            articles: [
              { title: "Getting Started", body: "..." },
            ],
          }}
        />,
      );
      expect(screen.getByText("Getting Started")).toBeTruthy();
    });

    it("extracts label field when name and title are absent", () => {
      render(
        <StructuredDataViewer
          data={{
            options: [
              { label: "Option A", value: 1 },
            ],
          }}
        />,
      );
      expect(screen.getByText("Option A")).toBeTruthy();
    });

    it("extracts id field as last resort", () => {
      render(
        <StructuredDataViewer
          data={{
            records: [
              { id: "rec_123", status: "active" },
            ],
          }}
        />,
      );
      expect(screen.getByText("rec_123")).toBeTruthy();
    });

    it("shows no subtitle when no label key is present", () => {
      render(
        <StructuredDataViewer
          data={{
            items: [
              { path: "/a", message: "required" },
            ],
          }}
        />,
      );
      expect(screen.getByText("Item 1")).toBeTruthy();
      expect(screen.queryByText(/\u2014/)).toBeFalsy();
    });

    it("skips non-scalar label values", () => {
      render(
        <StructuredDataViewer
          data={{
            items: [
              { name: { first: "John", last: "Doe" }, age: 30 },
            ],
          }}
        />,
      );
      expect(screen.getByText("Item 1")).toBeTruthy();
      expect(screen.queryByText(/\u2014/)).toBeFalsy();
    });
  });

  describe("object array collapse behavior", () => {
    it("starts items expanded when array has <= 3 items", () => {
      render(
        <StructuredDataViewer
          data={{
            errors: [
              { path: "/a", message: "required" },
              { path: "/b", message: "invalid" },
            ],
          }}
        />,
      );
      expect(screen.getAllByText("Path")).toHaveLength(2);
      expect(screen.getAllByText("Message")).toHaveLength(2);
    });

    it("starts items collapsed when array has > 3 items", () => {
      render(
        <StructuredDataViewer
          data={{
            cohorts: [
              { name: "C1", size: 10 },
              { name: "C2", size: 20 },
              { name: "C3", size: 30 },
              { name: "C4", size: 40 },
            ],
          }}
        />,
      );
      expect(screen.getByText("Item 1")).toBeTruthy();
      expect(screen.queryByText("10")).toBeFalsy();
    });

    it("expands collapsed item on click", () => {
      render(
        <StructuredDataViewer
          data={{
            cohorts: [
              { name: "C1", size: 10 },
              { name: "C2", size: 20 },
              { name: "C3", size: 30 },
              { name: "C4", size: 40 },
            ],
          }}
        />,
      );

      expect(screen.queryByText("10")).toBeFalsy();

      fireEvent.click(screen.getByText("Item 1"));

      expect(screen.getByText("10")).toBeTruthy();
    });

    it("collapses outer section on header click", () => {
      render(
        <StructuredDataViewer
          data={{
            errors: [
              { path: "/a", message: "required" },
            ],
          }}
        />,
      );

      expect(screen.getByText("Item 1")).toBeTruthy();

      fireEvent.click(screen.getByText(/Errors/));

      expect(screen.queryByText("Item 1")).toBeFalsy();
    });

    it("handles empty objects in array gracefully", () => {
      render(
        <StructuredDataViewer
          data={{
            items: [{}, { name: "valid" }],
          }}
        />,
      );
      expect(screen.getByText(/empty/)).toBeTruthy();
      expect(screen.getByText("valid")).toBeTruthy();
    });
  });

  describe("object array depth limits", () => {
    it("renders object array at depth 1 as structured items", () => {
      render(
        <StructuredDataViewer
          data={{
            wrapper: {
              cohorts: [
                { name: "C1", size: 10 },
              ],
            },
          }}
        />,
      );
      expect(screen.getByText("Item 1")).toBeTruthy();
      expect(screen.getByText("C1")).toBeTruthy();
    });

    it("falls back to JSON for object arrays at depth >= MAX_RECURSIVE_DEPTH", () => {
      render(
        <StructuredDataViewer
          data={{
            level1: {
              level2: {
                deep_items: [
                  { name: "deep", value: 1 },
                ],
              },
            },
          }}
        />,
      );
      expect(screen.getByText(/Level2/)).toBeTruthy();
    });
  });

  describe("mixed data", () => {
    it("separates scalars and complex values correctly", () => {
      render(
        <StructuredDataViewer
          data={{
            agent_execution_id: "aex_abc123",
            cost_micros: 1500,
            structured: {
              executive_summary: "overview text",
            },
          }}
        />,
      );

      expect(screen.getByText("Agent Execution Id")).toBeTruthy();
      expect(screen.getByText("Cost Micros")).toBeTruthy();
      expect(screen.getByText("Structured")).toBeTruthy();
    });
  });

  describe("nested section collapse", () => {
    it("toggles nested section visibility on click", () => {
      render(
        <StructuredDataViewer
          data={{
            details: { key: "value" },
          }}
        />,
      );

      expect(screen.getByText("Key")).toBeTruthy();
      expect(screen.getByText("value")).toBeTruthy();

      fireEvent.click(screen.getByText("Details"));

      expect(screen.queryByText("Key")).toBeFalsy();
      expect(screen.queryByText("value")).toBeFalsy();
    });
  });
});
