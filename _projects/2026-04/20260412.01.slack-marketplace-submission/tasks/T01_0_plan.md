# Task T01: Slack Marketplace Submission Prerequisites

**Created**: 2026-04-12
**Status**: PENDING REVIEW
**Type**: Feature Development

## Objective

Complete all prerequisites for submitting the Stigmer Slack app (`A0AS6B4B97G`) to the Slack Marketplace, enabling multi-workspace MCP access for Stigmer agents.

## Background

Slack's MCP server only allows Marketplace-published or internal apps. The Stigmer Slack app currently works as an internal app on the Stigmer workspace. To enable customer workspaces, the app must be published to the Slack Marketplace.

### Current State

- App ID: `A0AS6B4B97G`
- MCP toggle: enabled
- Public distribution: deactivated (MCP works as internal app)
- `search:read` removed, granular `search:read.*` scopes in place
- OAuth flow: working end-to-end (user token `xoxp-` correctly extracted)
- Active workspace installs: 0 (need 5+)

### Slack Review Timeline

- Preliminary review: ~10 business days
- Functional review: up to 10 weeks (new submissions)
- Multiple review rounds possible

## Task Breakdown

### Phase 1: Scope and Config Cleanup

1. **Update seedpack and OAuthApp to match Slack app scopes**
   - [ ] Update `seedpack/mcp-servers/mcp-server-slack.yaml` -- remove `search:read` from `scope_hints`, add the granular `search:read.public` and `search:read.users` scopes
   - [ ] Update the `slack-oauth` OAuthApp document in MongoDB to match
   - [ ] Update the `slack-oauth` seed migration to use the new scopes
   - [ ] Verify the OAuth authorization URL uses `user_scope` parameter (already working via `scope_parameter_name`)

2. **Consider optional scopes**
   - [ ] Evaluate marking `search:read.public` and `search:read.users` as optional scopes (Slack's March 2026 feature)
   - [ ] If yes, update the OAuth flow to support `user_optional` scopes

### Phase 2: Listing Assets

3. **Prepare Marketplace listing content**
   - [ ] Write short description (max 140 chars)
   - [ ] Write long description (what Stigmer does, how Slack integration works, value proposition)
   - [ ] Prepare app icon (512x512 PNG, no rounded corners)
   - [ ] Capture 3-5 screenshots showing: MCP tool discovery, agent using Slack tools, OAuth consent screen
   - [ ] Record video demo (3-5 min): OAuth flow, setup, agent using Slack, uninstall

4. **Write scope justifications**
   - [ ] `channels:read` -- agents list channels for navigation and message routing
   - [ ] `chat:write` -- agents send messages on behalf of users
   - [ ] `users:read` -- agents resolve user identities for @-mention handling
   - [ ] `users:read.email` -- agents match identities across Stigmer and Slack
   - [ ] `search:read.public` -- agents search public channels for context
   - [ ] `search:read.users` -- agents search users for @-mentions and lookups

### Phase 3: Public Pages

5. **Create or identify required public pages**
   - [ ] Landing page with "Add to Slack" button (e.g., `stigmer.ai/integrations/slack`)
   - [ ] Support page (e.g., `stigmer.ai/support`)
   - [ ] Privacy policy page with GDPR/CCPA language (e.g., `stigmer.ai/privacy`)

6. **Configure Direct Install URL**
   - [ ] Set up in Slack app settings (Basic Information > Installing Your App)
   - [ ] URL must HTTP 302 redirect to `slack.com/oauth/v2/authorize` with correct scopes

### Phase 4: Get Installs

7. **Re-enable public distribution and gather installs**
   - [ ] Re-enable public distribution on the Slack app
   - [ ] Install on 5+ active workspaces (team members, beta users, partners)
   - [ ] Note: MCP won't work during this phase for non-internal apps -- installs just need to exist

### Phase 5: Test Account and Submission

8. **Prepare test account for Slack reviewers**
   - [ ] Create a Stigmer test account with credentials
   - [ ] Populate with dummy data (agents, sessions, MCP server connections)
   - [ ] Write clear testing instructions for reviewers

9. **Submit to Slack Marketplace**
   - [ ] Go to app settings > Submit to Slack Marketplace > Review & Submit
   - [ ] Complete all submission sections (listing, scopes, security, testing info)
   - [ ] Include video demo link
   - [ ] Submit for review

## Success Criteria for T01

- All scopes aligned between Slack app, seedpack YAML, and OAuthApp seed
- Marketplace listing content prepared and ready
- Public pages (landing, support, privacy) accessible
- Direct Install URL configured and working
- 5+ active workspace installs achieved
- Test account prepared for reviewers
- App submitted to Slack Marketplace review

## Risks

1. **5+ installs gate** -- may take time to gather; plan outreach to team/partners early
2. **Scope rejection** -- Slack may push back on `search:read.*` scopes; have clear justification ready
3. **Review feedback cycles** -- budget for 2-3 rounds of feedback before approval
4. **10-week timeline** -- functional review can take up to 10 weeks; start as early as possible

## Review Process

**What happens next**:
1. **You review this plan** -- take your time to consider the approach
2. **Provide feedback** -- share any concerns, suggestions, or changes
3. **I'll revise the plan** -- create an updated version incorporating your feedback
4. **You approve** -- give explicit approval to proceed
5. **Execution begins** -- implementation tracked in T01_3_execution.md
