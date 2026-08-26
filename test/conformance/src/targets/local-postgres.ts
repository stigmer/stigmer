// Local Postgres targets: the OSS server on the Postgres Store driver
// (Phase-2 P2, DD-010/DD-011). Domain: conformance targets.
//
// Both classes are their sqlite-backed parents with EXACTLY ONE
// difference: the spawned server gets a DATABASE_URL, selecting the
// Postgres driver. Inheritance is the point — the capability matrices and
// every provisioning behavior are the parent's own objects, so
// "byte-identical matrix" (DD-011's wire-invisibility requirement) holds
// by construction and can never drift.
//
// Each spawned server gets a throwaway database created from
// CONFORMANCE_POSTGRES_URL (harness/postgres.ts) and dropped on teardown —
// the same per-file isolation the sqlite targets get from temp DB_PATH
// files. The env var being unset fails setup loudly (never a silent
// sqlite pass).
import {
  provisionPostgresDatabase,
  type ProvisionedPostgresDatabase,
} from "../harness/postgres";
import { LocalTarget } from "./local";
import { LocalExecutionTarget } from "./local-execution";

export class LocalPostgresTarget extends LocalTarget {
  override readonly name: string = "local-postgres";

  private database: ProvisionedPostgresDatabase | undefined;

  override async setup(): Promise<void> {
    this.database = await provisionPostgresDatabase();
    await super.setup();
  }

  protected override extraServerEnv(): Record<string, string> {
    if (this.database === undefined) {
      throw new Error("LocalPostgresTarget: database not provisioned before spawn");
    }
    return { DATABASE_URL: this.database.databaseUrl };
  }

  override async teardown(): Promise<void> {
    await super.teardown();
    await this.database?.drop();
    this.database = undefined;
  }
}

export class LocalPostgresExecutionTarget extends LocalExecutionTarget {
  override readonly name: string = "local-postgres-execution";

  private database: ProvisionedPostgresDatabase | undefined;

  override async setup(): Promise<void> {
    this.database = await provisionPostgresDatabase();
    await super.setup();
  }

  protected override extraServerEnv(): Record<string, string> {
    if (this.database === undefined) {
      throw new Error(
        "LocalPostgresExecutionTarget: database not provisioned before spawn",
      );
    }
    return { DATABASE_URL: this.database.databaseUrl };
  }

  override async teardown(): Promise<void> {
    await super.teardown();
    await this.database?.drop();
    this.database = undefined;
  }
}
