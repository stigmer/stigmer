"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  RoutineForm,
  useActiveOrgId,
  useOrgSlugForId,
  useBreadcrumbOverride,
  PageHeader,
} from "@stigmer/react-sdk";

/**
 * Console page for creating a new routine.
 *
 * Mounted at `/library/routines/new`. Renders the SDK's
 * `RoutineForm` component and handles routing on
 * completion (navigate to detail) and cancellation (navigate to list).
 */
export function RoutineNewPage() {
  const org = useActiveOrgId();
  const slugForOrg = useOrgSlugForId();
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => {
    setLabel("New routine");
  }, [setLabel]);

  if (!org) return null;

  return (
    <>
      <PageHeader className="mb-6" headingLevel={1} title="New routine" description="Start an agent on a schedule, by hand, or from another system." />
      <RoutineForm
        org={org}
        onComplete={(routine) =>
          router.push(
            `/library/routines/${slugForOrg(routine.metadata?.org ?? "")}/${routine.metadata?.slug}`,
          )
        }
        onCancel={() => router.push("/library/routines")}
      />
    </>
  );
}
