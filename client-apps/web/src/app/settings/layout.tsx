export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-foreground mb-1 text-xl font-semibold">Settings</h1>
      <p className="text-muted-foreground mb-8 text-sm">
        Manage your members, API keys, environments, identity providers,
        and configuration.
      </p>
      {children}
    </div>
  );
}
