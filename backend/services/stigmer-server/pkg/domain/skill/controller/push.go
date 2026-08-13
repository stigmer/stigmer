package skill

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourcelib "github.com/stigmer/stigmer/backend/libs/go/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/storage"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/transfer"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// Context keys for push operation
const (
	SkillKey              = "skill"              // The Skill being built (type transformation: PushSkillRequest → Skill)
	ArtifactBytesKey      = "pushArtifactBytes"  // Resolved artifact ZIP bytes (inline or staged — see ResolveArtifactSourceStep)
	ExtractResultKey      = "extractResult"      // Extracted SKILL.md content and hash
	ArtifactStorageKeyKey = "artifactStorageKey" // Storage key for the artifact
	ExistingSkillKey      = "existingSkill"      // Existing skill loaded by slug
	ShouldCreateSkillKey  = "shouldCreateSkill"  // Flag: true=create, false=update
)

// Push uploads a skill artifact and creates or updates the skill resource.
//
// This operation:
// 1. Validates the request using proto validation
// 2. Builds initial Skill resource from request
// 3. Generates slug from name using common library
// 4. Extracts SKILL.md from ZIP and calculates SHA256 hash
// 5. Checks if artifact exists and stores if new (deduplication)
// 6. Constructs resource ID (org-scoped or platform-scoped)
// 7. Loads existing skill if it exists
// 8. Archives previous version if updating
// 9. Updates skill with artifact info and timestamps
// 10. Persists skill to SQLite
//
// Pipeline leverages common steps where possible (ValidateProto, ResolveSlug, Persist)
// and uses custom steps only for push-specific logic (artifact handling).
//
// Security:
// - Uses google/safearchive to prevent path traversal and symlink attacks
// - Validates ZIP size and compression ratios (prevents ZIP bombs)
// - Extracts SKILL.md in memory only (executables never touch disk)
// - Stores sealed ZIP with restricted permissions (0600)
//
// Content-Addressable Storage:
// - Same content = same hash = single storage copy (deduplication)
// - Artifacts are immutable once stored
// - Multiple skills/versions can reference the same artifact
//
// Returns: The created or updated Skill resource (not PushSkillResponse)
func (c *SkillController) Push(ctx context.Context, req *skillv1.PushSkillRequest) (*skillv1.Skill, error) {
	// Create request context with the push request
	reqCtx := pipeline.NewRequestContext(ctx, req)

	// Build and execute push pipeline
	p := c.buildPushPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Return the built skill from context (stored by final step)
	skill := reqCtx.Get(SkillKey).(*skillv1.Skill)
	return skill, nil
}

// buildPushPipeline constructs the pipeline for push operations
//
// This pipeline converts PushSkillRequest → Skill:
// 1. Validates request
// 2. Builds initial Skill (without ID yet)
// 3. Extracts SKILL.md, parses frontmatter, and calculates hash
// 4. Resolves slug from extracted name
// 5. Finds existing skill by slug (sets shouldCreate flag + existing ID if found)
// 6. Generates ID if creating new (uses proper ID generation with prefix)
// 7. Checks/stores artifact with deduplication
// 8. Populates skill with artifact data and timestamps
// 9. Archives the NEW skill (for version history)
// 10. Persists to database
func (c *SkillController) buildPushPipeline() *pipeline.Pipeline[*skillv1.PushSkillRequest] {
	return pipeline.NewPipeline[*skillv1.PushSkillRequest]("skill-push").
		AddStep(steps.NewValidateProtoStep[*skillv1.PushSkillRequest]()). // 1. Validate request (incl. exactly-one artifact source)
		AddStep(c.newResolveArtifactSourceStep()).                        // 2. Resolve inline bytes or staged upload
		AddStep(c.newBuildInitialSkillStep()).                            // 3. Build Skill (no ID yet)
		AddStep(c.newExtractAndHashArtifactStep()).                       // 4. Extract SKILL.md + parse frontmatter
		AddStep(c.newResolveSlugForPushStep()).                           // 5. Resolve slug from extracted name
		AddStep(c.newFindExistingBySlugStep()).                           // 6. Find by slug
		AddStep(c.newGenerateIDIfNeededStep()).                           // 7. Generate ID if creating
		AddStep(c.newCheckAndStoreArtifactStep()).                        // 8. Store artifact
		AddStep(c.newPopulateSkillFieldsStep()).                          // 9. Populate fields
		AddStep(c.newArchiveCurrentSkillStep()).                          // 10. Archive NEW skill
		AddStep(c.newStoreSkillStep()).                                   // 11. Persist to DB
		AddStep(c.newIndexSkillSearchStep()).                             // 12. Update search index
		Build()
}

