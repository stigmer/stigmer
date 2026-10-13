/**
 * Test support: an `update(resource, paths)` call a test's SDK double
 * captured, read back for assertions. `sentUpdate` answers the resource
 * the hook sent, the paths it named, and the id and etag it addressed;
 * `sentRefs` reads a list of references the way the old inputs carried
 * them (organization, slug, and an id or version only when set), so a
 * test states the references it expects without the proto's defaults.
 */
interface SentMetadata {
  readonly id?: string;
  readonly etag?: string;
  readonly name?: string;
}

/** A captured update call: the resource sent and the paths named. */
export interface SentUpdate<R> {
  readonly resource: R;
  readonly paths: string[];
  readonly id: string;
  readonly etag: string;
}

/** The `index`th call of an update double, as resource, paths, id and etag. */
export function sentUpdate<R extends { metadata?: SentMetadata }>(
  update: { mock: { calls: unknown[][] } },
  index = 0,
): SentUpdate<R> {
  const call = update.mock.calls[index];
  if (call === undefined) {
    throw new Error(`update was called ${update.mock.calls.length} time(s); no call ${index}`);
  }
  const resource = call[0] as R;
  return {
    resource,
    paths: call[1] as string[],
    id: resource.metadata?.id ?? "",
    etag: resource.metadata?.etag ?? "",
  };
}

/** A sent reference list as plain references: org, slug, and id or version when set. */
export function sentRefs(
  refs: ReadonlyArray<{ org: string; slug: string; id?: string; version?: string }> | undefined,
): Array<{ org: string; slug: string; id?: string; version?: string }> {
  return (refs ?? []).map((ref) => ({
    org: ref.org,
    slug: ref.slug,
    ...(ref.id ? { id: ref.id } : {}),
    ...(ref.version ? { version: ref.version } : {}),
  }));
}
