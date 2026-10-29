import { useParams } from "react-router-dom";
import {
  SessionInspector,
  useOrgSlugForId,
  SessionViewer,
  useAccountExecutionDefaults,
  useActiveOrgId,
  useFollowSessionOrganization,
  useSession,
  useWorkspaceSources,
  useDeploymentMode,
  ManageAccessButton,
  ThreadSkeleton,
} from "@stigmer/react-sdk";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
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
  // A link can open a conversation from an organization other than the
  // active one: the shell follows it there, so the org menu, the sidebar,
  // the share dialog and the viewer all name the conversation's organization
  // (stigmer/stigmer#1580).
  const { session } = useSession(id);
  useFollowSessionOrganization(session);
  const orgId = useActiveOrgId();
  const browseLocalFolder = useNativeFolderPicker();
  const { enableGitHub, enableLocal } = useWorkspaceSources({ hasLocalPicker: true });
  const workspaceFileLister = useNativeWorkspaceFiles();
  const workspaceFileReader = useNativeWorkspaceFileReader();
  const workspaceContentSearcher = useNativeWorkspaceContentSearcher();
  // Seeds session-scoped auto-approve from the account's
  // default_auto_approve preference (same seam as the launcher's seed;
  // served in every edition, the operator account included).
  const accountDefaults = useAccountExecutionDefaults();
  const slugForOrg = useOrgSlugForId();
  const deploymentMode = useDeploymentMode();

  return (
    <div className="flex h-full w-full flex-col">
      <SessionViewer
        sessionId={id}
        org={orgId}
        accountDefaults={accountDefaults}
        enableGitHub={enableGitHub}
        enableLocal={enableLocal}
        onBrowseLocalFolder={browseLocalFolder}
        inspector={
          <SessionInspector
            workspaceFileLister={workspaceFileLister}
            workspaceFileReader={workspaceFileReader}
            workspaceContentSearcher={workspaceContentSearcher}
          />
        }
        modelsHubHref="#/models"
        routineHref={(routine) =>
          `#/library/routines/${slugForOrg(routine.metadata?.org ?? "")}/${routine.metadata?.slug ?? ""}`
        }
        // The open-source edition shares a session with no one (its grants
        // are on organizations only), so it offers no Manage access.
        accessSlot={
          deploymentMode === "local" ? undefined : (
            <ManageAccessButton
              resource={{
                kind: ApiResourceKind.session,
                kindString: "session",
                id,
                org: orgId,
              }}
            />
          )
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
