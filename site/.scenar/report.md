# Scenar Preview Report
Generated: 2026-04-18T07:28:42.292Z

## Discovered (118 components) → views.generated.ts

| Component | Path | Category | Props |
|-----------|------|----------|-------|
| RootError | src/app/error | component | error: Error & { digest?: string; }, reset: () => void |
| GlobalError | src/app/global-error | component | error: Error & { digest?: string; }, reset: () => void |
| RootLayout | src/app/layout | layout | _none_ |
| NotFound | src/app/not-found | component | _none_ |
| AuthGuard | src/auth/AuthGuard | component | _none_ |
| AuthProvider | src/auth/AuthProvider | component | _none_ |
| LibraryNavigationProvider | src/contexts/library-navigation | component | _none_ |
| OrgProvider | src/contexts/org-context | component | _none_ |
| SessionNavigationProvider | src/contexts/session-navigation | component | _none_ |
| OrgGate | src/components/auth/OrgGate | component | _none_ |
| Providers | src/components/auth/Providers | component | _none_ |
| AppShell | src/components/layout/AppShell | layout | _none_ |
| ManagementSidebar | src/components/layout/ManagementSidebar | layout | _none_ |
| OrgSwitcher | src/components/layout/OrgSwitcher | layout | _none_ |
| Sidebar | src/components/layout/Sidebar | layout | _none_ |
| UserMenu | src/components/layout/UserMenu | layout | _none_ |
| StigmerTransportBridge | src/components/providers/StigmerTransportBridge | component | _none_ |
| SessionLauncher | src/components/session/SessionLauncher | component | _none_ |
| ApiKeysSection | src/components/settings/ApiKeysSection | component | _none_ |
| ComingSoon | src/components/settings/ComingSoon | component | title: string, icon?: ComponentType<{ className?: string; }> | undefined |
| EnvironmentsSection | src/components/settings/EnvironmentsSection | component | _none_ |
| IdentityProvidersSection | src/components/settings/IdentityProvidersSection | component | _none_ |
| InvitationsSection | src/components/settings/InvitationsSection | component | _none_ |
| MembersSection | src/components/settings/MembersSection | component | _none_ |
| OAuthAppsSection | src/components/settings/OAuthAppsSection | component | _none_ |
| OrgProfileSection | src/components/settings/OrgProfileSection | component | _none_ |
| PlatformClientsSection | src/components/settings/PlatformClientsSection | component | _none_ |
| UsageSection | src/components/settings/UsageSection | component | _none_ |
| Badge | src/components/ui/badge | primitive | defaultChecked?: boolean | undefined, defaultValue?: string | number | readonly string[] | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, accessKey?: string | undefined, +275 more |
| Button | src/components/ui/button | primitive | focusableWhenDisabled?: boolean | undefined, nativeButton?: boolean | undefined, disabled?: boolean | undefined, form?: string | undefined, slot?: string | undefined, +285 more |
| Card | src/components/ui/card | primitive | defaultChecked?: boolean | undefined, defaultValue?: string | number | readonly string[] | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, accessKey?: string | undefined, +274 more |
| CardHeader | src/components/ui/card | primitive | defaultChecked?: boolean | undefined, defaultValue?: string | number | readonly string[] | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, accessKey?: string | undefined, +273 more |
| CardTitle | src/components/ui/card | primitive | defaultChecked?: boolean | undefined, defaultValue?: string | number | readonly string[] | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, accessKey?: string | undefined, +273 more |
| CardDescription | src/components/ui/card | primitive | defaultChecked?: boolean | undefined, defaultValue?: string | number | readonly string[] | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, accessKey?: string | undefined, +273 more |
| CardAction | src/components/ui/card | primitive | defaultChecked?: boolean | undefined, defaultValue?: string | number | readonly string[] | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, accessKey?: string | undefined, +273 more |
| CardContent | src/components/ui/card | primitive | defaultChecked?: boolean | undefined, defaultValue?: string | number | readonly string[] | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, accessKey?: string | undefined, +273 more |
| CardFooter | src/components/ui/card | primitive | defaultChecked?: boolean | undefined, defaultValue?: string | number | readonly string[] | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, accessKey?: string | undefined, +273 more |
| Collapsible | src/components/ui/collapsible | primitive | open?: boolean | undefined, defaultOpen?: boolean | undefined, onOpenChange?: ((open: boolean, eventDetails: CollapsibleRootChangeEventDetails) => void) | ..., disabled?: boolean | undefined, slot?: string | undefined, +275 more |
| CollapsibleTrigger | src/components/ui/collapsible | primitive | nativeButton?: boolean | undefined, disabled?: boolean | undefined, form?: string | undefined, slot?: string | undefined, style?: CSSProperties | undefined, +282 more |
| CollapsibleContent | src/components/ui/collapsible | primitive | hiddenUntilFound?: boolean | undefined, keepMounted?: boolean | undefined, slot?: string | undefined, style?: CSSProperties | undefined, title?: string | undefined, +273 more |
| Dialog | src/components/ui/dialog | primitive | open?: boolean | undefined, defaultOpen?: boolean | undefined, modal?: boolean | "trap-focus" | undefined, onOpenChange?: ((open: boolean, eventDetails: DialogRoot.ChangeEventDetails) => void) | unde..., onOpenChangeComplete?: ((open: boolean) => void) | undefined, +5 more |
| DialogTrigger | src/components/ui/dialog | primitive | handle?: DialogHandle<Payload> | undefined, payload?: Payload | undefined, id?: string | undefined, nativeButton?: boolean | undefined, disabled?: boolean | undefined, +284 more |
| DialogClose | src/components/ui/dialog | primitive | nativeButton?: boolean | undefined, disabled?: boolean | undefined, form?: string | undefined, slot?: string | undefined, style?: CSSProperties | undefined, +282 more |
| DialogContent | src/components/ui/dialog | primitive | initialFocus?: boolean | React.RefObject<HTMLElement | null> | ((openType: InteractionType) ..., finalFocus?: boolean | React.RefObject<HTMLElement | null> | ((closeType: InteractionType)..., slot?: string | undefined, style?: CSSProperties | undefined, title?: string | undefined, +273 more |
| DialogTitle | src/components/ui/dialog | primitive | slot?: string | undefined, style?: CSSProperties | undefined, title?: string | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, +271 more |
| DialogDescription | src/components/ui/dialog | primitive | slot?: string | undefined, style?: CSSProperties | undefined, title?: string | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, +271 more |
| DropdownMenu | src/components/ui/dropdown-menu | primitive | defaultOpen?: boolean | undefined, loopFocus?: boolean | undefined, highlightItemOnHover?: boolean | undefined, modal?: boolean | undefined, onOpenChange?: ((open: boolean, eventDetails: MenuRoot.ChangeEventDetails) => void) | undefined, +9 more |
| DropdownMenuPortal | src/components/ui/dropdown-menu | primitive | keepMounted?: boolean | undefined, container?: HTMLElement | ShadowRoot | React.RefObject<HTMLElement | ShadowRoot | null> |..., slot?: string | undefined, style?: CSSProperties | undefined, title?: string | undefined, +273 more |
| DropdownMenuTrigger | src/components/ui/dropdown-menu | primitive | disabled?: boolean | undefined, handle?: MenuHandle<Payload> | undefined, payload?: Payload | undefined, delay?: number | undefined, closeDelay?: number | undefined, +287 more |
| DropdownMenuContent | src/components/ui/dropdown-menu | primitive | id?: string | undefined, finalFocus?: boolean | React.RefObject<HTMLElement | null> | ((closeType: InteractionType)..., slot?: string | undefined, style?: CSSProperties | undefined, title?: string | undefined, +276 more |
| DropdownMenuGroup | src/components/ui/dropdown-menu | primitive | slot?: string | undefined, style?: CSSProperties | undefined, title?: string | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, +271 more |
| DropdownMenuLabel | src/components/ui/dropdown-menu | primitive | slot?: string | undefined, style?: CSSProperties | undefined, title?: string | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, +272 more |
| DropdownMenuItem | src/components/ui/dropdown-menu | primitive | onClick?: ((event: import("/Users/suresh/scm/github.com/stigmer/stigmer/node_modules/@b..., disabled?: boolean | undefined, label?: string | undefined, id?: string | undefined, closeOnClick?: boolean | undefined, +277 more |
| DropdownMenuSub | src/components/ui/dropdown-menu | primitive | onOpenChange?: ((open: boolean, eventDetails: MenuSubmenuRoot.ChangeEventDetails) => void) |..., closeParentOnEsc?: boolean | undefined, disabled?: boolean | undefined, defaultOpen?: boolean | undefined, loopFocus?: boolean | undefined, +8 more |
| DropdownMenuSubTrigger | src/components/ui/dropdown-menu | primitive | onClick?: ((event: import("/Users/suresh/scm/github.com/stigmer/stigmer/node_modules/@b..., label?: string | undefined, id?: string | undefined, disabled?: boolean | undefined, delay?: number | undefined, +278 more |
| DropdownMenuSubContent | src/components/ui/dropdown-menu | primitive | id?: string | undefined, finalFocus?: boolean | React.RefObject<HTMLElement | null> | ((closeType: InteractionType)..., slot?: string | undefined, style?: CSSProperties | undefined, title?: string | undefined, +276 more |
| DropdownMenuCheckboxItem | src/components/ui/dropdown-menu | primitive | checked?: boolean | undefined, defaultChecked?: boolean | undefined, onCheckedChange?: ((checked: boolean, eventDetails: MenuCheckboxItem.ChangeEventDetails) => voi..., onClick?: ((event: import("/Users/suresh/scm/github.com/stigmer/stigmer/node_modules/@b..., disabled?: boolean | undefined, +279 more |
| DropdownMenuRadioGroup | src/components/ui/dropdown-menu | primitive | value?: any, defaultValue?: any, onValueChange?: ((value: any, eventDetails: MenuRadioGroup.ChangeEventDetails) => void) | und..., disabled?: boolean | undefined, slot?: string | undefined, +275 more |
| DropdownMenuRadioItem | src/components/ui/dropdown-menu | primitive | value: any, onClick?: ((event: import("/Users/suresh/scm/github.com/stigmer/stigmer/node_modules/@b..., disabled?: boolean | undefined, label?: string | undefined, id?: string | undefined, +277 more |
| DropdownMenuSeparator | src/components/ui/dropdown-menu | primitive | orientation?: Orientation | undefined, slot?: string | undefined, style?: CSSProperties | undefined, title?: string | undefined, suppressContentEditableWarning?: boolean | undefined, +272 more |
| DropdownMenuShortcut | src/components/ui/dropdown-menu | primitive | defaultChecked?: boolean | undefined, defaultValue?: string | number | readonly string[] | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, accessKey?: string | undefined, +273 more |
| ScrollArea | src/components/ui/scroll-area | primitive | slot?: string | undefined, style?: CSSProperties | undefined, title?: string | undefined, defaultChecked?: boolean | undefined, defaultValue?: string | number | readonly string[] | undefined, +273 more |
| Separator | src/components/ui/separator | primitive | orientation?: Orientation | undefined, slot?: string | undefined, style?: CSSProperties | undefined, title?: string | undefined, suppressContentEditableWarning?: boolean | undefined, +272 more |
| Toaster | src/components/ui/sonner | primitive | id?: string | undefined, invert?: boolean | undefined, theme?: "light" | "dark" | "system" | undefined, position?: Position | undefined, hotkey?: string[] | undefined, +15 more |
| Table | src/components/ui/table | primitive | align?: "center" | "left" | "right" | undefined, bgcolor?: string | undefined, border?: number | undefined, cellPadding?: string | number | undefined, cellSpacing?: string | number | undefined, +282 more |
| TableHeader | src/components/ui/table | primitive | defaultChecked?: boolean | undefined, defaultValue?: string | number | readonly string[] | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, accessKey?: string | undefined, +273 more |
| TableBody | src/components/ui/table | primitive | defaultChecked?: boolean | undefined, defaultValue?: string | number | readonly string[] | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, accessKey?: string | undefined, +273 more |
| TableRow | src/components/ui/table | primitive | defaultChecked?: boolean | undefined, defaultValue?: string | number | readonly string[] | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, accessKey?: string | undefined, +273 more |
| TableHead | src/components/ui/table | primitive | align?: "center" | "left" | "right" | "justify" | "char" | undefined, colSpan?: number | undefined, headers?: string | undefined, rowSpan?: number | undefined, scope?: string | undefined, +279 more |
| TableCell | src/components/ui/table | primitive | align?: "center" | "left" | "right" | "justify" | "char" | undefined, colSpan?: number | undefined, headers?: string | undefined, rowSpan?: number | undefined, scope?: string | undefined, +282 more |
| TableCaption | src/components/ui/table | primitive | defaultChecked?: boolean | undefined, defaultValue?: string | number | readonly string[] | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, accessKey?: string | undefined, +273 more |
| TooltipProvider | src/components/ui/tooltip | primitive | delay?: number | undefined, closeDelay?: number | undefined, timeout?: number | undefined |
| Tooltip | src/components/ui/tooltip | primitive | defaultOpen?: boolean | undefined, open?: boolean | undefined, onOpenChange?: ((open: boolean, eventDetails: TooltipRoot.ChangeEventDetails) => void) | und..., onOpenChangeComplete?: ((open: boolean) => void) | undefined, disableHoverablePopup?: boolean | undefined, +6 more |
| TooltipTrigger | src/components/ui/tooltip | primitive | handle?: TooltipHandle<Payload> | undefined, payload?: Payload | undefined, delay?: number | undefined, closeOnClick?: boolean | undefined, closeDelay?: number | undefined, +286 more |
| TooltipContent | src/components/ui/tooltip | primitive | slot?: string | undefined, style?: CSSProperties | undefined, title?: string | undefined, suppressContentEditableWarning?: boolean | undefined, suppressHydrationWarning?: boolean | undefined, +273 more |
| LibraryLayout | src/app/library/layout | layout | _none_ |
| LibraryBreadcrumb | src/app/library/LibraryBreadcrumb | component | _none_ |
| LibraryBreadcrumbProvider | src/app/library/LibraryBreadcrumbContext | component | _none_ |
| LibraryLanding | src/app/library/LibraryLanding | component | _none_ |
| LibraryPage | src/app/library/page | page | _none_ |
| LoginPage | src/app/login/page | page | _none_ |
| SettingsError | src/app/settings/error | component | error: Error & { digest?: string; }, reset: () => void |
| SettingsLayout | src/app/settings/layout | layout | _none_ |
| SettingsLoading | src/app/settings/loading | component | _none_ |
| SettingsPage | src/app/settings/page | page | _none_ |
| DisabledAuthProvider | src/auth/disabled/DisabledAuthProvider | component | _none_ |
| OidcAuthProvider | src/auth/oidc/OidcAuthProvider | component | config: OidcConfig |
| OidcCallbackPage | src/app/auth/callback/page | page | _none_ |
| InvitePageClient | src/app/invite/[token]/InvitePageClient | component | _none_ |
| InvitePage | src/app/invite/[token]/page | page | _none_ |
| AgentListPage | src/app/library/agents/AgentListPage | page | _none_ |
| AgentsPage | src/app/library/agents/page | page | _none_ |
| McpServerListPage | src/app/library/mcp-servers/McpServerListPage | page | _none_ |
| McpServersPage | src/app/library/mcp-servers/page | page | _none_ |
| SkillsPage | src/app/library/skills/page | page | _none_ |
| SkillListPage | src/app/library/skills/SkillListPage | page | _none_ |
| SessionPage | src/app/sessions/[id]/SessionPage | page | _none_ |
| SessionPageInner | src/app/sessions/[id]/SessionPage | page | id: string |
| SessionSkeleton | src/app/sessions/[id]/SessionPage | page | _none_ |
| ApiKeysPage | src/app/settings/api-keys/page | page | _none_ |
| BillingPage | src/app/settings/billing/page | page | _none_ |
| EnvironmentsPage | src/app/settings/environments/page | page | _none_ |
| IdentityProvidersPage | src/app/settings/identity-providers/page | page | _none_ |
| InvitationsPage | src/app/settings/invitations/page | page | _none_ |
| MembersPage | src/app/settings/members/page | page | _none_ |
| OAuthAppsPage | src/app/settings/oauth-apps/page | page | _none_ |
| OrgProfilePage | src/app/settings/org-profile/page | page | _none_ |
| PlatformClientsPage | src/app/settings/platform-clients/page | page | _none_ |
| UsagePage | src/app/settings/usage/page | page | _none_ |
| GitHubCallbackPage | src/app/auth/github/callback/page | page | _none_ |
| McpOAuthCallbackPage | src/app/auth/oauth/callback/page | page | _none_ |
| AgentDetailPageInner | src/app/library/agents/[org]/[slug]/AgentDetailPage | page | org: string, slug: string |
| AgentDetailPage | src/app/library/agents/[org]/[slug]/AgentDetailPage | page | _none_ |
| Page | src/app/library/agents/[org]/[slug]/page | page | _none_ |
| McpServerDetailPageInner | src/app/library/mcp-servers/[org]/[slug]/McpServerDetailPage | page | org: string, slug: string |
| McpServerDetailPage | src/app/library/mcp-servers/[org]/[slug]/McpServerDetailPage | page | _none_ |
| SkillDetailPageInner | src/app/library/skills/[org]/[slug]/SkillDetailPage | page | org: string, slug: string |
| SkillDetailPage | src/app/library/skills/[org]/[slug]/SkillDetailPage | page | _none_ |

## Skipped (5 components)

| Component | Path | Reason |
|-----------|------|--------|
| HomePage | /Users/suresh/scm/github.com/stigmer/stigmer/client-apps/web/src/app/page.tsx | No JSX return detected |
| HomePage | /Users/suresh/scm/github.com/stigmer/stigmer/client-apps/web/src/app/page.tsx | No JSX return detected |
| AuthContext | /Users/suresh/scm/github.com/stigmer/stigmer/client-apps/web/src/auth/context.tsx | Higher-order component |
| Page | /Users/suresh/scm/github.com/stigmer/stigmer/client-apps/web/src/app/sessions/[id]/page.tsx | No JSX return detected |
| Page | /Users/suresh/scm/github.com/stigmer/stigmer/client-apps/web/src/app/sessions/[id]/page.tsx | No JSX return detected |

## Adding skipped components

Edit `.scenar/views.custom.tsx` to add them manually:

```tsx
import { HomePage } from "../src/app/page";
import { HomePage } from "../src/app/page";
import { AuthContext } from "../src/auth/context";
import { Page } from "../src/app/sessions/[id]/page";
import { Page } from "../src/app/sessions/[id]/page";

export const customViews = {
  HomePage,
  HomePage,
  AuthContext,
  Page,
  Page,
} as const;
```

## Scan metadata

- **Framework:** nextjs
- **Entry point:** src/app/layout.tsx
- **Detected providers:** SessionNavigationProvider
