package main

import (
	"os"
	"path/filepath"
	"testing"
)

// ============================================================================
// loadSchemas — the shared loading layer under every NewGenerator caller
// (today: the mcp-ts target, one Generator per resource directory). These
// tests pin the layout contract that target depends on: config JSONs from
// tasks/ (or the directory root when there is no tasks/), shared types from
// types/ and tasks/types/, name-keyed dedup, and domain stamping.
// ============================================================================

func writeSchemaFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

// TestLoadSchemasResourceDirShape pins the exact shape mcp-ts loads: a
// resource spec JSON at the directory root plus its types/ subdirectory
// (e.g. schemas/agentic/agent/{agent.json, types/*.json}).
func TestLoadSchemasResourceDirShape(t *testing.T) {
	dir := t.TempDir()
	writeSchemaFile(t, dir, "agent.json", `{
		"name": "AgentSpec",
		"protoType": "ai.stigmer.agentic.agent.v1.AgentSpec",
		"protoFile": "apis/ai/stigmer/agentic/agent/v1/spec.proto",
		"fields": [{"name": "Description", "jsonName": "description", "protoField": "description", "type": {"kind": "string"}}]
	}`)
	writeSchemaFile(t, filepath.Join(dir, "types"), "subagent.json", `{
		"name": "SubAgent",
		"protoType": "ai.stigmer.agentic.agent.v1.SubAgent",
		"protoFile": "apis/ai/stigmer/agentic/agent/v1/spec.proto",
		"fields": [{"name": "Name", "jsonName": "name", "protoField": "name", "type": {"kind": "string"}}]
	}`)

	gen, err := NewGenerator(dir, t.TempDir(), "agent")
	if err != nil {
		t.Fatalf("NewGenerator: %v", err)
	}

	// The root spec loads as a task config; buildMcpGen later promotes it
	// to a resource spec by shape.
	if len(gen.taskConfigs) != 1 || gen.taskConfigs[0].Name != "AgentSpec" {
		t.Fatalf("taskConfigs = %+v, want the single root spec AgentSpec", gen.taskConfigs)
	}
	if len(gen.sharedTypes) != 1 || gen.sharedTypes[0].Name != "SubAgent" {
		t.Fatalf("sharedTypes = %+v, want the single types/ entry SubAgent", gen.sharedTypes)
	}
	if got := gen.sharedTypes[0].Domain; got != "agentic" {
		t.Errorf("shared type Domain = %q, want %q (stamped from proto namespace)", got, "agentic")
	}
}

// TestLoadSchemasTasksDirPreferred pins that a tasks/ subdirectory takes
// precedence over root JSONs, and that tasks/types/ contributes shared types.
func TestLoadSchemasTasksDirPreferred(t *testing.T) {
	dir := t.TempDir()
	// A root JSON that must NOT load once tasks/ exists.
	writeSchemaFile(t, dir, "ignored.json", `{"name": "Ignored", "fields": []}`)
	writeSchemaFile(t, filepath.Join(dir, "tasks"), "httpcall.json", `{
		"name": "HttpCallTaskConfig",
		"kind": "HTTP_CALL",
		"protoType": "ai.stigmer.agentic.workflow.v1.HttpCallTaskConfig",
		"protoFile": "apis/ai/stigmer/agentic/workflow/v1/tasks/http_call.proto",
		"fields": []
	}`)
	writeSchemaFile(t, filepath.Join(dir, "tasks", "types"), "endpoint.json", `{
		"name": "HttpEndpoint",
		"protoType": "ai.stigmer.agentic.workflow.v1.HttpEndpoint",
		"protoFile": "apis/ai/stigmer/agentic/workflow/v1/tasks/http_call.proto",
		"fields": []
	}`)

	gen, err := NewGenerator(dir, t.TempDir(), "gen")
	if err != nil {
		t.Fatalf("NewGenerator: %v", err)
	}

	if len(gen.taskConfigs) != 1 || gen.taskConfigs[0].Name != "HttpCallTaskConfig" {
		t.Fatalf("taskConfigs = %+v, want only tasks/httpcall.json (root JSONs ignored when tasks/ exists)", gen.taskConfigs)
	}
	if len(gen.sharedTypes) != 1 || gen.sharedTypes[0].Name != "HttpEndpoint" {
		t.Fatalf("sharedTypes = %+v, want the tasks/types/ entry HttpEndpoint", gen.sharedTypes)
	}
}

// TestLoadSchemasTypeDedup pins that shared types are deduplicated by name
// across types/ and tasks/types/ — first occurrence wins.
func TestLoadSchemasTypeDedup(t *testing.T) {
	dir := t.TempDir()
	writeSchemaFile(t, filepath.Join(dir, "tasks"), "noop.json", `{"name": "NoopTaskConfig", "fields": []}`)
	writeSchemaFile(t, filepath.Join(dir, "types"), "shared.json", `{
		"name": "SharedThing",
		"protoType": "ai.stigmer.commons.apiresource.SharedThing",
		"fields": [{"name": "First", "jsonName": "first", "protoField": "first", "type": {"kind": "string"}}]
	}`)
	writeSchemaFile(t, filepath.Join(dir, "tasks", "types"), "shared.json", `{
		"name": "SharedThing",
		"protoType": "ai.stigmer.agentic.workflow.v1.SharedThing",
		"fields": []
	}`)

	gen, err := NewGenerator(dir, t.TempDir(), "gen")
	if err != nil {
		t.Fatalf("NewGenerator: %v", err)
	}

	if len(gen.sharedTypes) != 1 {
		t.Fatalf("sharedTypes has %d entries, want 1 (deduplicated by name)", len(gen.sharedTypes))
	}
	// types/ loads before tasks/types/, so the commons variant wins.
	if got := gen.sharedTypes[0].Domain; got != "commons" {
		t.Errorf("deduped type Domain = %q, want %q (first occurrence wins)", got, "commons")
	}
}

// TestLoadSchemasEmptyDirFails pins the loud failure when a schema directory
// yields nothing — a misconfigured --schema-dir must not produce a silent
// no-op generator.
func TestLoadSchemasEmptyDirFails(t *testing.T) {
	if _, err := NewGenerator(t.TempDir(), t.TempDir(), "gen"); err == nil {
		t.Fatal("NewGenerator on an empty schema dir succeeded, want error")
	}
}
