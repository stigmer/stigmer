/**
 * Pins RunFilterBar's mapping from chips to RunClientFilters: a phase
 * chip toggles its phase in and out (dropping `phases` when the last one
 * goes), the duration and cost presets set their bounds and clear them
 * when pressed again, "Has retries" toggles `hasRetries`, and "Clear all"
 * counts the active filter kinds and resets to `{}`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { RunFilterBar } from "../RunFilterBar";
import type { RunClientFilters } from "../derive-run-row";

function Harness({
  initial = {},
  onChange,
}: {
  readonly initial?: RunClientFilters;
  readonly onChange: (filters: RunClientFilters) => void;
}) {
  const [filters, setFilters] = useState<RunClientFilters>(initial);
  return (
    <RunFilterBar
      filters={filters}
      onFiltersChange={(next) => {
        onChange(next);
        setFilters(next);
      }}
    />
  );
}

function chip(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

describe("RunFilterBar", () => {
  afterEach(cleanup);

  it("toggles phase chips in and out of the phases filter", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByRole("toolbar", { name: "Run filters" })).toBeTruthy();

    fireEvent.click(chip("Failed"));
    expect(onChange).toHaveBeenLastCalledWith({ phases: [RunPhase.RUN_FAILED] });
    expect(chip("Failed").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(chip("Running"));
    expect(onChange).toHaveBeenLastCalledWith({
      phases: [RunPhase.RUN_FAILED, RunPhase.RUN_IN_PROGRESS],
    });

    fireEvent.click(chip("Failed"));
    fireEvent.click(chip("Running"));
    expect(onChange).toHaveBeenLastCalledWith({ phases: undefined });
    expect(chip("Failed").getAttribute("aria-pressed")).toBe("false");
  });

  it("sets and clears duration and cost presets, and toggles retries", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(chip("More filters"));
    expect(screen.queryByRole("button", { name: "More filters" })).toBeNull();

    fireEvent.click(chip("> 10m"));
    expect(onChange).toHaveBeenLastCalledWith({ minDurationMs: 600_000, maxDurationMs: undefined });
    fireEvent.click(chip("< 10s"));
    expect(onChange).toHaveBeenLastCalledWith({ minDurationMs: undefined, maxDurationMs: 10_000 });
    fireEvent.click(chip("< 10s"));
    expect(onChange).toHaveBeenLastCalledWith({ minDurationMs: undefined, maxDurationMs: undefined });

    fireEvent.click(chip("< $1"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ minCostMicros: undefined, maxCostMicros: BigInt(1_000_000) }),
    );
    fireEvent.click(chip("< $1"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ minCostMicros: undefined, maxCostMicros: undefined }),
    );

    fireEvent.click(chip("Has retries"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ hasRetries: true }));
    fireEvent.click(chip("Has retries"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ hasRetries: undefined }));
  });

  it("counts every active filter kind and clears them all", () => {
    const onChange = vi.fn();
    render(
      <Harness
        onChange={onChange}
        initial={{
          phases: [RunPhase.RUN_FAILED],
          maxDurationMs: 1_000,
          minCostMicros: BigInt(10_000_000),
          hasRetries: true,
          failedTaskName: "fetchData",
        }}
      />,
    );
    fireEvent.click(chip("Clear all (5)"));
    expect(onChange).toHaveBeenLastCalledWith({});
    expect(screen.queryByRole("button", { name: /Clear all/ })).toBeNull();
  });
});
