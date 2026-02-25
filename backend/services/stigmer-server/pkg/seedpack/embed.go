// Package seedpack provides embedded system resources for offline-first bootstrap.
//
// The seedpack contains vendored skills (like skill-creator from Anthropic), system
// agents, and MCP server definitions that are embedded in the binary at build time.
// This enables:
//   - Offline server bootstrap (no network required)
//   - Supply-chain security (pinned content with provenance tracking)
//   - Reproducible deployments (content digest verification)
//
// Resources are discovered by convention at runtime (no manifest file):
//   - skills/{name}/SKILL.md    -> skill to bootstrap
//   - agents/{name}.yaml        -> system agent to bootstrap
//   - mcp-servers/{name}.yaml   -> MCP server to bootstrap
//
// Architecture follows K3s packaged components pattern: bundled content applied on
// startup with integrity controls.
package seedpack

import "embed"

// content embeds the seedpack resource directories at build time.
//
// Embedded directories:
//   - skills/: Raw skill content (SKILL.md, scripts, references)
//   - agents/: System agent YAML definitions for bootstrap
//   - mcp-servers/: MCP server YAML definitions for bootstrap
//
// Excluded:
//   - tools/: Build-time scripts, not runtime content
//
//go:embed skills
//go:embed agents
//go:embed mcp-servers
var content embed.FS
