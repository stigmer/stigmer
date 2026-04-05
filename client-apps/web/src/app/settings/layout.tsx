export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-foreground mb-1 text-xl font-semibold">Settings</h1>
      <p className="text-muted-foreground mb-8 text-sm">
        Manage your API keys, environments, members, and configuration.
      </p>
      {children}
    </div>
  );
}
