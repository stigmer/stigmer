"use client";

import { useCallback, useMemo, useState } from "react";
import type { PlanInput } from "@stigmer/sdk";
import type { Plan } from "@stigmer/protos/ai/stigmer/billing/plan/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCreatePlan}. */
export interface UseCreatePlanReturn {
  /**
   * Add a plan to the catalog. A plan's terms are final once it exists:
   * there is no update, so changed terms are a new plan and the old one
   * is retired.
   */
  readonly createPlan: (input: PlanInput) => Promise<Plan>;
  /** `true` while a create is in flight. */
  readonly isSubmitting: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behaviour hook that adds a plan to the Stigmer Cloud catalog.
 * Platform-operator surface: `can_manage_plans` on `platform:stigmer`.
 */
export function useCreatePlan(): UseCreatePlanReturn {
  const stigmer = useStigmer();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const createPlan = useCallback(
    async (input: PlanInput): Promise<Plan> => {
      setIsSubmitting(true);
      setError(null);
      try {
        return await stigmer.plan.create(input);
      } catch (e) {
        const err = toError(e);
        setError(err);
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [stigmer.plan],
  );
  const clearError = useCallback(() => setError(null), []);
  return useMemo(() => ({ createPlan, isSubmitting, error, clearError }), [createPlan, isSubmitting, error, clearError]);
}

/** Return value of {@link useRetirePlan}. */
export interface UseRetirePlanReturn {
  /**
   * Retire a plan: it can no longer be bought, and every subscription
   * already on it keeps it. Retiring is final.
   */
  readonly retirePlan: (planId: string) => Promise<Plan>;
  /** `true` while a retire is in flight. */
  readonly isSubmitting: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behaviour hook that retires a catalog plan.
 * Platform-operator surface: `can_manage_plans` on `platform:stigmer`.
 */
export function useRetirePlan(): UseRetirePlanReturn {
  const stigmer = useStigmer();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const retirePlan = useCallback(
    async (planId: string): Promise<Plan> => {
      setIsSubmitting(true);
      setError(null);
      try {
        return await stigmer.plan.retire(planId);
      } catch (e) {
        const err = toError(e);
        setError(err);
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [stigmer.plan],
  );
  const clearError = useCallback(() => setError(null), []);
  return useMemo(() => ({ retirePlan, isSubmitting, error, clearError }), [retirePlan, isSubmitting, error, clearError]);
}
