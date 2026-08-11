package workflow

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"

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
//
// On failure: reverts the version hash from workflow state so the workflow
// persists without version tracking. This maintains the invariant that
// a set versionHash always has a resolvable audit entry.
type saveVersionAuditStep struct {
	store store.Store
	// isCreate skips the version-changed gate (the first version always archives).
	isCreate bool
	// persistOnRevert re-persists the workflow after clearing the version hash on
	// archive failure. Required when this step runs AFTER the final persist (the
	// create path archives last, so default_instance_id is captured); on the
	// update path a Persist step follows, so the revert is flushed there instead.
	persistOnRevert bool
}

func newSaveVersionAuditStep(s store.Store, isCreate, persistOnRevert bool) *saveVersionAuditStep {
	return &saveVersionAuditStep{store: s, isCreate: isCreate, persistOnRevert: persistOnRevert}
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

	// Rollback applies repoint, never duplicate (stigmer/stigmer#341): when the
	// caller re-applies a prior version's spec, the canonical rendering
	// reproduces that version's hash, so the content is already archived.
	// Versions are content-addressed identities — one content, one history
	// entry — so the head simply repoints to the existing row (the hash chain
	// was already set by populateVersionHashStep) and only the tag assignment
	// below still runs. Inserting again would give the tag single-holder
	// UPDATE two targets and make hash lookups ambiguous. An unexpected
	// lookup failure degrades to archiving anyway: a possible duplicate row
	// beats a failed apply.
	var existingSnapshot workflowv1.Workflow
	lookupErr := s.store.GetAuditByHash(ctx.Context(), kind, workflowID, versionHash, &existingSnapshot)
	alreadyArchived := lookupErr == nil
	if lookupErr != nil && !errors.Is(lookupErr, store.ErrAuditNotFound) {
		log.Warn().
			Err(lookupErr).
			Str("workflow_id", workflowID).
			Str("version_hash", truncateHash(versionHash)).
			Msg("Could not check for an existing archived version — archiving anyway")
	}

	if !alreadyArchived {
		// Archive the snapshot tagless. The tag lives only in the audit tag column
		// (the source of truth), assigned below through the single-holder primitive.
		// Snapshot blobs are never the tag's home, so a later tag move never rewrites
		// this immutable content.
		if err := s.store.SaveAudit(ctx.Context(), kind, workflowID, wf, versionHash, ""); err != nil {
			log.Error().
				Err(err).
				Str("workflow_id", workflowID).
				Str("version_hash", truncateHash(versionHash)).
				Msg("Failed to save workflow version audit — reverting version hash to maintain audit-resolvability invariant")

			// Revert: clear version hash so the persisted workflow doesn't reference
			// an audit entry that doesn't exist. The workflow is still created/updated
			// successfully, but without version tracking for this apply.
			wf.Status.VersionHash = ""
			if wf.Metadata != nil && wf.Metadata.Version != nil {
				wf.Metadata.Version.Id = ""
			}
			ctx.SetNewState(wf)

			// When this step runs after the final persist (create path), flush the
			// reverted state ourselves — there is no downstream persist to do it.
			if s.persistOnRevert {
				if perr := s.store.SaveResource(ctx.Context(), kind, workflowID, wf); perr != nil {
					log.Error().
						Err(perr).
						Str("workflow_id", workflowID).
						Msg("Failed to re-persist workflow after reverting version hash")
				}
			}
			return nil
		}
	}

	// Assign the requested tag through SetAuditTag — the one primitive shared
	// with the tagVersion RPC — so apply-time tagging obeys the same
	// single-holder invariant (a tag names exactly one version). The head
	// version (freshly archived or repointed-to) becomes the tag's sole
	// holder; any prior holder is cleared.
	if tag != "" {
		if err := s.store.SetAuditTag(ctx.Context(), kind, workflowID, versionHash, tag); err != nil {
			log.Error().
				Err(err).
				Str("workflow_id", workflowID).
				Str("version_hash", truncateHash(versionHash)).
				Str("tag", tag).
				Msg("Archived version but failed to assign its tag — clearing the live tag to stay consistent with the audit column")

			// The audit head is now untagged; keep the live head consistent so
			// get / getByReference never advertise a tag the store cannot resolve.
			if wf.Metadata != nil && wf.Metadata.Version != nil {
				wf.Metadata.Version.Tag = ""
				ctx.SetNewState(wf)
			}
		}
	}

	if alreadyArchived {
		log.Info().
			Str("workflow_id", workflowID).
			Str("version_hash", truncateHash(versionHash)).
			Str("tag", tag).
			Msg("Version content already archived — repointed head without a new history row")
	} else {
		log.Info().
			Str("workflow_id", workflowID).
			Str("version_hash", truncateHash(versionHash)).
			Str("tag", tag).
			Msg("Archived workflow version to audit history")
	}

	return nil
}

func truncateHash(hash string) string {
	if len(hash) > 12 {
		return hash[:12] + "..."
	}
	return hash
}

// mapWorkflowToVersionEntry converts an archived Workflow proto to a
// WorkflowVersionEntry.
//
// The tag is passed in by the caller from the audit tag column (the source of
// truth), never read from the embedded snapshot: a snapshot's tag is only
// correct as of archival time, whereas the column reflects the current tag even
// after a tag move.
func mapWorkflowToVersionEntry(wf *workflowv1.Workflow, isCurrent bool, tag string) *workflowv1.WorkflowVersionEntry {
	entry := &workflowv1.WorkflowVersionEntry{
		IsCurrent: isCurrent,
		Tag:       tag,
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
	}

	return entry
}
