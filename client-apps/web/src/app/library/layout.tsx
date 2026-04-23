"use client";

import { cn } from "@stigmer/theme";
import {
  LibraryNavigationProvider,
  useLibraryNavigation,
  type ActiveDetail,
} from "@/domain/library/library-navigation";
import { LibraryBreadcrumb } from "@/domain/library/LibraryBreadcrumb";
import { LibraryBreadcrumbProvider } from "@/domain/library/LibraryBreadcrumbContext";
import { AgentDetailPageInner } from "@/domain/library/agents/AgentDetailPage";
import { SkillDetailPageInner } from "@/domain/library/skills/SkillDetailPage";
import { McpServerDetailPageInner } from "@/domain/library/mcp-servers/McpServerDetailPage";

export default function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LibraryNavigationProvider>
      <LibraryBreadcrumbProvider>
        <LibraryLayoutContent>{children}</LibraryLayoutContent>
      </LibraryBreadcrumbProvider>
    </LibraryNavigationProvider>
  );
}

function LibraryLayoutContent({ children }: { children: React.ReactNode }) {
  const { activeDetail } = useLibraryNavigation();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <LibraryBreadcrumb />
      <div
        className={cn(activeDetail != null && "hidden")}
        aria-hidden={activeDetail != null}
      >
        {children}
      </div>
      {activeDetail != null && (
        <LibraryDetailContent
          detail={activeDetail}
          key={`${activeDetail.resourceType}/${activeDetail.org}/${activeDetail.slug}`}
        />
      )}
    </div>
  );
}

function LibraryDetailContent({ detail }: { detail: ActiveDetail }) {
  switch (detail.resourceType) {
    case "agents":
      return <AgentDetailPageInner org={detail.org} slug={detail.slug} />;
    case "skills":
      return <SkillDetailPageInner org={detail.org} slug={detail.slug} />;
    case "mcp-servers":
      return <McpServerDetailPageInner org={detail.org} slug={detail.slug} />;
  }
}
