use std::path::Path;

use serde::Serialize;

const MAX_ENTRIES: usize = 10_000;

/// Soft cap for a single file read. Must stay in sync with
/// `MAX_WORKSPACE_FILE_READ_BYTES` on the TS side so web and desktop truncate at
/// the same boundary.
const MAX_READ_BYTES: usize = 1_048_576; // 1 MiB

/// Only the head is scanned for a NUL byte (git's text/binary heuristic).
const BINARY_SNIFF_BYTES: usize = 8000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    path: String,
    is_directory: bool,
}

#[derive(Debug, Serialize)]
pub struct ListResult {
    files: Vec<FileEntry>,
    truncated: bool,
}

/// Lists files in a workspace directory, respecting `.gitignore` rules.
///
/// Uses the `ignore` crate (the library powering ripgrep) for directory
/// walking. This automatically handles nested `.gitignore` files,
/// `.git/info/exclude`, and global gitconfig excludes. Hidden files and
/// directories (`.git/`, `.DS_Store`) are excluded by default.
///
/// Returns up to [`MAX_ENTRIES`] file entries with paths relative to the
/// workspace root. Sets `truncated: true` if the walk produces more
/// entries than the cap.
fn list_files(root: &Path) -> Result<ListResult, String> {
    if !root.exists() {
        return Err(format!(
            "Workspace path does not exist: {}",
            root.display()
        ));
    }
    if !root.is_dir() {
        return Err(format!(
            "Workspace path is not a directory: {}",
            root.display()
        ));
    }

    let walker = ignore::WalkBuilder::new(root)
        .follow_links(false)
        .standard_filters(true)
        .build();

    let mut files = Vec::with_capacity(MAX_ENTRIES.min(4096));
    let mut truncated = false;

    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        if entry.path() == root {
            continue;
        }

        let rel = match entry.path().strip_prefix(root) {
            Ok(r) => r,
            Err(_) => continue,
        };

        let rel_str = rel.to_string_lossy().to_string();
        if rel_str.is_empty() {
            continue;
        }

        let is_dir = entry
            .file_type()
            .map(|ft| ft.is_dir())
            .unwrap_or(false);

        files.push(FileEntry {
            path: rel_str,
            is_directory: is_dir,
        });

        if files.len() >= MAX_ENTRIES {
            truncated = true;
            break;
        }
    }

    Ok(ListResult { files, truncated })
}

#[tauri::command]
pub async fn list_workspace_files(path: String) -> Result<ListResult, String> {
    let root = std::path::PathBuf::from(&path);
    tokio::task::spawn_blocking(move || list_files(&root))
        .await
        .map_err(|e| format!("Failed to list workspace files: {e}"))?
}

/// Decoded content of a single workspace file. Serializes to the TS
/// `WorkspaceFileContent` shape (hence `camelCase`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    /// Decoded UTF-8 text, or `None` when binary or undecodable.
    text: Option<String>,
    is_binary: bool,
    /// Full file size in bytes — independent of truncation.
    size: u64,
    /// `"utf-8"` when decoded; `"unknown"` for binary or undecodable bytes
    /// (disambiguated by `is_binary`).
    encoding: String,
    truncated: bool,
}

