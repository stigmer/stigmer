import { useParams } from "react-router-dom";
import {
  SessionViewer,
  useAccountExecutionDefaults,
  useActiveOrgSlug,
  useActiveOrgId,
  useWorkspaceSources,
  ManageAccessButton,
  ThreadSkeleton,
} from "@stigmer/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useNativeFolderPicker } from "../hooks/useNativeFolderPicker";
import { useNativeWorkspaceFiles } from "../hooks/useNativeWorkspaceFiles";
import { useNativeWorkspaceFileReader } from "../hooks/useNativeWorkspaceFileReader";
import { useNativeWorkspaceContentSearcher } from "../hooks/useNativeWorkspaceContentSearcher";

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
  const workspaceFileReader = useNativeWorkspaceFileReader();
  const workspaceContentSearcher = useNativeWorkspaceContentSearcher();
  // Seeds session-scoped auto-approve from the account's
  // default_auto_approve preference (same seam as the launcher's seed;
  // no-op in pure-local mode where IdentityAccount is unavailable).
  const accountDefaults = useAccountExecutionDefaults();

  return (
    <div className="flex h-full w-full flex-col">
      <SessionViewer
        sessionId={id}
        org={org}
        accountDefaults={accountDefaults}
        enableGitHub={enableGitHub}
        enableLocal={enableLocal}
        onBrowseLocalFolder={browseLocalFolder}
        workspaceFileLister={workspaceFileLister}
        workspaceFileReader={workspaceFileReader}
        workspaceContentSearcher={workspaceContentSearcher}
        accessSlot={
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
