// Access — the unified "Manage access" experience composing visibility
// (library) and explicit grants (iam-policy) into one dialog, with a kebab
// hook and a visible-button trigger for the surfaces that mount it.
export {
  ManageAccessDialog,
  type ManageAccessDialogProps,
} from "./ManageAccessDialog.js";
export {
  ManageAccessButton,
  type ManageAccessButtonProps,
} from "./ManageAccessButton.js";
export {
  useManageAccess,
  type UseManageAccessArgs,
  type UseManageAccessReturn,
} from "./useManageAccess.js";
export type {
  AccessResource,
  AccessVisibility,
  AccessExtraSection,
} from "./types.js";
