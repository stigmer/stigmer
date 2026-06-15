import { useParams } from "react-router-dom";
import {
  SessionViewer,
  useActiveOrgSlug,
  useActiveOrgId,
  useWorkspaceSources,
  ManageAccessButton,
  ThreadSkeleton,
} from "@stigmer/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useNativeFolderPicker } from "../hooks/useNativeFolderPicker";
import { useNativeWorkspaceFiles } from "../hooks/useNativeWorkspaceFiles";

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <SessionSkeleton />;
  return <SessionPageInner id={id} />;
}

function SessionPageInner({ id }: { id: string }) {
  const org = useActiveOrgSlug();
  const orgId = useActiveOrgId();
  const browseLocalFolder = useNativeFolderPicker();
  const { enableGitHub, enableLocal } = useWorkspaceSources({ hasLocalPicker: true });
  const workspaceFileLister = useNativeWorkspaceFiles();

  return (
    <div className="flex h-full w-full flex-col">
      <SessionViewer
        sessionId={id}
        org={org}
        enableGitHub={enableGitHub}
        enableLocal={enableLocal}
        onBrowseLocalFolder={browseLocalFolder}
        workspaceFileLister={workspaceFileLister}
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

function SessionSkeleton() {
  return (
    <div className="flex h-full w-full flex-col">
      <ThreadSkeleton className="flex-1 px-0" />
    </div>
  );
}
