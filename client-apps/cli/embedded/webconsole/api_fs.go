package webconsole

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type fsEntry struct {
	Name   string `json:"name"`
	IsDir  bool   `json:"isDir"`
	Hidden bool   `json:"hidden,omitempty"`
}

type fsListResponse struct {
	Path    string    `json:"path"`
	CWD     string    `json:"cwd"`
	Home    string    `json:"home"`
	Entries []fsEntry `json:"entries"`
}

type fsErrorResponse struct {
	Error string `json:"error"`
}

func handleFSList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	requestedPath := r.URL.Query().Get("path")

	cwd, _ := os.Getwd()
	home, _ := os.UserHomeDir()

	if requestedPath == "" {
		requestedPath = home
	}

	if !filepath.IsAbs(requestedPath) {
		writeJSONError(w, http.StatusBadRequest, "path must be absolute")
		return
	}

	requestedPath = filepath.Clean(requestedPath)

	info, err := os.Stat(requestedPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSONError(w, http.StatusNotFound, "directory not found")
			return
		}
		if os.IsPermission(err) {
			writeJSONError(w, http.StatusForbidden, "permission denied")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "failed to stat path")
		return
	}

	if !info.IsDir() {
		writeJSONError(w, http.StatusBadRequest, "path is not a directory")
		return
	}

	dirEntries, err := os.ReadDir(requestedPath)
	if err != nil {
		if os.IsPermission(err) {
			writeJSONError(w, http.StatusForbidden, "permission denied")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "failed to read directory")
		return
	}

	entries := make([]fsEntry, 0, len(dirEntries))
	for _, de := range dirEntries {
		if !de.Type().IsRegular() && !de.IsDir() {
			// Resolve symlinks to determine isDir.
			resolved, err := os.Stat(filepath.Join(requestedPath, de.Name()))
			if err != nil {
				continue
			}
			entries = append(entries, fsEntry{
				Name:   de.Name(),
				IsDir:  resolved.IsDir(),
				Hidden: strings.HasPrefix(de.Name(), "."),
			})
			continue
		}
		entries = append(entries, fsEntry{
			Name:   de.Name(),
			IsDir:  de.IsDir(),
			Hidden: strings.HasPrefix(de.Name(), "."),
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(fsListResponse{
		Path:    requestedPath,
		CWD:     cwd,
		Home:    home,
		Entries: entries,
	})
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(fsErrorResponse{Error: msg})
}
