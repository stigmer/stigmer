"use client";

import { createContext, useContext, type ComponentType } from "react";
import type { JsonValue } from "@bufbuild/protobuf";
import type { TaskOutcome } from "./WorkflowTaskApprovalCard.js";

/**
 * Props a custom review renderer receives for a pending human_input gate.
 *
 * The renderer owns the presentation of the material under review; Stigmer
 * keeps owning the approval mechanics. Whatever the surface collects flows
 * through {@link submit}, which routes to the standard
 * `submitWorkflowTaskApproval` path — outcomes, routing, and audit behave
 * exactly as they do for the built-in card.
 */
export interface ReviewRendererProps {
  /** Name of the human_input task awaiting a decision. */
  readonly taskName: string;
  /**
   * The resolved review payload. Artifact-backed payloads are fetched and
   * parsed before the renderer mounts, so this is always the materialized
   * value — never an artifact reference.
   */
  readonly payload: JsonValue;
  /**
   * JSON Schema for the reviewer's structured response from the task
   * config's `form_schema`, or `null` when the gate defines none. Custom
   * surfaces that collect a response should shape it to this schema so
   * the decision record stays consistent with the workflow contract.
   */
  readonly formSchema: Record<string, unknown> | null;
  /**
   * Configured outcomes the reviewer can choose between. Empty when the
   * gate uses the default binary approve/reject pair — renderers should
   * treat that the same way the built-in card does.
   */
  readonly outcomes: readonly TaskOutcome[];
  /**
   * Submits the reviewer's decision through the standard approval path.
   * The task name is already bound; pass the chosen outcome plus any
   * structured form data and free-text comment.
   */
  readonly submit: (
    outcome: string,
    formData?: Record<string, unknown>,
    comment?: string,
  ) => Promise<unknown>;
  /** True while this gate's submission RPC is in flight. */
  readonly isSubmitting: boolean;
  /** This gate's last failed decision, or `null`. */
  readonly error: Error | null;
}

/**
 * Registry of custom review renderers keyed by `ui_hint`.
 *
 * A human_input task declares `ui_hint: "article-diff"` in its config;
 * an embedding application registers a matching renderer here (via
 * `StigmerProvider`'s `reviewRenderers` prop) and the approval gate
 * presents domain-native UI instead of the built-in card. Hints without
 * a registered renderer fall back to the built-in card with the payload
 * shown as structured data — workflows stay portable across surfaces.
 */
export type ReviewRenderers = Readonly<
  Record<string, ComponentType<ReviewRendererProps>>
>;

const EMPTY_RENDERERS: ReviewRenderers = {};

/**
 * React context distributing the host application's review renderers.
 *
 * Populated by `StigmerProvider`'s `reviewRenderers` prop. Defaults to an
 * empty registry — the absence of custom renderers is a fully supported
 * state (every gate falls back to the built-in card), so consuming this
 * context outside a provider is not an error.
 */
export const ReviewRendererContext = createContext<ReviewRenderers>(EMPTY_RENDERERS);

/**
 * Resolves the custom renderer registered for a gate's `ui_hint`,
 * or `null` when the hint is empty or nothing is registered for it.
 */
export function useReviewRenderer(
  uiHint: string | undefined,
): ComponentType<ReviewRendererProps> | null {
  const renderers = useContext(ReviewRendererContext);
  if (!uiHint) return null;
  return renderers[uiHint] ?? null;
}
