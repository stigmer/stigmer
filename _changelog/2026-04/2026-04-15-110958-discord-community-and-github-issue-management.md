# Discord Community Management and GitHub Issue Lifecycle

**Date**: April 15, 2026

## Summary

Established the operational foundation for the Stigmer Community Discord server and standardized GitHub issue management for the open-source repo. Two Cursor action rules now bridge Discord and GitHub: one for daily community health scanning and response drafting, another for GitHub issue triage, resolution, and cross-platform notification. GitHub issue templates ensure structured community contributions from day one.

## Problem Statement

The Stigmer Community Discord launched with no operational tooling — no structured channels, no response workflow, no way to track which community messages had been addressed. GitHub issues had no templates, no standardized labeling convention, and no lifecycle management. The two systems were disconnected: fixing a bug on GitHub didn't notify the person who reported it on Discord, and triaging a Discord message didn't create or label the corresponding GitHub issue.

### Pain Points

- Community messages in Discord could go unanswered with no visibility into response times
- No classification system for message types (bugs vs features vs questions)
- GitHub issues had inconsistent or missing labels
- No process for closing the loop — fixing an issue didn't notify the Discord reporter
- Secrets (bot token) needed secure management without hardcoding

## Solution

Two complementary Cursor action rules that together manage the full community interaction lifecycle, backed by a Discord bot for API access and Planton Cloud for secret management.

## Implementation Details

### Discord Community Health Rule (`@discord-community-health`)

- Fetches Discord bot credentials from Planton Cloud MCP at runtime (secrets group: `discord-bot`)
- Scans `#general` and `#show-and-tell` for unanswered community messages
- Classifies messages (bug, feature, integration/SDK, general) and tags them with reaction emojis (bug: bug, feature: lightbulb, SDK: plug, acknowledged: eyes)
- Cross-references GitHub issue links in messages to check issue state
- Drafts responses following the vocabulary and tone guidelines from `docs/vocabulary.md`
- Sends responses only after explicit user approval
- Reports community health: response time compliance, stale threads, role coverage, channel scaling signals
- Treats `swarupdonepudi` as a community member regardless of Discord roles (co-founder playing the role of first user for genuine feedback)

### GitHub Issue Triage Rule (`@github-issue-triage`)

- **Triage mode**: Scans for unlabeled issues, classifies them, suggests type + component + priority + source labels
- **Resolve mode**: Closes GitHub issues with a comment, finds linked Discord messages, posts resolution replies, adds checkmark reactions
- **Health report mode**: Open issue stats, stale issue detection, missing label flags, weekly close summary
- Uses `gh` CLI for all GitHub operations and Discord REST API (via Planton MCP) for cross-posting

### GitHub Issue Templates

- `bug_report.md`: Structured template with sections for reproduction steps, environment, error output
- `feature_request.md`: Structured template with use case, current behavior, proposed solution
- `config.yml`: Redirects "Question" type to Discord instead of creating a GitHub issue

### Discord Server Structure

- Minimal-channels approach: `#general` (all conversation), `#announcements` (read-only releases), `#show-and-tell` (community showcase)
- Three roles: Maintainer (indigo), Contributor (emerald), Early Adopter (amber)
- Channel permissions: `#announcements` is Maintainer-write-only
- All resource IDs stored in Planton `discord-bot-config` variables group with YAML backup in `stigmer-cloud/_ops/`

### Label Taxonomy

Standardized across type, component, priority, source, and status dimensions. 25 labels total, including new additions: `community`, `source: discord`, `status: in-progress`, `component: gateway`, `component: iam`, `component: sdk-react`.

## Benefits

- **Response time visibility**: The health rule flags any community message unanswered for 4+ hours and marks 24h+ as urgent
- **Closed-loop resolution**: Fixing a GitHub issue triggers a Discord notification to the original reporter
- **Consistent triage**: Every issue gets classified with the same label taxonomy
- **Zero hardcoded secrets**: Bot token lives in Planton, fetched at runtime via MCP
- **Structured community input**: Issue templates guide reporters to provide reproduction steps and environment details
- **Scalable foundation**: Emoji tagging works now; the rule includes a scaling signal to suggest channel splitting when `#general` exceeds 50 messages/day

## Impact

- Community members (starting with swarupdonepudi's 3 initial reports) get timely, well-crafted responses
- Maintainers have a single daily workflow: invoke `@discord-community-health`, review drafts, approve
- Issue resolution automatically notifies Discord — no manual cross-posting needed
- The operational cost of community management drops to ~10 minutes/day

## Related Work

- Discord bot credentials: Planton secrets group `discord-bot` and variables group `discord-bot-config`
- YAML backups: `stigmer-cloud/_ops/planton/service-hub/secrets-group/discord-bot.yaml` and `stigmer-cloud/_ops/planton/service-hub/variables-group/discord-bot-config.yaml`
- Vocabulary and tone: `docs/vocabulary.md`
- Existing commit/PR rules: `.cursor/rules/commit-stigmer-oss-changes.mdc`, `.cursor/rules/create-stigmer-oss-pull-request.mdc`

---

**Status**: Production Ready
**Timeline**: Single session
