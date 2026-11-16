import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  RoutineForm,
  useBreadcrumbOverride,
  useActiveOrgId,
  useOrgSlugForId,
  PageHeader,
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
    <>
      <PageHeader className="mb-6" headingLevel={1} title="New routine" description="Start an agent on a schedule, by hand, or from another system." />
      <RoutineForm
        org={org}
        onComplete={(routine) =>
          navigate(
            `/library/routines/${slugForOrg(routine.metadata?.org ?? "")}/${routine.metadata?.slug}`,
          )
        }
        onCancel={() => navigate("/library/routines")}
      />
    </>
  );
}
