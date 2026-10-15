"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { OrgProfileSection } from "@stigmer/react";

/**
 * Organization profile settings. Opening a child organization from the
 * section's Child organizations list lands on the dashboard, as an
 * organization switch from the sidebar does.
 */
export default function OrgProfilePage() {
  const router = useRouter();
  const handleOrgChanged = useCallback(() => {
    router.push("/dashboard");
  }, [router]);

  return <OrgProfileSection onOrgChanged={handleOrgChanged} />;
}
