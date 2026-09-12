// Local Postgres targets: the OSS server on the Postgres Store driver
// (Phase-2 P2, DD-010/DD-011). Domain: conformance targets.
//
// Both classes are their sqlite-backed parents with EXACTLY ONE
// difference: the storage seam provisions a throwaway Postgres database
// (its DATABASE_URL selects the driver). Inheritance is the point — the
// capability matrices and every provisioning behavior are the parent's own
// objects, so "byte-identical matrix" (DD-011's wire-invisibility
// requirement) holds by construction and can never drift.
//
// Every spawned server — the primary and any sibling — gets its own
// database created from CONFORMANCE_POSTGRES_URL (harness/postgres.ts) and
// dropped when that server stops: the same per-server isolation the sqlite
// targets get from temp DB_PATH files. The env var being unset fails setup
// loudly (never a silent sqlite pass).
import { provisionPostgresStorage } from "../harness/postgres";
import type { ProvisionedStorage } from "../harness/server-process";
import { LocalTarget } from "./local";
import { LocalExecutionTarget } from "./local-execution";

export class LocalPostgresTarget extends LocalTarget {
  override readonly name: string = "local-postgres";

  protected override provisionStorage(): Promise<ProvisionedStorage> {
    return provisionPostgresStorage();
  }
}

export class LocalPostgresExecutionTarget extends LocalExecutionTarget {
  override readonly name: string = "local-postgres-execution";

  protected override provisionStorage(): Promise<ProvisionedStorage> {
    return provisionPostgresStorage();
  }
}
