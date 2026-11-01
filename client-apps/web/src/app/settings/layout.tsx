/**
 * The settings column: wide enough for a settings page's tables
 * (`max-w-5xl`), with the document's heading for assistive technology;
 * each page draws its own visible heading through the kit's `SettingsPage`.
 * The desktop app's `SettingsLayout` is the same frame.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="sr-only">Settings</h1>
      {children}
    </div>
  );
}
