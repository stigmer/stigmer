import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ScheduleForm,
  useActiveOrgSlug,
  useBreadcrumbOverride,
} from "@stigmer/react";

export default function ScheduleNewPage() {
  const org = useActiveOrgSlug();
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
          `/library/schedules/${schedule.metadata?.org}/${schedule.metadata?.slug}`,
        )
      }
      onCancel={() => navigate("/library/schedules")}
    />
  );
}
