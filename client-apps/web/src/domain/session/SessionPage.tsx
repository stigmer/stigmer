"use client";

import { useState } from "react";
import {
  SessionViewer,
  useGitHubConnection,
  useActiveOrgSlug,
  SharePanel,
  PermissionGate,
} from "@stigmer/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useDeploymentMode } from "@/domain/_shared/hooks/useDeploymentMode";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";
import { Button } from "@/domain/_shared/ui/button";
import { ThreadSkeleton } from "@stigmer/react";

export default function SessionPage() {
  const id = useStaticRouteParam("id");
  if (!id) return <SessionSkeleton />;
  return <SessionPageInner id={id} />;
}

export function SessionPageInner({ id }: { id: string }) {
  const org = useActiveOrgSlug();
  const deploymentMode = useDeploymentMode();
  const gitHubConnection = useGitHubConnection(org);

  return (
    <div className="flex h-full w-full flex-col pl-[220px]">
      <SessionViewer
        sessionId={id}
        org={org}
        gitHubConnection={gitHubConnection}
        enableGitHub
        enableLocal={deploymentMode === "local"}
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
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowSharePanel((v) => !v)}
        aria-label="Share session"
        aria-expanded={showSharePanel}
      >
        Share
      </Button>
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

// ---------------------------------------------------------------------------
// Local sub-components (loading states stay in client app for Link routing)
// ---------------------------------------------------------------------------

export function SessionSkeleton() {
  return (
    <div className="flex h-full w-full flex-col pl-[220px]">
      <ThreadSkeleton className="flex-1 px-0" />
    </div>
  );
}
