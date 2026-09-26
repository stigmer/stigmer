/**
 * The `default_of` derived rule, shared by the two instance kinds. The
 * model reads `viewer from default_of` so a blueprint's system-managed
 * default instance is exactly as reachable as its template and never
 * more; the tuple that link stands on is not a `kind_meta` fact — the
 * cloud writes `<instance>#default_of@<blueprint>` iff the blueprint's
 * `status.default_instance_id` names the instance (stigmer-cloud
 * iam/tuple-lifecycle.ts `onDefaultInstanceLinked`, fired when the
 * pointer persists), and open source derives it from the same pointer at
 * check time: load the blueprint the instance names, compare.
 *
 * The blueprint is read through the source's memoised loader, so the
 * row this rule loads is the very row `viewer from default_of` then
 * resolves the blueprint's `viewer` on — one read serves both. Which spec
 * field names the blueprint is `kind_meta`'s to say (the instance kind's
 * `additional_parents` entry for the blueprint kind), never restated
 * here; an instance kind without that entry is a binding bug
 * (bindings.ts) and throws at first use rather than deriving nothing.
 *
 * A user-created instance points at a blueprint whose pointer names a
 * different row (or none), so the rule derives nothing for it and its
 * personal configuration stays its owner's — the invariant the model's
 * comment states. A blueprint that no longer exists grants nothing, as in
 * the cloud, where the tuple died with the row.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { isMessage } from "@bufbuild/protobuf";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  getKindEnum,
  getKindMeta,
  kindByEnumName,
  kindEnumName,
} from "../../pipeline/apiresource-meta.js";
import { parentIdOf } from "../../pipeline/steps/shapes.js";
import type { Tuple } from "../tuples.js";
import type { DerivedRelation } from "./rewrite.js";

export interface BlueprintOfInstance<Desc extends DescMessage> {
  /** The blueprint kind (`agent`, `workflow`). */
  readonly kind: ApiResourceKind;
  /** Its message schema: what the loaded blueprint row decodes with. */
  readonly schema: Desc;
  /** The blueprint's default-instance pointer, read from the typed row; "" when unset. */
  defaultInstanceIdOf(blueprint: MessageShape<Desc>): string;
}

export function defaultOfBlueprint<Desc extends DescMessage>(
  blueprint: BlueprintOfInstance<Desc>,
): DerivedRelation {
  const blueprintType = kindEnumName(blueprint.kind);
  return async (object, row, loader): Promise<ReadonlyArray<Tuple>> => {
    const blueprintId = parentIdOf(
      row,
      blueprintSpecFieldOf(object.type, blueprint.kind),
    );
    if (blueprintId === "") {
      return [];
    }
    const loaded = await loader.load({ type: blueprintType, id: blueprintId });
    if (
      loaded === undefined ||
      !isMessage(loaded, blueprint.schema) ||
      blueprint.defaultInstanceIdOf(loaded) !== object.id
    ) {
      return [];
    }
    return [
      {
        object,
        relation: "default_of",
        subject: {
          form: "object",
          object: { type: blueprintType, id: blueprintId },
        },
      },
    ];
  };
}

/** The instance kind's `kind_meta` parent entry for the blueprint kind: the spec field that names it. */
function blueprintSpecFieldOf(
  instanceType: string,
  blueprintKind: ApiResourceKind,
): string {
  const instanceKind = kindByEnumName(instanceType);
  const parents = getKindMeta(instanceKind).authorization?.additionalParents;
  const entry = parents?.find(
    (parent) => getKindEnum(parent.kind) === blueprintKind,
  );
  if (entry === undefined) {
    throw new Error(
      `${instanceType} declares default_of but kind_meta names no ${kindEnumName(blueprintKind)} parent`,
    );
  }
  return entry.specField;
}
