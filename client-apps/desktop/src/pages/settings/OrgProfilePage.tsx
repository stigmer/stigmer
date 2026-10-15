import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { OrgProfileSection } from "@stigmer/react";

/**
 * Organization profile settings. Opening a child organization from the
 * section's Child organizations list lands on the dashboard, as an
 * organization switch from the sidebar does (which also overwrites the
 * persisted last route, so the parent's settings page is not restored
 * into the child on the next launch).
 */
export default function OrgProfilePage() {
  const navigate = useNavigate();
  const handleOrgChanged = useCallback(() => navigate("/dashboard"), [navigate]);

  return <OrgProfileSection onOrgChanged={handleOrgChanged} />;
}
