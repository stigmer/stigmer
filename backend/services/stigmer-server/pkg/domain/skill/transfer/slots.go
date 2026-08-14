// Package transfer implements the skill artifact transfer lane: the HTTP
// upload/download surface that carries skill artifact bytes OUTSIDE the gRPC
// control plane (stigmer/stigmer#675).
//
// The gRPC server caps messages at 10MB while the skill layer permits 100MB
// artifacts, so inline PushSkillRequest.artifact / GetArtifactResponse bytes
// physically cannot carry every valid skill. This package is the OSS
// implementation of the cross-edition contract defined on the skill protos:
//
//   - createArtifactUploadUrl() mints a short-lived, SINGLE-USE capability
//     URL; the client PUTs the ZIP there and then calls push() with the
//     returned artifact_upload_ref.
//   - getArtifactDownloadUrl() mints a download URL keyed by the
//     content-hash storage key.
//
// Cloud implements the same RPCs with R2 pre-signed URLs. Here the server
// serves the bytes itself: the unguessable token (upload) or content-hash
// key (download) in the URL path IS the credential — the same trust model as
// the getArtifact RPC, which deliberately skips authorization, and the same
// client semantics as a pre-signed URL.
package transfer

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// DefaultSlotTTL bounds how long a minted upload slot (and its URL) stays
// valid. Generous enough for a 100MB upload on a slow link, short enough
// that abandoned slots don't accumulate.
const DefaultSlotTTL = 15 * time.Minute

// refByteLen sizes the random capability token. 16 bytes = 128 bits of
// entropy, matching the unguessability of the content-hash download keys.
const refByteLen = 16

// refPrefix marks upload references so they are recognizable in logs and
// cannot be confused with artifact storage keys.
const refPrefix = "sau_"

// slot tracks one minted upload capability.
type slot struct {
	declaredSize int64
	expiresAt    time.Time
	uploaded     bool
}

// UploadSlots is the in-memory registry of outstanding upload capabilities,
// plus the staging directory their bytes land in.
//
// In-memory is deliberate: the OSS server is single-instance (the same
// assumption the in-process bufconn lane and SQLite store already make), and
// a slot is worthless across restarts anyway — its bytes live in the staging
// directory, which is swept on boot.
type UploadSlots struct {
	mu         sync.Mutex
	slots      map[string]*slot
	stagingDir string
	ttl        time.Duration
	maxSize    int64
	now        func() time.Time // injectable for expiry tests
}

// NewUploadSlots creates the registry and prepares the staging directory.
//
// Any file already present in stagingDir is an orphan from a previous
// process (the registry that knew about it died with that process), so the
// directory is emptied — this is also the crash-recovery story for uploads
// that never reached their push.
func NewUploadSlots(stagingDir string, ttl time.Duration, maxSize int64) (*UploadSlots, error) {
	if err := os.RemoveAll(stagingDir); err != nil {
		return nil, fmt.Errorf("failed to clear skill staging directory: %w", err)
	}
	if err := os.MkdirAll(stagingDir, 0700); err != nil {
		return nil, fmt.Errorf("failed to create skill staging directory: %w", err)
	}
	return &UploadSlots{
		slots:      make(map[string]*slot),
		stagingDir: stagingDir,
		ttl:        ttl,
		maxSize:    maxSize,
		now:        time.Now,
	}, nil
}

// Mint reserves an upload slot for an artifact of declaredSize bytes and
// returns its single-use reference. The caller has already authorized the
// request (the mint RPC carries push's can_create_skill check) and validated
// declaredSize against the skill size limit.
func (u *UploadSlots) Mint(declaredSize int64) (ref string, ttl time.Duration, err error) {
	if declaredSize <= 0 || declaredSize > u.maxSize {
		return "", 0, fmt.Errorf("declared size %d outside (0, %d]", declaredSize, u.maxSize)
	}

	buf := make([]byte, refByteLen)
	if _, err := rand.Read(buf); err != nil {
		return "", 0, fmt.Errorf("failed to generate upload reference: %w", err)
	}
	ref = refPrefix + hex.EncodeToString(buf)

	u.mu.Lock()
	defer u.mu.Unlock()
	u.sweepLocked()
	u.slots[ref] = &slot{
		declaredSize: declaredSize,
		expiresAt:    u.now().Add(u.ttl),
	}
	return ref, u.ttl, nil
}

// Receive streams an upload's body into the slot's staging file.
//
// The body must match the size declared at mint time exactly: a shorter body
// means a truncated transfer, a longer one means the client lied — both
// reject rather than staging bytes that would fail (or worse, surprise)
// validation later. The staged file only becomes consumable once this
// returns nil.
func (u *UploadSlots) Receive(ref string, body io.Reader) error {
	u.mu.Lock()
	s, ok := u.slots[ref]
	if !ok || u.now().After(s.expiresAt) {
		u.mu.Unlock()
		return errSlotUnknown
	}
	if s.uploaded {
		u.mu.Unlock()
		return errSlotConsumed
	}
	declared := s.declaredSize
	u.mu.Unlock()

	path := u.stagePath(ref)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return fmt.Errorf("failed to open staging file: %w", err)
	}

	// Read at most declared+1 bytes: hitting the extra byte proves the body
	// exceeds the declaration without buffering an unbounded stream.
	written, copyErr := io.Copy(f, io.LimitReader(body, declared+1))
	closeErr := f.Close()

	switch {
	case copyErr != nil:
		os.Remove(path)
		return fmt.Errorf("failed to receive upload: %w", copyErr)
	case closeErr != nil:
		os.Remove(path)
		return fmt.Errorf("failed to finalize staging file: %w", closeErr)
	case written != declared:
		os.Remove(path)
		return fmt.Errorf("%w: received %d bytes, declared %d", errSizeMismatch, written, declared)
	}

	u.mu.Lock()
	defer u.mu.Unlock()
	// Re-check under the lock: the slot may have expired mid-upload.
	s, ok = u.slots[ref]
	if !ok || u.now().After(s.expiresAt) {
		os.Remove(path)
		return errSlotUnknown
	}
	s.uploaded = true
	return nil
}

// Consume returns the staged bytes for ref and retires the slot — an upload
// reference is strictly single-use. Push calls this when it sees
// artifact_upload_ref; whatever happens downstream (validation failure
// included), the slot is gone and the client must re-mint to retry.
func (u *UploadSlots) Consume(ref string) ([]byte, error) {
	u.mu.Lock()
	s, ok := u.slots[ref]
	switch {
	case !ok, u.now().After(s.expiresAt):
		u.mu.Unlock()
		return nil, errSlotUnknown
	case !s.uploaded:
		u.mu.Unlock()
		return nil, errSlotEmpty
	}
	delete(u.slots, ref)
	u.mu.Unlock()

	path := u.stagePath(ref)
	data, err := os.ReadFile(path)
	os.Remove(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read staged artifact: %w", err)
	}
	return data, nil
}

// sweepLocked drops expired slots and their staged files. Called from Mint
// (under the lock), which bounds the registry: it can hold at most the slots
// minted within one TTL window.
func (u *UploadSlots) sweepLocked() {
	now := u.now()
	for ref, s := range u.slots {
		if now.After(s.expiresAt) {
			delete(u.slots, ref)
			os.Remove(u.stagePath(ref))
		}
	}
}

// stagePath maps a reference to its staging file. refs are server-generated
// hex (never client-supplied paths), so simple joining is safe.
func (u *UploadSlots) stagePath(ref string) string {
	return filepath.Join(u.stagingDir, ref+".zip")
}
