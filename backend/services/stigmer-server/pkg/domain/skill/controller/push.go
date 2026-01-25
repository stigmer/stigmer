package skill

import (
	"context"
	"fmt"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourcelib "github.com/stigmer/stigmer/backend/libs/go/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/storage"
)

// Context keys for push operation
const (
	SkillKey              = "skill"              // The Skill being built (type transformation: PushSkillRequest → Skill)
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
// 10. Persists skill to BadgerDB
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
// 3. Resolves slug from name
// 4. Finds existing skill by slug (sets shouldCreate flag + existing ID if found)
// 5. Generates ID if creating new (uses proper ID generation with prefix)
// 6. Extracts SKILL.md and calculates hash
// 7. Checks/stores artifact with deduplication
// 8. Populates skill with artifact data and timestamps
// 9. Archives the NEW skill (for version history)
// 10. Persists to database
func (c *SkillController) buildPushPipeline() *pipeline.Pipeline[*skillv1.PushSkillRequest] {
	return pipeline.NewPipeline[*skillv1.PushSkillRequest]("skill-push").
		AddStep(steps.NewValidateProtoStep[*skillv1.PushSkillRequest]()). // 1. Validate request
		AddStep(c.newBuildInitialSkillStep()).                            // 2. Build Skill (no ID yet)
		AddStep(c.newResolveSlugForPushStep()).                           // 3. Resolve slug
		AddStep(c.newFindExistingBySlugStep()).                           // 4. Find by slug
		AddStep(c.newGenerateIDIfNeededStep()).                           // 5. Generate ID if creating
		AddStep(c.newExtractAndHashArtifactStep()).                       // 6. Extract SKILL.md
		AddStep(c.newCheckAndStoreArtifactStep()).                        // 7. Store artifact
		AddStep(c.newPopulateSkillFieldsStep()).                          // 8. Populate fields
		AddStep(c.newArchiveCurrentSkillStep()).                          // 9. Archive NEW skill
		AddStep(c.newStoreSkillStep()).                                   // 10. Persist to DB
		Build()
}

// BuildInitialSkillStep builds an initial Skill resource from PushSkillRequest
//
// This step creates a Skill with basic metadata from the request.
// Note: ID and slug are NOT set here - they will be set by later steps.
type BuildInitialSkillStep struct{}

func (c *SkillController) newBuildInitialSkillStep() *BuildInitialSkillStep {
	return &BuildInitialSkillStep{}
}

func (s *BuildInitialSkillStep) Name() string {
	return "BuildInitialSkill"
}

func (s *BuildInitialSkillStep) Execute(ctx *pipeline.RequestContext[*skillv1.PushSkillRequest]) error {
	req := ctx.Input()

	// Build initial Skill resource (ID will be set later)
	skill := &skillv1.Skill{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Skill",
		Metadata: &apiresourcepb.ApiResourceMetadata{
			Name: req.Name, // User-provided name (will be stored as-is)
			// Slug will be set by ResolveSlugForPushStep
			// Id will be set by GenerateIDIfNeededStep or FindExistingBySlugStep
			OwnerScope: req.Scope,
			Org:        req.Org,
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

// ResolveSlugForPushStep generates slug from name
//
// This uses the exported GenerateSlug function from common library.
type ResolveSlugForPushStep struct{}

func (c *SkillController) newResolveSlugForPushStep() *ResolveSlugForPushStep {
	return &ResolveSlugForPushStep{}
}

func (s *ResolveSlugForPushStep) Name() string {
	return "ResolveSlugForPush"
}

func (s *ResolveSlugForPushStep) Execute(ctx *pipeline.RequestContext[*skillv1.PushSkillRequest]) error {
	skill := ctx.Get(SkillKey).(*skillv1.Skill)

	// Generate slug from name using common library
	slug := steps.GenerateSlug(skill.Metadata.Name)
	if slug == "" {
		return grpclib.InvalidArgumentError(fmt.Sprintf("invalid skill name: %s", skill.Metadata.Name))
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

	// Find existing skill by slug using common helper
	existingSkill, err := steps.FindResourceBySlug[*skillv1.Skill](
		ctx.Context(),
		s.store,
		apiresourcekind.ApiResourceKind_skill,
		slug,
	)
	if err != nil {
		return grpclib.InternalError(err, "failed to search for existing skill")
	}

	if existingSkill != nil {
		// Skill exists - will update
		// Copy existing ID to current skill
		skill.Metadata.Id = existingSkill.Metadata.Id
		ctx.Set(ExistingSkillKey, existingSkill)
		ctx.Set(ShouldCreateSkillKey, false)
	} else {
		// Skill doesn't exist - will create new
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

// ExtractAndHashArtifactStep extracts SKILL.md from ZIP and calculates SHA256 hash
//
// This step validates the artifact and extracts the SKILL.md content safely.
// Security measures are handled by storage.ExtractSkillMd (ZIP bomb prevention, etc.)
type ExtractAndHashArtifactStep struct{}

func (c *SkillController) newExtractAndHashArtifactStep() *ExtractAndHashArtifactStep {
	return &ExtractAndHashArtifactStep{}
}

func (s *ExtractAndHashArtifactStep) Name() string {
	return "ExtractAndHashArtifact"
}

func (s *ExtractAndHashArtifactStep) Execute(ctx *pipeline.RequestContext[*skillv1.PushSkillRequest]) error {
	req := ctx.Input()

	// Extract SKILL.md and calculate hash (safely with all security checks)
	extractResult, err := storage.ExtractSkillMd(req.Artifact)
	if err != nil {
		return grpclib.InvalidArgumentError(fmt.Sprintf("failed to extract SKILL.md: %v", err))
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
	req := ctx.Input()
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
		storageKey, err = s.artifactStorage.Store(extractResult.Hash, req.Artifact)
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

	// Archive the current skill (with all new data populated)
	if err := s.archiveSkill(ctx.Context(), skill); err != nil {
		// Log warning but don't fail - archival is best-effort
		fmt.Printf("Warning: failed to archive skill %s: %v\n", skill.Metadata.Id, err)
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
// 2. Sets status.version_hash and status.artifact_storage_key
// 3. Sets audit fields using common library helpers:
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

	// 1. Populate spec with extracted SKILL.md content
	skill.Spec.SkillMd = extractResult.Content

	// 2. Populate status with artifact metadata
	skill.Status.VersionHash = extractResult.Hash
	skill.Status.ArtifactStorageKey = storageKey
	skill.Status.State = skillv1.SkillState_SKILL_STATE_READY

	// 3. Set audit fields using common library helpers
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

// StoreSkillStep persists the Skill to BadgerDB
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

	// Save skill to BadgerDB
	if err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_skill, skill.Metadata.Id, skill); err != nil {
		return grpclib.InternalError(err, "failed to save skill")
	}

	return nil
}
