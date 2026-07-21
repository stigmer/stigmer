import { Link } from "react-router-dom";
import { useSettingsNavGroups } from "@stigmer/react";

export default function SettingsLanding() {
  const navGroups = useSettingsNavGroups();

  return (
    <div className="flex flex-col gap-6">
      {navGroups.map((group) => (
        <section
          key={group.label}
          className="rounded-lg border border-border p-5"
        >
          <h2 className="mb-1 text-sm font-semibold text-foreground">
            {group.label}
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {group.description}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {group.items.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className="flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-primary"
              >
                <item.icon className="size-4 shrink-0 text-muted-foreground" />
                {item.label}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
