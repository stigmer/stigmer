package transfer

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/storage"
)

// PathPrefix roots the transfer lane on the server's unified HTTP handler
// (the main gRPC port, which already routes /v1/proxy/* around gRPC-Web).
const PathPrefix = "/v1/skill-artifacts"

// uploadsSegment separates upload capabilities from download keys in the
// URL space: PUT {PathPrefix}/uploads/{ref} vs GET {PathPrefix}/{key}.
const uploadsSegment = "/uploads/"

// downloadKeyPrefix restricts the download surface to the skill artifact
// store's own keys ("skills/<hash>.zip"). Everything else under the storage
// root — should the two ever share one — stays unreachable from this lane.
const downloadKeyPrefix = "skills/"

// Sentinel errors let the HTTP handler map registry failures onto honest
// status codes without string matching.
var (
	errSlotUnknown  = errors.New("upload reference unknown or expired")
	errSlotConsumed = errors.New("upload reference already carries an upload")
	errSlotEmpty    = errors.New("upload reference has no uploaded bytes")
	errSizeMismatch = errors.New("upload size mismatch")
)

// UploadURL renders the capability URL for a minted reference against the
// lane's externally-reachable base URL. Kept next to the route definition so
// the URL shape and its handler cannot drift apart.
func UploadURL(baseURL, ref string) string {
	return fmt.Sprintf("%s%s%s%s", strings.TrimSuffix(baseURL, "/"), PathPrefix, uploadsSegment, ref)
}

// DownloadURL renders the download URL for an artifact storage key.
func DownloadURL(baseURL, storageKey string) string {
	return fmt.Sprintf("%s%s/%s", strings.TrimSuffix(baseURL, "/"), PathPrefix, storageKey)
}

// NewHandler serves the transfer lane:
//
//	PUT {PathPrefix}/uploads/{ref}  — stage artifact bytes (capability: ref)
//	GET {PathPrefix}/{storage_key}  — serve artifact bytes (capability: content-hash key)
//
// Neither route carries bearer auth by design: the URL is the credential,
// mirroring cloud's pre-signed R2 URLs. Minting an upload URL requires the
// same gRPC authorization as push; download keys are unguessable content
// hashes handed out by authorized skill reads.
func NewHandler(slots *UploadSlots, artifacts storage.ArtifactStorage) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rest, ok := strings.CutPrefix(r.URL.Path, PathPrefix)
		if !ok {
			http.NotFound(w, r)
			return
		}

		if ref, isUpload := strings.CutPrefix(rest, uploadsSegment); isUpload {
			handleUpload(w, r, slots, ref)
			return
		}

		handleDownload(w, r, artifacts, strings.TrimPrefix(rest, "/"))
	})
}

func handleUpload(w http.ResponseWriter, r *http.Request, slots *UploadSlots, ref string) {
	if r.Method != http.MethodPut {
		w.Header().Set("Allow", http.MethodPut)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	err := slots.Receive(ref, r.Body)
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, errSlotUnknown):
		// Deliberately the same shape for "never existed" and "expired":
		// distinguishing them would let an unauthorized caller probe which
		// tokens were once valid.
		http.Error(w, "upload reference unknown or expired — request a new upload URL", http.StatusNotFound)
	case errors.Is(err, errSlotConsumed):
		http.Error(w, "upload reference already used — request a new upload URL", http.StatusConflict)
	case errors.Is(err, errSizeMismatch):
		http.Error(w, err.Error()+" — the upload must match the size declared to createArtifactUploadUrl", http.StatusBadRequest)
	default:
		log.Error().Err(err).Str("ref", ref).Msg("skill artifact upload failed")
		http.Error(w, "failed to stage upload", http.StatusInternalServerError)
	}
}

func handleDownload(w http.ResponseWriter, r *http.Request, artifacts storage.ArtifactStorage, key string) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !strings.HasPrefix(key, downloadKeyPrefix) {
		http.NotFound(w, r)
		return
	}

	// Full in-memory read matches the store's own interface (Get returns
	// bytes) and the ≤100MB validation ceiling bounds the allocation.
	data, err := artifacts.Get(key)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			http.NotFound(w, r)
			return
		}
		log.Error().Err(err).Str("storage_key", key).Msg("skill artifact download failed")
		http.Error(w, "failed to load artifact", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	w.Write(data)
}
