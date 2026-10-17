"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  RoutineForm,
  useActiveOrgId,
  useOrgSlugForId,
  useBreadcrumbOverride,
} from "@stigmer/react-sdk";

/**
 * Console page for creating a new schedule.
 *
 * Mounted at `/library/schedules/new`. Renders the SDK's
 * `RoutineForm` component and handles routing on
 * completion (navigate to detail) and cancellation (navigate to list).
 */
export function ScheduleNewPage() {
  const org = useActiveOrgId();
  const slugForOrg = useOrgSlugForId();
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => {
    setLabel("New schedule");
  }, [setLabel]);

  if (!org) return null;

  return (
    <RoutineForm
      org={org}
      onComplete={(routine) =>
        router.push(
          `/library/schedules/${slugForOrg(routine.metadata?.org ?? "")}/${routine.metadata?.slug}`,
        )
      }
      onCancel={() => router.push("/library/schedules")}
    />
  );
}
