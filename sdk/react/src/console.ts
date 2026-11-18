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
export { SettingsPage, SettingsSkeleton, SettingsOverview } from "./settings/index.js";
export type {
  SettingsPageProps,
  SettingsPageDenial,
  SettingsPageBack,
  SettingsSkeletonProps,
  SettingsOverviewProps,
} from "./settings/index.js";
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
export type { InvitationsSectionProps } from "./settings/index.js";
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
// Help — the server operator's help link, for the console's own screens
// (the sidebar's footer, sign-in, a gate's failure); never a builder's app
export { HelpLink } from "./help/index.js";
export type { HelpLinkProps } from "./help/index.js";

export { WorkspaceSidebar, SettingsSidebar, SidebarStatusRow } from "./sidebar/index.js";
export type {
  WorkspaceSidebarProps,
  WorkspaceSidebarActivity,
  WorkspaceNavId,
  SettingsSidebarProps,
  SidebarLinkRenderProps,
  RenderSidebarLink,
  SidebarStatusRowProps,
  SidebarStatusTone,
} from "./sidebar/index.js";

// Standalone screen — the frame every screen outside the console's frame
// stands on (signing in, the gates, a configuration or console that
// failed): the host's mark, a title, a line, one act and the help line. It
// renders before any provider.
export { StandaloneScreen } from "./standalone-screen/index.js";
export type { StandaloneScreenProps } from "./standalone-screen/index.js";

// Signing in — the sign-in screen in both apps, the return from the
// sign-in page, and the page that hands the browser back to the desktop
// app. Hosts keep their sign-in wiring and pass the state.
export { SignInView, SignInReturnView, AppHandoffView } from "./sign-in/index.js";
export type {
  SignInViewProps,
  SignInState,
  SignInElsewhere,
  SignInReturnViewProps,
  AppHandoffViewProps,
} from "./sign-in/index.js";

// The desktop app's server screens — connecting to the server a person
// chose, why it can't be used, and choosing another, as a screen or a
// dialog over the app. They render before any provider: they pick the
// server the kit talks to.
export { ServerConnectionView, ServerChooserForm } from "./server-screen/index.js";
export type { ServerConnectionViewProps, ServerConnectionState, ServerChooserFormProps } from "./server-screen/index.js";

// Gates — what a console shows between signing in and the app: the
// identity account checked or set up, then the person's organizations.
// The hooks (`useIdentityAccountGate`, `useOrgGate`) make the state; hosts
// keep their sign-in wiring and pass the account's corner.
export { IdentityAccountGateView, OrgGateView } from "./gate/index.js";
export type { IdentityAccountGateViewProps, OrgGateViewProps } from "./gate/index.js";

// Page states — a console page's place when there is nothing to show: an
// address that leads nowhere, a page that broke, a run's address resolving
// to its conversation. Hosts inject routing (`renderLink`, `onResolved`).
export { PageNotFound, PageFailure } from "./page-state/index.js";
export type { PageNotFoundProps, PageFailureProps, PageFailureLink } from "./page-state/index.js";
export { RunResolveView } from "./page-state/index.js";
export type { RunResolveViewProps } from "./page-state/index.js";

// Page frame — the column every console zone frames its pages in (settings,
// the Library, models, the dashboard, the marketplace), in both apps.
export { PageFrame } from "./page-frame/PageFrame.js";
export type { PageFrameProps, PageFrameWidth } from "./page-frame/PageFrame.js";

// Library — the landing and one list page per kind, in both apps. The
// detail views stay in the root entry (embedders build on them); these are
// the console's pages, with its addresses and Apply YAML. Hosts inject
// routing (`onOpen`, `renderLink`, `onNavigate`).
export {
  LibraryOverview,
  LibraryAgentsSection,
  LibrarySkillsSection,
  LibraryPluginsSection,
  LibraryRoutinesSection,
  LibraryEnvironmentsSection,
  LibraryFilesSection,
  AGENT_DELETE_DESCRIPTION,
  LIBRARY_HREFS,
  LIBRARY_ADD_PARAM,
  LIBRARY_ADD_MCP_SERVER,
} from "./library-pages/index.js";
export type {
  LibraryOverviewProps,
  LibraryAgentsSectionProps,
  LibrarySkillsSectionProps,
  LibraryPluginsSectionProps,
  LibraryRoutinesSectionProps,
  LibraryEnvironmentsSectionProps,
  LibraryFilesSectionProps,
  LibraryResourceKind,
  LibraryResourceRef,
  LibrarySectionNavigation,
} from "./library-pages/index.js";