// ResolveArtifactSourceStep materializes the artifact ZIP bytes from
// whichever source the request carries (proto validation has already
// guaranteed exactly one):
//
//   - inline artifact bytes — the classic ≤10MB path, passed through as-is
//   - artifact_upload_ref — bytes staged via createArtifactUploadUrl + HTTP
//     PUT (#675); consumed here, which retires the single-use reference
//     regardless of how the rest of the pipeline fares
//
// Downstream steps read ArtifactBytesKey and never touch req.Artifact, so
// the two sources are indistinguishable past this point — same validation,
// hashing, dedup, and versioning either way.
type ResolveArtifactSourceStep struct {
	slots *transfer.UploadSlots
}

func (c *SkillController) newResolveArtifactSourceStep() *ResolveArtifactSourceStep {
	return &ResolveArtifactSourceStep{slots: c.transferSlots}
}

func (s *ResolveArtifactSourceStep) Name() string {
	return "ResolveArtifactSource"
}

func (s *ResolveArtifactSourceStep) Execute(ctx *pipeline.RequestContext[*skillv1.PushSkillRequest]) error {
	req := ctx.Input()

	if req.ArtifactUploadRef == "" {
		ctx.Set(ArtifactBytesKey, req.Artifact)
		return nil
	}

	if s.slots == nil {
		return grpclib.FailedPreconditionError("skill artifact transfer lane is not configured on this server")
	}
	data, err := s.slots.Consume(req.ArtifactUploadRef)
	if err != nil {
		// The reference is client-supplied state, not server fault: unknown,
		// expired, already consumed, or minted-but-never-uploaded all mean
		// the client must re-mint and re-upload.
		return grpclib.InvalidArgumentError("artifact_upload_ref not usable: %v — request a new upload URL via createArtifactUploadUrl", err)
	}
	ctx.Set(ArtifactBytesKey, data)
	return nil
}

// BuildInitialSkillStep builds an initial Skill resource from PushSkillRequest
//
// This step creates a Skill with basic metadata from the request.
// Note: Name, ID, and slug are NOT set here - they will be set by later steps
// after extracting name from SKILL.md frontmatter.
type BuildInitialSkillStep struct{}

func (c *SkillController) newBuildInitialSkillStep() *BuildInitialSkillStep {
	return &BuildInitialSkillStep{}
}

func (s *BuildInitialSkillStep) Name() string {
	return "BuildInitialSkill"
}

func (s *BuildInitialSkillStep) Execute(ctx *pipeline.RequestContext[*skillv1.PushSkillRequest]) error {
	req := ctx.Input()

	// Build initial Skill resource
	// Name will be set by ResolveSlugForPushStep from extracted frontmatter
	// ID will be set by GenerateIDIfNeededStep or FindExistingBySlugStep
	// Slug will be set by ResolveSlugForPushStep
	skill := &skillv1.Skill{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Skill",
		Metadata: &apiresourcepb.ApiResourceMetadata{
			Org: req.Org, // All resources belong to an org
		},
		Spec: &skillv1.SkillSpec{
			Tag: req.Tag,
		},
		Status: &skillv1.SkillStatus{
			State: skillv1.SkillState_SKILL_STATE_READY,
		},
	}

	// Store skill in context for subsequent steps
	ctx.Set(SkillKey, skill)

	return nil
}

// ResolveSlugForPushStep generates slug from the extracted skill name
//
// This step uses the name extracted from SKILL.md frontmatter (by ExtractAndHashArtifactStep)
// to set the skill's metadata name and generate the slug.
type ResolveSlugForPushStep struct{}

func (c *SkillController) newResolveSlugForPushStep() *ResolveSlugForPushStep {
	return &ResolveSlugForPushStep{}
}

func (s *ResolveSlugForPushStep) Name() string {
	return "ResolveSlugForPush"
}

