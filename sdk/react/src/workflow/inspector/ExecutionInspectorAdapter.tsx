"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import { ExecutionInspector } from "../execution-inspector";
import type { ExecutionInspectorProps } from "../execution-inspector";

/**
 * Props for {@link ExecutionInspectorAdapter}.
 *
 * Extends the existing `ExecutionInspectorProps` — this adapter is a
 * transparent pass-through that adds visual consistency with the
 * design-mode inspector shell.
 */
export interface ExecutionInspectorAdapterProps extends ExecutionInspectorProps {}

/**
 * Execution mode adapter for the inspector panel.
 *
 * Wraps the existing T05 `ExecutionInspector` component to provide
 * visual consistency with the design-mode `InspectorShell`. The
 * execution inspector already has its own header and tab system,
 * so this adapter is intentionally thin — it ensures the component
 * fits into the same panel slot without duplicating the header.
 *
 * The underlying `ExecutionInspector`, `useExecutionTaskDetail`, and
 * `deriveTaskDetail` remain completely untouched.
 *
 * @since T10 (Inspector Panel Refactor)
 */
export const ExecutionInspectorAdapter = memo(function ExecutionInspectorAdapter(
  props: ExecutionInspectorAdapterProps,
) {
  return (
    <ExecutionInspector
      {...props}
      className={cn("flex-1", props.className)}
    />
  );
});
