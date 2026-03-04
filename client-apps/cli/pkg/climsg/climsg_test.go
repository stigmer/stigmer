package climsg

import (
	"bytes"
	"testing"

	"github.com/fatih/color"
	"github.com/stretchr/testify/assert"
)

func init() {
	color.NoColor = true
}

func TestWriter_Info(t *testing.T) {
	var buf bytes.Buffer
	w := New(&buf)
	w.Info("hello %s", "world")
	assert.Equal(t, "hello world\n", buf.String())
}

func TestWriter_Success(t *testing.T) {
	var buf bytes.Buffer
	w := New(&buf)
	w.Success("done")
	assert.Equal(t, "✓ done\n", buf.String())
}

func TestWriter_Warning(t *testing.T) {
	var buf bytes.Buffer
	w := New(&buf)
	w.Warning("careful %d", 42)
	assert.Equal(t, "⚠ careful 42\n", buf.String())
}

func TestWriter_Error(t *testing.T) {
	var buf bytes.Buffer
	w := New(&buf)
	w.Error("bad")
	assert.Equal(t, "✗ bad\n", buf.String())
}

func TestWriter_NoArgs(t *testing.T) {
	var buf bytes.Buffer
	w := New(&buf)
	w.Info("plain message")
	assert.Equal(t, "plain message\n", buf.String())
}

func TestWriter_EmptyFormat(t *testing.T) {
	var buf bytes.Buffer
	w := New(&buf)
	w.Info("")
	assert.Equal(t, "\n", buf.String())
}

func TestPackageLevelFunctions_DelegateToStderr(t *testing.T) {
	var buf bytes.Buffer
	restore := ReplaceOutput(&buf)
	defer restore()

	Info("info")
	Success("ok")
	Warning("warn")
	Error("err")

	out := buf.String()
	assert.Contains(t, out, "info\n")
	assert.Contains(t, out, "✓ ok\n")
	assert.Contains(t, out, "⚠ warn\n")
	assert.Contains(t, out, "✗ err\n")
}

func TestReplaceOutput_Restores(t *testing.T) {
	var buf bytes.Buffer
	restore := ReplaceOutput(&buf)
	Info("captured")
	restore()

	Info("not captured")

	assert.Contains(t, buf.String(), "captured")
	assert.NotContains(t, buf.String(), "not captured")
}
