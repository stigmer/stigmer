"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  SessionInspector,
  NewSessionViewer,
  useAccountExecutionDefaults,
  useGitHubConnection,
  useGitHubTreeLister,
  useGitHubFileReader,
  useWorkspaceSources,
  useActiveOrgId,
  useOrg,
  useLinkedLaunch,
  providerKeyRequired,
} from "@stigmer/react-sdk";
import type { ResourceRef } from "@stigmer/client";
import { useSessionNavigation } from "@/domain/session/session-navigation";
import { useJourneyLinks } from "@/domain/journey/journey-links";
import { JoinedWelcome } from "@/domain/session/JoinedWelcome";
import { forgetJoinedOrg, readJoinedOrg, subscribeJoinedOrg } from "@/domain/session/joined-org";

/**
 * Console-specific session launcher — thin shell that composes the SDK
 * `NewSessionViewer` with Console routing, org context, the
 * `?agent=org/slug` URL parameter a "Start session" action arrives with,
 * the `?plugin=org/slug` one a plugin's "Start a chat" arrives with, and
 * the `?agent=…&example=…&with=sample|own` launch the agent page's "Make it
 * yours" tab arrives with (a fresh composer on each arrival). The person's
 * plugin picks are remembered in this browser for the next conversation.
 *
 * A teammate who has just joined through an invite link is welcomed above
 * the heading, in the organization they joined, with the team's agents to
 * start from (`JoinedWelcome`, stigmer#3208). The invite page leaves the
 * joined organization in this tab's storage (`joined-org.ts`), so a new tab
 * or a later visit greets no more. The welcome is forgotten once a
 * conversation starts, and stands aside while a link sends the person to
 * an agent, a plugin or a launch (one of its own agent links included).
 */
export function SessionLauncher() {
  const rawSearchParams = useSearchParams();
  const org = useActiveOrgId();
  const accountDefaults = useAccountExecutionDefaults();
  const gitHubConnection = useGitHubConnection(org);
  const { enableGitHub, enableLocal } = useWorkspaceSources();
  const workspaceFileLister = useGitHubTreeLister(gitHubConnection.readOrg);
  const workspaceFileReader = useGitHubFileReader(gitHubConnection.readOrg);
  const { navigateToSession } = useSessionNavigation();
  const { activeOrg } = useOrg();
  const joinedOrg = useSyncExternalStore(subscribeJoinedOrg, readJoinedOrg, noJoinedOrg);

  // -------------------------------------------------------------------------
  // Explicit agent capture ("Start session" from an agent). Captured once so
  // the URL can be cleaned without losing intent.
  // -------------------------------------------------------------------------

  const liveAgentParam = rawSearchParams.get("agent");
  const livePluginParam = rawSearchParams.get("plugin");
  const liveWithParam = rawSearchParams.get("with");
  // A launch (`with=`) is read on every arrival, never as "Start session".
  const launch = useLinkedLaunch({ agent: liveAgentParam, example: rawSearchParams.get("example"), with: liveWithParam });
  const journeyLinks = useJourneyLinks();

  const [initialAgentRef, setInitialAgentRef] = useState<ResourceRef | undefined>(
    () => (liveWithParam ? undefined : parseRefParam(liveAgentParam)),
  );
  const [initialPluginRef, setInitialPluginRef] = useState<ResourceRef | undefined>(
    () => parseRefParam(livePluginParam),
  );

  if (initialAgentRef === undefined && liveAgentParam && !liveWithParam) {
    setInitialAgentRef(parseRefParam(liveAgentParam));
  }
  if (initialPluginRef === undefined && livePluginParam) {
    setInitialPluginRef(parseRefParam(livePluginParam));
  }

  useEffect(() => {
    if (liveAgentParam || livePluginParam) {
      window.history.replaceState({}, "", "/");
    }
  }, [liveAgentParam, livePluginParam]);

  const handleSessionCreated = useCallback(
    (sessionId: string) => {
      forgetJoinedOrg();
      navigateToSession(sessionId);
    },
    [navigateToSession],
  );
  const welcomesJoined =
    joinedOrg !== null &&
    joinedOrg === org &&
    initialAgentRef === undefined &&
    initialPluginRef === undefined &&
    launch === undefined;
  const joinedName = activeOrg?.metadata?.name || activeOrg?.metadata?.slug || "";

  return (
    <NewSessionViewer
      org={org}
      onSessionCreated={handleSessionCreated}
      headerContent={welcomesJoined ? <JoinedWelcome org={org} orgName={joinedName} /> : undefined}
      // A refusal for want of a provider shows once, as the launcher's own
      // notice linking Models & providers, never also as a toast.
      onError={(msg, error) => {
        if (providerKeyRequired(error) === null) toast.error(msg);
      }}
      accountDefaults={accountDefaults}
      gitHubConnection={enableGitHub ? gitHubConnection : undefined}
      enableGitHub={enableGitHub}
      enableLocal={enableLocal}
      inspector={<SessionInspector workspaceFileLister={workspaceFileLister} workspaceFileReader={workspaceFileReader} />}
      initialAgentRef={initialAgentRef}
      initialPluginRefs={initialPluginRef ? [initialPluginRef] : undefined}
      launch={launch}
      journeyLinks={journeyLinks}
      rememberPluginPicks
      // A newcomer's first visit asks what their agent should do for their
      // users; a deep link to an agent (initialAgentRef) still wins.
      firstQuestion
      className="h-full"
    />
  );
}

/**
 * Parse an `agent` or `plugin` query param of the form `org/slug` into a
 * {@link ResourceRef}. Returns `undefined` when absent or malformed.
 */
function parseRefParam(value: string | null): ResourceRef | undefined {
  if (!value) return undefined;
  const slashIndex = value.indexOf("/");
  if (slashIndex <= 0 || slashIndex === value.length - 1) return undefined;
  return {
    org: value.slice(0, slashIndex),
    slug: value.slice(slashIndex + 1),
  };
}

/** The server has no tab storage, so no organization joined. */
function noJoinedOrg(): null {
  return null;
}
