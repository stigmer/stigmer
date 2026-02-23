// Package seedpack provides embedded system resources for offline-first bootstrap.
//
// The seedpack contains vendored skills (like skill-creator from Anthropic), system
// agents, and MCP server definitions that are embedded in the binary at build time.
// This enables:
//   - Offline server bootstrap (no network required)
//   - Supply-chain security (pinned content with provenance tracking)
//   - Reproducible deployments (content digest verification)
//
// Architecture follows K3s packaged components pattern: bundled content applied on
// startup with integrity controls.
package seedpack

import "embed"

// content embeds the seedpack files at build time.
//
// Embedded directories:
//   - manifest.json: Seedpack metadata and resource registry
//   - skills/*: Raw skill content (SKILL.md, scripts, references)
//   - agents/*: System agent YAML definitions for bootstrap
//   - mcp-servers/*: MCP server YAML definitions for bootstrap
//
// Excluded:
//   - tools/: Build-time scripts, not runtime content
//
//go:embed manifest.json
//go:embed skills/*
//go:embed agents/*
//go:embed mcp-servers/*
var content embed.FS
