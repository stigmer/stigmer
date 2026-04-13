# Task T06: Frontend — Disconnect + Connection Health + Error UX

**Created**: 2026-04-13 11:03
**Status**: NOT STARTED
**Repo**: stigmer
**Estimated scope**: ~6-8 files
**Depends on**: T02 (disconnect backend), T03 (error UX backend)

## Objective

Build the frontend for Phase 1 gap fixes: disconnect button, connection health display, and improved error messages. These changes apply to the existing OAuth flow (no BYOA yet).

## Context

This task consumes the backend work from T02 (disconnect RPC, connection health) and T03 (improved error messages). It modifies the shared component surface (ConnectBar, ConfigPanel) that T07 will further extend for BYOA.

### Key files to modify

- `sdk/react/src/mcp-server/useMcpServerCredentials.ts` — consume new fields
- `sdk/react/src/mcp-server/useOAuthGrantStatus.ts` — expose `connectionHealth`
- `sdk/react/src/mcp-server/McpServerDetailView.tsx` — ConnectBar UI changes
- `sdk/react/src/mcp-server/McpServerConfigPanel.tsx` — InlineOAuthSignIn changes

## Deliverables

### 1. `useDisconnectOAuth` hook

New hook at `sdk/react/src/mcp-server/useDisconnectOAuth.ts`:

```typescript
export function useDisconnectOAuth(): {
  disconnect: (mcpServerId: string, org: string) => Promise<boolean>;
  isDisconnecting: boolean;
  error: Error | null;
}
```

Wraps the `disconnectOAuth` RPC. After successful disconnect, callers should `refetch` grant status and credentials.

### 2. Enhance `useOAuthGrantStatus`

Add `connectionHealth` to the return type (maps from the new `OAuthConnectionHealth` proto enum). This is a direct pass-through from the RPC response.

### 3. Enhance `useMcpServerCredentials`

New derived state:
- `connectionHealth` — from grant status
- `canDisconnect` — `true` when `isOAuthConnected` (grant exists)
- Pass `connectionHealth` through to consumers

### 4. ConnectBar changes in `McpServerDetailView`

**Connection health display** (replaces simple "Connected" / "Not connected"):

| Health | Pill | Detail text |
|--------|------|------------|
| `HEALTHY` | Green "Connected" | "Tokens refresh automatically - Expires in {X}d" (existing) |
| `TOKEN_EXPIRED_REFRESHABLE` | Amber "Token expired" | "Token will be refreshed automatically on next use" |
| `TOKEN_EXPIRED` | Red "Re-authentication needed" | "Your token has expired. Sign in again to reconnect." |
| `NO_GRANT` | Muted "Not connected" | (existing) |

**Disconnect button:**
- Shown as a secondary action (icon button or dropdown item) when connected
- Confirmation dialog: "Disconnect from {serverName}? This will remove your saved credentials."
- After disconnect: refetch grant status + credentials

**Improved error display:**
- Strip any raw Temporal/gRPC metadata from error messages
- Show error in an alert/banner with clear remediation text
- Add "Try again" button that re-attempts connect

### 5. InlineOAuthSignIn changes in `McpServerConfigPanel`

Mirror the health display from ConnectBar:
- Health-aware status pill (green/amber/red)
- Disconnect action
- Better error display

### 6. Export new hook from `sdk/react/src/mcp-server/index.ts`

Add `useDisconnectOAuth` to the public API surface.

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `useDisconnectOAuth.ts` | Create | New hook |
| `useOAuthGrantStatus.ts` | Modify | Add `connectionHealth` |
| `useMcpServerCredentials.ts` | Modify | Add `connectionHealth`, `canDisconnect` |
| `McpServerDetailView.tsx` | Modify | Health display, disconnect button, error UX |
| `McpServerConfigPanel.tsx` | Modify | Health display, disconnect in InlineOAuthSignIn |
| `index.ts` | Modify | Export new hook |

## Acceptance Criteria

- [ ] Disconnect button appears when user is connected
- [ ] Disconnect cleans up and UI reverts to "Not connected"
- [ ] Connection health pill accurately reflects token state
- [ ] Expired-but-refreshable tokens show amber (not red)
- [ ] Connect failure errors are human-readable with remediation hints
- [ ] No raw Temporal/gRPC metadata shown to users
- [ ] All existing OAuth sign-in + manual token flows unchanged

## Predecessor Tasks

T02 (disconnect + health backend), T03 (error UX backend)

## Successor Tasks

T07 (frontend BYOA — extends the same components)
