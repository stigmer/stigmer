// What the model catalog console says to anyone who reaches it without the
// platform operator's permission (`can_manage_model_pricing` on
// `platform:stigmer`). The server's authorization is the real gate; these
// words are its designed face, drawn by the settings frame's `denied`
// state instead of a raw RPC error.

import type { SettingsPageDenial } from "../settings/SettingsPage.js";

/** What the model catalog console says to a person who is not a platform operator. */
export const MODEL_CATALOG_DENIAL: SettingsPageDenial = {
  title: "Platform operator access required",
  description:
    "The model catalog is a Stigmer-internal surface. It needs the platform operator role — organization roles do not grant it. If you believe you should have access, contact a platform operator.",
};
