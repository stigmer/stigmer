import { Loader2 } from "lucide-react";

/**
 * Settings-scoped loading boundary.
 *
 * Displayed within the settings layout when navigating between sub-pages
 * (e.g., Members -> API Keys) while the target page is loading. Keeps the
 * ManagementSidebar and settings header visible during transitions.
 */
export default function SettingsLoading() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="text-muted-foreground size-6 animate-spin" />
    </div>
  );
}
