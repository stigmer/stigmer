"use client";

/**
 * The web console's Library landing: the kit's overview, its cards and Add
 * menu going through Next's router.
 */

import { useRouter } from "next/navigation";
import { LibraryOverview } from "@stigmer/react-sdk/console";

export function LibraryLanding() {
  const router = useRouter();
  return <LibraryOverview onNavigate={(path) => router.push(path)} />;
}
