package steps

import (
	"fmt"

	"github.com/rs/zerolog/log"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// SearchIndexExtractor extracts search index fields from a proto resource.
// This is the subset of the SearchableExtractor interface needed by the
// pipeline step, defined here to avoid a dependency from libs -> services.
type SearchIndexExtractor interface {
	GetSearchIndexEntry(resource proto.Message) *store.SearchIndexEntry
}

// IndexSearchStep updates the FTS5 search index after a resource is persisted.
//
// This step must run AFTER PersistStep because it relies on the resource
// having a valid ID and metadata set by earlier pipeline steps.
//
// The step is best-effort: a failure to index logs a warning but does not
// fail the pipeline. The resource is already persisted at this point, and
// the search index can be rebuilt from the resources table if needed.
type IndexSearchStep[T proto.Message] struct {
	store     store.Store
	extractor SearchIndexExtractor
}

// NewIndexSearchStep creates a new IndexSearchStep.
//
// Parameters:
//   - s: the store for calling UpsertSearchIndex
//   - extractor: extracts searchable fields from the resource
func NewIndexSearchStep[T proto.Message](s store.Store, extractor SearchIndexExtractor) *IndexSearchStep[T] {
	return &IndexSearchStep[T]{
		store:     s,
		extractor: extractor,
	}
}

func (s *IndexSearchStep[T]) Name() string {
	return "IndexSearch"
}

func (s *IndexSearchStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	resource := ctx.NewState()

	metadataResource, ok := any(resource).(HasMetadata)
	if !ok {
		log.Warn().Msg("IndexSearchStep: resource does not implement HasMetadata, skipping indexing")
		return nil
	}

	metadata := metadataResource.GetMetadata()
	if metadata == nil || metadata.Id == "" {
		log.Warn().Msg("IndexSearchStep: resource has no metadata or ID, skipping indexing")
		return nil
	}

	entry := s.extractor.GetSearchIndexEntry(resource)
	if entry == nil {
		log.Warn().Str("id", metadata.Id).Msg("IndexSearchStep: extractor returned nil entry, skipping indexing")
		return nil
	}

	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	if err := s.store.UpsertSearchIndex(ctx.Context(), kind, metadata.Id, entry); err != nil {
		log.Warn().Err(err).
			Str("id", metadata.Id).
			Str("kind", kind.String()).
			Msg("IndexSearchStep: failed to update search index (best-effort)")
	}

	return nil
}

// DeleteSearchIndexStep removes a resource's entry from the FTS5 search index.
//
// This step must run AFTER DeleteResourceStep. Like IndexSearchStep, it is
// best-effort: a failure logs a warning but does not fail the pipeline.
type DeleteSearchIndexStep[T proto.Message] struct {
	store store.Store
}

// NewDeleteSearchIndexStep creates a new DeleteSearchIndexStep.
func NewDeleteSearchIndexStep[T proto.Message](s store.Store) *DeleteSearchIndexStep[T] {
	return &DeleteSearchIndexStep[T]{store: s}
}

func (s *DeleteSearchIndexStep[T]) Name() string {
	return "DeleteSearchIndex"
}

func (s *DeleteSearchIndexStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	idVal := ctx.Get(ResourceIdKey)
	if idVal == nil {
		return fmt.Errorf("resource id not found in context (ExtractResourceIdStep must run first)")
	}
	id := idVal.(string)

	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	if err := s.store.DeleteSearchIndex(ctx.Context(), kind, id); err != nil {
		log.Warn().Err(err).
			Str("id", id).
			Str("kind", kind.String()).
			Msg("DeleteSearchIndexStep: failed to remove search index entry (best-effort)")
	}

	return nil
}