func (s *ResolveSlugForPushStep) Execute(ctx *pipeline.RequestContext[*skillv1.PushSkillRequest]) error {
	skill := ctx.Get(SkillKey).(*skillv1.Skill)
	extractResult := ctx.Get(ExtractResultKey).(*storage.ExtractSkillMdResult)

	// Use name extracted from SKILL.md frontmatter
	skill.Metadata.Name = extractResult.Name

	// Generate slug from extracted name using common library
	slug := steps.GenerateSlug(extractResult.Name)
	if slug == "" {
		return grpclib.InvalidArgumentError("invalid skill name: %s", extractResult.Name)
	}

	skill.Metadata.Slug = slug

	return nil
}

// FindExistingBySlugStep finds existing skill by slug
//
// This step:
// 1. Searches for skill by slug (similar to LoadForApplyStep pattern)
// 2. If found:
//   - Sets ExistingSkillKey in context
//   - Copies existing ID to current skill
//   - Sets shouldCreate = false
//
// 3. If not found:
//   - Sets shouldCreate = true
type FindExistingBySlugStep struct {
	store store.Store
}

func (c *SkillController) newFindExistingBySlugStep() *FindExistingBySlugStep {
	return &FindExistingBySlugStep{
		store: c.store,
	}
}

func (s *FindExistingBySlugStep) Name() string {
	return "FindExistingBySlug"
}

func (s *FindExistingBySlugStep) Execute(ctx *pipeline.RequestContext[*skillv1.PushSkillRequest]) error {
	skill := ctx.Get(SkillKey).(*skillv1.Skill)
	slug := skill.Metadata.Slug

	existingSkill, found, err := steps.FindResourceBySlug[*skillv1.Skill](
		ctx.Context(),
		s.store,
		apiresourcekind.ApiResourceKind_skill,
		slug,
		skill.Metadata.Org,
	)
	if err != nil {
		return grpclib.InternalError(err, "failed to search for existing skill")
	}

	if found {
		skill.Metadata.Id = existingSkill.Metadata.Id
		ctx.Set(ExistingSkillKey, existingSkill)
		ctx.Set(ShouldCreateSkillKey, false)
	} else {
		ctx.Set(ExistingSkillKey, nil)
		ctx.Set(ShouldCreateSkillKey, true)
	}

	return nil
}

// GenerateIDIfNeededStep generates ID for new skills using proper ID prefix
//
// This step:
// 1. Checks shouldCreate flag
// 2. If creating new, generates ID using apiresource.GetIdPrefix(kind)
// 3. If updating, ID is already set by FindExistingBySlugStep
type GenerateIDIfNeededStep struct{}

func (c *SkillController) newGenerateIDIfNeededStep() *GenerateIDIfNeededStep {
	return &GenerateIDIfNeededStep{}
}

func (s *GenerateIDIfNeededStep) Name() string {
	return "GenerateIDIfNeeded"
}

func (s *GenerateIDIfNeededStep) Execute(ctx *pipeline.RequestContext[*skillv1.PushSkillRequest]) error {
	skill := ctx.Get(SkillKey).(*skillv1.Skill)
	shouldCreate := ctx.Get(ShouldCreateSkillKey).(bool)

	// Only generate ID if creating new skill
	if shouldCreate {
		// Get api_resource_kind from request context (injected by interceptor)
		kind := apiresourcekind.ApiResourceKind_skill

		// Extract ID prefix from the kind's proto options using common library
		idPrefix, err := apiresourcelib.GetIdPrefix(kind)
		if err != nil {
			return fmt.Errorf("failed to get ID prefix from kind: %w", err)
		}

		// Generate ID using ULID (via common library)
		skill.Metadata.Id = steps.GenerateID(idPrefix)
	}

	// If updating, ID is already set by FindExistingBySlugStep

	return nil
}

// ExtractAndHashArtifactStep extracts SKILL.md from ZIP, parses frontmatter, and calculates SHA256 hash
//
// This step:
// 1. Validates the artifact (ZIP bomb prevention, size limits, etc.)
// 2. Extracts SKILL.md content safely (in-memory only)
// 3. Parses YAML frontmatter to extract name and description
// 4. Calculates SHA256 hash for content-addressable storage
//
// The extracted name and description are stored in the result for use by subsequent steps.
// Security measures are handled by storage.ExtractSkillMd.
type ExtractAndHashArtifactStep struct{}

