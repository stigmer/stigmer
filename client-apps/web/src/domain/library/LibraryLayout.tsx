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
import { ScheduleDetailPageInner } from "@/domain/library/schedules/ScheduleDetailPage";

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

  const overlayActive = activeDetail != null;

  // While a detail overlay is active, the route-rendered children stay
  // mounted but hidden: preserving LIST scroll, filters, and loaded data
  // under the overlay is the reason this zone bypasses Next routing at
  // all (see LibraryNavigationProvider). Children that are themselves a
  // detail page — a cold deep-load of a detail URL — would be the SAME
  // page the overlay renders, so the route-level detail wrappers yield
  // to the overlay and render null inside this wrapper
  // (useRouteDetailYieldsToOverlay, oss#621); only list content is ever
  // actually kept alive here.
  //
  // The desktop app's LibraryLayout renders a plain <Outlet /> with no
  // overlay: react-router navigates detail routes for real, so neither
  // case exists there. That divergence is inherent to the static-export
  // constraint, not drift.
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
        data-slot="library-route-children"
        className={cn(
          overlayActive && "hidden",
          isFullViewport && "flex min-h-0 flex-1 flex-col",
        )}
        aria-hidden={overlayActive}
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
    case "schedules":
      return <ScheduleDetailPageInner org={detail.org} slug={detail.slug} />;
  }
}
