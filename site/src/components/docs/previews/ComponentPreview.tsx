"use client";

import {
  Component,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Eye, ChevronRight, ChevronDown } from "lucide-react";
import { createDemoClient, buildScenario } from "@stigmer/react/demo";
import { PREVIEW_CONFIGS, type PreviewConfig } from "./preview-configs";
import { PreviewShell } from "./PreviewShell";

export interface ComponentPreviewProps {
  readonly component: string;
}

/**
 * Generic MDX component that renders a live preview of an SDK component.
 *
 * Collapsed by default — shows a compact "Preview" toggle bar. Clicking
 * the bar mounts the component for the first time: demo client creation,
 * fixture setup, and rendering are all deferred until the user opts in.
 *
 * The error boundary wraps only the expanded content so a broken preview
 * never hides the toggle bar or breaks the docs page.
 *
 * Returns `null` silently for unregistered component names.
 */
export function ComponentPreview({ component }: ComponentPreviewProps) {
  const config = PREVIEW_CONFIGS[component];
  const [isOpen, setIsOpen] = useState(false);

  if (!config) return null;

  const Chevron = isOpen ? ChevronDown : ChevronRight;

  return (
    <div className="not-prose">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className={`flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground ${isOpen ? "rounded-b-none border-b-0 bg-accent/50" : ""}`}
        aria-expanded={isOpen}
      >
        <Eye className="size-4 shrink-0" />
        <span className="font-medium">Preview</span>
        <Chevron className="ml-auto size-4 shrink-0" />
      </button>
      {isOpen && (
        <PreviewErrorBoundary>
          <PreviewRenderer config={config} />
        </PreviewErrorBoundary>
      )}
    </div>
  );
}

/**
 * Inner renderer extracted as a separate component so `useMemo` is
 * never called conditionally (ComponentPreview returns early for
 * unregistered components, and the renderer only mounts when open).
 */
function PreviewRenderer({ config }: { config: PreviewConfig }) {
  const client = useMemo(
    () => createDemoClient(buildScenario(...config.fixtures)),
    [config],
  );

  const Comp = config.component;
  const shellClassName = [
    "rounded-t-none border-t-0",
    config.previewClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <PreviewShell client={client} className={shellClassName}>
      <Comp {...config.props} />
    </PreviewShell>
  );
}

// ---------------------------------------------------------------------------
// Error boundary — catches render failures so the surrounding docs
// page continues to work. The toggle bar remains visible.
// ---------------------------------------------------------------------------

interface ErrorBoundaryState {
  hasError: boolean;
}

class PreviewErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ComponentPreview] render failed:", error, info);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
