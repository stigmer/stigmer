package transfer

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testMaxSize = 1024 * 1024 // 1MB keeps fixtures small

func newTestSlots(t *testing.T) *UploadSlots {
	t.Helper()
	slots, err := NewUploadSlots(filepath.Join(t.TempDir(), "staging"), DefaultSlotTTL, testMaxSize)
	if err != nil {
		t.Fatalf("NewUploadSlots: %v", err)
	}
	return slots
}

// TestSlots_MintReceiveConsume pins the happy path: minted ref accepts
// exactly the declared bytes and hands them back once.
func TestSlots_MintReceiveConsume(t *testing.T) {
	slots := newTestSlots(t)
	payload := []byte("zip-bytes-stand-in")

	ref, ttl, err := slots.Mint(int64(len(payload)))
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if !strings.HasPrefix(ref, refPrefix) {
		t.Errorf("ref %q missing %q prefix", ref, refPrefix)
	}
	if ttl != DefaultSlotTTL {
		t.Errorf("ttl = %v, want %v", ttl, DefaultSlotTTL)
	}

	if err := slots.Receive(ref, bytes.NewReader(payload)); err != nil {
		t.Fatalf("Receive: %v", err)
	}

	got, err := slots.Consume(ref)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if !bytes.Equal(got, payload) {
		t.Errorf("consumed bytes differ from uploaded bytes")
	}
}

// TestSlots_MintRejectsOutOfRangeSizes pins the fail-loud boundary: zero,
// negative, and over-limit declarations never mint.
func TestSlots_MintRejectsOutOfRangeSizes(t *testing.T) {
	slots := newTestSlots(t)
	for _, size := range []int64{0, -1, testMaxSize + 1} {
		if _, _, err := slots.Mint(size); err == nil {
			t.Errorf("Mint(%d) succeeded, want error", size)
		}
	}
	// The boundary itself is valid.
	if _, _, err := slots.Mint(testMaxSize); err != nil {
		t.Errorf("Mint(max) failed: %v", err)
	}
}

// TestSlots_ReceiveRejectsSizeMismatch pins that both short and long bodies
// are refused and leave nothing staged.
func TestSlots_ReceiveRejectsSizeMismatch(t *testing.T) {
	slots := newTestSlots(t)

	for name, body := range map[string][]byte{
		"short": []byte("abc"),
		"long":  bytes.Repeat([]byte("x"), 20),
	} {
		ref, _, err := slots.Mint(10)
		if err != nil {
			t.Fatalf("Mint: %v", err)
		}
		err = slots.Receive(ref, bytes.NewReader(body))
		if !errors.Is(err, errSizeMismatch) {
			t.Errorf("%s body: err = %v, want errSizeMismatch", name, err)
		}
		if _, err := os.Stat(slots.stagePath(ref)); !os.IsNotExist(err) {
			t.Errorf("%s body: staging file survived a rejected upload", name)
		}
	}
}

// TestSlots_ConsumeIsSingleUse pins that a reference dies with its first
// consume — the retry contract is re-mint, never replay.
func TestSlots_ConsumeIsSingleUse(t *testing.T) {
	slots := newTestSlots(t)
	payload := []byte("once")

	ref, _, _ := slots.Mint(int64(len(payload)))
	if err := slots.Receive(ref, bytes.NewReader(payload)); err != nil {
		t.Fatalf("Receive: %v", err)
	}
	if _, err := slots.Consume(ref); err != nil {
		t.Fatalf("first Consume: %v", err)
	}
	if _, err := slots.Consume(ref); !errors.Is(err, errSlotUnknown) {
		t.Errorf("second Consume err = %v, want errSlotUnknown", err)
	}
	if _, err := os.Stat(slots.stagePath(ref)); !os.IsNotExist(err) {
		t.Error("staging file survived consume")
	}
}

// TestSlots_ReceiveIsSingleUse pins that a second PUT to the same ref is
// refused — the capability covers one upload, not a mutable slot.
func TestSlots_ReceiveIsSingleUse(t *testing.T) {
	slots := newTestSlots(t)
	payload := []byte("first")

	ref, _, _ := slots.Mint(int64(len(payload)))
	if err := slots.Receive(ref, bytes.NewReader(payload)); err != nil {
		t.Fatalf("Receive: %v", err)
	}
	if err := slots.Receive(ref, bytes.NewReader(payload)); !errors.Is(err, errSlotConsumed) {
		t.Errorf("second Receive err = %v, want errSlotConsumed", err)
	}
}

// TestSlots_UnknownAndUnuploadedRefs pins the two remaining refusal shapes.
func TestSlots_UnknownAndUnuploadedRefs(t *testing.T) {
	slots := newTestSlots(t)

	if err := slots.Receive("sau_deadbeef", bytes.NewReader([]byte("x"))); !errors.Is(err, errSlotUnknown) {
		t.Errorf("Receive(unknown) err = %v, want errSlotUnknown", err)
	}
	if _, err := slots.Consume("sau_deadbeef"); !errors.Is(err, errSlotUnknown) {
		t.Errorf("Consume(unknown) err = %v, want errSlotUnknown", err)
	}

	ref, _, _ := slots.Mint(4)
	if _, err := slots.Consume(ref); !errors.Is(err, errSlotEmpty) {
		t.Errorf("Consume(minted, never uploaded) err = %v, want errSlotEmpty", err)
	}
}

// TestSlots_Expiry pins that time retires slots: expired refs refuse both
// upload and consume, and minting sweeps their staged files.
func TestSlots_Expiry(t *testing.T) {
	slots := newTestSlots(t)
	payload := []byte("stale")

	ref, _, _ := slots.Mint(int64(len(payload)))
	if err := slots.Receive(ref, bytes.NewReader(payload)); err != nil {
		t.Fatalf("Receive: %v", err)
	}

	// Jump past the TTL.
	slots.now = func() time.Time { return time.Now().Add(DefaultSlotTTL + time.Minute) }

	if _, err := slots.Consume(ref); !errors.Is(err, errSlotUnknown) {
		t.Errorf("Consume(expired) err = %v, want errSlotUnknown", err)
	}

	// A mint sweeps the expired slot's staged file.
	if _, _, err := slots.Mint(4); err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if _, err := os.Stat(slots.stagePath(ref)); !os.IsNotExist(err) {
		t.Error("expired staging file survived the sweep")
	}
}

// TestSlots_BootSweepsOrphans pins the crash-recovery story: files left in
// the staging directory by a dead process are removed on construction.
func TestSlots_BootSweepsOrphans(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "staging")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	orphan := filepath.Join(dir, "sau_orphan.zip")
	if err := os.WriteFile(orphan, []byte("left behind"), 0600); err != nil {
		t.Fatal(err)
	}

	if _, err := NewUploadSlots(dir, DefaultSlotTTL, testMaxSize); err != nil {
		t.Fatalf("NewUploadSlots: %v", err)
	}
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Error("orphaned staging file survived boot")
	}
}
