import { describe, it, expect } from "vitest";
import {
  diamondPath,
  octagonPath,
  circlePath,
  parallelBarPath,
  getShapePath,
  getContentInsets,
  SVG_SHAPE_CLASSES,
} from "../node-shell/shape-paths";
import type { VisualClass } from "../task-type-visual-registry";

// ---------------------------------------------------------------------------
// SVG path validity helpers
// ---------------------------------------------------------------------------

const SVG_PATH_COMMAND_RE = /^[MLAZHVCSQTmlahvcsqtz0-9.,\s-]+$/;

function isValidSvgPathD(d: string): boolean {
  return SVG_PATH_COMMAND_RE.test(d) && d.length > 0;
}

// ---------------------------------------------------------------------------
// diamondPath
// ---------------------------------------------------------------------------

describe("diamondPath", () => {
  it("produces a valid SVG d string", () => {
    const d = diamondPath(140, 140);
    expect(isValidSvgPathD(d)).toBe(true);
  });

  it("starts at top-center vertex", () => {
    const d = diamondPath(140, 140);
    expect(d).toContain("M 70 0");
  });

  it("visits all four midpoint vertices and closes", () => {
    const d = diamondPath(100, 80);
    expect(d).toContain("L 100 40");
    expect(d).toContain("L 50 80");
    expect(d).toContain("L 0 40");
    expect(d).toContain("Z");
  });

  it("handles non-square dimensions", () => {
    const d = diamondPath(200, 100);
    expect(d).toContain("M 100 0");
    expect(d).toContain("L 200 50");
    expect(d).toContain("L 100 100");
    expect(d).toContain("L 0 50");
  });
});

// ---------------------------------------------------------------------------
// octagonPath
// ---------------------------------------------------------------------------

describe("octagonPath", () => {
  it("produces a valid SVG d string", () => {
    const d = octagonPath(160, 160);
    expect(isValidSvgPathD(d)).toBe(true);
  });

  it("has 8 vertices (M + 7 L commands + Z)", () => {
    const d = octagonPath(160, 160);
    const commands = d.split(/(?=[MLZ])/);
    const moveAndLine = commands.filter((c) => c.startsWith("M") || c.startsWith("L"));
    expect(moveAndLine).toHaveLength(8);
    expect(d).toContain("Z");
  });

  it("respects the cut ratio relative to min dimension", () => {
    const d = octagonPath(160, 160);
    const cut = 160 * 0.29;
    expect(d).toContain(`M ${cut} 0`);
    expect(d).toContain(`L ${160 - cut} 0`);
  });
});

// ---------------------------------------------------------------------------
// circlePath
// ---------------------------------------------------------------------------

describe("circlePath", () => {
  it("produces a valid SVG d string", () => {
    const d = circlePath(80, 80);
    expect(isValidSvgPathD(d)).toBe(true);
  });

  it("uses arc commands", () => {
    const d = circlePath(80, 80);
    expect(d).toContain("A ");
  });

  it("starts at top-center and closes", () => {
    const d = circlePath(80, 80);
    expect(d).toContain("M 40 0");
    expect(d).toContain("Z");
  });

  it("handles ellipse dimensions", () => {
    const d = circlePath(100, 60);
    expect(d).toContain("M 50 0");
    expect(d).toContain("A 50 30");
  });
});

// ---------------------------------------------------------------------------
// parallelBarPath
// ---------------------------------------------------------------------------

describe("parallelBarPath", () => {
  it("produces a valid SVG d string", () => {
    const d = parallelBarPath(260, 32);
    expect(isValidSvgPathD(d)).toBe(true);
  });

  it("uses arc commands for rounded corners", () => {
    const d = parallelBarPath(260, 32);
    expect(d).toContain("A ");
  });

  it("closes the path", () => {
    const d = parallelBarPath(260, 32);
    expect(d).toContain("Z");
  });

  it("caps corner radius at half height", () => {
    const d = parallelBarPath(260, 10);
    expect(d).toContain("A 5 5");
  });
});

// ---------------------------------------------------------------------------
// getShapePath
// ---------------------------------------------------------------------------

