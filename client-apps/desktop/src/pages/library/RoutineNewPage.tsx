import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  RoutineForm,
  useBreadcrumbOverride,
  useActiveOrgId,
  useOrgSlugForId,
} from "@stigmer/react-sdk";

export default function RoutineNewPage() {
  const org = useActiveOrgId();
  const slugForOrg = useOrgSlugForId();
  const navigate = useNavigate();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => {
    setLabel("New routine");
    return () => setLabel(null);
  }, [setLabel]);

  if (!org) return null;

  return (
    <RoutineForm
      org={org}
      onComplete={(routine) =>
        navigate(
          `/library/routines/${slugForOrg(routine.metadata?.org ?? "")}/${routine.metadata?.slug}`,
        )
      }
      onCancel={() => navigate("/library/routines")}
    />
  );
}
