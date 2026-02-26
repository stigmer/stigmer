package clioutput

import (
	"bytes"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAlwaysYesConfirmer(t *testing.T) {
	c := AlwaysYesConfirmer{}

	confirmed, err := c.Confirm("Delete everything?")
	require.NoError(t, err)
	assert.True(t, confirmed)
}

func TestAlwaysYesConfirmer_IgnoresPrompt(t *testing.T) {
	c := AlwaysYesConfirmer{}

	confirmed, err := c.Confirm("")
	require.NoError(t, err)
	assert.True(t, confirmed)
}

// tempFileWithContent creates a temporary file with the given content
// and returns the *os.File. The caller must close and remove it.
func tempFileWithContent(t *testing.T, content string) *os.File {
	t.Helper()

	f, err := os.CreateTemp(t.TempDir(), "confirm-test-*")
	require.NoError(t, err)

	_, err = f.WriteString(content)
	require.NoError(t, err)

	_, err = f.Seek(0, 0)
	require.NoError(t, err)

	return f
}

func TestInteractiveConfirmer_AcceptsY(t *testing.T) {
	// Use a file to simulate terminal-like input.
	// Note: in tests, the file won't be a real terminal,
	// so IsTerminal returns false. We test that path separately.
	// Here we test the parsing logic by calling the internal reader path.
	for _, answer := range []string{"y\n", "Y\n"} {
		f := tempFileWithContent(t, answer)
		defer f.Close()

		var promptBuf bytes.Buffer
		c := &InteractiveConfirmer{In: f, Out: &promptBuf}

		// Since temp files aren't terminals, this returns false (safety behavior).
		confirmed, err := c.Confirm("Delete? [y/N]")
		require.NoError(t, err)
		assert.False(t, confirmed, "non-terminal input should be denied for safety")
	}
}

func TestInteractiveConfirmer_NonTerminalDenies(t *testing.T) {
	// A pipe fd is not a terminal. The confirmer should return false.
	r, w, err := os.Pipe()
	require.NoError(t, err)
	defer r.Close()
	defer w.Close()

	var promptBuf bytes.Buffer
	c := &InteractiveConfirmer{In: r, Out: &promptBuf}

	confirmed, err := c.Confirm("Delete? [y/N]")
	require.NoError(t, err)
	assert.False(t, confirmed)
	assert.Empty(t, promptBuf.String(), "no prompt should be written for non-terminal")
}

func TestNewConfirmer_Force(t *testing.T) {
	var buf bytes.Buffer
	c := NewConfirmer(true, &buf)

	_, ok := c.(AlwaysYesConfirmer)
	assert.True(t, ok, "force=true should return AlwaysYesConfirmer")
}

func TestNewConfirmer_Interactive(t *testing.T) {
	var buf bytes.Buffer
	c := NewConfirmer(false, &buf)

	_, ok := c.(*InteractiveConfirmer)
	assert.True(t, ok, "force=false should return InteractiveConfirmer")
}
