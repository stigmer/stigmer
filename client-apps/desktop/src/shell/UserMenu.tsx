import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Server } from "lucide-react";
import { ActionMenu } from "@stigmer/react-sdk";
import { UserMenu as SdkUserMenu } from "@stigmer/react-sdk/console";
import { useAuth } from "../auth/AuthProvider";
import { useServer } from "../server/ServerProvider";
import { useColorModePreference } from "../hooks/useColorModePreference";

export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { colorMode, setColorMode } = useColorModePreference();

  const handleSettingsClick = useCallback(() => {
    navigate("/settings");
  }, [navigate]);

  return (
    <SdkUserMenu
      user={user ? { name: user.name, email: user.email } : null}
      colorMode={colorMode}
      onColorModeChange={setColorMode}
      onSettingsClick={handleSettingsClick}
      onSignOut={user ? logout : undefined}
      extraItems={<ChangeServerItem />}
    />
  );
}

/**
 * "Change server…": the same form as "Use another server" on the sign-in
 * screen, over the app. Each server keeps its own sign-in, so coming back
 * to this one finds the person still signed in.
 */
function ChangeServerItem() {
  const { label, setChoosing } = useServer();
  return (
    <ActionMenu.Item icon={<Server className="size-4" />} onSelect={() => setChoosing(true)}>
      Change server&hellip;
      <span className="ml-auto max-w-28 truncate pl-2 text-xs text-muted-foreground">{label}</span>
    </ActionMenu.Item>
  );
}
