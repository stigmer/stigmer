"use client";

import { useCallback, useMemo, useReducer } from "react";
import type { WizardStepDef, WizardState } from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Options for {@link useWizardState}. */
export interface UseWizardStateOptions<TData> {
  /** Ordered step definitions — determines wizard length and validation. */
  readonly steps: readonly WizardStepDef<TData>[];
  /** Initial form data (empty/default values for all fields). */
  readonly initialData: TData;
}

/** Return value of {@link useWizardState}. */
export interface UseWizardStateReturn<TData> {
  /** Zero-based index of the current step. */
  readonly currentStepIndex: number;
  /** Definition of the current step. */
  readonly currentStep: WizardStepDef<TData>;
  /** Accumulated form data across all steps. */
  readonly data: TData;
  /** Merges a partial update into the accumulated data. */
  readonly updateData: (partial: Partial<TData>) => void;
  /** Whether navigation forward is allowed (current step is valid). */
  readonly canGoNext: boolean;
  /** Whether navigation backward is possible (not on first step). */
  readonly canGoBack: boolean;
  /** Advance to the next step (validates current step first). */
  readonly goNext: () => void;
  /** Return to the previous step. */
  readonly goBack: () => void;
  /** Jump directly to a specific step (only allows going backward). */
  readonly goToStep: (index: number) => void;
  /** Validation error for the current step, or `null`. */
  readonly validationError: string | null;
  /** `true` when on the first step. */
  readonly isFirstStep: boolean;
  /** `true` when on the last step. */
  readonly isLastStep: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type WizardAction<TData> =
  | { readonly type: "GO_NEXT" }
  | { readonly type: "GO_BACK" }
  | { readonly type: "GO_TO_STEP"; readonly index: number }
  | { readonly type: "UPDATE_DATA"; readonly partial: Partial<TData> }
  | { readonly type: "SET_VALIDATION_ERROR"; readonly error: string | null };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function createReducer<TData>(steps: readonly WizardStepDef<TData>[]) {
  return function wizardReducer(
    state: WizardState<TData>,
    action: WizardAction<TData>,
  ): WizardState<TData> {
    switch (action.type) {
      case "GO_NEXT": {
        const step = steps[state.currentStepIndex];
        const error = step?.validate?.(state.data) ?? null;
        if (error) {
          return { ...state, validationError: error };
        }
        const nextIndex = Math.min(
          state.currentStepIndex + 1,
          steps.length - 1,
        );
        return {
          ...state,
          currentStepIndex: nextIndex,
          validationError: null,
        };
      }

      case "GO_BACK": {
        const prevIndex = Math.max(state.currentStepIndex - 1, 0);
        return {
          ...state,
          currentStepIndex: prevIndex,
          validationError: null,
        };
      }

      case "GO_TO_STEP": {
        if (action.index < 0 || action.index >= steps.length) return state;
        if (action.index >= state.currentStepIndex) return state;
        return {
          ...state,
          currentStepIndex: action.index,
          validationError: null,
        };
      }

      case "UPDATE_DATA":
        return {
          ...state,
          data: { ...state.data, ...action.partial },
          validationError: null,
        };

      case "SET_VALIDATION_ERROR":
        return { ...state, validationError: action.error };

      default:
        return state;
    }
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Headless state machine for multi-step wizard flows.
 *
 * Manages step navigation, per-step validation gating, and accumulated
 * form data. Generic over the data shape — each wizard defines its own
 * `TData` type with fields for all steps.
 *
 * Navigation forward is gated by the current step's `validate` function.
 * Navigation backward is always allowed. Direct step jumps only go backward
 * (prevents skipping required steps).
 *
 * Follows the `useReducer` + discriminated union pattern established
 * by `agentSetupReducer` — pure state transitions, imperative API on top.
 *
 * @typeParam TData - Accumulated form data shape.
 *
 * @example
 * ```tsx
 * const wizard = useWizardState({
 *   steps: [
 *     { id: "basics", label: "Basics", validate: (d) => d.name ? null : "Name is required" },
 *     { id: "review", label: "Review" },
 *   ],
 *   initialData: { name: "", description: "" },
 * });
 *
 * // wizard.data.name, wizard.updateData({ name: "My Agent" })
 * // wizard.goNext(), wizard.goBack()
 * ```
 */
export function useWizardState<TData>(
  options: UseWizardStateOptions<TData>,
): UseWizardStateReturn<TData> {
  const { steps, initialData } = options;

  const reducer = useMemo(() => createReducer(steps), [steps]);

  const [state, dispatch] = useReducer(reducer, {
    currentStepIndex: 0,
    data: initialData,
    validationError: null,
  });

  const currentStep = steps[state.currentStepIndex]!;
  const isFirstStep = state.currentStepIndex === 0;
  const isLastStep = state.currentStepIndex === steps.length - 1;

  const canGoNext = useMemo(() => {
    const error = currentStep.validate?.(state.data) ?? null;
    return error === null;
  }, [currentStep, state.data]);

  const canGoBack = !isFirstStep;

  const goNext = useCallback(() => {
    dispatch({ type: "GO_NEXT" });
  }, []);

  const goBack = useCallback(() => {
    dispatch({ type: "GO_BACK" });
  }, []);

  const goToStep = useCallback((index: number) => {
    dispatch({ type: "GO_TO_STEP", index });
  }, []);

  const updateData = useCallback((partial: Partial<TData>) => {
    dispatch({ type: "UPDATE_DATA", partial });
  }, []);

  return useMemo(
    () => ({
      currentStepIndex: state.currentStepIndex,
      currentStep,
      data: state.data,
      updateData,
      canGoNext,
      canGoBack,
      goNext,
      goBack,
      goToStep,
      validationError: state.validationError,
      isFirstStep,
      isLastStep,
    }),
    [
      state.currentStepIndex,
      state.data,
      state.validationError,
      currentStep,
      canGoNext,
      canGoBack,
      isFirstStep,
      isLastStep,
      updateData,
      goNext,
      goBack,
      goToStep,
    ],
  );
}
