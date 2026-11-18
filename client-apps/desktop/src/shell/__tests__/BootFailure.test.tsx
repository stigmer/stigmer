// ---------------------------------------------------------------------------
// The app's last resort says it couldn't start and tries again by reloading
//
// main.tsx's boundary draws BootFailure when the app fails while it draws
// itself. Pinned: the failure in the console's words, the stack kept off the
// screen, and Try again reloading the window.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BootFailure } from "../BootFailure";

afterEach(cleanup);

describe("the boot failure", () => {
  it("says the app couldn't start, keeps the stack off the screen, and reloads on Try again", () => {
    const error = new Error("a part of the app failed to load");
    error.stack = "Error: a part of the app failed to load\n    at ServerProvider (ServerProvider.tsx:88:31)";
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, reload } });
    try {
      render(<BootFailure error={error} />);
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Stigmer Desktop couldn't start.");
      expect(alert.textContent).not.toContain("ServerProvider.tsx");

      fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });
});
