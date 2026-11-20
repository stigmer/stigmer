/**
 * The shared runner starts signed in (STIGMER_RUNNER_API_KEY): on a server
 * that holds one organization with sign-in on, boot makes sure the key the
 * operator generated is a working API key of the organization's `runner`
 * service account, so the runner beside the server (Compose's
 * `stigmer-runner`, the Kubernetes operator's runner container), handed the
 * same key as `STIGMER_TOKEN`, authenticates on its first call. Before this,
 * a person signed in, created a key in the console, put it in the runner's
 * settings and restarted it.
 *
 * Why a service account, and why admin: the key it replaces was the
 * operator's own, a person's key. A service account's key is bound to the
 * organization and speaks for no person (domain/identityaccount/
 * service-accounts.ts). The runner's one call on its own key is reading a
 * plugin while it lists an agent's tools (runner/src/activities/
 * list-plugin-tools.ts), and a private plugin is visible to its owner and
 * the organization's admins (fga/model/agentic/plugin.fga), so a member
 * would lose the tools of a plugin another member installed. Every other
 * call of a run carries the run's own credential.
 *
 * What it does, every boot, after the organization and its roles exist:
 *   - finds the organization's service account named `runner`, or creates
 *     it with the admin role (an admin who changed its role later keeps
 *     that choice);
 *   - when one of that account's keys already has the key's hash, nothing
 *     more: this is its idempotency;
 *   - otherwise deletes the account's keys named `runner` (the key was
 *     replaced, so the old one must stop working) and stores the new one,
 *     never expiring, through the key's ordinary create chain run as the
 *     account (domain/apikey/controller.ts, newServiceAccountKeyProvisioner).
 *
 * The key is still an API key (the runner stays inside the server's trust
 * domain, as boot/shared-runner.ts explains). A key whose hash another
 * account's key holds is a boot error: the operator reused a key.
 */
import { create } from "@bufbuild/protobuf";

import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { CreateServiceAccountInputSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/io_pb";
import type { CreateServiceAccountInput } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/io_pb";

import type { ServiceAccountKeyProvisioner } from "../domain/apikey/controller.js";
import { hashApiKey } from "../domain/apikey/keymaterial.js";
import { findApiKeyByHash } from "../domain/apikey/lookup.js";
import { keysOwnedBy, ownerOfKey } from "../domain/apikey/queries.js";
import { isServiceAccount } from "../domain/identityaccount/actor.js";
import type { IdentityAccountStore } from "../domain/identityaccount/store.js";
import type { Store } from "../store/interface.js";
import type { Logger } from "./logger.js";

/** The service account's name, and its key's name. */
export const RUNNER_SERVICE_ACCOUNT_NAME = "runner";

/** The in-process edges the step creates and deletes through (boot/inprocess.ts). */
export interface RunnerKeyEdges {
  createServiceAccount(input: CreateServiceAccountInput): Promise<IdentityAccount>;
  deleteApiKey(id: string): Promise<void>;
}

export interface RunnerKeyBootDeps {
  readonly plaintext: string;
  readonly org: string;
  readonly store: Store;
  readonly accounts: Pick<IdentityAccountStore, "findByOrg">;
  readonly edges: RunnerKeyEdges;
  readonly provisioner: ServiceAccountKeyProvisioner;
  readonly logger: Logger;
}

/** What the step did, for its log line and its tests. */
export type RunnerKeyOutcome = "in place" | "provisioned" | "replaced";

export async function ensureRunnerKey(deps: RunnerKeyBootDeps): Promise<RunnerKeyOutcome> {
  const hash = hashApiKey(deps.plaintext);
  const account = await runnerAccount(deps);
  const accountId = account.metadata?.id ?? "";
  const holder = await findApiKeyByHash(deps.store, hash);
  if (holder !== undefined) {
    if (ownerOfKey(holder) === accountId) {
      deps.logger.info("the shared runner's key is in place", { serviceAccountId: accountId });
      return "in place";
    }
    throw new Error(
      "STIGMER_RUNNER_API_KEY is already the key of another account: generate a new key for the runner (one stk_ value used only by it) and start the server again",
    );
  }
  const old = (await keysOwnedBy(deps.store, [accountId])).filter(
    (key) => key.metadata?.name === RUNNER_SERVICE_ACCOUNT_NAME,
  );
  for (const key of old) {
    await deps.edges.deleteApiKey(key.metadata?.id ?? "");
  }
  await deps.provisioner.provision({
    account,
    name: RUNNER_SERVICE_ACCOUNT_NAME,
    plaintext: deps.plaintext,
  });
  const outcome: RunnerKeyOutcome = old.length > 0 ? "replaced" : "provisioned";
  deps.logger.info(
    outcome === "replaced"
      ? "the shared runner's key changed: the old key is deleted and the new one stored"
      : "the shared runner's key is stored; the runner signs in with it",
    { serviceAccountId: accountId, org: deps.org },
  );
  return outcome;
}

async function runnerAccount(deps: RunnerKeyBootDeps): Promise<IdentityAccount> {
  const existing = (await deps.accounts.findByOrg(deps.org)).find(
    (account) =>
      isServiceAccount(account) && account.metadata?.name === RUNNER_SERVICE_ACCOUNT_NAME,
  );
  if (existing !== undefined) {
    return existing;
  }
  return deps.edges.createServiceAccount(
    create(CreateServiceAccountInputSchema, {
      org: deps.org,
      name: RUNNER_SERVICE_ACCOUNT_NAME,
      role: IamRole.admin,
    }),
  );
}
