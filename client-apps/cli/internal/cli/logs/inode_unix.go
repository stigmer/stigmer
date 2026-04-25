//go:build !windows

package logs

import (
	"os"
	"syscall"
)

// getInode extracts the inode number from os.FileInfo.
// Used to detect when a log file has been replaced (e.g. on server restart).
func getInode(info os.FileInfo) uint64 {
	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		return stat.Ino
	}
	return 0
}
