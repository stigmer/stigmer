import { Outlet } from "react-router-dom";
import { cn } from "@stigmer/theme";
import { LibraryBreadcrumbProvider } from "@stigmer/react";
import { LibraryBreadcrumb } from "./LibraryBreadcrumb";
import {
  FullViewportLayoutProvider,
  useFullViewportLayout,
} from "./full-viewport-layout";

export default function LibraryLayout() {
  return (
    <LibraryBreadcrumbProvider>
      <FullViewportLayoutProvider>
        <LibraryLayoutContent />
      </FullViewportLayoutProvider>
    </LibraryBreadcrumbProvider>
  );
}

function LibraryLayoutContent() {
  const { isFullViewport } = useFullViewportLayout();

  return (
    <div
      className={cn(
        isFullViewport
          ? "flex h-full flex-col"
          : "mx-auto max-w-4xl px-6 py-8",
      )}
    >
      {!isFullViewport && <LibraryBreadcrumb />}
      <div className={cn(isFullViewport && "flex min-h-0 flex-1 flex-col")}>
        <Outlet />
      </div>
    </div>
  );
}
