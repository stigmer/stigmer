// Layout-contract regression suite for ResizableSplit's responsive collapse
// (stigmer/stigmer#301). Runs in a real Chromium via `vitest.a11y.config.ts` —
// evaluating a CSS container query requires a real layout engine, which
// happy-dom does not have.
//
// The contract under test: `responsiveCollapse` keys on the split's OWN box
// (a container query), never the browser viewport. The defining scenario is
// the one the issue reports — a narrow dock inside a WIDE window. A viewport
// media query can never fire there (the window is wide), so every assertion
// below that expects a collapse is meaningless under the old `max-lg`
// implementation and fails against it.
//
// Like the provider container suite (#260/DD-019), this renders against the
// SHIPPED stylesheet (`dist/styles.css`, built by `npm run build:libs`), so
// the contract is verified on the artifact consumers actually load.

import "../../../dist/styles.css";

import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { page } from "@vitest/browser/context";
import { ResizableSplit } from "../ResizableSplit";

// The harness default viewport (414×896) is narrower than Tailwind's `lg`,
// where a viewport-keyed collapse would fire too — hiding the very defect
// this suite exists to catch. Pin a desktop-wide window so the narrow-dock
// cases can only pass with a container-keyed implementation.
beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(cleanup);

/** The collapse threshold the component documents: 48rem = 768px. */
const THRESHOLD_PX = 768;

/** Comfortably inside the collapse band — the issue's 360–640px dock class. */
const NARROW_PX = 500;

/** Comfortably above the threshold, yet far below the Chromium viewport. */
const WIDE_PX = THRESHOLD_PX + 132;

/**
 * Render the split docked in a fixed-width wrapper, the embedded-host
 * arrangement from stigmer/stigmer#301: the wrapper is narrower than the
 * viewport, so any viewport-keyed rule sees a wide window while the
 * component's own box is tight.
 */
function renderDocked(
  wrapperWidthPx: number,
  overrides: Partial<React.ComponentProps<typeof ResizableSplit>> = {},
) {
  return render(
    <div style={{ width: wrapperWidthPx, height: 400, display: "flex" }}>
      <ResizableSplit
        resizablePane="primary"
        responsiveCollapse="primary"
        primary={<div data-testid="primary">chat</div>}
        secondary={<div data-testid="secondary">panel</div>}
        {...overrides}
      />
    </div>,
  );
}

function paneOf(testId: string): HTMLElement {
  return screen.getByTestId(testId).parentElement!;
}

describe("ResizableSplit responsive collapse keys on its container (#301)", () => {
  it("sanity: the test viewport is wide enough that a viewport-lg query could never fire", () => {
    // Guards the premise of every case below. If the runner's viewport ever
    // shrinks below Tailwind's `lg` (1024px), the narrow-dock cases stop
    // discriminating between container- and viewport-keyed implementations.
    expect(window.innerWidth).toBeGreaterThanOrEqual(1024);
  });

  it("collapses the primary pane in a narrow dock inside a wide window", () => {
    renderDocked(NARROW_PX);

    expect(getComputedStyle(paneOf("primary")).display).toBe("none");
    // The drag handle hides with the pane...
    const separator = screen.getByRole("separator", { hidden: true });
    expect(getComputedStyle(separator).display).toBe("none");
    // ...so the secondary pane owns the full dock width.
    expect(paneOf("secondary").getBoundingClientRect().width).toBe(NARROW_PX);
  });

  it("keeps both panes side-by-side once the dock is wider than the threshold", () => {
    renderDocked(WIDE_PX);

    const primary = paneOf("primary");
    const secondary = paneOf("secondary");
    expect(getComputedStyle(primary).display).not.toBe("none");
    expect(getComputedStyle(secondary).display).not.toBe("none");
    // The fixed pane holds its pixel width; the sibling flexes into the rest.
    expect(primary.getBoundingClientRect().width).toBe(384);
    expect(secondary.getBoundingClientRect().width).toBeGreaterThan(0);
  });

  it("collapses the secondary pane when it is the responsive side", () => {
    renderDocked(NARROW_PX, {
      resizablePane: "secondary",
      responsiveCollapse: "secondary",
    });

    expect(getComputedStyle(paneOf("secondary")).display).toBe("none");
    expect(paneOf("primary").getBoundingClientRect().width).toBe(NARROW_PX);
  });

  it('responsiveCollapse="none": never collapses and creates no containment context', () => {
    const { container } = renderDocked(NARROW_PX, {
      responsiveCollapse: "none",
    });

    expect(getComputedStyle(paneOf("primary")).display).not.toBe("none");
    expect(getComputedStyle(paneOf("secondary")).display).not.toBe("none");

    // The containment invariant: without a collapse to decide, the root must
    // NOT be a CSS container — `container-type: inline-size` would re-parent
    // `position: fixed` descendants (the workflow inspector's click-away
    // backdrop renders in-tree inside a split pane) and add a stacking
    // context. See the conditional in ResizableSplit.
    const root = paneOf("primary").parentElement!;
    expect(getComputedStyle(root).containerType).toBe("normal");
  });

  it("the collapse-enabled root is an inline-size container named for its query", () => {
    renderDocked(NARROW_PX);

    const root = screen.getByRole("separator", { hidden: true }).parentElement!;
    const style = getComputedStyle(root);
    expect(style.containerType).toBe("inline-size");
    expect(style.containerName).toBe("resizable-split");
  });
});
