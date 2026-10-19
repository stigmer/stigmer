/**
 * A File's media type: the one its upload declares, else the filename's
 * extension read from a small table, else application/octet-stream. The
 * server never sniffs bytes it was not handed; a type is a label the
 * uploader or the extension gives, and the runner sniffs an image before it
 * shows one to the model.
 *
 * The table holds the types a conversation's files commonly carry: Claude's
 * image types (the four a message shows the model as an image), documents,
 * office files, data, archives and source code. Types carry no parameters
 * (no `; charset=`), matching FileSpec.mime_type's grammar.
 *
 * Pinned by __tests__/mime.test.ts.
 */
import { DEFAULT_MIME_TYPE } from "./constants.js";

const BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  // Images
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".avif", "image/avif"],
  [".heic", "image/heic"],
  // Documents
  [".pdf", "application/pdf"],
  [".txt", "text/plain"],
  [".md", "text/markdown"],
  [".html", "text/html"],
  [".htm", "text/html"],
  [".rtf", "application/rtf"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".doc", "application/msword"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".xls", "application/vnd.ms-excel"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".odt", "application/vnd.oasis.opendocument.text"],
  [".ods", "application/vnd.oasis.opendocument.spreadsheet"],
  // Data
  [".csv", "text/csv"],
  [".tsv", "text/tab-separated-values"],
  [".json", "application/json"],
  [".jsonl", "application/jsonl"],
  [".xml", "application/xml"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"],
  [".toml", "application/toml"],
  [".parquet", "application/vnd.apache.parquet"],
  [".ipynb", "application/x-ipynb+json"],
  [".sql", "application/sql"],
  [".log", "text/plain"],
  // Archives
  [".zip", "application/zip"],
  [".tar", "application/x-tar"],
  [".gz", "application/gzip"],
  [".tgz", "application/gzip"],
  // Audio and video
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"],
  // Source code
  [".py", "text/x-python"],
  [".js", "text/javascript"],
  [".mjs", "text/javascript"],
  [".ts", "text/typescript"],
  [".tsx", "text/typescript"],
  [".go", "text/x-go"],
  [".java", "text/x-java"],
  [".rs", "text/x-rust"],
  [".rb", "text/x-ruby"],
  [".c", "text/x-c"],
  [".h", "text/x-c"],
  [".cpp", "text/x-c++"],
  [".sh", "text/x-shellscript"],
  [".css", "text/css"],
]);

/** The declared type, lowercased; else the extension's; else octet-stream. */
export function fileMimeType(filename: string, declared: string): string {
  if (declared !== "") {
    return declared.toLowerCase();
  }
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) {
    return DEFAULT_MIME_TYPE;
  }
  return BY_EXTENSION.get(filename.slice(dot).toLowerCase()) ?? DEFAULT_MIME_TYPE;
}
