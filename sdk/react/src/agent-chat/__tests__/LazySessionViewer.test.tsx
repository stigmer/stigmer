/**
 * Proves the conversation view's loader (../LazySessionViewer.tsx): it
 * draws the thread's skeleton until the view's chunk arrives, then the view
 * with the props it was given; once loaded, a later mount draws the view at
 * once; a chunk that fails says the conversation could not load and that a
 * reload tries again, and the next mount does try again. Each case loads the
 * module afresh, so the module's one shared import starts empty.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.doUnmock("../../session/SessionViewer.js");
});

function viewerModule() {
  return {
    SessionViewer: (props: { sessionId: string }) => <div data-testid="viewer">{props.sessionId}</div>,
  };
}

describe("LazySessionViewer", () => {
  it("draws the skeleton, then the view with its props, and a later mount at once", async () => {
    vi.doMock("../../session/SessionViewer.js", viewerModule);
    const { LazySessionViewer } = await import("../LazySessionViewer");
    const { unmount } = render(<LazySessionViewer sessionId="ses_1" org="acme" />);
    expect(screen.queryByTestId("viewer")).toBeNull();
    expect((await screen.findByTestId("viewer")).textContent).toBe("ses_1");
    unmount();

    render(<LazySessionViewer sessionId="ses_2" org="acme" />);
    expect(screen.getByTestId("viewer").textContent).toBe("ses_2");
  });

  it("says the conversation could not load, and the next mount tries again", async () => {
    let fail = true;
    vi.doMock("../../session/SessionViewer.js", () => {
      if (fail) throw new Error("chunk failed");
      return viewerModule();
    });
    const { LazySessionViewer, preloadSessionViewer } = await import("../LazySessionViewer");
    const { unmount } = render(<LazySessionViewer sessionId="ses_1" org="acme" />);
    expect((await screen.findByRole("alert")).textContent).toBe("The conversation could not load.Reload the page to try again.");
    unmount();

    fail = false;
    vi.resetModules();
    await expect(preloadSessionViewer()).resolves.toBeDefined();
  });
});
