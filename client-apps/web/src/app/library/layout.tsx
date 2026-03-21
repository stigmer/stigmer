"use client";

import { LibraryBreadcrumb } from "./LibraryBreadcrumb";
import { LibraryBreadcrumbProvider } from "./LibraryBreadcrumbContext";

export default function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LibraryBreadcrumbProvider>
      <div className="mx-auto max-w-4xl px-6 py-8">
        <LibraryBreadcrumb />
        {children}
      </div>
    </LibraryBreadcrumbProvider>
  );
}
