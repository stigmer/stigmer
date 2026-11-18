// ---------------------------------------------------------------------------
// main — the boot error view
//
// Inside the Tauri runtime the entry module mounts the app under a boot error
// boundary. When the app throws while rendering, the person sees the failure
// in the console's words ("Stigmer Desktop couldn't start.") with the error's
// line and Try again, the stack kept off the screen for Copy details, in
// place of a blank window, and the native window is still asked to show
// itself.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

const show = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ show }),
}));
vi.mock("../App", () => ({
  App: (): never => {
    throw new Error("settings store unreadable");
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  document.getElementById("root")?.remove();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

// The entry module draws its failure and its notice on the kit's frame, so
// importing it loads the kit cold in this environment (4 to 7 seconds here),
// more than the default per-test budget.
const IMPORT_BUDGET_MS = 30_000;

describe("main inside the Tauri runtime", () => {
  it("says the app couldn't start in plain words, keeps the stack off the screen, and still shows the window", async () => {
    // React reports an error a boundary caught; keep the run's output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);

    await import("../main");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Stigmer Desktop couldn't start.");
    expect(alert.textContent).toContain("settings store unreadable");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(root.textContent).not.toContain("at ");
    expect(root.querySelector("pre")).toBeNull();
    await waitFor(() => expect(show).toHaveBeenCalledTimes(1));
  }, IMPORT_BUDGET_MS);
});
