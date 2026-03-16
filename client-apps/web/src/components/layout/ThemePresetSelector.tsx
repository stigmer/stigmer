"use client";

import { useCallback, useEffect, useState } from "react";
import { Palette } from "lucide-react";
import { cn, THEME_PRESETS } from "@stigmer/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const STORAGE_KEY = "stgm-theme-preset";

function getStoredPresetId(): string {
  if (typeof window === "undefined") return "default";
  return localStorage.getItem(STORAGE_KEY) ?? "default";
}

function applyPresetClass(presetId: string) {
  const html = document.documentElement;
  for (const preset of THEME_PRESETS) {
    if (preset.className) {
      html.classList.remove(preset.className);
    }
  }
  const selected = THEME_PRESETS.find((p) => p.id === presetId);
  if (selected?.className) {
    html.classList.add(selected.className);
  }
}

export function ThemePresetSelector() {
  const [presetId, setPresetId] = useState("default");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = getStoredPresetId();
    setPresetId(stored);
    applyPresetClass(stored);
    setMounted(true);
  }, []);

  const handleChange = useCallback((value: unknown) => {
    const id = value as string;
    setPresetId(id);
    localStorage.setItem(STORAGE_KEY, id);
    applyPresetClass(id);
  }, []);

  if (!mounted) {
    return <ThemePresetSkeleton />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Color preset"
        className={cn(
          "bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center rounded-lg p-1.5 transition-colors",
        )}
      >
        <Palette className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Color Preset</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuRadioGroup value={presetId} onValueChange={handleChange}>
          {THEME_PRESETS.map((preset) => (
            <DropdownMenuRadioItem key={preset.id} value={preset.id}>
              <span
                className="size-3 shrink-0 rounded-full border"
                style={{ backgroundColor: preset.swatch }}
              />
              <span>{preset.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemePresetSkeleton() {
  return (
    <div className="bg-muted text-muted-foreground flex items-center justify-center rounded-lg p-1.5">
      <Palette className="size-3.5" />
    </div>
  );
}
