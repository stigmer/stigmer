/**
 * Pins the desktop session launcher's link handling, as the web launcher's
 * test pins it there: a plugin page's "Start a chat" link
 * (`/?plugin=org/slug`) starts a chat with no agent that lists the plugin,
 * an `?agent=org/slug` link preselects the agent, a link that arrives after
 * the launcher is open is read too and the address cleaned once read, the
 * person's plugin picks are remembered for the next conversation, and a
 * refusal for want of a provider key raises no toast (the launcher's own
 * notice says it) while any other refusal does. The viewer, and how a
 * refusal is read, are pinned in @stigmer/react-sdk.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";

const page = vi.hoisted(() => ({
  viewer: [] as Array<Record<string, unknown>>,
  navigate: undefined as NavigateFunction | undefined,
  toasts: [] as string[],
  keyRefusal: new Error("This organization has no Anthropic key, so the run was not started."),
}));

vi.mock("@stigmer/react-sdk", () => ({
  SessionInspector: () => null,
  useActiveOrgId: () => "org_acme",
  NewSessionViewer: (props: Record<string, unknown>) => {
    page.viewer.push(props);
    return null;
  },
  useAccountExecutionDefaults: () => undefined,
  useWorkspaceSources: () => ({ enableGitHub: false, enableLocal: true }),
  // The SDK reads the refusal's reason; here one error stands for a
  // provider-key refusal and every other is not one.
  providerKeyRequired: (error: unknown) =>
    error === page.keyRefusal ? { org: "acme", provider: "anthropic", model: "" } : null,
}));

vi.mock("sonner", () => ({
  toast: {
    error: (message: string) => {
      page.toasts.push(message);
    },
  },
}));
vi.mock("../../hooks/useNativeFolderPicker", () => ({ useNativeFolderPicker: () => undefined }));
vi.mock("../../hooks/useNativeWorkspaceFiles", () => ({ useNativeWorkspaceFiles: () => undefined }));
vi.mock("../../hooks/useNativeWorkspaceFileReader", () => ({ useNativeWorkspaceFileReader: () => undefined }));
vi.mock("../../hooks/useNativeWorkspaceContentSearcher", () => ({
  useNativeWorkspaceContentSearcher: () => undefined,
}));

import { SessionLauncher } from "../SessionLauncher";

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<SessionLauncher />} />
      </Routes>
    </MemoryRouter>,
  );
}

// Captures the router's navigate so a test can bring a link in after the
// launcher has opened, and shows the address the launcher leaves.
function RouterProbe() {
  page.navigate = useNavigate();
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

beforeEach(() => {
  page.viewer.length = 0;
  page.navigate = undefined;
  page.toasts.length = 0;
});

/** The viewer's error callback, as the launcher hands it. */
function onError(): (message: string, error: Error) => void {
  return page.viewer.at(-1)?.onError as (message: string, error: Error) => void;
}

describe("desktop SessionLauncher", () => {
  it("starts a chat with no agent that lists the plugin a plugin page's link names", () => {
    renderAt(`/?plugin=${encodeURIComponent("acme/linear")}`);

    expect(page.viewer[0]).toMatchObject({
      initialPluginRefs: [{ org: "acme", slug: "linear" }],
      initialAgentRef: undefined,
    });
  });

  it("preselects the agent an ?agent=org/slug link names", () => {
    renderAt(`/?agent=${encodeURIComponent("acme/helper")}`);

    expect(page.viewer[0]).toMatchObject({ initialAgentRef: { org: "acme", slug: "helper" } });
  });

  it("reads an agent and a plugin link that arrive after the launcher opened, and cleans the address", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="*" element={<SessionLauncher />} />
        </Routes>
        <RouterProbe />
      </MemoryRouter>,
    );
    expect(page.viewer.at(-1)).toMatchObject({ initialAgentRef: undefined, initialPluginRefs: undefined });

    act(() => {
      page.navigate?.(`/?agent=${encodeURIComponent("acme/helper")}&plugin=${encodeURIComponent("acme/linear")}`);
    });

    expect(page.viewer.at(-1)).toMatchObject({
      initialAgentRef: { org: "acme", slug: "helper" },
      initialPluginRefs: [{ org: "acme", slug: "linear" }],
    });
    expect(screen.getByTestId("location").textContent).toBe("/");
  });

  it("remembers the person's plugin picks for the next conversation", () => {
    renderAt("/");

    expect(page.viewer.at(-1)).toMatchObject({ rememberPluginPicks: true, initialPluginRefs: undefined });
  });

  it("raises no toast for a refusal for want of a provider key, which the launcher's notice says", () => {
    renderAt("/");

    onError()(page.keyRefusal.message, page.keyRefusal);

    expect(page.toasts).toEqual([]);
  });

  it("raises a toast for any other refusal", () => {
    renderAt("/");

    onError()("The server is unreachable.", new Error("The server is unreachable."));

    expect(page.toasts).toEqual(["The server is unreachable."]);
  });
});
