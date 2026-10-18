import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  EnvironmentCreationDenied,
  EnvironmentForm,
  useActiveOrgId,
  useBreadcrumbOverride,
  useCanCreateEnvironment,
  useOrgSlugForId,
} from "@stigmer/react-sdk";

/**
 * Creates an Environment, wired identically to the web page: the SDK's
 * form, the new Environment opened on completion, the list on cancel, and
 * the denied notice for someone who may not create one.
 */
export default function EnvironmentNewPage() {
  const org = useActiveOrgId();
  const slugForOrg = useOrgSlugForId();
  const navigate = useNavigate();
  const { setLabel } = useBreadcrumbOverride();
  const { allowed: canCreate, isLoading: isChecking } = useCanCreateEnvironment(org || null);

  useEffect(() => {
    setLabel("New environment");
    return () => setLabel(null);
  }, [setLabel]);

  if (!org || isChecking) return null;
  if (!canCreate) return <EnvironmentCreationDenied />;

  return (
    <EnvironmentForm
      org={org}
      onCreated={(environment) =>
        navigate(`/library/environments/${slugForOrg(environment.metadata?.org ?? "")}/${environment.metadata?.slug}`)
      }
      onCancel={() => navigate("/library/environments")}
    />
  );
}
