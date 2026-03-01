package pythonrt

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/httputil"
)

// downloadPythonDist downloads the python-build-standalone install_only tarball
// for the given platform to destPath, then verifies its SHA-256 checksum.
func downloadPythonDist(platform Platform, destPath string) error {
	url, err := platform.DownloadURL()
	if err != nil {
		return err
	}

	triple, err := platform.PBSTriple()
	if err != nil {
		return err
	}

	expectedHash, ok := pbsChecksums[triple]
	if !ok {
		return fmt.Errorf("no pinned checksum for platform triple %s", triple)
	}

	log.Info().
		Str("url", url).
		Str("platform", platform.String()).
		Msg("Downloading python-build-standalone")

	_, err = httputil.DownloadFile(&httputil.DownloadOptions{
		URL:      url,
		DestPath: destPath,
		OnProgress: func(downloaded, total int64) {
			if total > 0 {
				log.Debug().
					Str("progress", fmt.Sprintf("%.0f%%", float64(downloaded)/float64(total)*100)).
					Str("size", httputil.FormatBytes(downloaded)).
					Msg("Downloading Python runtime")
			}
		},
	})
	if err != nil {
		return errors.Wrap(err, "failed to download python-build-standalone tarball")
	}

	if err := verifyChecksum(destPath, expectedHash); err != nil {
		return err
	}

	return nil
}

// verifyChecksum computes the SHA-256 of the file at path and compares it
// against the expected hex-encoded digest.
func verifyChecksum(path, expected string) error {
	actual, err := hashFile(path)
	if err != nil {
		return errors.Wrap(err, "failed to compute checksum of downloaded file")
	}
	if actual != expected {
		return fmt.Errorf(
			"checksum mismatch: expected %s, got %s",
			expected, actual,
		)
	}
	log.Debug().Str("sha256", actual[:16]+"…").Msg("Checksum verified")
	return nil
}

// hashFile computes the SHA-256 hex digest of the file at path.
func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", errors.Wrapf(err, "failed to open %s for hashing", path)
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", errors.Wrapf(err, "failed to read %s for hashing", path)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
