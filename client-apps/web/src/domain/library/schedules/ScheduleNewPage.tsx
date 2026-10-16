"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ScheduleForm,
  useActiveOrgId,
  useOrgSlugForId,
  useBreadcrumbOverride,
} from "@stigmer/react-sdk";

/**
 * Console page for creating a new schedule.
 *
 * Mounted at `/library/schedules/new`. Renders the SDK's
 * `ScheduleForm` component and handles routing on
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
    <ScheduleForm
      org={org}
      onComplete={(schedule) =>
        router.push(
          `/library/schedules/${slugForOrg(schedule.metadata?.org ?? "")}/${schedule.metadata?.slug}`,
        )
      }
      onCancel={() => router.push("/library/schedules")}
    />
  );
}
