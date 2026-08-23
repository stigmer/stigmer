#!/usr/bin/env bash
# Regenerates src/store/sqlite/__tests__/fixtures/go-v6-database.sql — the
# migration-adoption fixture (sub-project DD-002): a REAL database created by
# the Go server's storage code at schema v6, captured as a reviewable SQL
# text dump. The driver tests reconstruct the binary database from this dump
# and prove the TS migrations adopt it (schema_version 6 → 7, all rows
# preserved, out-of-chain tables intact).
#
# Requires: go (the repo toolchain) and the sqlite3 CLI. Run from anywhere;
# paths are derived from the repo root. The generator Go program is written
# into a throwaway directory inside the stigmer-server module (it imports
# that module's internal store packages) and removed afterwards.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
service_dir="$repo_root/backend/services/stigmer-server-ts"
gen_dir="$repo_root/backend/services/stigmer-server/fixturegen-tmp"
out_file="$service_dir/src/store/sqlite/__tests__/fixtures/go-v6-database.sql"
db_dir="$(mktemp -d)"
db_file="$db_dir/stigmer.db"

cleanup() {
  rm -rf "$gen_dir" "$db_dir"
}
trap cleanup EXIT

mkdir -p "$gen_dir" "$(dirname "$out_file")"

cat > "$gen_dir/main.go" <<'EOF'
// Throwaway fixture generator (written by regen-go-db-fixture.sh, never
// committed): creates a database through the REAL Go storage code paths —
// sqlite store migrations v1-v6, resource/audit/bootstrap writes, and the
// three out-of-chain consumer stores — then exits. The shell script dumps
// the file to SQL text.
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	mcpserveroauth "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/mcpserver/oauth"
	dedupe "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/dedupe"
)

func main() {
	if err := run(os.Args[1]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(dbPath string) error {
	ctx := context.Background()

	s, err := sqlite.NewStore(dbPath)
	if err != nil {
		return err
	}
	defer s.Close()

	org := &organizationv1.Organization{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Organization",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "acme",
			Name: "Acme",
			Slug: "acme",
			Org:  "",
		},
		Spec: &organizationv1.OrganizationSpec{Description: "fixture org"},
	}
	if err := s.SaveResource(ctx, apiresourcekind.ApiResourceKind_organization, "acme", org); err != nil {
		return err
	}
	if err := s.SaveAudit(ctx, apiresourcekind.ApiResourceKind_organization, "acme", org, "hash-v1", "stable"); err != nil {
		return err
	}
	if err := s.SetBootstrapState(ctx, "seedpack_version", "1.1.0"); err != nil {
		return err
	}
	if _, err := s.AppendWorkflowExecutionEvents(ctx, "wfe_fixture", []*store.WorkflowExecutionEventRecord{
		{ExecutionID: "wfe_fixture", SequenceNumber: 1, EventType: "task_started", TaskName: "step-a", Data: []byte{0x0a}},
		{ExecutionID: "wfe_fixture", SequenceNumber: 2, EventType: "task_completed", TaskName: "step-a", Data: []byte{0x0b}},
	}); err != nil {
		return err
	}
	if err := s.UpsertScheduleRun(ctx, &store.ScheduleRunRecord{
		ScheduleID: "sch_fixture", Org: "acme", NominalFireTime: "2026-08-20T00:00:00Z",
		Origin: "cron", Outcome: "completed", RecordedAt: "2026-08-20T00:00:01Z",
		CompletedAt: "2026-08-20T00:00:05Z",
	}); err != nil {
		return err
	}
	if err := s.UpsertSearchIndex(ctx, apiresourcekind.ApiResourceKind_organization, "acme", &store.SearchIndexEntry{
		Name: "Acme", Description: "fixture org", Org: "acme",
		Visibility: "visibility_org", CreatedAt: 1755648000,
	}); err != nil {
		return err
	}

	// The out-of-chain tables, created and populated through the real
	// consumer stores exactly as a live Go server would.
	dedupeStore, err := dedupe.NewSQLiteSignalDedupeStore(s.DB())
	if err != nil {
		return err
	}
	if _, err := dedupeStore.Claim(ctx, "acme", "fixture-key", "wfe_fixture", "resume", dedupe.InFlightClaimTTL); err != nil {
		return err
	}
	if err := dedupeStore.MarkDelivered(ctx, "acme", "fixture-key"); err != nil {
		return err
	}

	grants, err := mcpserveroauth.NewOAuthGrantStore(s.DB())
	if err != nil {
		return err
	}
	if err := grants.Upsert(ctx, &mcpserveroauth.OAuthGrant{
		IdentityAccountID: "ida_fixture", ResourceID: "mcp_fixture",
		ResourceKind: "mcp_server", OrgID: "acme", ClientID: "client-1",
		AuthMethod: "mcp_oauth", TokenEndpoint: "https://example.test/token",
		AccessTokenEnvVar: "TOKEN", EnvironmentID: "env_fixture",
	}); err != nil {
		return err
	}

	pending, err := mcpserveroauth.NewPendingOAuthStateStore(s.DB())
	if err != nil {
		return err
	}
	if err := pending.Save(ctx, &mcpserveroauth.PendingOAuthState{
		State: "state-fixture", CodeVerifier: "enc:v1:sealed", ClientID: "client-1",
		TokenEndpoint: "https://example.test/token", McpServerID: "mcp_fixture",
		IdentityAccountID: "ida_fixture", TargetEnvVar: "TOKEN",
		AuthMethod: "mcp_oauth", RedirectURI: "http://127.0.0.1/cb", Org: "acme",
		CreatedAt: 1755648000,
	}); err != nil {
		return err
	}

	return nil
}
EOF

echo "Generating Go database at $db_file ..."
(cd "$repo_root" && go run "$gen_dir/main.go" "$db_file")

# Checkpoint the WAL so the dump sees every write, then dump to SQL text.
sqlite3 "$db_file" "PRAGMA wal_checkpoint(TRUNCATE);" > /dev/null

{
  echo "-- Generated by scripts/regen-go-db-fixture.sh — a REAL Go-created"
  echo "-- stigmer database at schema v6, for the TS driver's migration-"
  echo "-- adoption tests (sub-project DD-002). Do not edit by hand."
  sqlite3 "$db_file" .dump
} > "$out_file"

echo "Wrote $(wc -l < "$out_file") lines to $out_file"
