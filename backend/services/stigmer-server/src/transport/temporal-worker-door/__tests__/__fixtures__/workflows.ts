/**
 * Workflows the worker-door suite runs on its test Temporal: a turn that
 * schedules one activity on a sandbox's own queue, the shape of the
 * server's invoke workflow and its runner activity, and a workflow that
 * only waits, for the calls that would end or signal another sandbox's run.
 * They run inside the workflow sandbox: Temporal's workflow APIs only.
 */
import {
  ActivityCancellationType,
  CancellationScope,
  condition,
  defineSignal,
  isCancellation,
  proxyActivities,
  setHandler,
  sleep,
} from "@temporalio/workflow";

/** One turn: the activity on `queue`, with a heartbeat bound so a pause reaches it. */
export async function turn(queue: string, input: string): Promise<string> {
  const { Turn } = proxyActivities<{ Turn(input: string): Promise<string> }>({
    taskQueue: queue,
    startToCloseTimeout: "60s",
    heartbeatTimeout: "10s",
    retry: { maximumAttempts: 1 },
  });
  return Turn(input);
}

export const poke = defineSignal("poke");

/** Waits for `poke`, or until it is ended from outside. */
export async function waiting(): Promise<string> {
  let poked = false;
  setHandler(poke, () => {
    poked = true;
  });
  await condition(() => poked);
  return "poked";
}

/** A turn ended from outside: the activity is cancelled after it has started heartbeating. */
export async function cancelledTurn(queue: string): Promise<string> {
  const { Turn } = proxyActivities<{ Turn(input: string): Promise<string> }>({
    taskQueue: queue,
    startToCloseTimeout: "60s",
    heartbeatTimeout: "10s",
    cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
    retry: { maximumAttempts: 1 },
  });
  try {
    await CancellationScope.cancellable(async () => {
      const turn = Turn("long");
      await sleep(1_500);
      CancellationScope.current().cancel();
      await turn;
    });
    return "not cancelled";
  } catch (error) {
    return isCancellation(error) ? "cancelled" : `failed: ${String(error)}`;
  }
}
