import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { ReviewRendererContext, type ReviewRenderers } from "../ReviewRendererContext";
import { WorkflowTaskReviewGate } from "../WorkflowTaskReviewGate";

/**
 * Minimal Stigmer client stub. `artifact.getContent` only matters for
 * artifact-backed payload tests; inline tests never call it.
 */
function createMockStigmer(overrides: {
  getContent?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    artifact: {
      getContent:
        overrides.getContent ??
        vi.fn().mockRejectedValue(new Error("getContent not stubbed")),
    },
  } as never;
}

function jsonContentResponse(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    content: bytes,
    contentType: "application/json",
    totalSizeBytes: BigInt(bytes.length),
    truncated: false,
  };
}

function wrapper(client: unknown, renderers: ReviewRenderers = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>
          <ReviewRendererContext.Provider value={renderers}>
            {children}
          </ReviewRendererContext.Provider>
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

const defaultProps = {
  taskName: "editorial_review",
  prompt: "Review the proposed revision before publishing.",
  outcomes: [
    { name: "approve", label: "Approve" },
    { name: "request_changes", label: "Request Changes" },
  ],
  onSubmit: vi.fn().mockResolvedValue(undefined),
  isSubmitting: false,
  error: null,
};

describe("WorkflowTaskReviewGate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(cleanup);

  describe("renderer dispatch", () => {
    it("renders the built-in card when the gate has no ui_hint", () => {
      render(<WorkflowTaskReviewGate {...defaultProps} />, {
        wrapper: wrapper(createMockStigmer()),
      });

      expect(
        screen.getByRole("form", { name: /approval decision for editorial_review/i }),
      ).toBeTruthy();
    });

    it("falls back to the built-in card for an unregistered ui_hint (portability)", () => {
      render(
        <WorkflowTaskReviewGate
          {...defaultProps}
          uiHint="article-diff"
          payload={{ title: "Draft v2" }}
        />,
        { wrapper: wrapper(createMockStigmer(), {}) },
      );

      expect(
        screen.getByRole("form", { name: /approval decision for editorial_review/i }),
      ).toBeTruthy();
    });

    it("renders the registered custom renderer for a matching ui_hint", () => {
      const renderers: ReviewRenderers = {
        "article-diff": ({ payload }) => (
          <div data-testid="custom-renderer">
            {(payload as { title: string }).title}
          </div>
        ),
      };

      render(
        <WorkflowTaskReviewGate
          {...defaultProps}
          uiHint="article-diff"
          payload={{ title: "Draft v2" }}
        />,
        { wrapper: wrapper(createMockStigmer(), renderers) },
      );

      expect(screen.getByTestId("custom-renderer").textContent).toBe("Draft v2");
      expect(screen.queryByRole("form")).toBeNull();
    });

    it("passes formSchema and outcomes through to the custom renderer", () => {
      const seen: { formSchema?: unknown; outcomes?: unknown } = {};
      const renderers: ReviewRenderers = {
        "article-diff": ({ formSchema, outcomes }) => {
          seen.formSchema = formSchema;
          seen.outcomes = outcomes;
          return <div data-testid="custom-renderer" />;
        },
      };

      const formSchema = { type: "object", properties: { notes: { type: "string" } } };
      render(
        <WorkflowTaskReviewGate
          {...defaultProps}
          uiHint="article-diff"
          payload={{ title: "Draft" }}
          formSchema={formSchema}
        />,
        { wrapper: wrapper(createMockStigmer(), renderers) },
      );

      expect(seen.formSchema).toEqual(formSchema);
      expect(seen.outcomes).toEqual(defaultProps.outcomes);
    });

    it("binds taskName into the renderer's submit callback", () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const renderers: ReviewRenderers = {
        "article-diff": ({ submit }) => (
          <button
            type="button"
            onClick={() => submit("approve", { notes: "lgtm" }, "ship it")}
          >
            Decide
          </button>
        ),
      };

      render(
        <WorkflowTaskReviewGate
          {...defaultProps}
          onSubmit={onSubmit}
          uiHint="article-diff"
          payload={{ title: "Draft" }}
        />,
        { wrapper: wrapper(createMockStigmer(), renderers) },
      );

      fireEvent.click(screen.getByRole("button", { name: "Decide" }));

      expect(onSubmit).toHaveBeenCalledWith(
        "editorial_review",
        "approve",
        { notes: "lgtm" },
        "ship it",
      );
    });
  });

  describe("inline payload fallback display", () => {
    it("shows the payload as structured data in the built-in card", () => {
      render(
        <WorkflowTaskReviewGate
          {...defaultProps}
          payload={{ severity: "P1", summary: "Database migration plan" }}
        />,
        { wrapper: wrapper(createMockStigmer()) },
      );

      expect(screen.getByLabelText("Review material for editorial_review")).toBeTruthy();
      expect(screen.getByText("Database migration plan")).toBeTruthy();
    });

    it("omits the review material section when the gate has no payload", () => {
      render(<WorkflowTaskReviewGate {...defaultProps} />, {
        wrapper: wrapper(createMockStigmer()),
      });

      expect(screen.queryByLabelText("Review material for editorial_review")).toBeNull();
    });
  });

  describe("artifact-backed payload", () => {
    it("shows a loading state, then the custom renderer with fetched content", async () => {
      const getContent = vi
        .fn()
        .mockResolvedValue(jsonContentResponse({ records: ["r1", "r2"] }));
      const renderers: ReviewRenderers = {
        "infra-proposal": ({ payload }) => (
          <div data-testid="custom-renderer">
            {(payload as { records: string[] }).records.length} records
          </div>
        ),
      };

      render(
        <WorkflowTaskReviewGate
          {...defaultProps}
          uiHint="infra-proposal"
          payloadArtifactId="art_review123"
        />,
        { wrapper: wrapper(createMockStigmer({ getContent }), renderers) },
      );

      expect(
        screen.getByRole("status", { name: /loading review material/i }),
      ).toBeTruthy();

      await waitFor(() =>
        expect(screen.getByTestId("custom-renderer").textContent).toBe("2 records"),
      );
      expect(getContent).toHaveBeenCalledWith(
        expect.objectContaining({ artifactId: "art_review123" }),
      );
    });

    it("shows an error state with retry when the artifact fetch fails", async () => {
      const getContent = vi.fn().mockRejectedValue(new Error("storage unavailable"));

      render(
        <WorkflowTaskReviewGate {...defaultProps} payloadArtifactId="art_review123" />,
        { wrapper: wrapper(createMockStigmer({ getContent })) },
      );

      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
      expect(screen.getByText(/storage unavailable/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
      // The gate must never offer a decision without its review material.
      expect(screen.queryByRole("form")).toBeNull();
    });

    it("retries the fetch when the reviewer clicks Retry", async () => {
      const getContent = vi
        .fn()
        .mockRejectedValueOnce(new Error("transient"))
        .mockResolvedValue(jsonContentResponse({ ok: true }));

      render(
        <WorkflowTaskReviewGate {...defaultProps} payloadArtifactId="art_review123" />,
        { wrapper: wrapper(createMockStigmer({ getContent })) },
      );

      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));

      await waitFor(() =>
        expect(screen.getByRole("form", { name: /approval decision/i })).toBeTruthy(),
      );
      expect(getContent).toHaveBeenCalledTimes(2);
    });

    it("surfaces a parse failure as an error instead of rendering garbage", async () => {
      const bytes = new TextEncoder().encode("{not json");
      const getContent = vi.fn().mockResolvedValue({
        content: bytes,
        contentType: "application/json",
        totalSizeBytes: BigInt(bytes.length),
        truncated: false,
      });

      render(
        <WorkflowTaskReviewGate {...defaultProps} payloadArtifactId="art_review123" />,
        { wrapper: wrapper(createMockStigmer({ getContent })) },
      );

      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    });
  });
});
