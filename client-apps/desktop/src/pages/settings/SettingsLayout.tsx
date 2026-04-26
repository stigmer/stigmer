import { Outlet } from "react-router-dom";

export default function SettingsLayout() {
  return (
    <div className="h-full overflow-y-auto">
      <h1 className="sr-only">Settings</h1>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Outlet />
      </div>
    </div>
  );
}
