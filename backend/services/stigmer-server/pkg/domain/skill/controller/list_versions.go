package skill

import (
	"context"
	"encoding/base64"
	"fmt"
	"strconv"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

const (
	defaultPageSize = 50
	maxPageSize     = 100

	listVersionsSkillIDKey = "listVersionsSkillId"
)

// ListVersions returns the version history for a skill, identified by org and slug.
//
// The handler resolves the skill by slug, loads all audit records, maps them to
// SkillVersionEntry protos, and applies cursor-based pagination. The first entry
// (newest) is marked as is_current=true.
func (c *SkillController) ListVersions(ctx context.Context, req *skillv1.ListSkillVersionsInput) (*skillv1.ListSkillVersionsResponse, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildListVersionsPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	resp := reqCtx.Get("listVersionsResponse").(*skillv1.ListSkillVersionsResponse)
	return resp, nil
}

func (c *SkillController) buildListVersionsPipeline() *pipeline.Pipeline[*skillv1.ListSkillVersionsInput] {
	return pipeline.NewPipeline[*skillv1.ListSkillVersionsInput]("skill-list-versions").
		AddStep(steps.NewValidateProtoStep[*skillv1.ListSkillVersionsInput]()).
		AddStep(c.newResolveSkillBySlugStep()).
		AddStep(c.newLoadAndMapVersionsStep()).
		Build()
}

// ResolveSkillBySlugStep finds the skill by org+slug and stores its ID in context.
type ResolveSkillBySlugStep struct {
	store store.Store
}

func (c *SkillController) newResolveSkillBySlugStep() *ResolveSkillBySlugStep {
	return &ResolveSkillBySlugStep{store: c.store}
}

func (s *ResolveSkillBySlugStep) Name() string {
	return "ResolveSkillBySlug"
}

func (s *ResolveSkillBySlugStep) Execute(ctx *pipeline.RequestContext[*skillv1.ListSkillVersionsInput]) error {
	req := ctx.Input()

	skill, found, err := steps.FindResourceBySlug[*skillv1.Skill](
		ctx.Context(),
		s.store,
		apiresourcekind.ApiResourceKind_skill,
		req.Slug,
		req.Org,
	)
	if err != nil {
		return grpclib.InternalError(err, "failed to search for skill")
	}
	if !found {
		return grpclib.NotFoundError("skill", fmt.Sprintf("%s (org: %s)", req.Slug, req.Org))
	}

	ctx.Set(listVersionsSkillIDKey, skill.Metadata.Id)
	return nil
}

// LoadAndMapVersionsStep loads audit records, maps to SkillVersionEntry, and paginates.
type LoadAndMapVersionsStep struct {
	store store.Store
}

func (c *SkillController) newLoadAndMapVersionsStep() *LoadAndMapVersionsStep {
	return &LoadAndMapVersionsStep{store: c.store}
}

func (s *LoadAndMapVersionsStep) Name() string {
	return "LoadAndMapVersions"
}

func (s *LoadAndMapVersionsStep) Execute(ctx *pipeline.RequestContext[*skillv1.ListSkillVersionsInput]) error {
	req := ctx.Input()
	skillID := ctx.Get(listVersionsSkillIDKey).(string)

	records, err := s.store.ListAuditHistory(ctx.Context(), apiresourcekind.ApiResourceKind_skill, skillID)
	if err != nil {
		return grpclib.InternalError(err, "failed to load version history")
	}

	entries := make([]*skillv1.SkillVersionEntry, 0, len(records))
	for i, data := range records {
		var skill skillv1.Skill
		if err := proto.Unmarshal(data, &skill); err != nil {
			continue
		}
		entries = append(entries, mapSkillToVersionEntry(&skill, i == 0))
	}

	// Pagination
	pageSize := int(req.PageSize)
	if pageSize <= 0 {
		pageSize = defaultPageSize
	}
	if pageSize > maxPageSize {
		pageSize = maxPageSize
	}

	startIndex := 0
	if req.PageToken != "" {
		decoded, err := base64.StdEncoding.DecodeString(req.PageToken)
		if err != nil {
			return grpclib.InvalidArgumentError("invalid page_token")
		}
		idx, err := strconv.Atoi(string(decoded))
		if err != nil || idx < 0 {
			return grpclib.InvalidArgumentError("invalid page_token")
		}
		startIndex = idx
	}

	totalCount := int32(len(entries))

	var pageEntries []*skillv1.SkillVersionEntry
	var nextPageToken string

	if startIndex < len(entries) {
		end := startIndex + pageSize
		if end > len(entries) {
			end = len(entries)
		}
		pageEntries = entries[startIndex:end]

		if end < len(entries) {
			nextPageToken = base64.StdEncoding.EncodeToString([]byte(strconv.Itoa(end)))
		}
	}

	ctx.Set("listVersionsResponse", &skillv1.ListSkillVersionsResponse{
		Versions:      pageEntries,
		NextPageToken: nextPageToken,
		TotalCount:    totalCount,
	})

	return nil
}

// mapSkillToVersionEntry maps an archived Skill proto to a SkillVersionEntry.
func mapSkillToVersionEntry(skill *skillv1.Skill, isCurrent bool) *skillv1.SkillVersionEntry {
	entry := &skillv1.SkillVersionEntry{
		IsCurrent: isCurrent,
	}

	if skill.Status != nil {
		entry.VersionHash = skill.Status.VersionHash
		entry.ArtifactStorageKey = skill.Status.ArtifactStorageKey
		entry.GitProvenance = skill.Status.GitProvenance

		if skill.Status.Audit != nil && skill.Status.Audit.SpecAudit != nil {
			audit := skill.Status.Audit.SpecAudit
			entry.PushedAt = audit.UpdatedAt
			if entry.PushedAt == nil {
				entry.PushedAt = audit.CreatedAt
			}
			entry.PushedBy = audit.UpdatedBy
			if entry.PushedBy == nil {
				entry.PushedBy = audit.CreatedBy
			}
		}
	}

	if skill.Spec != nil {
		entry.Tag = skill.Spec.Tag
	}

	if skill.Metadata != nil && skill.Metadata.Version != nil {
		entry.Message = skill.Metadata.Version.Message
	}

	return entry
}
