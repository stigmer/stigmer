import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  RoutineForm,
  useBreadcrumbOverride,
  useActiveOrgId,
  useOrgSlugForId,
} from "@stigmer/react";

export default function ScheduleNewPage() {
  const org = useActiveOrgId();
  const slugForOrg = useOrgSlugForId();
  const navigate = useNavigate();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => {
    setLabel("New schedule");
    return () => setLabel(null);
  }, [setLabel]);

  if (!org) return null;

  return (
    <RoutineForm
      org={org}
      onComplete={(routine) =>
        navigate(
          `/library/schedules/${slugForOrg(routine.metadata?.org ?? "")}/${routine.metadata?.slug}`,
        )
      }
      onCancel={() => navigate("/library/schedules")}
    />
  );
}
