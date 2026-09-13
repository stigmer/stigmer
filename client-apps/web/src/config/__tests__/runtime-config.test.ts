// ---------------------------------------------------------------------------
// runtime-config — the /config.json contract the served console reads
//
// Two rules land here with sp.console-login (20260913.02):
//
//   - `apiUrl: ""` in /config.json means "the browser's own origin", the
//     rule `appUrl` already follows (Q-CL-3). The server serves the console
//     and its API on one port, so the console can never need a different
//     origin — and a synthesized `http://<host>` broke behind every TLS
//     proxy (mixed content). The dev/env path keeps its localhost default.
//   - `authMode: "oidc"` with an empty client id is the honest state of a
//     self-hosted server whose operator set the issuer but not the console's
//     client (Q-CL-2); the refusal names both knobs, because the loader
//     cannot tell a server-synthesized file from a container's.
//
// The loader memoizes in module state, so every test re-imports it.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGIN = "https://stigmer.example.com";

function configJson(body: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

async function load() {
  const module = await import("../runtime-config");
  return module;
}

describe("runtime-config: /config.json from the server that serves the console", () => {
  beforeEach(() => {
    vi.resetModules();
    const happyDom = (
      window as unknown as { happyDOM: { setURL(url: string): void } }
    ).happyDOM;
    happyDom.setURL(`${ORIGIN}/sessions`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads an empty apiUrl as the browser's own origin, the appUrl rule", async () => {
    configJson({ apiUrl: "", appUrl: "", authMode: "disabled" });
    const { loadRuntimeConfig, getRuntimeConfig } = await load();
    await loadRuntimeConfig();
    expect(getRuntimeConfig().apiUrl).toBe(ORIGIN);
  });

  it("keeps an explicit apiUrl verbatim (the container's entrypoint still emits one)", async () => {
    configJson({ apiUrl: "https://api.example.com", authMode: "disabled" });
    const { loadRuntimeConfig, getRuntimeConfig } = await load();
    await loadRuntimeConfig();
    expect(getRuntimeConfig().apiUrl).toBe("https://api.example.com");
  });

  it("carries the OIDC posture the server publishes", async () => {
    configJson({
      apiUrl: "",
      authMode: "oidc",
      oidcIssuer: "https://auth.example.com/realms/main",
      oidcClientId: "stigmer-console",
      oidcAudience: "https://stigmer.example.com/",
    });
    const { loadRuntimeConfig, getRuntimeConfig } = await load();
    await loadRuntimeConfig();
    expect(getRuntimeConfig()).toMatchObject({
      authMode: "oidc",
      oidcIssuer: "https://auth.example.com/realms/main",
      oidcClientId: "stigmer-console",
      oidcAudience: "https://stigmer.example.com/",
    });
  });

  it("refuses an OIDC posture with no console client, naming the server knob and the container knob", async () => {
    configJson({
      apiUrl: "",
      authMode: "oidc",
      oidcIssuer: "https://auth.example.com/realms/main",
      oidcClientId: "",
      oidcAudience: "https://stigmer.example.com/",
    });
    const { loadRuntimeConfig } = await load();
    await expect(loadRuntimeConfig()).rejects.toThrow(
      /STIGMER_OIDC_CONSOLE_CLIENT_ID[\s\S]*NEXT_PUBLIC_OIDC_CLIENT_ID/,
    );
  });

  it("does not fetch /config.json in development — env vars are the source there", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { loadRuntimeConfig, getRuntimeConfig } = await load();
    await loadRuntimeConfig();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getRuntimeConfig().apiUrl).toBe("http://localhost:7234");
    vi.unstubAllEnvs();
  });
});
