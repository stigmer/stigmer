"use client";

import { OrgProvider } from "@/contexts/org-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return <OrgProvider>{children}</OrgProvider>;
}
