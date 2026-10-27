// ---------------------------------------------------------------------------
// main — the boot error view
//
// Inside the Tauri runtime the entry module mounts the app under a boot error
// boundary. When the app throws while rendering, the person sees a "Runtime
// Error" heading with the error's message and stack in place of a blank
// window, and the native window is still asked to show itself.
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

describe("main inside the Tauri runtime", () => {
  it("shows the app's render error as a Runtime Error view and still shows the window", async () => {
    // React reports an error a boundary caught; keep the run's output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);

    await import("../main");

    expect(await screen.findByRole("heading", { name: "Runtime Error" })).toBeTruthy();
    expect(screen.getByText("settings store unreadable")).toBeTruthy();
    expect(root.querySelector("pre")?.textContent).toContain("settings store unreadable");
    await waitFor(() => expect(show).toHaveBeenCalledTimes(1));
  });
});
