/**
 * The label a routine stamps on every run it starts: the audit link from
 * a run to its routine, the lane the run's settings are resolved under
 * (domain/run/resolve-run-config.ts), how the credential resolver finds the
 * routine's vaults (domain/vault/resolve.ts), and the run list index's
 * `routine` key, which a schedule fire reads to find the run an earlier
 * attempt of the same fire created (temporal/routine/run-starter.ts). One
 * constant, so its readers cannot drift. Runs a schedule started carried
 * `stigmer.ai/schedule-id`; the store step that renamed the kind moved
 * them (store/schedules-become-routines.ts).
 */
export const ROUTINE_ID_LABEL_KEY = "stigmer.ai/routine-id";
