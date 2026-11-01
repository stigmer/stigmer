"use client";

// The settings landing: the kit's overview of every settings group, each
// page a Next.js link. The desktop app draws the same component with its
// router's link.

import Link from "next/link";
import { SettingsOverview } from "@stigmer/react-sdk/console";

export default function SettingsPage() {
  return (
    <SettingsOverview
      renderLink={({ id, href, className, children, "aria-current": ariaCurrent }) => (
        <Link key={id} href={href} className={className} aria-current={ariaCurrent}>
          {children}
        </Link>
      )}
    />
  );
}
