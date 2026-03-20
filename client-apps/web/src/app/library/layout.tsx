"use client";

import { LibraryBreadcrumb } from "./LibraryBreadcrumb";

export default function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <LibraryBreadcrumb />
      {children}
    </div>
  );
}
