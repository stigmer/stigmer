"use client";

import { cn } from "@stigmer/theme";
import {
  WorkflowNavigationProvider,
  useWorkflowNavigation,
} from "@/domain/workflow/workflow-navigation";
import { WorkflowBreadcrumb } from "@/domain/workflow/WorkflowBreadcrumb";
import { WorkflowDetailPageInner } from "@/domain/workflow/WorkflowDetailPage";
import { LibraryBreadcrumbProvider } from "@stigmer/react";

export default function WorkflowLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkflowNavigationProvider>
      <LibraryBreadcrumbProvider>
        <WorkflowLayoutContent>{children}</WorkflowLayoutContent>
      </LibraryBreadcrumbProvider>
    </WorkflowNavigationProvider>
  );
}

function WorkflowLayoutContent({ children }: { children: React.ReactNode }) {
  const { activeDetail } = useWorkflowNavigation();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <WorkflowBreadcrumb />
      <div
        className={cn(activeDetail != null && "hidden")}
        aria-hidden={activeDetail != null}
      >
        {children}
      </div>
      {activeDetail != null && (
        <WorkflowDetailPageInner
          key={`${activeDetail.org}/${activeDetail.slug}`}
          org={activeDetail.org}
          slug={activeDetail.slug}
        />
      )}
    </div>
  );
}
