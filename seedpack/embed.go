// Package seedpack provides embedded system resources for Stigmer server bootstrap.
//
// The seedpack is a standard Stigmer project embedded in the binary at build time.
// On first server start, the CLI extracts it to a temp directory and runs
// `stigmer apply` — the same code path used for any user project.
//
// Embedded directories:
//   - stigmer.yaml: Project manifest (declares this as a Stigmer project)
//   - organizations/: Organization YAML definitions
//   - skills/: Skill directories (SKILL.md, scripts, references)
//   - agents/: System agent YAML definitions
//   - workflows/: System workflow YAML definitions
//   - mcp-servers/: MCP server YAML definitions
//
// Excluded (not embedded, so they never reach the bootstrap apply path):
//   - tools/: Build-time regeneration scripts, not runtime content
//   - icons/: UI assets, not runtime content
//   - canary/: CI canary-credential tracking metadata (no kind), not a resource
package seedpack

import "embed"

//go:embed stigmer.yaml
//go:embed skills
//go:embed agents
//go:embed workflows
//go:embed mcp-servers
//go:embed organizations
var content embed.FS
