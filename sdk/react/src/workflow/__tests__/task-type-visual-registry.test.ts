import { describe, it, expect } from "vitest";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import {
  VISUAL_REGISTRY,
  getVisualSpec,
  type VisualClass,
  type PortPattern,
} from "../task-type-visual-registry";

const ALL_KIND_STRINGS = Object.entries(WorkflowTaskKind)
  .filter(
    ([, v]) =>
      typeof v === "number" &&
      v !== WorkflowTaskKind.workflow_task_kind_unspecified,
  )
  .map(([name]) => name);

// prefix-classnames-ignore: VisualClass is the node-shape taxonomy, not CSS —
// "container" collides with the Tailwind utility name.
const ALL_VISUAL_CLASSES: VisualClass[] = [
  "task-card",
  "decision-diamond",
  "parallel-bar",
  "event-circle",
  "gate-octagon",
  "subworkflow-card",
  "container",
  "terminal-pill",
];

describe("VISUAL_REGISTRY", () => {
  it("has an entry for every WorkflowTaskKind enum value", () => {
    for (const kind of ALL_KIND_STRINGS) {
      expect(VISUAL_REGISTRY.has(kind), `missing entry for ${kind}`).toBe(true);
    }
  });

  it("has entries for sentinel nodes", () => {
    expect(VISUAL_REGISTRY.has("__start__")).toBe(true);
    expect(VISUAL_REGISTRY.has("__end__")).toBe(true);
  });

  it("maps sentinels to terminal-pill", () => {
    expect(VISUAL_REGISTRY.get("__start__")!.visualClass).toBe("terminal-pill");
    expect(VISUAL_REGISTRY.get("__end__")!.visualClass).toBe("terminal-pill");
  });

  it("maps __start__ to source-only and __end__ to sink-only ports", () => {
    expect(VISUAL_REGISTRY.get("__start__")!.portPattern).toBe("source-only");
    expect(VISUAL_REGISTRY.get("__end__")!.portPattern).toBe("sink-only");
  });

  it("covers all 8 visual classes with at least one kind", () => {
    const usedClasses = new Set<string>();
    for (const spec of VISUAL_REGISTRY.values()) {
      usedClasses.add(spec.visualClass);
    }
    for (const vc of ALL_VISUAL_CLASSES) {
      expect(usedClasses.has(vc), `visual class ${vc} has no kinds mapped`).toBe(true);
    }
  });

  it("has positive dimensions for every entry", () => {
    for (const [kind, spec] of VISUAL_REGISTRY) {
      expect(spec.defaultWidth, `${kind} width`).toBeGreaterThan(0);
      expect(spec.defaultHeight, `${kind} height`).toBeGreaterThan(0);
    }
  });

  it("has non-empty ariaShapeLabel for every entry", () => {
    for (const [kind, spec] of VISUAL_REGISTRY) {
      expect(spec.ariaShapeLabel.length, `${kind} ariaShapeLabel`).toBeGreaterThan(0);
    }
  });

  it("marks only for_each and try_catch as containers", () => {
    const containers = [...VISUAL_REGISTRY.entries()]
      .filter(([, spec]) => spec.isContainer)
      .map(([kind]) => kind)
      .sort();
    expect(containers).toEqual(["for_each", "try_catch"]);
  });
});

describe("getVisualSpec", () => {
  it("returns correct spec for known kinds", () => {
    expect(getVisualSpec("switch_case").visualClass).toBe("decision-diamond");
    expect(getVisualSpec("fork").visualClass).toBe("parallel-bar");
    expect(getVisualSpec("human_input").visualClass).toBe("gate-octagon");
    expect(getVisualSpec("listen").visualClass).toBe("event-circle");
    expect(getVisualSpec("wait").visualClass).toBe("event-circle");
    expect(getVisualSpec("agent_call").visualClass).toBe("task-card");
    expect(getVisualSpec("run_workflow").visualClass).toBe("subworkflow-card");
    expect(getVisualSpec("for_each").visualClass).toBe("container");
    expect(getVisualSpec("try_catch").visualClass).toBe("container");
    expect(getVisualSpec("__start__").visualClass).toBe("terminal-pill");
  });

  it("returns task-card fallback for unknown kinds", () => {
    expect(getVisualSpec("nonexistent_kind").visualClass).toBe("task-card");
    expect(getVisualSpec("").visualClass).toBe("task-card");
  });

  it("returns correct port patterns", () => {
    expect(getVisualSpec("switch_case").portPattern).toBe("branch-per-case");
    expect(getVisualSpec("human_input").portPattern).toBe("branch-per-outcome");
    expect(getVisualSpec("fork").portPattern).toBe("branch-per-branch");
    expect(getVisualSpec("for_each").portPattern).toBe("container");
    expect(getVisualSpec("agent_call").portPattern).toBe("standard");
  });

  it("returns the same object reference for repeated lookups", () => {
    const a = getVisualSpec("agent_call");
    const b = getVisualSpec("agent_call");
    expect(a).toBe(b);
  });
});

describe("registry immutability", () => {
  it("VISUAL_REGISTRY is frozen", () => {
    expect(Object.isFrozen(VISUAL_REGISTRY)).toBe(true);
  });
});
