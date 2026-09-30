/**
 * Whether this run is a test gate: `STIGMER_TEST_GATE=1`, set by the CI lanes
 * and the local gates. A gate provides every dependency a suite needs, so a
 * suite that would skip because a dependency is missing (the Temporal test
 * server cannot boot, say) fails there instead. Outside a gate the same suite
 * skips by name with its reason.
 */
export const IN_TEST_GATE = process.env.STIGMER_TEST_GATE === "1";
