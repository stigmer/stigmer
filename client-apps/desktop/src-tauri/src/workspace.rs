use std::path::Path;

use grep_regex::RegexMatcherBuilder;
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
use serde::Serialize;

const MAX_ENTRIES: usize = 10_000;

/// Soft cap for a single file read. Must stay in sync with
/// `MAX_WORKSPACE_FILE_READ_BYTES` on the TS side so web and desktop truncate at
/// the same boundary. Also the per-file size ceiling for content search — a file
/// too large to fully view is skipped by the grep too, keeping the two surfaces
/// consistent about what they will and won't show.
const MAX_READ_BYTES: usize = 1_048_576; // 1 MiB

/// Only the head is scanned for a NUL byte (git's text/binary heuristic).
const BINARY_SNIFF_BYTES: usize = 8000;

/// Byte ceiling for delivering a workspace *image* whole
/// (stigmer/stigmer#379). Must stay in sync with
/// `MAX_WORKSPACE_IMAGE_READ_BYTES` on the TS side (`WorkspaceFileReader.ts`).
/// Deliberately larger than `MAX_READ_BYTES`: text degrades gracefully when
/// truncated, an image does not — images are delivered whole or not at all.
const MAX_IMAGE_READ_BYTES: usize = 10 * 1024 * 1024; // 10 MiB

/// Raster formats the viewer renders inline. Must stay in sync with
/// `IMAGE_MIME_BY_EXTENSION` in `WorkspaceFileReader.ts` (SVG deliberately
/// absent on both sides — it decodes as UTF-8 and flows through the text path).
const IMAGE_EXTENSIONS: [&str; 8] = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"];

/// Whether the path's extension names a raster format the viewer can render.
fn is_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

/// Per-file content-search match cap. A single noisy file cannot flood the
/// results; hitting it flags the result set `truncated`.
const MAX_MATCHES_PER_FILE: usize = 50;

/// Workspace-wide content-search match cap. Bounds the payload and the walk;
/// hitting it flags the result set `truncated`.
const MAX_TOTAL_MATCHES: usize = 1000;

/// Preview length ceiling (in characters). Longer matched lines are windowed
/// around the first hit so the match stays visible without shipping a whole
/// minified line.
const MAX_PREVIEW_CHARS: usize = 240;

/// Characters of context kept before the match when a long line is windowed.
const PREVIEW_WINDOW_BEFORE: usize = 40;

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

/// Builds the directory walker shared by file listing and content search, so
/// both surfaces see the **identical** file set: nested `.gitignore` rules,
/// `.git/info/exclude`, global gitconfig excludes, and hidden files/dirs
/// (`.git/`, `.DS_Store`) filtered out. Keeping this in one place means a file
/// that never appears in the Explorer can never appear in a search hit either.
fn build_walker(root: &Path) -> ignore::Walk {
    ignore::WalkBuilder::new(root)
        .follow_links(false)
        .standard_filters(true)
        .build()
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

    let walker = build_walker(root);

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

/// A single content-search hit. Serializes to the TS `WorkspaceContentMatch`
/// shape (hence `camelCase`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentMatch {
    /// Workspace-root-relative path of the file the match is in.
    path: String,
    /// 1-based line number of the match.
    line: u32,
    /// The matched line, windowed so the match stays visible on long lines. The
    /// TS side recomputes the highlight range from `preview` + query, so no
    /// column/offset is carried (it would be an unused field until jump-to-line).
    preview: String,
}

/// Result of a workspace content search: ranked hits plus a `truncated` flag
/// set when a per-file or workspace-wide cap stopped the walk early.
#[derive(Debug, Serialize)]
pub struct SearchResult {
    matches: Vec<ContentMatch>,
    truncated: bool,
}

/// Sink that collects hits for a single file, enforcing the per-file cap and
/// the workspace-wide cap. Returning `Ok(false)` stops the search for the
/// current file; the outer loop stops the whole walk once the total cap is hit.
struct MatchSink<'a> {
    rel_path: &'a str,
    needle_lower: &'a str,
    matches: &'a mut Vec<ContentMatch>,
    per_file: usize,
    truncated: &'a mut bool,
}

