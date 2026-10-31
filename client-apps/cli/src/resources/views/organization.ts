// `get organization`: an organization by name and slug, its id, what it is
// for, the organization it is a child of (by the id it stores, since a view
// reads only its resource), and when it was made
// (apis/ai/stigmer/tenancy/organization/v1/spec.proto). An organization
// belongs to none, so its title names its slug alone on every server.

import { audited, instant, obj, str } from "../render.js";
import type { KindView } from "./view.js";

export const organizationView: KindView = {
  title: (json) => {
    const metadata = obj(json, "metadata");
    return { name: str(metadata, "name") || str(metadata, "slug"), ref: str(metadata, "slug") };
  },
  sections: (json) => {
    const metadata = obj(json, "metadata");
    const spec = obj(json, "spec");
    return [
      {
        fields: [
          ["ID", str(metadata, "id")],
          ["Description", str(spec, "description")],
          ["Parent", str(spec, "parent_org")],
          ["Created", instant(audited(json).created)],
        ],
      },
    ];
  },
};
