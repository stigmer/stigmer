import { useParams } from "react-router-dom";
import { useState } from "react";
import {
  SessionViewer,
  useActiveOrgSlug,
  useWorkspaceSources,
  SharePanel,
  PermissionGate,
  ThreadSkeleton,
} from "@stigmer/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useNativeFolderPicker } from "../hooks/useNativeFolderPicker";

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <SessionSkeleton />;
  return <SessionPageInner id={id} />;
}

function SessionPageInner({ id }: { id: string }) {
  const org = useActiveOrgSlug();
  const browseLocalFolder = useNativeFolderPicker();
  const { enableGitHub, enableLocal } = useWorkspaceSources({ hasLocalPicker: true });

  return (
    <div className="flex h-full w-full flex-col">
      <SessionViewer
        sessionId={id}
        org={org}
        enableGitHub={enableGitHub}
        enableLocal={enableLocal}
        onBrowseLocalFolder={browseLocalFolder}
        headerActions={
          <ShareActions sessionId={id} />
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Share actions — kept in the client app (DD-004: no Console auth in SDK)
// ---------------------------------------------------------------------------

function ShareActions({ sessionId }: { sessionId: string }) {
  const [showSharePanel, setShowSharePanel] = useState(false);

  return (
    <PermissionGate resource={{ kind: "session", id: sessionId }} relation="can_grant_access">
      <button
        type="button"
        onClick={() => setShowSharePanel((v) => !v)}
        aria-label="Share session"
        aria-expanded={showSharePanel}
        className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent-hover"
      >
        Share
      </button>
      {showSharePanel && (
        <div className="absolute right-0 top-full mt-1 w-80 rounded-lg border border-border bg-popover shadow-lg">
          <SharePanel
            resource={{ kind: "session", id: sessionId, resourceKind: ApiResourceKind.session }}
            resourceKindString="session"
            resourceKind={ApiResourceKind.session}
            onClose={() => setShowSharePanel(false)}
          />
        </div>
      )}
    </PermissionGate>
  );
}

function SessionSkeleton() {
  return (
    <div className="flex h-full w-full flex-col">
      <ThreadSkeleton className="flex-1 px-0" />
    </div>
  );
}
