/**
 * The one data step both store drivers run when a run's values stop being
 * copied: every row of the retired execution context kind leaves the
 * store, and the connect attempt table is created. The drivers own the SQL
 * (the statements, the transaction); this module owns what is edition- and
 * driver-neutral: which kind goes and why nothing is carried. It follows
 * environment-retired.ts, its line's latest.
 *
 * What leaves. Every `execution_context` row leaves every table that keys a
 * row by kind (run-rename.ts `RUN_KIND_TABLES`): the live rows (a sealed
 * copy of the values one run or one tool connect used, which a stopped or
 * failed run left behind), their history, their list keys and the names
 * they held. A key does not outlive the field that held it: nothing is
 * carried, because a run's values are now fetched from their vaults when
 * its work starts (domain/vault/resolve.ts), and a run recovered after the
 * upgrade plans its values again. Search entries of the removed rows are
 * boot's rebuild's to drop, which re-indexes only the registered kinds.
 * The kind's owner tuples were derived from the rows themselves, so no
 * grant row names one. The sealed values of a removed row are not destroyed
 * one by one: the built-in codec keeps nothing outside the row, and a codec
 * that does keeps it under the organization's keys, which the
 * organization's purge destroys.
 *
 * What arrives. `connect_attempt`, one non-secret row per tool connect in
 * flight: the binding of the runner credential the connect mints (who
 * started it, in which organization, for which tool, and, for the runner's
 * backfill, which run's planned values it uses), deleted when the connect
 * settles and swept once expired (domain/mcpserver/connect-attempt.ts).
 */

/** The `kind` column value of the rows the step deletes. */
export const RETIRED_EXECUTION_CONTEXT_KIND = "execution_context";