func (c *SkillController) newExtractAndHashArtifactStep() *ExtractAndHashArtifactStep {
	return &ExtractAndHashArtifactStep{}
}

func (s *ExtractAndHashArtifactStep) Name() string {
	return "ExtractAndHashArtifact"
}

func (s *ExtractAndHashArtifactStep) Execute(ctx *pipeline.RequestContext[*skillv1.PushSkillRequest]) error {
	artifactBytes := ctx.Get(ArtifactBytesKey).([]byte)

	// Extract SKILL.md and calculate hash (safely with all security checks)
	extractResult, err := storage.ExtractSkillMd(artifactBytes)
	if err != nil {
		return grpclib.InvalidArgumentError("failed to extract SKILL.md: %v", err)
	}

	// Store extract result in context for later steps
	ctx.Set(ExtractResultKey, extractResult)

	return nil
}

// CheckAndStoreArtifactStep checks if artifact exists and stores it if new
//
// This implements content-addressable storage with deduplication:
// - If artifact with same hash exists, reuse storage key
// - If artifact is new, store it and get storage key
// - Storage key is saved in context for PopulateSkillFieldsStep
type CheckAndStoreArtifactStep struct {
	artifactStorage storage.ArtifactStorage
}

func (c *SkillController) newCheckAndStoreArtifactStep() *CheckAndStoreArtifactStep {
	return &CheckAndStoreArtifactStep{
		artifactStorage: c.artifactStorage,
	}
}

func (s *CheckAndStoreArtifactStep) Name() string {
	return "CheckAndStoreArtifact"
}

func (s *CheckAndStoreArtifactStep) Execute(ctx *pipeline.RequestContext[*skillv1.PushSkillRequest]) error {
	artifactBytes := ctx.Get(ArtifactBytesKey).([]byte)
	extractResult := ctx.Get(ExtractResultKey).(*storage.ExtractSkillMdResult)

	// Check if artifact already exists (content-addressable deduplication)
	exists, err := s.artifactStorage.Exists(extractResult.Hash)
	if err != nil {
		return grpclib.InternalError(err, "failed to check artifact existence")
	}

	var storageKey string
	if exists {
		// Artifact already exists - reuse storage key (deduplication!)
		storageKey = s.artifactStorage.GetStorageKey(extractResult.Hash)
	} else {
		// New artifact - store it with restricted permissions
		storageKey, err = s.artifactStorage.Store(extractResult.Hash, artifactBytes)
		if err != nil {
			return grpclib.InternalError(err, "failed to store artifact")
		}
	}

	// Store storage key in context for PopulateSkillFieldsStep
	ctx.Set(ArtifactStorageKeyKey, storageKey)

	return nil
}

// ArchiveCurrentSkillStep archives the NEW skill (after populating fields)
//
// This step preserves version history by saving a snapshot of the current skill
// to the dedicated audit table. The archive happens AFTER all fields are populated
// (including new artifact data).
//
// Archival is best-effort - failures are logged but don't stop the push operation.
//
// Audit Pattern:
// - Each push triggers archival (both create and update)
// - Archived records are immutable (never modified)
// - Archive contains the CURRENT state (with new artifact data)
// - Query by tag returns latest version with that tag (sorted by timestamp)
// - Query by hash returns exact match
//
// The audit records are stored in a dedicated resource_audit table with:
// - resource_id: references the main skill's ID
// - version_hash: for exact version lookups
// - tag: for tag-based lookups
// - archived_at: timestamp for ordering
type ArchiveCurrentSkillStep struct {
	store store.Store
}

func (c *SkillController) newArchiveCurrentSkillStep() *ArchiveCurrentSkillStep {
	return &ArchiveCurrentSkillStep{
		store: c.store,
	}
}

func (s *ArchiveCurrentSkillStep) Name() string {
	return "ArchiveCurrentSkill"
}

