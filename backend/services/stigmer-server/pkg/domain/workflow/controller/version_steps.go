package workflow

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/rs/zerolog/log"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

const (
	VersionHashKey    = "version_hash"
	VersionChangedKey = "version_changed"
)

// computeVersionHashStep computes SHA-256 of the generated CNCF YAML.
//
// The hash is deterministic because the YAML converter produces stable output
// from structured proto input. This means "same workflow spec = same YAML = same hash."
//
// Stores the computed hash in context under VersionHashKey for downstream steps.
type computeVersionHashStep struct{}

func newComputeVersionHashStep() *computeVersionHashStep {
	return &computeVersionHashStep{}
}

func (s *computeVersionHashStep) Name() string {
	return "ComputeVersionHash"
}

func (s *computeVersionHashStep) Execute(ctx *pipeline.RequestContext[*workflowv1.Workflow]) error {
	wf := ctx.NewState()
	yaml := wf.GetStatus().GetServerlessWorkflowValidation().GetYaml()
	if yaml == "" {
		log.Debug().Msg("No YAML in validation status — skipping version hash computation")
		return nil
	}

	hash := sha256.Sum256([]byte(yaml))
	hexHash := hex.EncodeToString(hash[:])

	ctx.Set(VersionHashKey, hexHash)

	log.Debug().
		Str("version_hash", hexHash[:12]+"...").
		Int("yaml_length", len(yaml)).
		Msg("Computed workflow version hash")

	return nil
}

// checkVersionChangedStep compares the new version hash against the existing
// workflow's status.version_hash. Sets VersionChangedKey in context.
//
// This step enables downstream steps (audit, metadata) to skip work when
// the spec hasn't actually changed (idempotent applies).
type checkVersionChangedStep struct{}

func newCheckVersionChangedStep() *checkVersionChangedStep {
	return &checkVersionChangedStep{}
}

func (s *checkVersionChangedStep) Name() string {
	return "CheckVersionChanged"
}

func (s *checkVersionChangedStep) Execute(ctx *pipeline.RequestContext[*workflowv1.Workflow]) error {
	newHash, _ := ctx.Get(VersionHashKey).(string)
	if newHash == "" {
		ctx.Set(VersionChangedKey, false)
		return nil
	}

	wf := ctx.NewState()
	existingHash := wf.GetStatus().GetVersionHash()

	changed := newHash != existingHash
	ctx.Set(VersionChangedKey, changed)

	if changed {
		log.Debug().
			Str("old_hash", truncateHash(existingHash)).
			Str("new_hash", truncateHash(newHash)).
			Msg("Workflow version changed")
	} else {
		log.Debug().
			Str("hash", truncateHash(newHash)).
			Msg("Workflow version unchanged — skipping audit")
	}

	return nil
}

// populateVersionHashStep writes the computed version hash into
// workflow.status.version_hash and sets up metadata.version fields.
//
// On create: always populates (no previous version exists).
// On update: only populates if VersionChangedKey is true.
type populateVersionHashStep struct {
	isCreate bool
}

func newPopulateVersionHashStep(isCreate bool) *populateVersionHashStep {
	return &populateVersionHashStep{isCreate: isCreate}
}

func (s *populateVersionHashStep) Name() string {
	return "PopulateVersionHash"
}

func (s *populateVersionHashStep) Execute(ctx *pipeline.RequestContext[*workflowv1.Workflow]) error {
	newHash, _ := ctx.Get(VersionHashKey).(string)
	if newHash == "" {
		return nil
	}

	if !s.isCreate {
		changed, _ := ctx.Get(VersionChangedKey).(bool)
		if !changed {
			return nil
		}
	}

	wf := ctx.NewState()

	// Set version_hash in status
	if wf.Status == nil {
		wf.Status = &workflowv1.WorkflowStatus{}
	}
	previousHash := wf.Status.VersionHash
	wf.Status.VersionHash = newHash

	// Set metadata.version chain
	if wf.Metadata != nil {
		if wf.Metadata.Version == nil {
			wf.Metadata.Version = &apiresource.ApiResourceMetadataVersion{}
		}
		wf.Metadata.Version.Id = newHash
		wf.Metadata.Version.PreviousVersionId = previousHash
	}

	ctx.SetNewState(wf)

	log.Debug().
		Str("version_hash", truncateHash(newHash)).
		Str("previous", truncateHash(previousHash)).
		Msg("Populated version hash in workflow status and metadata")

	return nil
}

// saveVersionAuditStep archives the workflow to the resource_audit table.
//
// On create: always saves (first version).
// On update: only saves if VersionChangedKey is true (idempotent).
//
// The audit entry stores the full Workflow protobuf including:
// - status.serverless_workflow_validation.yaml (the executable YAML)
// - status.version_hash (the content hash)
// - metadata.version.message (user description)
// - metadata.version.tag (optional tag)
type saveVersionAuditStep struct {
	store    store.Store
	isCreate bool
}

func newSaveVersionAuditStep(s store.Store, isCreate bool) *saveVersionAuditStep {
	return &saveVersionAuditStep{store: s, isCreate: isCreate}
}

