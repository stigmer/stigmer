//go:build windows

package logs

import "os"

// getInode is a best-effort implementation on Windows where POSIX inodes do
// not exist. Returning 0 disables the file-replacement detection in
// tailLogFile; the tailer will still recover via the file-size check.
func getInode(_ os.FileInfo) uint64 {
	return 0
}
