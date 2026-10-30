/**
 * The session fields a console follow-up may write, read one way for both
 * jobs the session page has: loading a stored conversation into its
 * workspace and picks, and telling whether the person changed one since.
 * A follow-up writes a field only when the page's value differs from the
 * one the server holds (stigmer/stigmer#2028), so the comparison sees what
 * the page can hold and nothing else: the repositories and folders with
 * every stored field but the token, and the plugin and skill references.
 *
 * @internal
 */
import { toResourceRefInputs, type ResourceRef, type SessionResourceInput } from "@stigmer/client";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";

/** A conversation's follow-up fields, each in the shape a follow-up sends. */
export interface FollowUpFields {
  /**
   * The repositories and folders, without a token or a File: the page
   * never holds either, and a follow-up keeps both as stored.
   */
  readonly resources: SessionResourceInput[];
  readonly plugins: ResourceRef[];
  readonly skillRefs: ResourceRef[];
}

/** The follow-up fields of a stored conversation's spec. */
export function followUpFieldsOf(spec: Session["spec"]): FollowUpFields {
  const resources: SessionResourceInput[] = [];
  for (const stored of spec?.resources ?? []) {
    const resource = stored.resource;
    if (resource.case === "gitRepository") {
      const { url, branch, commit, writeBackMode } = resource.value;
      resources.push({
        name: stored.name,
        gitRepository: {
          url,
          ...(branch && { branch }),
          ...(commit && { commit }),
          ...(writeBackMode && { writeBackMode }),
        },
      });
    } else if (resource.case === "localPath") {
      resources.push({ name: stored.name, localPath: { path: resource.value.path } });
    }
  }
  return {
    resources,
    plugins: toResourceRefInputs(spec?.plugins) ?? [],
    skillRefs: toResourceRefInputs(spec?.skillRefs) ?? [],
  };
}

/**
 * Whether two resource lists name the same repositories and folders, in
 * the same order, field for field. An unset field equals an empty one;
 * tokens are not compared.
 */
export function sameResources(
  a: readonly SessionResourceInput[],
  b: readonly SessionResourceInput[],
): boolean {
  return a.length === b.length && a.every((entry, i) => sameResource(entry, b[i]!));
}

/**
 * Whether two reference lists name the same references, in the same order.
 * `kind` is not compared: the field a list sits in implies it, and a
 * picker's reference may leave it out.
 */
export function sameRefs(a: readonly ResourceRef[], b: readonly ResourceRef[]): boolean {
  return (
    a.length === b.length &&
    a.every((ref, i) => {
      const other = b[i]!;
      return (
        same(ref.org, other.org) &&
        same(ref.slug, other.slug) &&
        same(ref.id, other.id) &&
        same(ref.version, other.version)
      );
    })
  );
}

function sameResource(a: SessionResourceInput, b: SessionResourceInput): boolean {
  if (!same(a.name, b.name)) return false;
  if (a.gitRepository || b.gitRepository) {
    const x = a.gitRepository;
    const y = b.gitRepository;
    return (
      x !== undefined &&
      y !== undefined &&
      same(x.url, y.url) &&
      same(x.branch, y.branch) &&
      same(x.commit, y.commit) &&
      same(x.writeBackMode, y.writeBackMode)
    );
  }
  if (a.localPath || b.localPath) {
    return a.localPath !== undefined && b.localPath !== undefined && same(a.localPath.path, b.localPath.path);
  }
  return same(a.file?.fileId, b.file?.fileId) && same(a.file?.mountPath, b.file?.mountPath);
}

/** Equality with an unset value, `""` and `0` alike. */
function same<T extends string | number>(a: T | undefined, b: T | undefined): boolean {
  return (a || undefined) === (b || undefined);
}
