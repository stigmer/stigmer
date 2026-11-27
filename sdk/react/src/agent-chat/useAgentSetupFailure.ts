// The classified cause of a pinned chat's setup failure (./setup-error.ts):
// when the agent the chat is pinned to cannot be set up, reads what the
// classification needs besides the failure (whether the organization the
// chat names is one of the account's own, whether the account is an app
// user), then gives the classified error. Those reads run only once a
// failure arrives, so a chat that starts pays nothing for them. With no
// client in reach (a launcher drawn outside the provider, as some tests
// draw it), the failure is classified by itself alone.

import { useContext, useEffect, useState } from "react";
import { StigmerContext } from "@stigmer/react-core";
import { isAppUser } from "../agent/appUser.js";
import { lookUpOrganization } from "../agent/usePersonalKeys.js";
import { useKnownOrgs } from "../organization/OrgProvider.js";
import { classifyAgentSetupFailure, type AgentChatSetupError } from "./setup-error.js";

/**
 * `failure` classified by its cause, or `null` while there is none or while
 * the classification's reads are in flight.
 *
 * @internal
 */
export function useAgentSetupFailure(failure: Error | null, org: string, agent: string): AgentChatSetupError | null {
  const stigmer = useContext(StigmerContext);
  const knownOrgs = useKnownOrgs();
  const [classified, setClassified] = useState<{ of: Error; error: AgentChatSetupError } | null>(null);

  useEffect(() => {
    if (failure === null) return;
    let current = true;
    const reads =
      stigmer === null
        ? Promise.resolve([{ mine: null }, false] as const)
        : Promise.all([lookUpOrganization(stigmer, org, knownOrgs), isAppUser(stigmer)]);
    void reads.then(([organization, appUser]) => {
      if (!current) return;
      setClassified({ of: failure, error: classifyAgentSetupFailure(failure, { org, agent, orgIsMine: organization.mine, appUser }) });
    });
    return () => {
      current = false;
    };
  }, [failure, org, agent, stigmer, knownOrgs]);

  return failure !== null && classified?.of === failure ? classified.error : null;
}
