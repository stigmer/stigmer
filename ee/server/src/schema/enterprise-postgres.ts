/**
 * The identity unit's Postgres half as a host builds it: the four store
 * adapters and the schema chain's ensure, all over the one pool the host
 * hands in. The unit itself constructs no store and reads no
 * configuration (extension/enterprise-identity.ts); a host calls this once
 * and passes what it returns as the unit's ports, so every host, a
 * self-hosted Enterprise server included, builds the same adapters the
 * same way.
 *
 * `schema.ensure` runs the Enterprise chain (schema/enterprise-migrations.ts)
 * on a dedicated client, which its session advisory lock needs, and
 * releases the client whatever happens.
 */
import type { Pool } from "pg";

import { newSignInGrantLedger } from "../iam/federation/postgres-sign-in-grants.js";
import type { SignInGrantLedger } from "../iam/federation/sign-in-grants.js";
import { newInvitationStore } from "../iam/invitation/postgres-store.js";
import type { InvitationStore } from "../iam/invitation/store.js";
import { newIdentityProviderStore } from "../iam/provider/postgres-store.js";
import type { IdentityProviderStore } from "../iam/provider/store.js";
import { newTeamStore } from "../iam/team/postgres-store.js";
import type { TeamStore } from "../iam/team/store.js";
import { runEnterpriseMigrations } from "./enterprise-migrations.js";

/** The unit's schema, made current before anything reads it. */
export interface EnterpriseSchema {
  ensure(): Promise<void>;
}

export interface EnterprisePostgres {
  readonly providers: IdentityProviderStore;
  readonly teams: TeamStore;
  readonly invitations: InvitationStore;
  readonly signInGrants: SignInGrantLedger;
  readonly schema: EnterpriseSchema;
}

export function newEnterprisePostgres(pool: Pool): EnterprisePostgres {
  return {
    providers: newIdentityProviderStore(pool),
    teams: newTeamStore(pool),
    invitations: newInvitationStore(pool),
    signInGrants: newSignInGrantLedger(pool),
    schema: {
      async ensure(): Promise<void> {
        const client = await pool.connect();
        try {
          await runEnterpriseMigrations(client);
        } finally {
          client.release();
        }
      },
    },
  };
}
