// The corner a pre-app gate screen shares: the account as the sidebar's
// foot draws it (the kit's `UserMenu`), so a person stuck at a gate (an
// error, the first organization's form, account setup) sees who is signed
// in and can always sign out. It renders above the router, so it holds only
// what works there: the colour scheme and Sign out. The identity gate and
// the organization gate pass it, with the app's mark, to the kit's views.

import { UserMenu } from "@stigmer/react-sdk/console";
import { useAuth } from "../auth/AuthProvider";
import { useColorModePreference } from "../hooks/useColorModePreference";

export function GateHeader() {
  const { user, logout } = useAuth();
  const { colorMode, setColorMode } = useColorModePreference();
  if (!user) return null;
  return (
    <UserMenu
      user={{ name: user.name, email: user.email }}
      colorMode={colorMode}
      onColorModeChange={setColorMode}
      onSignOut={logout}
    />
  );
}

/** The app's mark on the gate screens, at the frame's 40px. */
export function GateMark() {
  return <img src="/app-icon-light.svg" alt="Stigmer" width={40} height={40} className="size-10 rounded-xl" />;
}
