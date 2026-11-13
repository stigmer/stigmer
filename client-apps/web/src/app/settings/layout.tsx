import { PageFrame } from "@stigmer/react-sdk/console";

/**
 * The settings column: the kit's wide `PageFrame` (wide enough for a
 * settings page's tables), with the document's heading for assistive
 * technology; each page draws its own visible heading through the kit's
 * `SettingsPage`. The desktop app's `SettingsLayout` is the same frame.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageFrame width="wide">
      <h1 className="sr-only">Settings</h1>
      {children}
    </PageFrame>
  );
}
