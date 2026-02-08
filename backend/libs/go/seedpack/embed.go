// Package seedpack provides embedded system skills for offline-first bootstrap.
//
// The seedpack contains vendored skills (like skill-creator from Anthropic) that are
// embedded in the binary at build time. This enables:
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
//   - manifest.json: Seedpack metadata and skill/agent registry
//   - skills/*: Raw skill content (SKILL.md, scripts, references)
//   - artifacts/*: Pre-built ZIP artifacts for bootstrap (created by vendor_skill.sh)
//   - agents/*: System agent YAML definitions for bootstrap
//
// Excluded:
//   - tools/: Build-time scripts, not runtime content
//
//go:embed manifest.json
//go:embed skills/*
//go:embed artifacts/*
//go:embed agents/*
var content embed.FS
