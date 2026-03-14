package browser

import (
	"os/exec"
	"runtime"

	"github.com/pkg/errors"
)

// Open opens the given URL in the user's default browser.
//
// Falls back silently on failure — callers should always print the URL
// as a manual fallback before calling this function.
func Open(url string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", url).Start()
	case "linux":
		return exec.Command("xdg-open", url).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	default:
		return errors.Errorf("unsupported platform: %s", runtime.GOOS)
	}
}
