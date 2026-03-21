import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider";
import { source } from "@/lib/source";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider search={{ options: { type: "static" } }}>
      <DocsLayout tree={source.pageTree}>{children}</DocsLayout>
    </RootProvider>
  );
}
