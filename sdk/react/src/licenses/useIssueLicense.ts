"use client";

import { useCallback, useMemo, useState } from "react";
import type { LicenseInput } from "@stigmer/sdk";
import type { License } from "@stigmer/protos/ai/stigmer/billing/license/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useIssueLicense}. */
export interface UseIssueLicenseReturn {
  /**
   * Issue a license: the server builds and validates the claims, has the
   * vault sign them, records the license and returns it with its ticket.
   * A license is final once issued (there is no update and no delete); a
   * license that must say something else is a new one.
   */
  readonly issue: (input: LicenseInput) => Promise<License>;
  /** `true` while an issue is in flight. */
  readonly isSubmitting: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook for issuing a Stigmer license.
 *
 * The returned license carries `status.ticket`; hand it to the view that
 * shows the ticket rather than reading it again. The parent should refetch
 * its list after a successful issue.
 *
 * Platform-operator surface: the caller needs `can_issue_license` on
 * `platform:stigmer`.
 */
export function useIssueLicense(): UseIssueLicenseReturn {
  const stigmer = useStigmer();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const issue = useCallback(
    async (input: LicenseInput): Promise<License> => {
      setIsSubmitting(true);
      setError(null);
      try {
        return await stigmer.license.create(input);
      } catch (e) {
        const err = toError(e);
        setError(err);
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [stigmer.license],
  );

  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({ issue, isSubmitting, error, clearError }),
    [issue, isSubmitting, error, clearError],
  );
}
