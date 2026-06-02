use std::path::Path;

use serde::Serialize;

const MAX_ENTRIES: usize = 10_000;

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
}
