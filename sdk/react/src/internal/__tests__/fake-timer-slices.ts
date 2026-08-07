import { act } from "@testing-library/react";
import { vi } from "vitest";

/**
 * Advance fake time in small slices with an `act` boundary per slice.
 *
 * A single long `advanceTimersByTimeAsync` inside one `act` coalesces
 * every React commit to the END of the block: no re-render lands
 * between timer callbacks, and state updates queued by multiple timer
 * ticks collapse into one commit. Any test about how timers and renders
 * INTERLEAVE (poll phase stability, render-pressure starvation, data
 * arriving "on the next poll tick") silently measures nothing under a
 * single long advance. Slicing lets React commit between timer steps,
 * the way real time does in production.
 *
 * Not a `.test` file and inside `__tests__` deliberately: vitest does
 * not collect it, and the build/typedoc excludes keep it out of the
 * published package.
 */
export async function advanceInSlices(
  totalMs: number,
  sliceMs = 100,
): Promise<void> {
  for (let elapsed = 0; elapsed < totalMs; elapsed += sliceMs) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(sliceMs);
    });
  }
}