impl Sink for MatchSink<'_> {
    type Error = std::io::Error;

    fn matched(
        &mut self,
        _searcher: &Searcher,
        mat: &SinkMatch<'_>,
    ) -> Result<bool, std::io::Error> {
        if self.matches.len() >= MAX_TOTAL_MATCHES {
            *self.truncated = true;
            return Ok(false);
        }
        if self.per_file >= MAX_MATCHES_PER_FILE {
            *self.truncated = true;
            return Ok(false);
        }

        // A line-oriented literal search yields one line per call; guard against
        // a multi-line chunk anyway by numbering from the chunk's first line.
        let first_line = mat.line_number().unwrap_or(0) as u32;
        for (offset, raw) in mat.lines().enumerate() {
            if self.matches.len() >= MAX_TOTAL_MATCHES || self.per_file >= MAX_MATCHES_PER_FILE {
                *self.truncated = true;
                return Ok(false);
            }
            let line = String::from_utf8_lossy(raw);
            let line = line.trim_end_matches(['\r', '\n']);
            self.matches.push(ContentMatch {
                path: self.rel_path.to_string(),
                line: first_line + offset as u32,
                preview: window_preview(line, self.needle_lower),
            });
            self.per_file += 1;
        }
        Ok(true)
    }
}

/// Windows a matched line to at most [`MAX_PREVIEW_CHARS`] characters, centered
/// so the first occurrence of the (lowercased) needle stays visible. Ellipses
/// mark elision on either side. Char-based to never split a UTF-8 sequence.
fn window_preview(line: &str, needle_lower: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    if chars.len() <= MAX_PREVIEW_CHARS {
        return line.to_string();
    }

    // Locate the match in char space. Lowercasing can shift offsets for a few
    // exotic scripts, but this only nudges the window — the TS side re-finds and
    // highlights the needle in the returned preview regardless.
    let line_lower = line.to_lowercase();
    let match_char_start = line_lower
        .find(needle_lower)
        .map(|byte| line_lower[..byte].chars().count())
        .unwrap_or(0);

    let start = match_char_start.saturating_sub(PREVIEW_WINDOW_BEFORE);
    let end = (start + MAX_PREVIEW_CHARS).min(chars.len());

    let mut preview = String::new();
    if start > 0 {
        preview.push('…');
    }
    preview.extend(&chars[start..end]);
    if end < chars.len() {
        preview.push('…');
    }
    preview
}

/// Searches file *contents* under `root` for a case-insensitive literal
/// substring, reusing the same [`build_walker`] file set as listing.
///
/// Uses ripgrep's own `grep-searcher` + `grep-regex` so line counting, CRLF,
/// encoding, and binary detection match ripgrep instead of being hand-rolled;
/// the deferred regex mode is one flag (`fixed_strings(false)`) away. Files
/// larger than [`MAX_READ_BYTES`] are skipped (consistent with the viewer's read
/// cap). Results are capped (per file and total) and sorted deterministically.
fn search_content(root: &Path, query: &str) -> Result<SearchResult, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(SearchResult { matches: Vec::new(), truncated: false });
    }
    if !root.exists() {
        return Err(format!("Workspace path does not exist: {}", root.display()));
    }
    if !root.is_dir() {
        return Err(format!("Workspace path is not a directory: {}", root.display()));
    }

    // `fixed_strings` treats the pattern as a literal, so query metacharacters
    // (`.`, `(`, …) match literally — substring search today, regex later.
    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(true)
        .fixed_strings(true)
        .build(trimmed)
        .map_err(|e| format!("Invalid search query: {e}"))?;

    let needle_lower = trimmed.to_lowercase();

    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\x00'))
        .line_number(true)
        .build();

    let mut matches: Vec<ContentMatch> = Vec::new();
    let mut truncated = false;

    for entry in build_walker(root) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        if entry.path() == root {
            continue;
        }
        let is_file = entry.file_type().map(|ft| ft.is_file()).unwrap_or(false);
        if !is_file {
            continue;
        }

        // Skip oversized files (mirrors the viewer's 1 MiB read cap).
        if let Ok(meta) = entry.metadata() {
            if meta.len() > MAX_READ_BYTES as u64 {
                continue;
            }
        }

        let rel = match entry.path().strip_prefix(root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let rel_str = rel.to_string_lossy().to_string();
        if rel_str.is_empty() {
            continue;
        }

        {
            let mut sink = MatchSink {
                rel_path: &rel_str,
                needle_lower: &needle_lower,
                matches: &mut matches,
                per_file: 0,
                truncated: &mut truncated,
            };
            // An unreadable file (permissions, race) is skipped, not fatal.
            let _ = searcher.search_path(&matcher, entry.path(), &mut sink);
        }

        if matches.len() >= MAX_TOTAL_MATCHES {
            truncated = true;
            break;
        }
    }

    // Deterministic order (walker order is not stable across platforms): by
    // path, then line — so tests and the UI see a stable ranking.
    matches.sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)));

    Ok(SearchResult { matches, truncated })
}

