"use client";

import {
  SessionViewer,
  useGitHubConnection,
  useGitHubTreeLister,
  useGitHubFileReader,
  useWorkspaceSources,
  useActiveOrgSlug,
  useActiveOrgId,
  ManageAccessButton,
} from "@stigmer/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";
import { ThreadSkeleton } from "@stigmer/react";

export default function SessionPage() {
  const id = useStaticRouteParam("id");
  if (!id) return <SessionSkeleton />;
  return <SessionPageInner id={id} />;
}

export function SessionPageInner({ id }: { id: string }) {
  const org = useActiveOrgSlug();
  const orgId = useActiveOrgId();
  const gitHubConnection = useGitHubConnection(org);
  const { enableGitHub, enableLocal } = useWorkspaceSources();
  const workspaceFileLister = useGitHubTreeLister(gitHubConnection.token);
  const workspaceFileReader = useGitHubFileReader(gitHubConnection.token);

  return (
    <div className="flex h-full w-full flex-col">
      <SessionViewer
        sessionId={id}
        org={org}
        gitHubConnection={enableGitHub ? gitHubConnection : undefined}
        enableGitHub={enableGitHub}
        enableLocal={enableLocal}
        workspaceFileLister={workspaceFileLister}
        workspaceFileReader={workspaceFileReader}
        headerActions={
          <ManageAccessButton
            resource={{
              kind: ApiResourceKind.session,
              kindString: "session",
              id,
              org: orgId,
            }}
          />
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local sub-components (loading states stay in client app for Link routing)
// ---------------------------------------------------------------------------

export function SessionSkeleton() {
  return (
    <div className="flex h-full w-full flex-col">
      <ThreadSkeleton className="flex-1 px-0" />
    </div>
  );
}
