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
// Only manifest.json and skills/* are embedded - tools/ is excluded as it's
// a build-time script, not runtime content.
//
//go:embed manifest.json
//go:embed skills/*
var content embed.FS
