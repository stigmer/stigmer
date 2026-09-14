/**
 * The permission vocabulary as the wire spells it (20260913.01 slice 5,
 * Q-S5-3): `checkMyPermission` carries its `relation` as a string — the
 * FGA relation name, which is the `IamPermission` member name — while the
 * composed Authorizer's `AuthzCheck` carries the enum. This is the one
 * read from the first spelling to the second. A relation that names no
 * permission is the caller's mistake (INVALID_ARGUMENT in the controller),
 * never a permission nobody holds: the console asks with the ten strings
 * `IamPermission` lists (claim check C4) and a typo should be heard.
 *
 * A Map over the descriptor's values, never the TS enum's reverse index
 * (the `kindsByEnumName` doctrine in pipeline/apiresource-meta.ts): a
 * prototype key or a number spelled as text must resolve to nothing. The
 * zero value `unspecified` is not a permission and is left out.
 */
import {
  IamPermission,
  IamPermissionSchema,
} from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

let byName: Map<string, IamPermission> | undefined;

/** The permission a wire relation names, or `undefined`. */
export function permissionByEnumName(
  relation: string,
): IamPermission | undefined {
  if (byName === undefined) {
    byName = new Map(
      IamPermissionSchema.values
        .filter((value) => value.number !== IamPermission.unspecified)
        .map((value) => [value.name, value.number as IamPermission]),
    );
  }
  return byName.get(relation);
}
