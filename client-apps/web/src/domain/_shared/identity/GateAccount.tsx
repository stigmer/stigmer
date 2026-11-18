"use client";

// The corner the console's gate screens share: the account as the sidebar's
// foot draws it (the kit's `UserMenu`), so a person stuck at a gate (setting
// up their account, a failure, making their first organization) sees who is
// signed in and can always sign out. Before the app there is no Settings to
// open, so the menu holds the colour scheme and Sign out. The kit's gate
// views place it top-right; the identity gate and the organization gate
// pass it.

import { useTheme } from "next-themes";
import { UserMenu } from "@stigmer/react-sdk/console";
import type { ColorMode } from "@stigmer/react-sdk";
import { useAuth } from "@/auth";

export function GateAccount() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  if (!user) return null;
  return (
    <UserMenu
      user={{ name: user.name, email: user.email }}
      colorMode={(theme ?? "system") as ColorMode}
      onColorModeChange={setTheme}
      onSignOut={logout}
    />
  );
}
