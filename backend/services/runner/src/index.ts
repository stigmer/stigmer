/**
 * @stigmer/runner — public API.
 *
 * @example
 * ```ts
 * import { createStigmerRunner } from '@stigmer/runner';
 *
 * const runner = await createStigmerRunner({
 *   taskQueue: 'session:abc-123',
 *   temporalAddress: 'localhost:7233',
 *   stigmerEndpoint: 'http://localhost:7234',
 * });
 *
 * process.on('SIGTERM', () => runner.shutdown());
 * await runner.start();
 * ```
 */

export { createStigmerRunner } from "./runner.js";
export type { StigmerRunnerOptions, StigmerRunner } from "./runner.js";
