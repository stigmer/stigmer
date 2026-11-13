/**
 * A Stigmer that signs its callers in, made ready for a builder's token route
 * the way the console's "In your app" tab makes it ready: the built server's
 * shipped entry (one organization, made by the server) told to trust
 * test/support's hermetic issuer, its first person provisioned (the fresh
 * server's first caller becomes the organization's admin), then an admin
 * service account with a key, and account creation on sign-in turned on with
 * the Member role.
 *
 * `stigmer up` cannot stand in: it trusts every caller, and a server that
 * trusts every caller refuses to mint user tokens. No Temporal is started:
 * minting and reading who a token is need none.
 *
 * The person's calls go through the TypeScript client as the workspace builds
 * it (`sdk/typescript/dist`, from `npm run build:libs`).
 *
 * `nativeClientId` registers a client for installed apps with the server
 * (`STIGMER_OIDC_NATIVE_CLIENT_ID`), so its `getServerInfo` announces the
 * sign-in the desktop app and the CLI use; `issuer` is returned for a caller
 * that signs in through it.
 */
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { startLocalOidcIssuer } from "../../support/src/local-oidc-issuer.ts";
import { spawnServer } from "../../support/src/server-process.ts";
import { tsServerEntryPath } from "../../support/src/ts-build.ts";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const AUDIENCE = "https://handover.stigmer.test/api";
/** The admin service account's name, as the tab names it. */
export const BACKEND_NAME = "app-backend";

/**
 * Starts the server and readies it. `log` prints a step.
 * @param {{ log: (step: string) => void, nativeClientId?: string }} opts
 */
export async function startSignedInServer({ log, nativeClientId }) {
  const { createNodeClient } = await import(pathToFileURL(join(repoRoot, "sdk", "typescript", "dist", "node.js")).href);
  const issuer = await startLocalOidcIssuer({ audience: AUDIENCE });
  let server;
  try {
    server = await spawnServer(process.execPath, {
      args: [tsServerEntryPath()],
      env: {
        STIGMER_OIDC_ISSUER: issuer.issuer,
        STIGMER_OIDC_AUDIENCE: AUDIENCE,
        ...(nativeClientId === undefined ? {} : { STIGMER_OIDC_NATIVE_CLIENT_ID: nativeClientId }),
      },
    });
    log(`a server that signs its callers in is serving on ${server.baseUrl}`);
    const personToken = await issuer.mint({ sub: "handover|owner", email: "owner@handover.stigmer.test", ttlSeconds: 3600 });
    const person = createNodeClient({ baseUrl: server.baseUrl, getAccessToken: () => personToken });
    await person.identityAccount.provisionMyAccount();
    const orgs = await person.organization.listMine({});
    const org = orgs.entries[0];
    if (org?.metadata?.id === undefined) throw new Error("the signed-in server made no organization for its first person");
    const account = await person.identityAccount.createServiceAccount({ org: org.metadata.id, name: BACKEND_NAME, role: IamRole.admin });
    const key = await person.apiKey.createForServiceAccount({ serviceAccountId: account.metadata?.id ?? "", name: BACKEND_NAME, neverExpires: true });
    await person.organization.updateEmbedding({
      orgId: org.metadata.id,
      embedding: { createAccountsOnSignIn: true, signInRole: IamRole.member },
    });
    log(`organization ${org.metadata.slug}: ${BACKEND_NAME} made as an admin, accounts made on sign-in as Member`);
    return {
      baseUrl: server.baseUrl,
      issuer,
      orgSlug: org.metadata.slug,
      apiKey: key.spec?.keyHash ?? "",
      /** How the server provisioned the account a token names (4 is an app user). */
      async provisioningModeOf(token) {
        const client = createNodeClient({ baseUrl: server.baseUrl, getAccessToken: () => token });
        const me = await client.identityAccount.whoAmI();
        return me.spec?.provisioningMode;
      },
      logTail: () => server.logTail(),
      async stop() {
        await server.stop();
        await issuer.close();
      },
    };
  } catch (error) {
    await server?.stop();
    await issuer.close();
    throw error;
  }
}