#[tauri::command]
pub async fn search_workspace_content(
    root: String,
    query: String,
) -> Result<SearchResult, String> {
    let root_buf = std::path::PathBuf::from(&root);
    tokio::task::spawn_blocking(move || search_content(&root_buf, &query))
        .await
        .map_err(|e| format!("Failed to search workspace files: {e}"))?
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
    /// `"utf-8"` when decoded; `"base64"` when `image_base64` is set;
    /// `"unknown"` for other binary or undecodable bytes (disambiguated by
    /// `is_binary`).
    encoding: String,
    truncated: bool,
    /// Base64 of the *complete* bytes when the file is a renderable image
    /// within [`MAX_IMAGE_READ_BYTES`] (stigmer/stigmer#379) — never partial.
    /// The TS shim decodes this into `WorkspaceFileContent.bytes`.
    #[serde(skip_serializing_if = "Option::is_none")]
    image_base64: Option<String>,
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

    // Read at most cap+1 bytes so truncation is detectable without loading a
    // multi-gigabyte file into memory. Image-suffixed paths get the larger
    // image cap: their bytes are only useful whole (stigmer/stigmer#379).
    let is_image = is_image_path(rel);
    let read_cap = if is_image { MAX_IMAGE_READ_BYTES } else { MAX_READ_BYTES };
    let file = std::fs::File::open(&target).map_err(|e| format!("Cannot open {relative}: {e}"))?;
    let mut bytes = Vec::new();
    file.take((read_cap + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Cannot read {relative}: {e}"))?;

    let is_binary = bytes.iter().take(BINARY_SNIFF_BYTES).any(|&b| b == 0);
    if is_binary {
        // Gate on the binary sniff AND the extension, mirroring the GitHub
        // reader: a text file merely named .png keeps its text path below,
        // and an over-cap image falls back to the plain binary notice
        // (whole-or-not-at-all — a truncated image cannot render).
        let image_base64 = (is_image && bytes.len() <= MAX_IMAGE_READ_BYTES).then(|| {
            use base64::{engine::general_purpose::STANDARD, Engine as _};
            STANDARD.encode(&bytes)
        });
        return Ok(ReadResult {
            text: None,
            is_binary: true,
            size,
            encoding: if image_base64.is_some() { "base64" } else { "unknown" }.into(),
            truncated: false,
            image_base64,
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
        image_base64: None,
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
    fn delivers_an_image_whole_and_base64_encoded() {
        let dir = tempfile::tempdir().unwrap();
        let png_bytes = [0x89u8, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00];
        fs::write(dir.path().join("logo.png"), png_bytes).unwrap();

        let result = read_file(dir.path(), "logo.png").unwrap();

        assert!(result.is_binary);
        assert_eq!(result.encoding, "base64");
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let decoded = STANDARD.decode(result.image_base64.unwrap()).unwrap();
        assert_eq!(decoded, png_bytes);
    }

    #[test]
    fn image_extension_check_is_case_insensitive() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("SHOT.PNG"), [0x89u8, 0x50, 0x00]).unwrap();

        let result = read_file(dir.path(), "SHOT.PNG").unwrap();
        assert!(result.image_base64.is_some());
    }

    #[test]
    fn withholds_bytes_from_binary_without_an_image_extension() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("blob.bin"), [0x48, 0x00, 0x49]).unwrap();

        let result = read_file(dir.path(), "blob.bin").unwrap();

        assert!(result.is_binary);
        assert_eq!(result.encoding, "unknown");
        assert!(result.image_base64.is_none());
    }

    #[test]
    fn withholds_bytes_from_an_image_beyond_the_whole_image_ceiling() {
        let dir = tempfile::tempdir().unwrap();
        // All-zero bytes trip the NUL sniff; one byte over the ceiling means
        // the image cannot be delivered whole (whole-or-not-at-all).
        fs::write(
            dir.path().join("huge.png"),
            vec![0u8; MAX_IMAGE_READ_BYTES + 1],
        )
        .unwrap();

        let result = read_file(dir.path(), "huge.png").unwrap();

        assert!(result.is_binary);
        assert!(result.image_base64.is_none());
        assert_eq!(result.size, (MAX_IMAGE_READ_BYTES + 1) as u64);
    }

    #[test]
    fn keeps_a_text_file_claiming_an_image_extension_on_the_text_path() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("fake.png"), "not really a png").unwrap();

        let result = read_file(dir.path(), "fake.png").unwrap();

        assert!(!result.is_binary);
        assert_eq!(result.text.as_deref(), Some("not really a png"));
        assert!(result.image_base64.is_none());
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

    // ── content search ──────────────────────────────────────────────────

    #[test]
    fn search_finds_matches_across_nested_files() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), "hello world\nnothing here\n").unwrap();
        fs::create_dir(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src/b.txt"), "the world turns\n").unwrap();

        let result = search_content(dir.path(), "world").unwrap();

        assert!(!result.truncated);
        assert_eq!(result.matches.len(), 2);
        let paths: Vec<&str> = result.matches.iter().map(|m| m.path.as_str()).collect();
        assert!(paths.contains(&"a.txt"));
        assert!(paths.contains(&"src/b.txt"));
    }

    #[test]
    fn search_is_case_insensitive() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("f.txt"), "TODO: fix\ntodo again\nToDo third\n").unwrap();

        let result = search_content(dir.path(), "todo").unwrap();

        assert_eq!(result.matches.len(), 3);
    }

    #[test]
    fn search_treats_query_as_literal_not_regex() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("f.txt"), "a.b matched\naxb not\n").unwrap();

        // As a regex, "a.b" would match "axb"; as a literal it must not.
        let result = search_content(dir.path(), "a.b").unwrap();

        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.matches[0].line, 1);
    }

    #[test]
    fn search_reports_one_based_line_numbers() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("f.txt"), "one\ntwo\nfindme\nfour\n").unwrap();

        let result = search_content(dir.path(), "findme").unwrap();

        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.matches[0].line, 3);
        assert_eq!(result.matches[0].preview, "findme");
    }

    #[test]
    fn search_matches_multiple_lines_in_one_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("f.txt"), "key\nother\nkey\nkey\n").unwrap();

        let result = search_content(dir.path(), "key").unwrap();

        let lines: Vec<u32> = result.matches.iter().map(|m| m.line).collect();
        assert_eq!(lines, vec![1, 3, 4]);
    }

    #[test]
    fn search_respects_gitignore() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".gitignore"), "ignored.log\nbuild/\n").unwrap();
        fs::write(dir.path().join("kept.rs"), "needle here\n").unwrap();
        fs::write(dir.path().join("ignored.log"), "needle here\n").unwrap();
        fs::create_dir(dir.path().join("build")).unwrap();
        fs::write(dir.path().join("build/out.js"), "needle here\n").unwrap();

        let result = search_content(dir.path(), "needle").unwrap();

        let paths: Vec<&str> = result.matches.iter().map(|m| m.path.as_str()).collect();
        assert_eq!(paths, vec!["kept.rs"]);
    }

    #[test]
    fn search_skips_binary_files() {
        let dir = tempfile::tempdir().unwrap();
        // A NUL byte precedes the needle: grep's binary detection quits the file.
        fs::write(dir.path().join("blob.bin"), b"\x00needle\n").unwrap();
        fs::write(dir.path().join("text.txt"), "needle\n").unwrap();

        let result = search_content(dir.path(), "needle").unwrap();

        let paths: Vec<&str> = result.matches.iter().map(|m| m.path.as_str()).collect();
        assert_eq!(paths, vec!["text.txt"]);
    }

    #[test]
    fn search_skips_oversized_files() {
        let dir = tempfile::tempdir().unwrap();
        let mut big = "x".repeat(MAX_READ_BYTES + 10);
        big.push_str("\nneedle\n");
        fs::write(dir.path().join("big.txt"), &big).unwrap();
        fs::write(dir.path().join("small.txt"), "needle\n").unwrap();

        let result = search_content(dir.path(), "needle").unwrap();

        let paths: Vec<&str> = result.matches.iter().map(|m| m.path.as_str()).collect();
        assert_eq!(paths, vec!["small.txt"]);
    }

    #[test]
    fn search_matches_crlf_lines() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("f.txt"), "first\r\nneedle here\r\nlast\r\n").unwrap();

        let result = search_content(dir.path(), "needle").unwrap();

        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.matches[0].line, 2);
        // The CR must be trimmed from the preview.
        assert_eq!(result.matches[0].preview, "needle here");
    }

    #[test]
    fn search_handles_utf8_multibyte() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("f.txt"), "日本語 needle 世界\n").unwrap();

        let result = search_content(dir.path(), "needle").unwrap();

        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.matches[0].preview, "日本語 needle 世界");
    }

    #[test]
    fn search_windows_long_lines_keeping_the_match_visible() {
        let dir = tempfile::tempdir().unwrap();
        let mut line = "a".repeat(MAX_PREVIEW_CHARS + 200);
        line.push_str("NEEDLE");
        line.push_str(&"b".repeat(300));
        line.push('\n');
        fs::write(dir.path().join("f.txt"), &line).unwrap();

        let result = search_content(dir.path(), "needle").unwrap();

        assert_eq!(result.matches.len(), 1);
        let preview = &result.matches[0].preview;
        // Windowed (ellipsis + bounded length) yet still contains the match.
        assert!(preview.contains("NEEDLE"), "preview must keep the match: {preview}");
        assert!(preview.starts_with('…'));
        assert!(preview.chars().count() <= MAX_PREVIEW_CHARS + 2); // + two ellipses
    }

    #[test]
    fn search_orders_results_by_path_then_line() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("zebra.txt"), "hit\nhit\n").unwrap();
        fs::write(dir.path().join("alpha.txt"), "hit\n").unwrap();

        let result = search_content(dir.path(), "hit").unwrap();

        let ordered: Vec<(&str, u32)> = result
            .matches
            .iter()
            .map(|m| (m.path.as_str(), m.line))
            .collect();
        assert_eq!(
            ordered,
            vec![("alpha.txt", 1), ("zebra.txt", 1), ("zebra.txt", 2)]
        );
    }

    #[test]
    fn search_caps_matches_per_file_and_flags_truncated() {
        let dir = tempfile::tempdir().unwrap();
        let content = "match\n".repeat(MAX_MATCHES_PER_FILE + 20);
        fs::write(dir.path().join("noisy.txt"), &content).unwrap();

        let result = search_content(dir.path(), "match").unwrap();

        assert!(result.truncated);
        assert_eq!(result.matches.len(), MAX_MATCHES_PER_FILE);
    }

    #[test]
    fn search_empty_query_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("f.txt"), "something\n").unwrap();

        assert!(search_content(dir.path(), "").unwrap().matches.is_empty());
        assert!(search_content(dir.path(), "   ").unwrap().matches.is_empty());
    }

    #[test]
    fn search_nonexistent_root_returns_error() {
        let result = search_content(Path::new("/nonexistent/path/xyzzy"), "q");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn search_no_matches_returns_empty_not_error() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("f.txt"), "nothing relevant\n").unwrap();

        let result = search_content(dir.path(), "absent").unwrap();
        assert!(!result.truncated);
        assert!(result.matches.is_empty());
    }
}
