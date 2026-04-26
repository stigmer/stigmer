"use client";

import { useCallback } from "react";
import { Download, Monitor } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { UserMenu as SdkUserMenu } from "@stigmer/react";
import type { ColorMode } from "@stigmer/react";
import { useAuth } from "@/auth";
import { triggerDesktopDownload } from "@/lib/desktop-download";
import { DropdownMenuItem } from "@/domain/_shared/ui/dropdown-menu";

export function UserMenu() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();

  const handleSettingsClick = useCallback(() => {
    router.push("/settings");
  }, [router]);

  return (
    <SdkUserMenu
      user={user ? { name: user.name, email: user.email } : null}
      colorMode={(theme ?? "system") as ColorMode}
      onColorModeChange={setTheme}
      onSettingsClick={handleSettingsClick}
      onSignOut={user ? logout : undefined}
      extraItems={
        <DesktopAppItem />
      }
    />
  );
}

function DesktopAppItem() {
  return (
    <DropdownMenuItem onClick={triggerDesktopDownload}>
      <Monitor className="size-4" />
      Get Desktop App
      <Download className="text-muted-foreground ml-auto size-3" />
    </DropdownMenuItem>
  );
}
