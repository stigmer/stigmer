import { Outlet } from "react-router-dom";
import { LibraryBreadcrumbProvider } from "@stigmer/react";
import { WorkflowBreadcrumb } from "./WorkflowBreadcrumb";

export default function WorkflowLayout() {
  return (
    <LibraryBreadcrumbProvider>
      <div className="mx-auto max-w-4xl px-6 py-8">
        <WorkflowBreadcrumb />
        <Outlet />
      </div>
    </LibraryBreadcrumbProvider>
  );
}
