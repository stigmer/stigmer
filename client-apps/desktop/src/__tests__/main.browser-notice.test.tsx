// ---------------------------------------------------------------------------
// main — the notice outside the Tauri runtime
//
// Opened in a regular browser (the Vite dev server, no Tauri internals), the
// entry module never mounts the app or touches the native window: it shows a
// notice that the desktop needs its native runtime and how to start it.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { screen } from "@testing-library/react";

const getCurrentWindow = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow }));
const App = vi.hoisted(() => vi.fn(() => <div>app</div>));
vi.mock("../App", () => ({ App }));

afterEach(() => {
  document.getElementById("root")?.remove();
});

describe("main outside the Tauri runtime", () => {
  it("shows the Tauri-required notice with the start command, and never mounts the app", async () => {
    expect("__TAURI_INTERNALS__" in window).toBe(false);
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);

    await import("../main");

    expect(await screen.findByRole("heading", { name: "Stigmer Desktop" })).toBeTruthy();
    expect(screen.getByText(/requires the Tauri native runtime/)).toBeTruthy();
    expect(screen.getByText("make desktop-dev")).toBeTruthy();
    expect(App).not.toHaveBeenCalled();
    expect(getCurrentWindow).not.toHaveBeenCalled();
  });
});
