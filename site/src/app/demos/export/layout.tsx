import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Layout for video export pages. Inherits root-level fonts and
 * base styles but skips the docs layout (no nav, sidebar, footer).
 * Hidden from search engines via robots meta.
 */
export default function ExportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
