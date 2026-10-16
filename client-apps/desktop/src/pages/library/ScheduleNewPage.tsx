import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ScheduleForm,
  useBreadcrumbOverride,
  useActiveOrgId,
  useOrgSlugForId,
} from "@stigmer/react-sdk";

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
    <ScheduleForm
      org={org}
      onComplete={(schedule) =>
        navigate(
          `/library/schedules/${slugForOrg(schedule.metadata?.org ?? "")}/${schedule.metadata?.slug}`,
        )
      }
      onCancel={() => navigate("/library/schedules")}
    />
  );
}
