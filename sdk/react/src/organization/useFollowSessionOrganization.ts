"use client";

/**
 * useFollowSessionOrganization: a session page's shell follows the session
 * into its own organization (stigmer/stigmer#1580).
 *
 * Session URLs name no organization, so a link can open a conversation
 * that belongs to an organization other than the active one. The session
 * surface already acts in the session's organization (SessionViewer reads
 * `session.metadata.org`); this hook makes the rest of the shell agree
 * with it: when the loaded session's organization is one of the person's
 * and is not the active one, it becomes the active one, so the
 * organization menu, the sidebar and every host control keyed on the
 * active organization name the conversation's.
 *
 * It aligns once per visit to a conversation, when that session and the
 * organization list have both loaded. A choice the person makes while the
 * conversation stays open stands, so the hook never fights the
 * organization menu; opening a conversation again is a new visit, and it
 * follows that conversation again, as a link to it would. A session in an organization
 * the person does not belong to (a guest's view of a share) switches
 * nothing. The switch goes through OrgProvider's `setActiveOrg`, the
 * programmatic path: it persists the choice and clears the fetch cache
 * like any switch, and it fires no host `onOrgChanged` navigation.
 */
import { useEffect, useRef } from "react";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";

import { useOrg } from "./OrgProvider.js";

/**
 * Makes the loaded session's organization the active one, once per visit
 * to the conversation, when the person belongs to it.
 *
 * @param session - The session the page shows, or null while it loads.
 */
export function useFollowSessionOrganization(session: Session | null): void {
  const { orgs, activeOrg, setActiveOrg, isLoading } = useOrg();
  const followedSessionRef = useRef<string | null>(null);

  const sessionId = session?.metadata?.id ?? "";
  const sessionOrg = session?.metadata?.org ?? "";
  const activeSlug = activeOrg?.metadata?.slug ?? "";

  useEffect(() => {
    if (sessionId === "" || sessionOrg === "" || isLoading || activeSlug === "")
      return;
    if (followedSessionRef.current === sessionId) return;
    followedSessionRef.current = sessionId;
    if (sessionOrg === activeSlug) return;
    const target = orgs.find((org) => org.metadata?.slug === sessionOrg);
    if (target !== undefined) setActiveOrg(target);
  }, [sessionId, sessionOrg, activeSlug, isLoading, orgs, setActiveOrg]);
}
