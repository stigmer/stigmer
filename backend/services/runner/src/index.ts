/**
 * @stigmer/runner — public API.
 *
 * Two modes of operation:
 *
 * 1. Static (CLI, single-queue polling):
 *    {@link createStigmerRunner} — one Worker, one task queue, blocks until shutdown.
 *
 * 2. Dynamic (desktop, multi-session):
 *    {@link createStigmerRunnerManager} — shared Temporal connection, per-session Workers.
 *
 * @example Static mode
 * ```ts
 * import { createStigmerRunner } from '@stigmer/runner';
 *
 * const runner = await createStigmerRunner({
 *   taskQueue: 'agent_execution_runner',
 *   temporalAddress: 'localhost:7233',
 *   stigmerEndpoint: 'http://localhost:7234',
 * });
 *
 * process.on('SIGTERM', () => runner.shutdown());
 * await runner.start();
 * ```
 *
 * @example Dynamic mode
 * ```ts
 * import { createStigmerRunnerManager } from '@stigmer/runner';
 *
 * const manager = await createStigmerRunnerManager({
 *   temporalAddress: 'localhost:7233',
 *   stigmerEndpoint: 'http://localhost:7234',
 * });
 *
 * await manager.addSession('ses_abc123');
 * // ... later
 * await manager.shutdown();
 * ```
 */

export { createStigmerRunner } from "./runner.js";
export type { StigmerRunnerOptions, StigmerRunner } from "./runner.js";

export { createStigmerRunnerManager } from "./runner-manager.js";
export type {
  RunnerManagerOptions,
  StigmerRunnerManager,
} from "./runner-manager.js";
