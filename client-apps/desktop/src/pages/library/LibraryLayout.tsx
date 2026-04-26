import { Outlet } from "react-router-dom";
import { LibraryBreadcrumbProvider } from "@stigmer/react";
import { LibraryBreadcrumb } from "./LibraryBreadcrumb";

export default function LibraryLayout() {
  return (
    <LibraryBreadcrumbProvider>
      <div className="mx-auto max-w-4xl px-6 py-8">
        <LibraryBreadcrumb />
        <Outlet />
      </div>
    </LibraryBreadcrumbProvider>
  );
}
