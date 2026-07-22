package extractor

import (
	"strings"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// DatastoreExtractor extracts searchable data from Datastore resources.
//
// The summary is spec.description, falling back to the declared
// collection names — an operator searching "bookings" should find the
// clinic datastore even when its description doesn't say so.
type DatastoreExtractor struct{}

var _ SearchableExtractor = (*DatastoreExtractor)(nil)

func init() {
	Register(&DatastoreExtractor{})
}

func (e *DatastoreExtractor) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_datastore
}

func (e *DatastoreExtractor) NewEmptyProto() proto.Message {
	return &datastorev1.Datastore{}
}

func (e *DatastoreExtractor) GetSearchSummary(resource proto.Message) string {
	ds, ok := resource.(*datastorev1.Datastore)
	if !ok || ds.GetSpec() == nil {
		return ""
	}
	if desc := ds.GetSpec().GetDescription(); desc != "" {
		return desc
	}
	names := make([]string, 0, len(ds.GetSpec().GetCollections()))
	for _, coll := range ds.GetSpec().GetCollections() {
		names = append(names, coll.GetName())
	}
	if len(names) == 0 {
		return ""
	}
	return "collections: " + strings.Join(names, ", ")
}

func (e *DatastoreExtractor) ToSearchResult(resource proto.Message, score float32) *searchv1.SearchResult {
	ds, ok := resource.(*datastorev1.Datastore)
	if !ok {
		return nil
	}

	meta := ds.GetMetadata()
	if meta == nil {
		return nil
	}

	result := &searchv1.SearchResult{
		Kind:          apiresourcekind.ApiResourceKind_datastore,
		Id:            meta.GetId(),
		Name:          meta.GetName(),
		Slug:          meta.GetSlug(),
		Org:           meta.GetOrg(),
		QualifiedSlug: buildQualifiedSlug(meta.GetOrg(), meta.GetSlug()),
		Description:   e.GetSearchSummary(resource),
		Visibility:    meta.GetVisibility(),
		Tags:          meta.GetTags(),
		Score:         score,
	}

	if audit := ds.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				result.CreatedAt = specAudit.GetCreatedAt()
			}
			if specAudit.GetUpdatedAt() != nil {
				result.UpdatedAt = specAudit.GetUpdatedAt()
			}
		}
	}

	if result.CreatedAt == nil {
		result.CreatedAt = &timestamppb.Timestamp{}
	}
	if result.UpdatedAt == nil {
		result.UpdatedAt = &timestamppb.Timestamp{}
	}

	return result
}

func (e *DatastoreExtractor) GetSearchIndexEntry(resource proto.Message) *store.SearchIndexEntry {
	ds, ok := resource.(*datastorev1.Datastore)
	if !ok {
		return nil
	}

	meta := ds.GetMetadata()
	if meta == nil {
		return nil
	}

	entry := &store.SearchIndexEntry{
		Name:        meta.GetName(),
		Description: e.GetSearchSummary(resource),
		Tags:        JoinTags(meta.GetTags()),
		Org:         meta.GetOrg(),
		Visibility:  meta.GetVisibility().String(),
	}

	if audit := ds.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				entry.CreatedAt = specAudit.GetCreatedAt().GetSeconds()
			}
		}
	}

	return entry
}
