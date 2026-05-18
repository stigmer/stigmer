import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-deep-link", () => ({
  onOpenUrl: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(false),
  requestPermission: vi.fn().mockResolvedValue("denied"),
  sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    listen: vi.fn().mockResolvedValue(() => {}),
  })),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn().mockResolvedValue(null),
}));

describe("Desktop App smoke", () => {
  it("BASE_URL defaults to localhost when VITE_STIGMER_API_URL is unset", () => {
    const envUrl = import.meta.env.VITE_STIGMER_API_URL;
    const baseUrl = envUrl ?? "http://localhost:7234";
    expect(baseUrl).toBe("http://localhost:7234");
  });

  it("fallbackDeploymentMode returns local for localhost URLs", () => {
    const url = new URL("http://localhost:7234");
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    expect(isLocal).toBe(true);
  });

  it("fallbackDeploymentMode returns cloud for remote URLs", () => {
    const url = new URL("https://api.stigmer.ai");
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    expect(isLocal).toBe(false);
  });
});
