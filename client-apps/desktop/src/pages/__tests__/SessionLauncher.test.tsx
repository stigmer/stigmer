/**
 * Pins the desktop session launcher's link handling, as the web launcher's
 * test pins it there: a plugin page's "Start a chat" link
 * (`/?plugin=org/slug`) starts a chat with no agent that lists the plugin,
 * an `?agent=org/slug` link preselects the agent, and the person's plugin
 * picks are remembered for the next conversation. The viewer is pinned in
 * @stigmer/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const page = vi.hoisted(() => ({ viewer: [] as Array<Record<string, unknown>> }));

vi.mock("@stigmer/react", () => ({
  useActiveOrgId: () => "org_acme",
  NewSessionViewer: (props: Record<string, unknown>) => {
    page.viewer.push(props);
    return null;
  },
  useAccountExecutionDefaults: () => undefined,
  useWorkspaceSources: () => ({ enableGitHub: false, enableLocal: true }),
}));

vi.mock("sonner", () => ({ toast: { error: () => undefined } }));
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

beforeEach(() => {
  page.viewer.length = 0;
});

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

  it("remembers the person's plugin picks for the next conversation", () => {
    renderAt("/");

    expect(page.viewer.at(-1)).toMatchObject({ rememberPluginPicks: true, initialPluginRefs: undefined });
  });
});
