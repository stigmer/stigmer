"use client";

// Notifications were a page of one switch; they are a section of Account
// preferences now. This address stays, so a bookmark or a shared link still
// lands: the page replaces it with the preferences page's (a client
// replace, since the console is a static export with no server redirects).

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const NOTIFICATIONS_MOVED_TO = "/settings/account-preferences";

export default function NotificationsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(NOTIFICATIONS_MOVED_TO);
  }, [router]);
  return null;
}
