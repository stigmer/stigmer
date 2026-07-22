"use client";

import { cn } from "@stigmer/theme";
import {
  LibraryNavigationProvider,
  useLibraryNavigation,
  type ActiveDetail,
} from "@/domain/library/library-navigation";
import {
  FullViewportLayoutProvider,
  useFullViewportLayout,
} from "@/domain/library/full-viewport-layout";
import { LibraryBreadcrumb } from "@/domain/library/LibraryBreadcrumb";
import { LibraryBreadcrumbProvider } from "@stigmer/react";
import { AgentDetailPageInner } from "@/domain/library/agents/AgentDetailPage";
import { SkillDetailPageInner } from "@/domain/library/skills/SkillDetailPage";
import { McpServerDetailPageInner } from "@/domain/library/mcp-servers/McpServerDetailPage";
import { WorkflowDetailPageInner } from "@/domain/workflow/WorkflowDetailPage";
import { DatastoreDetailPageInner } from "@/domain/library/datastores/DatastoreDetailPage";

export default function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LibraryNavigationProvider>
      <LibraryBreadcrumbProvider>
        <FullViewportLayoutProvider>
          <LibraryLayoutContent>{children}</LibraryLayoutContent>
        </FullViewportLayoutProvider>
      </LibraryBreadcrumbProvider>
    </LibraryNavigationProvider>
  );
}

function LibraryLayoutContent({ children }: { children: React.ReactNode }) {
  const { activeDetail } = useLibraryNavigation();
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
      <div
        className={cn(
          activeDetail != null && "hidden",
          isFullViewport && "flex min-h-0 flex-1 flex-col",
        )}
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
    case "workflows":
      return <WorkflowDetailPageInner org={detail.org} slug={detail.slug} />;
    case "datastores":
      return <DatastoreDetailPageInner org={detail.org} slug={detail.slug} />;
  }
}
