"use client";

// Policies were a page of one switch; they are a section of Organization
// preferences now. This address stays, so a bookmark or a shared link still
// lands: the page replaces it with the preferences page's (a client
// replace, since the console is a static export with no server redirects).

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const ORG_POLICIES_MOVED_TO = "/settings/org-preferences";

export default function OrgPoliciesPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(ORG_POLICIES_MOVED_TO);
  }, [router]);
  return null;
}
