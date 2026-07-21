"use client";

import Link from "next/link";
import { useSettingsNavGroups } from "@stigmer/react";

export default function SettingsPage() {
  const navGroups = useSettingsNavGroups();

  return (
    <div className="flex flex-col gap-6">
      {navGroups.map((group) => (
        <section
          key={group.label}
          className="border-border rounded-lg border p-5"
        >
          <h2 className="text-foreground mb-1 text-sm font-semibold">
            {group.label}
          </h2>
          <p className="text-muted-foreground mb-4 text-xs">
            {group.description}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-foreground hover:text-primary flex items-center gap-1.5 text-sm font-medium transition-colors"
              >
                <item.icon className="text-muted-foreground size-4 shrink-0" />
                {item.label}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