describe("getShapePath", () => {
  it("returns a path for decision-diamond", () => {
    const path = getShapePath("decision-diamond", 140, 140);
    expect(path).not.toBeNull();
    expect(isValidSvgPathD(path!)).toBe(true);
  });

  it("returns a path for gate-octagon", () => {
    const path = getShapePath("gate-octagon", 160, 160);
    expect(path).not.toBeNull();
    expect(isValidSvgPathD(path!)).toBe(true);
  });

  it("returns a path for event-circle", () => {
    const path = getShapePath("event-circle", 80, 80);
    expect(path).not.toBeNull();
    expect(isValidSvgPathD(path!)).toBe(true);
  });

  it("returns a path for parallel-bar", () => {
    const path = getShapePath("parallel-bar", 260, 32);
    expect(path).not.toBeNull();
    expect(isValidSvgPathD(path!)).toBe(true);
  });

  it("returns null for task-card", () => {
    expect(getShapePath("task-card", 220, 56)).toBeNull();
  });

  it("returns null for subworkflow-card", () => {
    expect(getShapePath("subworkflow-card", 220, 56)).toBeNull();
  });

  it("returns null for container", () => {
    expect(getShapePath("container", 280, 120)).toBeNull();
  });

  it("returns null for terminal-pill", () => {
    expect(getShapePath("terminal-pill", 100, 36)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getContentInsets
// ---------------------------------------------------------------------------

describe("getContentInsets", () => {
  const ALL_VISUAL_CLASSES: VisualClass[] = [
    "task-card",
    "subworkflow-card",
    "container",
    "terminal-pill",
    "decision-diamond",
    "gate-octagon",
    "event-circle",
    "parallel-bar",
  ];

  it("returns valid insets for all visual classes", () => {
    for (const vc of ALL_VISUAL_CLASSES) {
      const insets = getContentInsets(vc);
      expect(insets.top).toBeGreaterThanOrEqual(0);
      expect(insets.right).toBeGreaterThanOrEqual(0);
      expect(insets.bottom).toBeGreaterThanOrEqual(0);
      expect(insets.left).toBeGreaterThanOrEqual(0);
    }
  });

  it("diamond insets leave a positive content area", () => {
    const insets = getContentInsets("decision-diamond");
    const contentWidth = 140 - insets.left - insets.right;
    const contentHeight = 140 - insets.top - insets.bottom;
    expect(contentWidth).toBeGreaterThan(0);
    expect(contentHeight).toBeGreaterThan(0);
  });

  it("octagon insets leave a positive content area", () => {
    const insets = getContentInsets("gate-octagon");
    const contentWidth = 160 - insets.left - insets.right;
    const contentHeight = 160 - insets.top - insets.bottom;
    expect(contentWidth).toBeGreaterThan(0);
    expect(contentHeight).toBeGreaterThan(0);
  });

  it("circle insets leave a positive content area", () => {
    const insets = getContentInsets("event-circle");
    const contentWidth = 80 - insets.left - insets.right;
    const contentHeight = 80 - insets.top - insets.bottom;
    expect(contentWidth).toBeGreaterThan(0);
    expect(contentHeight).toBeGreaterThan(0);
  });

  it("parallel-bar insets leave a positive content area", () => {
    const insets = getContentInsets("parallel-bar");
    const contentWidth = 260 - insets.left - insets.right;
    const contentHeight = 32 - insets.top - insets.bottom;
    expect(contentWidth).toBeGreaterThan(0);
    expect(contentHeight).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// SVG_SHAPE_CLASSES
// ---------------------------------------------------------------------------

describe("SVG_SHAPE_CLASSES", () => {
  it("contains exactly the 4 non-rectangular visual classes", () => {
    expect(SVG_SHAPE_CLASSES.size).toBe(4);
    expect(SVG_SHAPE_CLASSES.has("decision-diamond")).toBe(true);
    expect(SVG_SHAPE_CLASSES.has("gate-octagon")).toBe(true);
    expect(SVG_SHAPE_CLASSES.has("event-circle")).toBe(true);
    expect(SVG_SHAPE_CLASSES.has("parallel-bar")).toBe(true);
  });

  it("does not contain rectangular visual classes", () => {
    expect(SVG_SHAPE_CLASSES.has("task-card")).toBe(false);
    expect(SVG_SHAPE_CLASSES.has("subworkflow-card")).toBe(false);
    expect(SVG_SHAPE_CLASSES.has("container")).toBe(false);
    expect(SVG_SHAPE_CLASSES.has("terminal-pill")).toBe(false);
  });
});
