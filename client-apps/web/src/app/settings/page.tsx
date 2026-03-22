import { ApiKeysSection } from "@/components/settings/ApiKeysSection";
import { EnvironmentsSection } from "@/components/settings/EnvironmentsSection";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-foreground mb-1 text-xl font-semibold">Settings</h1>
      <p className="text-muted-foreground mb-8 text-sm">
        Manage your API keys, environments, and configuration.
      </p>

      <div className="space-y-10">
        <ApiKeysSection />
        <EnvironmentsSection />
      </div>
    </div>
  );
}
