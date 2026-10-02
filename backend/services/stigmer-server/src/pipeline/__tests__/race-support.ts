/**
 * Race helpers for the per-domain recover tests (stigmer#1672).
 *
 * A deferred holds a step mid-chain until the test releases it. A
 * signalling serializer reports each `run` call as it arrives, so a test
 * can tell a second recover that queued behind the first from one that
 * raced ahead to the engine, and release the first on whichever happens,
 * without waiting on a timer. Kept apart from `support.ts`, which most
 * server tests import, so these helpers reach only the tests that race.
 */
import { KeyedSerializer } from "../keyed-serializer.js";

/** A promise and the function that settles it. */
export interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

export function deferred(): Deferred {
  let resolve = (): void => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** A KeyedSerializer that calls `onRun` as each `run` call arrives. */
export class SignallingSerializer extends KeyedSerializer {
  constructor(private readonly onRun: (key: string) => void) {
    super();
  }

  override run<T>(key: string, work: () => Promise<T>): Promise<T> {
    this.onRun(key);
    return super.run(key, work);
  }
}
