import { SettingsSkeleton } from "@stigmer/react-sdk/console";

/**
 * Settings-scoped loading boundary.
 *
 * Displayed within the settings layout while the next settings page loads
 * (e.g., Members -> API keys): the same skeleton every settings page draws
 * while it reads its own data, so the move between pages has one look.
 */
export default function SettingsLoading() {
  return <SettingsSkeleton label="Loading settings" />;
}
