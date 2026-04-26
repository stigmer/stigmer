import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { UserMenu as SdkUserMenu } from "@stigmer/react";
import { useAuth } from "../auth/AuthProvider";
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
    />
  );
}
