"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ScheduleForm,
  useActiveOrgSlug,
  useBreadcrumbOverride,
} from "@stigmer/react";

/**
 * Console page for creating a new schedule.
 *
 * Mounted at `/library/schedules/new`. Renders the SDK's
 * `ScheduleForm` component and handles routing on
 * completion (navigate to detail) and cancellation (navigate to list).
 */
export function ScheduleNewPage() {
  const org = useActiveOrgSlug();
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => {
    setLabel("New schedule");
  }, [setLabel]);

  if (!org) return null;

  return (
    <ScheduleForm
      org={org}
      onComplete={(schedule) =>
        router.push(
          `/library/schedules/${schedule.metadata?.org}/${schedule.metadata?.slug}`,
        )
      }
      onCancel={() => router.push("/library/schedules")}
    />
  );
}
