/**
 * The label a schedule stamps on every run it starts: the audit link from
 * a run to its schedule, how the credential resolver finds the schedule's
 * vaults (domain/vault/resolve.ts), and the run list index's `schedule`
 * key, which a fire reads to find the run an earlier attempt of the same
 * fire created (temporal/schedule/run-starter.ts). One constant, so the
 * three readers cannot drift.
 */
export const SCHEDULE_ID_LABEL_KEY = "stigmer.ai/schedule-id";
