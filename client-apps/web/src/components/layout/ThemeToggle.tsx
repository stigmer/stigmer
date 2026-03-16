"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@stigmer/theme";

const subscribe = () => () => {};

function useMounted() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

const themes = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "system", icon: Monitor, label: "System" },
  { value: "dark", icon: Moon, label: "Dark" },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  if (!mounted) {
    return <ThemeToggleSkeleton />;
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="bg-muted flex gap-0.5 rounded-lg p-0.5"
    >
      {themes.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          onClick={() => setTheme(value)}
          className={cn(
            "flex flex-1 items-center justify-center rounded-md p-1.5 transition-colors",
            theme === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

function ThemeToggleSkeleton() {
  return (
    <div className="bg-muted flex gap-0.5 rounded-lg p-0.5">
      {themes.map(({ value, icon: Icon }) => (
        <div
          key={value}
          className="text-muted-foreground flex flex-1 items-center justify-center rounded-md p-1.5"
        >
          <Icon className="size-3.5" />
        </div>
      ))}
    </div>
  );
}
