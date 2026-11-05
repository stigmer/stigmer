/**
 * Whether a server may run every agent on one shared runner.
 *
 * With no sandbox driver composed, every run goes to the shared runner
 * queue (agentexecution/dispatch.ts) and one runner process serves them
 * all. That runner is one trust domain: every agent it runs starts as one
 * user, under one workspace root, and reaches Temporal directly. On an
 * install that holds one organization that is what the organization chose.
 * On one that may hold several, it puts one customer's agent beside
 * another's. The tenant boundary on a self-hosted install is a sandbox
 * driver: each sandboxed runner serves its own session and reaches
 * Temporal only through the server.
 *
 * `local-process` does not separate them either: it starts each session's
 * runner as the server's own user, with the server's own environment, so
 * it counts as no driver here. The drivers that isolate a session are
 * `docker`, `agent-sandbox` and `substrate`, and a composition's own.
 *
 * So the Enterprise edition, the self-hosted one that may hold several
 * organizations, boots with no isolating sandbox driver only when its organization
 * limit is 1 (a license with `maxOrgs: 1` is one trust domain, as open
 * source is) or its operator has said they accept the sharing
 * (STIGMER_SHARED_RUNNER_ACROSS_ORGANIZATIONS=accepted, Helm's
 * `runner.sharedAcrossOrganizations`), and then logs one warning naming
 * what is shared. Open source's own edition holds one organization. The
 * hosted edition is its own deployment's: its production composes a
 * sandbox driver, and its development stacks share a runner on purpose.
 */
import { ServerEdition } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";

export interface SharedRunnerFacts {
  readonly edition: ServerEdition;
  readonly orgLimit: number | undefined;
  readonly sandboxProvisionerType: string;
  readonly acknowledged: boolean;
}

/** `not-shared` boots as it is; `refused` stops the boot; `acknowledged` boots with the warning. */
export type SharedRunnerVerdict = "not-shared" | "refused" | "acknowledged";

/** The provisioner settings that start no session runner apart from the server: none, and `local-process`. */
const SHARING_PROVISIONERS: ReadonlySet<string> = new Set(["", "local-process"]);

export function sharedRunnerRefusal(facts: SharedRunnerFacts): SharedRunnerVerdict {
  const severalOrganizations = facts.edition === ServerEdition.enterprise && facts.orgLimit !== 1;
  if (!severalOrganizations || !SHARING_PROVISIONERS.has(facts.sandboxProvisionerType)) {
    return "not-shared";
  }
  return facts.acknowledged ? "acknowledged" : "refused";
}

export const SHARED_RUNNER_REFUSAL =
  "this Enterprise server may hold more than one organization and composes no sandbox driver that isolates a session, so every organization's agents would share one user, one workspace root and direct reach to Temporal: set SANDBOX_PROVISIONER_TYPE to docker, agent-sandbox or substrate, or set STIGMER_SHARED_RUNNER_ACROSS_ORGANIZATIONS=accepted to accept that sharing";

export const SHARED_RUNNER_WARNING =
  "every organization's agents share one runner user, one workspace root and direct reach to Temporal: no sandbox driver isolates a session (STIGMER_SHARED_RUNNER_ACROSS_ORGANIZATIONS=accepted)";