/// Reads a single file under `root`, capped at [`MAX_READ_BYTES`].
///
/// Rejects absolute and `..`-escaping relative paths, and re-checks the
/// canonicalized target against the canonicalized root so a symlink cannot
/// escape the workspace. Returns `Err` for missing files or directories — the
/// caller maps that to an error state, never to the "unsupported" `null`.
fn read_file(root: &Path, relative: &str) -> Result<ReadResult, String> {
    use std::io::Read;

    let rel = Path::new(relative);
    if rel.is_absolute() {
        return Err(format!("Path must be relative: {relative}"));
    }
    if rel
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(format!("Path escapes the workspace root: {relative}"));
    }

    let root_canon = root
        .canonicalize()
        .map_err(|e| format!("Invalid workspace root {}: {e}", root.display()))?;
    let target = root_canon
        .join(rel)
        .canonicalize()
        .map_err(|e| format!("File not found: {relative} ({e})"))?;

    // Defense in depth: a symlink inside the root could still resolve outside it.
    if !target.starts_with(&root_canon) {
        return Err(format!("Path escapes the workspace root: {relative}"));
    }

    let meta = std::fs::metadata(&target).map_err(|e| format!("Cannot stat {relative}: {e}"))?;
    if meta.is_dir() {
        return Err(format!("Cannot read \"{relative}\": path is a directory"));
    }
    let size = meta.len();

    // Read at most MAX+1 bytes so truncation is detectable without loading a
    // multi-gigabyte file into memory.
    let file = std::fs::File::open(&target).map_err(|e| format!("Cannot open {relative}: {e}"))?;
    let mut bytes = Vec::new();
    file.take((MAX_READ_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Cannot read {relative}: {e}"))?;

    let is_binary = bytes.iter().take(BINARY_SNIFF_BYTES).any(|&b| b == 0);
    if is_binary {
        return Ok(ReadResult {
            text: None,
            is_binary: true,
            size,
            encoding: "unknown".into(),
            truncated: false,
        });
    }

    let truncated = bytes.len() > MAX_READ_BYTES;
    if truncated {
        bytes.truncate(MAX_READ_BYTES);
    }

    let text: Option<String> = match std::str::from_utf8(&bytes) {
        Ok(s) => Some(s.to_string()),
        // A truncated read may cut mid-UTF-8-sequence; keep the valid prefix
        // rather than discarding an otherwise-valid file.
        Err(err) if truncated => std::str::from_utf8(&bytes[..err.valid_up_to()])
            .ok()
            .map(str::to_string),
        Err(_) => None,
    };

    Ok(ReadResult {
        encoding: if text.is_some() { "utf-8" } else { "unknown" }.into(),
        text,
        is_binary: false,
        size,
        truncated,
    })
}

#[tauri::command]
pub async fn read_workspace_file(
    root: String,
    relative_path: String,
) -> Result<ReadResult, String> {
    let root_buf = std::path::PathBuf::from(&root);
    tokio::task::spawn_blocking(move || read_file(&root_buf, &relative_path))
        .await
        .map_err(|e| format!("Failed to read workspace file: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn valid_directory_returns_files() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("main.rs"), "fn main() {}").unwrap();
        fs::create_dir(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src/lib.rs"), "").unwrap();

        let result = list_files(dir.path()).unwrap();

        assert!(!result.truncated);
        assert!(result.files.len() >= 3);

        let paths: Vec<&str> = result.files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"main.rs"));
        assert!(paths.contains(&"src"));
        assert!(paths.contains(&"src/lib.rs"));
    }

    #[test]
    fn entries_have_relative_paths() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("a/b")).unwrap();
        fs::write(dir.path().join("a/b/deep.txt"), "").unwrap();

        let result = list_files(dir.path()).unwrap();

        let paths: Vec<&str> = result.files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"a/b/deep.txt"));
        for f in &result.files {
            assert!(!f.path.starts_with('/'), "path should be relative: {}", f.path);
        }
    }

    #[test]
    fn directory_entries_marked_correctly() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("subdir")).unwrap();
        fs::write(dir.path().join("file.txt"), "").unwrap();

        let result = list_files(dir.path()).unwrap();

        let subdir = result.files.iter().find(|f| f.path == "subdir").unwrap();
        assert!(subdir.is_directory);

        let file = result.files.iter().find(|f| f.path == "file.txt").unwrap();
        assert!(!file.is_directory);
    }

    #[test]
    fn nonexistent_path_returns_error() {
        let result = list_files(Path::new("/nonexistent/path/xyzzy"));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn file_path_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("not_a_dir.txt");
        fs::write(&file_path, "").unwrap();

        let result = list_files(&file_path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a directory"));
    }

    #[test]
    fn gitignore_filtering_works() {
        let dir = tempfile::tempdir().unwrap();
        // The ignore crate requires .git/ to activate .gitignore processing.
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".gitignore"), "ignored.log\nbuild/\n").unwrap();
        fs::write(dir.path().join("kept.rs"), "").unwrap();
        fs::write(dir.path().join("ignored.log"), "").unwrap();
        fs::create_dir(dir.path().join("build")).unwrap();
        fs::write(dir.path().join("build/output.js"), "").unwrap();

        let result = list_files(dir.path()).unwrap();
        let paths: Vec<&str> = result.files.iter().map(|f| f.path.as_str()).collect();

        assert!(paths.contains(&"kept.rs"));
        assert!(!paths.contains(&"ignored.log"), "ignored file should be filtered");
        assert!(!paths.contains(&"build"), "ignored directory should be filtered");
        assert!(!paths.contains(&"build/output.js"), "files in ignored directory should be filtered");
    }

    #[test]
    fn hidden_directories_excluded() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git/config"), "").unwrap();
        fs::write(dir.path().join("visible.rs"), "").unwrap();

        let result = list_files(dir.path()).unwrap();
        let paths: Vec<&str> = result.files.iter().map(|f| f.path.as_str()).collect();

        assert!(paths.contains(&"visible.rs"));
        assert!(!paths.contains(&".git"), ".git should be excluded");
        assert!(!paths.contains(&".git/config"), ".git contents should be excluded");
    }

    #[test]
    fn cap_produces_truncated() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..MAX_ENTRIES + 100 {
            fs::write(dir.path().join(format!("file_{i:06}.txt")), "").unwrap();
        }

        let result = list_files(dir.path()).unwrap();
        assert!(result.truncated);
        assert_eq!(result.files.len(), MAX_ENTRIES);
    }

    #[test]
    fn empty_directory_returns_empty_list() {
        let dir = tempfile::tempdir().unwrap();

        let result = list_files(dir.path()).unwrap();
        assert!(!result.truncated);
        assert!(result.files.is_empty());
    }

    #[test]
    fn reads_a_text_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("hello.txt"), "Hello World!").unwrap();

        let result = read_file(dir.path(), "hello.txt").unwrap();

        assert_eq!(result.text.as_deref(), Some("Hello World!"));
        assert!(!result.is_binary);
        assert!(!result.truncated);
        assert_eq!(result.size, 12);
        assert_eq!(result.encoding, "utf-8");
    }

    #[test]
    fn reads_a_nested_relative_path() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("a/b")).unwrap();
        fs::write(dir.path().join("a/b/deep.txt"), "deep").unwrap();

        let result = read_file(dir.path(), "a/b/deep.txt").unwrap();
        assert_eq!(result.text.as_deref(), Some("deep"));
    }

    #[test]
    fn detects_binary_via_nul_byte() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("blob.bin"), [0x48, 0x00, 0x49]).unwrap();

        let result = read_file(dir.path(), "blob.bin").unwrap();
        assert!(result.is_binary);
        assert!(result.text.is_none());
        assert_eq!(result.size, 3);
    }

    #[test]
    fn truncates_at_the_cap_and_reports_full_size() {
        let dir = tempfile::tempdir().unwrap();
        let big = "a".repeat(MAX_READ_BYTES + 500);
        fs::write(dir.path().join("big.txt"), &big).unwrap();

        let result = read_file(dir.path(), "big.txt").unwrap();

        assert!(result.truncated);
        assert_eq!(result.size, (MAX_READ_BYTES + 500) as u64);
        assert_eq!(result.text.unwrap().len(), MAX_READ_BYTES);
    }

    #[test]
    fn keeps_valid_utf8_prefix_when_truncation_splits_a_char() {
        let dir = tempfile::tempdir().unwrap();
        // Fill just under the cap with ASCII, then a multibyte char that will
        // straddle the MAX_READ_BYTES boundary.
        let mut content = "a".repeat(MAX_READ_BYTES - 1);
        content.push('世'); // 3 bytes → cut mid-sequence
        fs::write(dir.path().join("edge.txt"), &content).unwrap();

        let result = read_file(dir.path(), "edge.txt").unwrap();

        assert!(result.truncated);
        assert_eq!(result.encoding, "utf-8");
        // The valid prefix is kept; the split trailing char is dropped.
        assert_eq!(result.text.unwrap().len(), MAX_READ_BYTES - 1);
    }

    #[test]
    fn rejects_parent_dir_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let result = read_file(dir.path(), "../secret.txt");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("escapes the workspace root"));
    }

    #[test]
    fn rejects_absolute_paths() {
        let dir = tempfile::tempdir().unwrap();
        let result = read_file(dir.path(), "/etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must be relative"));
    }

    #[test]
    fn missing_file_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let result = read_file(dir.path(), "nope.txt");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("File not found"));
    }

    #[test]
    fn directory_path_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();

        let result = read_file(dir.path(), "sub");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("is a directory"));
    }
}
