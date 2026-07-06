import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { MermaidDiagram } from "../MermaidDiagram";
import { loadMermaid, type MermaidModule } from "../mermaid-loader";
import { ColorModeContext, type ResolvedColorMode } from "../../color-mode";

// The loader is the component's only side-effectful dependency; mocking it
// (not the `mermaid` package) exercises the real degradation contract:
// a rejected load must look exactly like "library not installed".
vi.mock("../mermaid-loader", () => ({
  loadMermaid: vi.fn(),
}));

// Partial-mock streamdown so tests can drive the incomplete-fence signal
// without spinning up a full Streamdown render.
vi.mock("streamdown", async (importOriginal) => ({
  ...(await importOriginal<typeof import("streamdown")>()),
  useIsCodeFenceIncomplete: vi.fn(() => false),
}));

const { useIsCodeFenceIncomplete } = await import("streamdown");

const loadMermaidMock = vi.mocked(loadMermaid);
const incompleteFenceMock = vi.mocked(useIsCodeFenceIncomplete);

/** Builds a mermaid module stub whose render resolves with the given SVG. */
function stubMermaid(svg = "<svg><g>diagram</g></svg>") {
  const mermaid = {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg }),
  };
  loadMermaidMock.mockResolvedValue(mermaid as unknown as MermaidModule);
  return mermaid;
}

function renderDiagram(
  chart: string,
  { colorMode = "light" as ResolvedColorMode } = {},
) {
  return render(
    <ColorModeContext.Provider value={colorMode}>
      <MermaidDiagram chart={chart} />
    </ColorModeContext.Provider>,
  );
}

function queryDiagram(container: HTMLElement) {
  return container.querySelector('[role="img"][aria-label="Mermaid diagram"]');
}

beforeEach(() => {
  loadMermaidMock.mockReset();
  incompleteFenceMock.mockReset();
  incompleteFenceMock.mockReturnValue(false);
});

afterEach(cleanup);

const CHART = "flowchart LR\n  A --> B";

describe("MermaidDiagram — successful render", () => {
  it("renders the SVG in an accessible container", async () => {
    stubMermaid("<svg data-diagram><g>ok</g></svg>");
    const { container } = renderDiagram(CHART);

    await waitFor(() => expect(queryDiagram(container)).not.toBeNull());
    expect(queryDiagram(container)!.querySelector("svg[data-diagram]")).not.toBeNull();
    // The source fallback is gone once the diagram is up.
    expect(container.querySelector("pre")).toBeNull();
  });

  it("shows the source as a code block while the render is pending", () => {
    // A load that never settles = the loading window.
    loadMermaidMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderDiagram(CHART);

    const code = container.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe(CHART);
    expect(queryDiagram(container)).toBeNull();
  });

  it("trims the trailing newline the fence body carries before rendering", async () => {
    const mermaid = stubMermaid();
    renderDiagram("flowchart LR\n  A --> B\n");

    await waitFor(() => expect(mermaid.render).toHaveBeenCalled());
    expect(mermaid.render).toHaveBeenCalledWith(
      expect.any(String),
      "flowchart LR\n  A --> B",
    );
  });
});

describe("MermaidDiagram — security and theming configuration", () => {
  it("configures mermaid with securityLevel strict (agent output is untrusted)", async () => {
    const mermaid = stubMermaid();
    renderDiagram(CHART);

    await waitFor(() => expect(mermaid.initialize).toHaveBeenCalled());
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict", startOnLoad: false }),
    );
  });

  it.each([
    ["light", "default"],
    ["dark", "dark"],
  ] as const)("selects the %s theme for %s color mode", async (mode, theme) => {
    const mermaid = stubMermaid();
    renderDiagram(CHART, { colorMode: mode });

    await waitFor(() => expect(mermaid.initialize).toHaveBeenCalled());
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme }),
    );
  });

  it("re-renders the diagram when the color mode changes", async () => {
    const mermaid = stubMermaid();
    const { container, rerender } = render(
      <ColorModeContext.Provider value="light">
        <MermaidDiagram chart={CHART} />
      </ColorModeContext.Provider>,
    );
    await waitFor(() => expect(queryDiagram(container)).not.toBeNull());

    rerender(
      <ColorModeContext.Provider value="dark">
        <MermaidDiagram chart={CHART} />
      </ColorModeContext.Provider>,
    );

    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));
    expect(mermaid.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "dark" }),
    );
  });
});

