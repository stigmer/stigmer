// ---------------------------------------------------------------------------
// Providers — which routes skip sign-in is a fixed, reviewed list
//
// The composition root wraps every route in the authenticated chain
// (AuthProvider → AuthGuard → transport → identity gate → org provider →
// org gate) except two prefix lists: public routes (sign-in, invitations,
// the desktop hand-back pages) get none of it, and auth-optional routes (the
// hosted chat) get the session without the guard. A prefix match is loose by
// nature, so a new page whose path happens to start with a public prefix
// would silently skip sign-in. This suite walks every page file under
// src/app and fails when the set of routes outside the guard is not exactly
// the reviewed one below, and pins the chain's order for the rest.
//
// It also pins the ConfigGate in front of everything: nothing renders until
// the runtime config loads, and a config that fails to load shows why.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const nav = vi.hoisted(() => ({ pathname: "/" }));
const config = vi.hoisted(() => ({
  load: null as null | (() => Promise<unknown>),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
}));

vi.mock("@/config/runtime-config", () => ({
  loadRuntimeConfig: () => (config.load ? config.load() : Promise.resolve({})),
}));

// Each link of the chain renders as a marker around its children, so the
// test can read which links wrap a page and in what order.
function marker(name: string) {
  return function Marker({ children }: { children?: React.ReactNode }) {
    return <div data-chain={name}>{children}</div>;
  };
}

vi.mock("@/providers/ThemeProvider", () => ({
  ThemeProvider: marker("theme"),
}));
vi.mock("@/auth", () => ({
  AuthProvider: marker("auth"),
  AuthGuard: marker("guard"),
}));
vi.mock("@/providers/StigmerTransportBridge", () => ({
  StigmerTransportBridge: marker("transport"),
}));
vi.mock("@/domain/_shared/identity/IdentityAccountGate", () => ({
  IdentityAccountGate: marker("identity"),
}));
vi.mock("@/domain/_shared/org/OrgGate", () => ({
  OrgGate: marker("org-gate"),
}));
vi.mock("@/domain/_shared/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@stigmer/react", () => ({
  FetchCacheProvider: marker("fetch-cache"),
  OrgProvider: marker("org"),
}));

import { Providers } from "../Providers";

const AUTHENTICATED_CHAIN = [
  "theme",
  "auth",
  "guard",
  "transport",
  "identity",
  "fetch-cache",
  "org",
  "org-gate",
];

/** The chain of markers wrapping the page, outermost first. */
function chainAround(page: HTMLElement): string[] {
  const chain: string[] = [];
  for (let node = page.parentElement; node; node = node.parentElement) {
    const name = node.getAttribute("data-chain");
    if (name) chain.unshift(name);
  }
  return chain;
}

async function renderAt(pathname: string): Promise<string[]> {
  nav.pathname = pathname;
  render(
    <Providers>
      <p>page</p>
    </Providers>,
  );
  const page = await screen.findByText("page");
  return chainAround(page);
}

// Vitest runs with cwd at client-apps/web (the static-export routing suite
// resolves the app dir the same way, for the same happy-dom reason).
const APP_DIR = resolve(process.cwd(), "src", "app");

function pageRoutes(dir: string): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Private folders (`_x`, `__tests__`) are not routes in the app router.
      if (!entry.startsWith("_")) routes.push(...pageRoutes(full));
    } else if (entry === "page.tsx") {
      const rel = relative(APP_DIR, dir).split(sep).join("/");
      routes.push(rel === "" ? "/" : `/${rel}`);
    }
  }
  return routes;
}

/** A concrete path for a route pattern: `[token]` becomes `token`. */
function samplePath(route: string): string {
  return route.replace(/\[([^\]]+)\]/g, "$1");
}

// The reviewed exceptions. A route joins either list only by editing it here.
const PUBLIC = ["/desktop/billing", "/invite/[token]", "/login"];
const AUTH_OPTIONAL = ["/chat/[org]/[slug]"];

describe("the route chain", () => {
  beforeEach(() => {
    config.load = null;
  });

  it("finds the app's page files", () => {
    expect(existsSync(APP_DIR)).toBe(true);
    expect(pageRoutes(APP_DIR).length).toBeGreaterThan(20);
  });

  it("puts exactly the reviewed routes outside the sign-in guard", async () => {
    const outside: { route: string; chain: string[] }[] = [];
    for (const route of pageRoutes(APP_DIR)) {
      const chain = await renderAt(samplePath(route));
      if (!chain.includes("guard")) outside.push({ route, chain });
      document.body.innerHTML = "";
    }

    expect(
      outside.map((entry) => entry.route).sort(),
      "A route skips the sign-in guard that is not on the reviewed list, or a reviewed route now sits behind it. " +
        "If the change is intended, update PUBLIC or AUTH_OPTIONAL in this file and in Providers.tsx together.",
    ).toEqual([...PUBLIC, ...AUTH_OPTIONAL].sort());
  });

  it.each(PUBLIC)(
    "renders public route %s with no session at all",
    async (route) => {
      expect(await renderAt(samplePath(route))).toEqual(["theme"]);
    },
  );

  it.each(AUTH_OPTIONAL)(
    "renders auth-optional route %s with the session but without the guard",
    async (route) => {
      expect(await renderAt(samplePath(route))).toEqual(["theme", "auth"]);
    },
  );

  it.each([
    "/",
    "/dashboard",
    "/settings/api-keys",
    "/library/agents/acme/helper",
    "/auth/callback",
  ])("wraps %s in the whole authenticated chain, in order", async (path) => {
    expect(await renderAt(path)).toEqual(AUTHENTICATED_CHAIN);
  });

  it.each(["/chat", "/invite", "/desktop"])(
    "keeps %s, a bare prefix without its slash, behind the guard",
    async (path) => {
      expect(await renderAt(path)).toEqual(AUTHENTICATED_CHAIN);
    },
  );
});

describe("the config gate", () => {
  beforeEach(() => {
    nav.pathname = "/dashboard";
  });

  it("renders nothing of the app until the runtime config has loaded", async () => {
    let finish: (value: unknown) => void = () => {};
    config.load = () =>
      new Promise((resolveLoad) => {
        finish = resolveLoad;
      });
    render(
      <Providers>
        <p>page</p>
      </Providers>,
    );

    expect(screen.queryByText("page")).toBeNull();
    finish({});
    expect(await screen.findByText("page")).toBeTruthy();
  });

  it("shows the configuration error and never the app when the config fails to load", async () => {
    config.load = () =>
      Promise.reject(
        new Error(
          "This server requires sign-in, but no OIDC client is configured",
        ),
      );
    render(
      <Providers>
        <p>page</p>
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText("Configuration Error")).toBeTruthy(),
    );
    expect(
      screen.getByText(
        "This server requires sign-in, but no OIDC client is configured",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("page")).toBeNull();
  });
});