func (s *ArchiveCurrentSkillStep) Execute(ctx *pipeline.RequestContext[*skillv1.PushSkillRequest]) error {
	skill := ctx.Get(SkillKey).(*skillv1.Skill)

	// Content-addressed change gate: a skill version is the immutable SHA-256 of
	// its artifact, so re-pushing identical content must NOT append a duplicate
	// audit row (the inverse of the "only one version" bug — duplicate timeline
	// entries for the same content). Mirrors the workflow change gate and the
	// cloud SkillPushHandler. New skills (no existing) always archive.
	if existing, ok := ctx.Get(ExistingSkillKey).(*skillv1.Skill); ok && existing != nil &&
		existing.Status != nil && existing.Status.VersionHash == skill.Status.VersionHash {
		log.Info().
			Str("skill_id", skill.Metadata.Id).
			Str("version_hash", skill.Status.VersionHash).
			Msg("ArchiveCurrentSkill: content unchanged, skipping version archival")
		return nil
	}

	// Archive the current skill (with all new data populated)
	if err := s.archiveSkill(ctx.Context(), skill); err != nil {
		log.Warn().Err(err).
			Str("skill_id", skill.Metadata.Id).
			Msg("ArchiveCurrentSkill: failed to archive skill (best-effort)")
	}

	return nil
}

// archiveSkill saves a snapshot to the audit table for version history.
// The archived skill can be queried by tag or hash.
func (s *ArchiveCurrentSkillStep) archiveSkill(ctx context.Context, skill *skillv1.Skill) error {
	// Extract version hash and tag for indexed queries
	versionHash := ""
	tag := ""
	if skill.Status != nil {
		versionHash = skill.Status.VersionHash
	}
	if skill.Spec != nil {
		tag = skill.Spec.Tag
	}

	// Save snapshot to audit table using the dedicated SaveAudit method
	// This creates a proper audit record with:
	// - resource_id: skill.Metadata.Id (for foreign key relationship)
	// - version_hash: for exact version lookups
	// - tag: for tag-based lookups
	// - archived_at: auto-set to current timestamp
	if err := s.store.SaveAudit(ctx, apiresourcekind.ApiResourceKind_skill, skill.Metadata.Id, skill, versionHash, tag); err != nil {
		return fmt.Errorf("failed to archive skill: %w", err)
	}

	return nil
}

// PopulateSkillFieldsStep populates the Skill with artifact data and audit fields
//
// This step:
// 1. Populates spec.skill_md from extracted SKILL.md content
// 2. Sets spec.name and spec.description from extracted frontmatter
// 3. Sets source metadata for traceability
// 4. Sets status.version_hash and status.artifact_storage_key
// 5. Sets audit fields using common library helpers:
//   - For create: SetAuditFieldsForCreate (sets created_at = updated_at = now)
//   - For update: Preserves existing audit, then updates with SetAuditFieldsForUpdate
type PopulateSkillFieldsStep struct{}

func (c *SkillController) newPopulateSkillFieldsStep() *PopulateSkillFieldsStep {
	return &PopulateSkillFieldsStep{}
}

func (s *PopulateSkillFieldsStep) Name() string {
	return "PopulateSkillFields"
}

