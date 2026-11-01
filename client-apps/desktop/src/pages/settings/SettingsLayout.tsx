import { Outlet } from "react-router-dom";

/**
 * The settings column: wide enough for a settings page's tables
 * (`max-w-5xl`), with the document's heading for assistive technology;
 * each page draws its own visible heading through the kit's `SettingsPage`.
 * The web console's settings layout is the same frame.
 */
export default function SettingsLayout() {
  return (
    <>
      <h1 className="sr-only">Settings</h1>
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </div>
    </>
  );
}
