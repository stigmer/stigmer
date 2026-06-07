package approval

import (
	"context"
	"io"
	"time"
)

// keyCode represents a decoded keystroke from raw terminal input.
type keyCode int

const (
	keyNone keyCode = iota
	keyUp
	keyDown
	keyEnter
	keyEsc
	keyCtrlC
	keyOne
	keyTwo
	keyThree
	keyFour
	keyUnknown
)

// escSeqTimeout is the maximum time to wait for subsequent bytes after
// receiving an escape byte (\033). Arrow keys produce 3-byte sequences
// (\033[A, \033[B) that arrive nearly simultaneously. A standalone Esc
// keypress produces only \033 with no follow-up within this window.
const escSeqTimeout = 50 * time.Millisecond

// keyReader decodes raw terminal bytes into keyCode values. It runs a
// persistent goroutine that reads one byte at a time from the underlying
// reader and delivers them via a buffered channel. This design:
//
//   - Prevents race conditions when multiple prompts share the same fd
//   - Enables timeout-based escape sequence disambiguation
//   - Stays dormant between prompts (blocked on Read in cooked mode)
//
// The goroutine cannot be cleanly stopped because terminal reads are
// blocking and io.Reader has no cancel mechanism. This is the same
// limitation Bubbletea has. One goroutine blocked on a syscall uses
// ~4KB of stack and zero CPU.
type keyReader struct {
	bytes chan byte
	errs  chan error
}

// newKeyReader creates a keyReader and starts its background read loop.
// The goroutine lives for the process lifetime — it blocks on Read
// between prompts and resumes when raw mode makes bytes available.
func newKeyReader(in io.Reader) *keyReader {
	kr := &keyReader{
		bytes: make(chan byte, 64),
		errs:  make(chan error, 1),
	}
	go kr.readLoop(in)
	return kr
}

func (kr *keyReader) readLoop(in io.Reader) {
	buf := [1]byte{}
	for {
		_, err := in.Read(buf[:])
		if err != nil {
			kr.errs <- err
			return
		}
		kr.bytes <- buf[0]
	}
}

// drain discards any buffered bytes from the channel. Call this before
// each prompt to prevent stale input (typed while the terminal was in
// cooked mode) from triggering unintended selections.
func (kr *keyReader) drain() {
	for {
		select {
		case <-kr.bytes:
		default:
			return
		}
	}
}

// readKey blocks until a complete keystroke is available or the context
// is cancelled. It handles escape sequence parsing: after receiving
// \033, it waits up to escSeqTimeout for the CSI indicator '[' and
// direction byte to distinguish arrow keys from a standalone Esc.
func (kr *keyReader) readKey(ctx context.Context) (keyCode, error) {
	b, err := kr.readByte(ctx)
	if err != nil {
		return keyNone, err
	}

	if b == '\033' {
		return kr.readEscapeSequence(ctx)
	}
	return decodeSingleByte(b), nil
}

// readByte returns the next byte from the channel, respecting context
// cancellation and reader errors. Buffered bytes are always consumed
// before errors — this prevents a race where the reader goroutine hits
// EOF while unconsumed bytes remain in the channel.
func (kr *keyReader) readByte(ctx context.Context) (byte, error) {
	select {
	case b := <-kr.bytes:
		return b, nil
	default:
	}
	select {
	case <-ctx.Done():
		return 0, ctx.Err()
	case b := <-kr.bytes:
		return b, nil
	case err := <-kr.errs:
		return 0, err
	}
}

// readByteTimeout returns the next byte if one arrives within the
// timeout. Returns (0, false) if the timeout expires.
func (kr *keyReader) readByteTimeout(timeout time.Duration) (byte, bool) {
	t := time.NewTimer(timeout)
	defer t.Stop()
	select {
	case b := <-kr.bytes:
		return b, true
	case <-t.C:
		return 0, false
	}
}

// readEscapeSequence is called after receiving \033. It attempts to
// read the CSI '[' and direction byte within the escape sequence
// timeout. If the bytes don't arrive in time or don't form a known
// sequence, it returns keyEsc (standalone Escape).
func (kr *keyReader) readEscapeSequence(ctx context.Context) (keyCode, error) {
	b2, ok := kr.readByteTimeout(escSeqTimeout)
	if !ok {
		return keyEsc, nil
	}
	if b2 != '[' {
		return keyEsc, nil
	}

	b3, ok := kr.readByteTimeout(escSeqTimeout)
	if !ok {
		return keyEsc, nil
	}
	_ = ctx // ctx unused in timeout path but kept in signature for consistency

	switch b3 {
	case 'A':
		return keyUp, nil
	case 'B':
		return keyDown, nil
	default:
		return keyUnknown, nil
	}
}

func decodeSingleByte(b byte) keyCode {
	switch {
	case b == '\r' || b == '\n':
		return keyEnter
	case b == 3: // Ctrl+C
		return keyCtrlC
	case b == '1':
		return keyOne
	case b == '2':
		return keyTwo
	case b == '3':
		return keyThree
	case b == '4':
		return keyFour
	default:
		return keyUnknown
	}
}
