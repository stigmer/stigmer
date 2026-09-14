/**
 * Pins permissions.ts (20260913.01 slice 5, Q-S5-3): the relation string a
 * checkMyPermission caller sends is admitted only when it is an
 * IamPermission member name — the Authorizer's AuthzCheck carries the
 * enum, and the wire carries its name. The zero value is not a
 * permission; a Map (never the TS enum's reverse index) keeps prototype
 * keys and numeric spellings from resolving to anything (the
 * kindsByEnumName precedent in pipeline/apiresource-meta.ts).
 */
import { describe, expect, it } from "vitest";

import {
  IamPermission,
  IamPermissionSchema,
} from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { permissionByEnumName } from "../permissions.js";

describe("permissionByEnumName", () => {
  it("resolves every member but the zero value by its exact proto name", () => {
    for (const value of IamPermissionSchema.values) {
      if (value.number === IamPermission.unspecified) continue;
      expect(permissionByEnumName(value.name), value.name).toBe(value.number);
    }
  });

  for (const garbage of [
    "unspecified",
    "",
    "CAN_VIEW",
    "can-view",
    "constructor",
    "__proto__",
    "4",
    "admin",
  ]) {
    it(`answers undefined for ${JSON.stringify(garbage)}`, () => {
      expect(permissionByEnumName(garbage)).toBeUndefined();
    });
  }
});
