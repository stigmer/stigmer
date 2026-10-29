// @stigmer/react-sdk/console — what only a Stigmer console renders: the
// platform operator's consoles (model catalog, licenses, plan catalog), the
// settings navigation and its section components, the user menu and the
// sidebars. The web console and the desktop app import them from here.
//
// Versioned with the kit and held to its standards, but shaped by the
// console's needs rather than an embedder's: these parts may change with the
// console. Billing and the plan vocabulary are not here: a product shows its
// customers those, so they stay in the root entry.

// Model catalog — platform-operator authoring of the model registry
// baseline: models, capabilities and list prices (gated on
// can_manage_model_pricing)
export {
  useModelPricingBaselines,
  useModelCatalogView,
  useUpsertModelPricingBaseline,
  useRetireModelPricingBaseline,
  ModelCatalogConsole,
} from "./model-catalog/index.js";
export type {
  UseModelPricingBaselinesOptions,
  UseModelPricingBaselinesReturn,
  ModelCatalogFlow,
  ModelCatalogRow,
  UseModelCatalogViewReturn,
  UpsertModelPricingBaselineInput,
  UseUpsertModelPricingBaselineReturn,
  RetireModelPricingBaselineInput,
  UseRetireModelPricingBaselineReturn,
  ModelCatalogConsoleProps,
} from "./model-catalog/index.js";

// Licenses — platform-operator issuing of Stigmer licenses: the renewal
// calendar, the issue form and the signed ticket (gated on can_issue_license)
export {
  useLicenses,
  useLicense,
  useIssueLicense,
  LicensesConsole,
  LicensesAccessNotice,
} from "./licenses/index.js";
export type {
  UseLicensesReturn,
  UseLicenseReturn,
  UseIssueLicenseReturn,
  LicensesConsoleProps,
} from "./licenses/index.js";

// Plan catalog — platform-operator management of the Stigmer Cloud plans
// organizations subscribe to (gated on can_manage_plans)
export {
  useCreatePlan,
  useRetirePlan,
  PlanCatalogConsole,
  PlanCreateForm,
  PlansAccessNotice,
} from "./plan-catalog/index.js";
export type {
  UseCreatePlanReturn,
  UseRetirePlanReturn,
  PlanCatalogConsoleProps,
  PlanCreateFormProps,
} from "./plan-catalog/index.js";

// Settings — navigation structure + section components shared across app shells
export {
  SETTINGS_NAV_GROUPS,
  SINGLE_ORG_SETTINGS_NAV_GROUPS,
  PLATFORM_SETTINGS_NAV_GROUP,
  ORG_ADMIN_SETTINGS_NAV_ITEMS,
  useSettingsNavGroups,
} from "./settings/index.js";
export type { SettingsNavItem, SettingsNavGroup } from "./settings/index.js";
export { ApiKeysSection } from "./settings/index.js";
export { MembersSection } from "./settings/index.js";
export type { MembersSectionProps } from "./settings/index.js";
export { OrgProfileSection } from "./settings/index.js";
export type { OrgProfileSectionProps } from "./settings/index.js";
export { OrgPreferencesSection, OrgPoliciesSection, OrgEmbeddingSection } from "./settings/index.js";
export type { OrgEmbeddingSectionProps } from "./settings/index.js";
export { AccountPreferencesSection } from "./settings/index.js";
export type { AccountPreferencesSectionProps } from "./settings/index.js";
export { NotificationsSection } from "./settings/index.js";
export type { NotificationsSectionProps } from "./settings/index.js";
export { MemorySection } from "./settings/index.js";
export { VaultsSection } from "./settings/index.js";
export { InvitationsSection } from "./settings/index.js";
export { FederationIssuersSection } from "./settings/index.js";
export { ServiceAccountsSection } from "./settings/index.js";
export { TeamsSection } from "./settings/index.js";
export { AccessHistorySection } from "./settings/index.js";
export { OAuthAppsSection } from "./settings/index.js";
export { ChannelAppsSection } from "./settings/index.js";
export { UsageSection } from "./settings/index.js";

// User — app shell user menu
export { UserMenu } from "./user/index.js";
export type { UserMenuProps } from "./user/index.js";

// Sidebar — the console's navigation chrome (workspace + settings zones).
// The web console, desktop app, and documentation tours all render these;
// hosts inject routing via `renderLink` and identity via the footer slot.
export { WorkspaceSidebar, SettingsSidebar } from "./sidebar/index.js";
export type {
  WorkspaceSidebarProps,
  WorkspaceSidebarActivity,
  WorkspaceNavId,
  SettingsSidebarProps,
  SidebarLinkRenderProps,
  RenderSidebarLink,
} from "./sidebar/index.js";
