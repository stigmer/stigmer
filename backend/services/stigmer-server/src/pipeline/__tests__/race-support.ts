/**
 * Race helpers for the per-domain recover tests (stigmer#1672).
 *
 * A deferred holds a step mid-chain until the test releases it. A
 * signalling serializer reports each `run` call as it arrives, so a test
 * can tell a second recover that queued behind the first from one that
 * raced ahead to the engine, and release the first on whichever happens,
 * without waiting on a timer. Kept apart from `support.ts`, which most
 * server tests import, so these helpers reach only the tests that race.
 *
 * `writeLandsMidUpdate` lands a write on a row when an update chain first
 * writes it, after the chain read it (pipeline/guarded-write.ts): every
 * update chain's race arm runs through it, and so does a scratch revert of
 * the guarded write to a plain save, which is how each arm is shown red.
 * `visibilityWrite` is the landing write every store-kept kind shares: an
 * update keeps the loaded row's visibility, so a stale copy reverts it.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { vi } from "vitest";

import type { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";

import type { Store } from "../../store/interface.js";
import { KeyedSerializer } from "../keyed-serializer.js";
import { metadataOf } from "../steps/shapes.js";

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

/** What a write the race let land answers, and how often the chain wrote the row. */
export interface MidUpdateRace<T> {
  readonly result: T;
  /** Writes of the row the chain made: two when a lost swap was retried. */
  readonly writes: number;
}

/**
 * Runs `update` and lands `write` on the row `kind`/`id` the first time the
 * chain writes it (a swap, a save or an atomic update), so the write lands
 * after the chain's read and before its own. The landing write passes
 * through; the chain's writes are counted.
 */
export async function writeLandsMidUpdate<T>(
  store: Store,
  kind: ApiResourceKind,
  id: string,
  write: () => Promise<unknown>,
  update: () => Promise<T>,
): Promise<MidUpdateRace<T>> {
  const swapResource = store.swapResource.bind(store);
  const saveResource = store.saveResource.bind(store);
  const updateResource = store.updateResource.bind(store);
  let landing = false;
  let landed = false;
  let writes = 0;
  const before = async (writtenKind: ApiResourceKind, writtenId: string) => {
    if (landing || writtenKind !== kind || writtenId !== id) {
      return;
    }
    writes += 1;
    if (!landed) {
      landed = true;
      landing = true;
      try {
        await write();
      } finally {
        landing = false;
      }
    }
  };
  const swap = vi.spyOn(store, "swapResource").mockImplementation((async <
    Desc extends DescMessage,
  >(
    writtenKind: ApiResourceKind,
    writtenId: string,
    schema: Desc,
    expectedBytes: Uint8Array,
    resource: MessageShape<Desc>,
  ) => {
    await before(writtenKind, writtenId);
    return swapResource(writtenKind, writtenId, schema, expectedBytes, resource);
  }) as typeof store.swapResource);
  const save = vi.spyOn(store, "saveResource").mockImplementation((async <
    Desc extends DescMessage,
  >(
    writtenKind: ApiResourceKind,
    writtenId: string,
    schema: Desc,
    msg: MessageShape<Desc>,
  ) => {
    await before(writtenKind, writtenId);
    return saveResource(writtenKind, writtenId, schema, msg);
  }) as typeof store.saveResource);
  const atomic = vi.spyOn(store, "updateResource").mockImplementation((async <
    Desc extends DescMessage,
  >(
    writtenKind: ApiResourceKind,
    writtenId: string,
    schema: Desc,
    modify: (msg: MessageShape<Desc>) => void,
  ) => {
    await before(writtenKind, writtenId);
    return updateResource(writtenKind, writtenId, schema, modify);
  }) as typeof store.updateResource);
  try {
    const result = await update();
    if (!landed) {
      throw new Error("the update never wrote the row, so nothing landed mid-update");
    }
    return { result, writes };
  } finally {
    swap.mockRestore();
    save.mockRestore();
    atomic.mockRestore();
  }
}

/**
 * The landing write every store-kept kind shares: the row's visibility set
 * to `visibility` inside the store's atomic write, as updateVisibility
 * writes it. An update keeps the visibility of the row it read
 * (BuildUpdateState), so a write that stored a copy of that row would put
 * the old visibility back.
 */
export function visibilityWrite<Desc extends DescMessage>(
  store: Store,
  kind: ApiResourceKind,
  schema: Desc,
  id: string,
  visibility: ApiResourceVisibility = ApiResourceVisibility.visibility_org,
): () => Promise<unknown> {
  return () =>
    store.updateResource(kind, id, schema, (row) => {
      const metadata = metadataOf(row);
      if (metadata !== undefined) {
        metadata.visibility = visibility;
      }
    });
}