func (s *PopulateSkillFieldsStep) Execute(ctx *pipeline.RequestContext[*skillv1.PushSkillRequest]) error {
	skill := ctx.Get(SkillKey).(*skillv1.Skill)
	extractResult := ctx.Get(ExtractResultKey).(*storage.ExtractSkillMdResult)
	storageKey := ctx.Get(ArtifactStorageKeyKey).(string)
	shouldCreate := ctx.Get(ShouldCreateSkillKey).(bool)
	req := ctx.Input()

	// 1. Populate spec with extracted SKILL.md content
	skill.Spec.SkillMd = extractResult.Content

	// 2. Set skill name and description from extracted frontmatter
	// Backend is the single source of truth for parsing SKILL.md
	skill.Spec.Name = extractResult.Name
	skill.Spec.Description = extractResult.Description

	// 3. Default visibility when unspecified, derived from the kind's proto config
	// so OSS and Cloud agree by construction (skill is a blueprint -> visibility_org).
	if skill.Metadata.Visibility == apiresourcepb.ApiResourceVisibility_api_resource_visibility_unspecified {
		visibility, err := apiresourcelib.DefaultVisibilityFor(apiresourcekind.ApiResourceKind_skill)
		if err != nil {
			return err
		}
		skill.Metadata.Visibility = visibility
	}

	// 4. Set git provenance metadata for traceability (if available)
	// This is optional - absent when pushed from a non-git directory
	if req.GitProvenance != nil {
		skill.Status.GitProvenance = req.GitProvenance
	}

	// 5. Populate status with artifact metadata
	skill.Status.VersionHash = extractResult.Hash
	skill.Status.ArtifactStorageKey = storageKey
	skill.Status.State = skillv1.SkillState_SKILL_STATE_READY

	// 6. Populate metadata.version for version history tracking
	previousVersionHash := ""
	if !shouldCreate {
		if existing, ok := ctx.Get(ExistingSkillKey).(*skillv1.Skill); ok && existing.Status != nil {
			previousVersionHash = existing.Status.VersionHash
		}
	}
	skill.Metadata.Version = &apiresourcepb.ApiResourceMetadataVersion{
		Id:                extractResult.Hash,
		Message:           req.Message,
		PreviousVersionId: previousVersionHash,
	}

	// 7. Set audit fields using common library helpers
	if shouldCreate {
		// Creating new skill - use common helper to set audit fields
		if err := steps.SetAuditFieldsForCreate(skill); err != nil {
			return fmt.Errorf("failed to set audit fields for create: %w", err)
		}
	} else {
		// Updating existing skill - preserve existing audit, then update
		existingSkill := ctx.Get(ExistingSkillKey).(*skillv1.Skill)

		// First, copy the entire status from existing (including audit)
		// This preserves all system-managed fields
		if existingSkill.Status != nil && existingSkill.Status.Audit != nil {
			// Preserve the existing audit fields
			if skill.Status.Audit == nil {
				skill.Status.Audit = &apiresourcepb.ApiResourceAudit{}
			}
			// Copy spec_audit and status_audit from existing
			skill.Status.Audit.SpecAudit = existingSkill.Status.Audit.SpecAudit
			skill.Status.Audit.StatusAudit = existingSkill.Status.Audit.StatusAudit
		}

		// Now update the audit fields (preserves created_at, updates updated_at)
		if err := steps.SetAuditFieldsForUpdate(skill); err != nil {
			return fmt.Errorf("failed to set audit fields for update: %w", err)
		}
	}

	return nil
}

// StoreSkillStep persists the Skill to SQLite
//
// This is the final step that saves the fully populated Skill to the database.
type StoreSkillStep struct {
	store store.Store
}

func (c *SkillController) newStoreSkillStep() *StoreSkillStep {
	return &StoreSkillStep{
		store: c.store,
	}
}

func (s *StoreSkillStep) Name() string {
	return "StoreSkill"
}

func (s *StoreSkillStep) Execute(ctx *pipeline.RequestContext[*skillv1.PushSkillRequest]) error {
	skill := ctx.Get(SkillKey).(*skillv1.Skill)

	// Save skill to SQLite
	if err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_skill, skill.Metadata.Id, skill); err != nil {
		return grpclib.InternalError(err, "failed to save skill")
	}

	return nil
}

// indexSkillSearchStep updates the FTS5 search index after a skill push.
//
// This is a custom step because the push pipeline's type parameter is
// PushSkillRequest, not Skill. The skill is read from the SkillKey context
// key instead of from ctx.NewState().
type indexSkillSearchStep struct {
	store store.Store
}

func (c *SkillController) newIndexSkillSearchStep() *indexSkillSearchStep {
	return &indexSkillSearchStep{store: c.store}
}

func (s *indexSkillSearchStep) Name() string {
	return "IndexSkillSearch"
}

func (s *indexSkillSearchStep) Execute(ctx *pipeline.RequestContext[*skillv1.PushSkillRequest]) error {
	skill := ctx.Get(SkillKey).(*skillv1.Skill)

	ext := &extractor.SkillExtractor{}
	entry := ext.GetSearchIndexEntry(skill)
	if entry == nil {
		log.Warn().Str("id", skill.Metadata.Id).Msg("IndexSkillSearch: extractor returned nil entry, skipping")
		return nil
	}

	if err := s.store.UpsertSearchIndex(ctx.Context(), apiresourcekind.ApiResourceKind_skill, skill.Metadata.Id, entry); err != nil {
		log.Warn().Err(err).
			Str("id", skill.Metadata.Id).
			Msg("IndexSkillSearch: failed to update search index (best-effort)")
	}

	return nil
}
