"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  EnvironmentCreationDenied,
  EnvironmentForm,
  useActiveOrgId,
  useBreadcrumbOverride,
  useCanCreateEnvironment,
  useOrgSlugForId,
} from "@stigmer/react-sdk";

/**
 * Console page for creating an Environment, at `/library/environments/new`.
 * Renders the SDK's `EnvironmentForm` and routes on completion (to the new
 * Environment) and cancellation (to the list). A direct visit by someone
 * who may not create one meets the denied notice instead of a form whose
 * save the server would refuse.
 */
export function EnvironmentNewPage() {
  const org = useActiveOrgId();
  const slugForOrg = useOrgSlugForId();
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();
  const { allowed: canCreate, isLoading: isChecking } = useCanCreateEnvironment(org || null);

  useEffect(() => {
    setLabel("New environment");
  }, [setLabel]);

  if (!org || isChecking) return null;
  if (!canCreate) return <EnvironmentCreationDenied />;

  return (
    <EnvironmentForm
      org={org}
      onCreated={(environment) =>
        router.push(
          `/library/environments/${slugForOrg(environment.metadata?.org ?? "")}/${environment.metadata?.slug}`,
        )
      }
      onCancel={() => router.push("/library/environments")}
    />
  );
}
