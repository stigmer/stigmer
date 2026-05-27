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

    it("renders object array as collapsible JSON", () => {
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
      expect(screen.getByText(/Errors.*2 items/)).toBeTruthy();
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