func (s *saveVersionAuditStep) Name() string {
	return "SaveVersionAudit"
}

func (s *saveVersionAuditStep) Execute(ctx *pipeline.RequestContext[*workflowv1.Workflow]) error {
	if !s.isCreate {
		changed, _ := ctx.Get(VersionChangedKey).(bool)
		if !changed {
			return nil
		}
	}

	wf := ctx.NewState()
	versionHash := wf.GetStatus().GetVersionHash()
	if versionHash == "" {
		return nil
	}

	// Extract tag from metadata.version.tag (set by CLI --tag flag or API)
	tag := ""
	if wf.Metadata != nil && wf.Metadata.Version != nil {
		tag = wf.Metadata.Version.Tag
	}

	workflowID := wf.GetMetadata().GetId()
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())
	if kind == 0 {
		kind = apiresourcekind.ApiResourceKind_workflow
	}

	if err := s.store.SaveAudit(ctx.Context(), kind, workflowID, wf, versionHash, tag); err != nil {
		// Audit failure is non-fatal for backward compatibility.
		// The main resource is already persisted; log and continue.
		log.Error().
			Err(err).
			Str("workflow_id", workflowID).
			Str("version_hash", truncateHash(versionHash)).
			Msg("Failed to save workflow version audit — version history may be incomplete")
		return nil
	}

	log.Info().
		Str("workflow_id", workflowID).
		Str("version_hash", truncateHash(versionHash)).
		Str("tag", tag).
		Msg("Archived workflow version to audit history")

	return nil
}

func truncateHash(hash string) string {
	if len(hash) > 12 {
		return hash[:12] + "..."
	}
	return hash
}

// loadWorkflowByReferenceStep loads a workflow by ApiResourceReference with version support.
//
// Version resolution (mirroring Skill's LoadSkillByReferenceStep):
//   - Empty/"latest" → return current head from main resource collection
//   - If version matches main workflow's status.version_hash → return main
//   - If 64-char hex → query audit by hash
//   - Otherwise → query audit by tag (newest with that tag)
type loadWorkflowByReferenceStep struct {
	store store.Store
}

func newLoadWorkflowByReferenceStep(s store.Store) *loadWorkflowByReferenceStep {
	return &loadWorkflowByReferenceStep{store: s}
}

func (s *loadWorkflowByReferenceStep) Name() string {
	return "LoadWorkflowByReference"
}

func (s *loadWorkflowByReferenceStep) Execute(ctx *pipeline.RequestContext[*workflowv1.Workflow]) error {
	// This step is used differently — it's called from the query handler
	// with the ApiResourceReference available in context.
	// For now, the existing LoadByReferenceStep handles the basic case.
	// Version resolution is added to the GetByReference handler method.
	return nil
}

// getVersionStep retrieves a specific version entry from audit by hash.
type getVersionStep struct {
	store store.Store
}

func newGetVersionStep(s store.Store) *getVersionStep {
	return &getVersionStep{store: s}
}

func (s *getVersionStep) Name() string {
	return "GetVersion"
}

func (s *getVersionStep) Execute(ctx *pipeline.RequestContext[*workflowv1.GetWorkflowVersionInput]) error {
	input := ctx.Input()

	var workflow workflowv1.Workflow
	err := s.store.GetAuditByHash(
		ctx.Context(),
		apiresourcekind.ApiResourceKind_workflow,
		input.WorkflowId,
		input.VersionHash,
		&workflow,
	)
	if err != nil {
		if errors.Is(err, store.ErrAuditNotFound) {
			return fmt.Errorf("workflow version %s not found", input.VersionHash[:12]+"...")
		}
		return fmt.Errorf("failed to load workflow version: %w", err)
	}

	// Map to WorkflowVersionEntry
	entry := mapWorkflowToVersionEntry(&workflow, false)
	ctx.Set("versionEntry", entry)
	return nil
}

// mapWorkflowToVersionEntry converts an archived Workflow proto to a WorkflowVersionEntry.
func mapWorkflowToVersionEntry(wf *workflowv1.Workflow, isCurrent bool) *workflowv1.WorkflowVersionEntry {
	entry := &workflowv1.WorkflowVersionEntry{
		IsCurrent: isCurrent,
	}

	if wf.Status != nil {
		entry.VersionHash = wf.Status.VersionHash

		// Extract validated YAML for runner/viewer consumption
		if wf.Status.ServerlessWorkflowValidation != nil {
			entry.ValidatedYaml = wf.Status.ServerlessWorkflowValidation.Yaml
		}

		if wf.Status.Audit != nil && wf.Status.Audit.SpecAudit != nil {
			audit := wf.Status.Audit.SpecAudit
			entry.AppliedAt = audit.UpdatedAt
			if entry.AppliedAt == nil {
				entry.AppliedAt = audit.CreatedAt
			}
			entry.AppliedBy = audit.UpdatedBy
			if entry.AppliedBy == nil {
				entry.AppliedBy = audit.CreatedBy
			}
		}
	}

	if wf.Metadata != nil && wf.Metadata.Version != nil {
		entry.Message = wf.Metadata.Version.Message
		entry.Tag = wf.Metadata.Version.Tag
	}

	return entry
}
