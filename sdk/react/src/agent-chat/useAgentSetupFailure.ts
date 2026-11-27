// The classified cause of a pinned chat's setup failure (./setup-error.ts):
// when the agent the chat is pinned to cannot be set up, reads what the
// classification needs besides the failure (whether the organization the
// chat names is one of the account's own, whether the account is an app
// user), then gives the classified error. Those reads run only once a
// failure arrives, so a chat that starts pays nothing for them. With no
// client in reach (a launcher drawn outside the provider, as some tests
// draw it), the failure is classified by itself alone.
//
// One classification per failure: the host's onError hears each failure
// once (NewSessionViewer), so a mounted organization provider that reloads
// or switches organizations never re-classifies a failure already
// classified. While that provider's list is still loading, the
// classification waits for it; a list that failed to load counts as
// unread.

import { useContext, useEffect, useRef, useState } from "react";
import { StigmerContext } from "@stigmer/react-core";
import { isAppUser } from "../agent/appUser.js";
import { lookUpOrganization } from "../agent/usePersonalKeys.js";
import { useKnownOrgs, useOptionalOrg } from "../organization/OrgProvider.js";
import { classifyAgentSetupFailure, type AgentChatSetupError } from "./setup-error.js";

/**
 * `failure` classified by its cause, or `null` while there is none or while
 * the classification's reads are in flight.
 *
 * @internal
 */
export function useAgentSetupFailure(failure: Error | null, org: string, agent: string): AgentChatSetupError | null {
  const stigmer = useContext(StigmerContext);
  const orgContext = useOptionalOrg();
  const knownOrgs = useKnownOrgs();
  const listSettled = orgContext === null || !orgContext.isLoading;
  // undefined: no provider (look the organization up); null: the provider's
  // list could not be read; otherwise the provider's organizations.
  const known = orgContext === null ? undefined : orgContext.error !== null ? null : (knownOrgs ?? null);
  const knownRef = useRef(known);
  knownRef.current = known;
  const startedFor = useRef<Error | null>(null);
  const [classified, setClassified] = useState<{ of: Error; error: AgentChatSetupError } | null>(null);

  useEffect(() => {
    if (failure === null || !listSettled || startedFor.current === failure) return;
    startedFor.current = failure;
    const reads =
      stigmer === null
        ? Promise.resolve([{ mine: null }, false] as const)
        : Promise.all([lookUpOrganization(stigmer, org, knownRef.current), isAppUser(stigmer)]);
    void reads.then(([organization, appUser]) => {
      if (startedFor.current !== failure) return;
      setClassified({ of: failure, error: classifyAgentSetupFailure(failure, { org, agent, orgIsMine: organization.mine, appUser }) });
    });
  }, [failure, org, agent, stigmer, listSettled]);

  return failure !== null && classified?.of === failure ? classified.error : null;
}