describe("MermaidDiagram — failure degrades to the code block", () => {
  it("falls back with an announced note when the diagram source is invalid", async () => {
    loadMermaidMock.mockResolvedValue({
      initialize: vi.fn(),
      render: vi.fn().mockRejectedValue(new Error("Parse error on line 2")),
    } as unknown as MermaidModule);
    const { container } = renderDiagram("flowchart LR\n  A --> ");

    await waitFor(() =>
      expect(container.querySelector('[role="status"]')).not.toBeNull(),
    );
    expect(container.querySelector("pre code")!.textContent).toContain(
      "A -->",
    );
    expect(container.querySelector('[role="status"]')!.textContent).toContain(
      "Parse error on line 2",
    );
    expect(queryDiagram(container)).toBeNull();
  });

  it("falls back when the mermaid library cannot be loaded (optional peer absent)", async () => {
    loadMermaidMock.mockRejectedValue(
      new Error("Cannot find module 'mermaid'"),
    );
    const { container } = renderDiagram(CHART);

    await waitFor(() =>
      expect(container.querySelector('[role="status"]')).not.toBeNull(),
    );
    expect(container.querySelector("pre code")!.textContent).toBe(CHART);
    expect(queryDiagram(container)).toBeNull();
  });

  it("does not attempt to render an empty fence", () => {
    stubMermaid();
    const { container } = renderDiagram("   \n  ");

    expect(loadMermaidMock).not.toHaveBeenCalled();
    expect(queryDiagram(container)).toBeNull();
  });
});

describe("MermaidDiagram — streaming deferral", () => {
  it("defers rendering while the fence is still streaming", () => {
    stubMermaid();
    incompleteFenceMock.mockReturnValue(true);
    const { container } = renderDiagram(CHART);

    expect(loadMermaidMock).not.toHaveBeenCalled();
    const code = container.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe(CHART);
  });

  it("renders the diagram once the fence closes", async () => {
    stubMermaid();
    incompleteFenceMock.mockReturnValue(true);
    const { container, rerender } = renderDiagram(CHART);
    expect(queryDiagram(container)).toBeNull();

    incompleteFenceMock.mockReturnValue(false);
    rerender(
      <ColorModeContext.Provider value="light">
        <MermaidDiagram chart={CHART} />
      </ColorModeContext.Provider>,
    );

    await waitFor(() => expect(queryDiagram(container)).not.toBeNull());
  });
});

describe("MermaidDiagram — stale-render races", () => {
  it("discards a render that resolves after the chart has changed", async () => {
    const initialize = vi.fn();
    let resolveFirst!: (result: { svg: string }) => void;
    const renderMock = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValue({ svg: "<svg data-chart='second'></svg>" });
    loadMermaidMock.mockResolvedValue({
      initialize,
      render: renderMock,
    } as unknown as MermaidModule);

    const { container, rerender } = renderDiagram("flowchart LR\n  A --> B");
    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));

    rerender(
      <ColorModeContext.Provider value="light">
        <MermaidDiagram chart={"flowchart LR\n  C --> D"} />
      </ColorModeContext.Provider>,
    );
    await waitFor(() =>
      expect(
        container.querySelector("svg[data-chart='second']"),
      ).not.toBeNull(),
    );

    // The first (now stale) render settles late — it must not clobber the
    // second chart's SVG.
    act(() => resolveFirst({ svg: "<svg data-chart='first'></svg>" }));
    expect(container.querySelector("svg[data-chart='first']")).toBeNull();
    expect(container.querySelector("svg[data-chart='second']")).not.toBeNull();
  });

  it("ignores a render that settles after unmount", async () => {
    let resolveRender!: (result: { svg: string }) => void;
    loadMermaidMock.mockResolvedValue({
      initialize: vi.fn(),
      render: vi.fn().mockReturnValue(
        new Promise((resolve) => (resolveRender = resolve)),
      ),
    } as unknown as MermaidModule);

    const { unmount } = renderDiagram(CHART);
    await waitFor(() => expect(loadMermaidMock).toHaveBeenCalled());
    unmount();

    // Settling after unmount must not warn or throw (React state update on
    // an unmounted component).
    expect(() =>
      act(() => resolveRender({ svg: "<svg></svg>" })),
    ).not.toThrow();
  });
});
