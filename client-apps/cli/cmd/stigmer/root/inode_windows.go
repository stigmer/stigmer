//go:build windows

package root

import "os"

func getInode(_ os.FileInfo) uint64 {
	return 0
}
