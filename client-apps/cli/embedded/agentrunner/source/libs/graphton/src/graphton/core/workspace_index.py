"""Structural symbol index for workspace-aware code search.

Parses source files for structural elements (classes, functions, methods,
types) and exposes a searchable in-memory index that agents query via the
``search`` platform tool.

Architecture
------------
Four layers compose bottom-up:

    _tokenize_identifier  (str -> list[str])
    LanguageSpec / LANGUAGE_SPECS  (extension -> regex patterns)
    parse_file            (content, file_path -> list[Symbol])
    WorkspaceIndex        (list[Symbol], search method)

The public entry point for index construction is
``build_workspace_index(backend, max_files)``.

The public entry point for querying is
``WorkspaceIndex.search(query, max_results)``.

Design notes
~~~~~~~~~~~~
* **Lazy construction** — the index is built on first ``search`` call,
  not during provisioning.  This avoids wasted work when the agent never
  searches.
* **Per-execution lifecycle** — the index lives in the search-tool
  closure and dies with the execution.  No persistence, no invalidation.
* **Zero new dependencies** — regex-based parsing, token-aware fuzzy
  matching.  No tree-sitter, no embedding model.
* **Language-extensible** — adding a new language is adding a
  ``LanguageSpec`` to ``LANGUAGE_SPECS``.
"""

from __future__ import annotations

import enum
import logging
import os
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_FILES: int = 2000
MAX_FILE_SIZE: int = 100_000  # 100 KB
MAX_SYMBOLS_PER_FILE: int = 200
_MAX_WALK_DEPTH: int = 15

# Extensions that the index recognises as source code.  Files with other
# extensions are silently skipped — no error, just unindexed.
_INDEXABLE_EXTENSIONS: frozenset[str] = frozenset({
    ".py", ".pyi",
    ".go",
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
    ".rs",
    ".java",
    ".rb",
    ".c", ".h", ".cpp", ".hpp", ".cc", ".cxx",
    ".php",
    ".kt", ".kts",
    ".scala",
    ".cs",
    ".swift",
    ".ex", ".exs",
})


# ---------------------------------------------------------------------------
# SymbolKind enum
# ---------------------------------------------------------------------------


class SymbolKind(enum.Enum):
    """Classification of a structural code element."""

    CLASS = "class"
    FUNCTION = "function"
    METHOD = "method"
    STRUCT = "struct"
    ENUM = "enum"
    INTERFACE = "interface"
    TYPE = "type"
    TRAIT = "trait"
    MODULE = "module"
    OBJECT = "object"
    IMPL = "impl"

    @property
    def label(self) -> str:
        """Human-readable lowercase label for output formatting."""
        return self.value


# ---------------------------------------------------------------------------
# Identifier tokenisation
# ---------------------------------------------------------------------------

# Boundary between a lowercase letter/digit and an uppercase letter,
# or between sequences of uppercase letters and a new CamelCase word.
_CAMEL_BOUNDARY = re.compile(
    r"(?<=[a-z0-9])(?=[A-Z])"   # aB  -> a | B
    r"|(?<=[A-Z])(?=[A-Z][a-z])"  # ABc -> A | Bc
)


def _tokenize_identifier(name: str) -> list[str]:
    """Split an identifier into lowercase tokens.

    Handles camelCase, PascalCase, snake_case, and combinations thereof.

    >>> _tokenize_identifier("AuthMiddleware")
    ['auth', 'middleware']
    >>> _tokenize_identifier("login_user")
    ['login', 'user']
    >>> _tokenize_identifier("HTTPServerError")
    ['http', 'server', 'error']
    >>> _tokenize_identifier("getHTTPResponse")
    ['get', 'http', 'response']
    """
    parts = name.replace("-", "_").split("_")

    tokens: list[str] = []
    for part in parts:
        if not part:
            continue
        sub_tokens = _CAMEL_BOUNDARY.split(part)
        tokens.extend(t.lower() for t in sub_tokens if t)

    return tokens


# ---------------------------------------------------------------------------
# Symbol value object
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Symbol:
    """A structural code element extracted from a source file.

    Attributes:
        name:        The identifier name (e.g. ``AuthMiddleware``).
        kind:        Classification (class, function, struct, ...).
        file_path:   Workspace-relative file path (forward slashes).
        line_number: 1-based line number of the definition.
        signature:   The full definition line as it appears in source.
    """

    name: str
    kind: SymbolKind
    file_path: str
    line_number: int
    signature: str
    _tokens: list[str] = field(
        default_factory=list,
        repr=False,
        compare=False,
        hash=False,
    )

    def __post_init__(self) -> None:
        if not self._tokens:
            object.__setattr__(self, "_tokens", _tokenize_identifier(self.name))

    @property
    def tokens(self) -> list[str]:
        """Lowercase tokens derived from the identifier name."""
        return self._tokens


# ---------------------------------------------------------------------------
# Language specifications
# ---------------------------------------------------------------------------

# Each pattern must use named groups:
#   ``name``  — the identifier
#   ``kind``  — matched against SymbolKind.value (lowercased)
#
# Patterns are applied per-line against stripped source lines.
# Order matters: first match wins for a given line.

_KIND_ALIASES: dict[str, SymbolKind] = {
    "class": SymbolKind.CLASS,
    "function": SymbolKind.FUNCTION,
    "func": SymbolKind.FUNCTION,
    "def": SymbolKind.FUNCTION,
    "fn": SymbolKind.FUNCTION,
    "fun": SymbolKind.FUNCTION,
    "method": SymbolKind.METHOD,
    "struct": SymbolKind.STRUCT,
    "enum": SymbolKind.ENUM,
    "interface": SymbolKind.INTERFACE,
    "type": SymbolKind.TYPE,
    "trait": SymbolKind.TRAIT,
    "module": SymbolKind.MODULE,
    "object": SymbolKind.OBJECT,
    "impl": SymbolKind.IMPL,
}


def _resolve_kind(raw: str) -> SymbolKind:
    """Map a raw kind string from a regex match to a ``SymbolKind``."""
    return _KIND_ALIASES.get(raw.lower(), SymbolKind.FUNCTION)


@dataclass(frozen=True)
class LanguageSpec:
    """Definition-extraction rules for a programming language.

    Attributes:
        extensions: File extensions that activate this spec (including dot).
        patterns:   Compiled regexes with named groups ``name`` and ``kind``.
    """

    extensions: frozenset[str]
    patterns: tuple[re.Pattern[str], ...]


def _compile(*raw_patterns: str) -> tuple[re.Pattern[str], ...]:
    return tuple(re.compile(p) for p in raw_patterns)


# -- Python ----------------------------------------------------------------

_PYTHON = LanguageSpec(
    extensions=frozenset({".py", ".pyi"}),
    patterns=_compile(
        r"^\s*(?:async\s+)?(?P<kind>class)\s+(?P<name>\w+)",
        r"^\s*(?:async\s+)?(?P<kind>def)\s+(?P<name>\w+)",
    ),
)

# -- Go -------------------------------------------------------------------

_GO = LanguageSpec(
    extensions=frozenset({".go"}),
    patterns=_compile(
        # type X struct / type X interface
        r"^\s*type\s+(?P<name>\w+)\s+(?P<kind>struct|interface)\b",
        # func (r *Receiver) MethodName(  -> captured as method
        r"^\s*(?P<kind>func)\s+\([^)]+\)\s+(?P<name>\w+)\s*\(",
        # func FunctionName(
        r"^\s*(?P<kind>func)\s+(?P<name>\w+)\s*[\(\[]",
    ),
)

# -- JavaScript / TypeScript -----------------------------------------------

_JS_TS = LanguageSpec(
    extensions=frozenset({".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}),
    patterns=_compile(
        r"^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?P<kind>class)\s+(?P<name>\w+)",
        r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?P<kind>function)\s+\*?\s*(?P<name>\w+)",
        r"^\s*(?:export\s+)?(?P<kind>interface)\s+(?P<name>\w+)",
        r"^\s*(?:export\s+)?(?P<kind>enum)\s+(?P<name>\w+)",
        r"^\s*(?:export\s+)?(?P<kind>type)\s+(?P<name>\w+)\s*[=<]",
    ),
)

# -- Rust ------------------------------------------------------------------

_RUST = LanguageSpec(
    extensions=frozenset({".rs"}),
    patterns=_compile(
        r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?P<kind>struct)\s+(?P<name>\w+)",
        r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?P<kind>enum)\s+(?P<name>\w+)",
        r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?(?P<kind>trait)\s+(?P<name>\w+)",
        r"^\s*(?P<kind>impl)\s+(?:<[^>]+>\s+)?(?P<name>\w+)",
        r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?(?:extern\s+\"[^\"]*\"\s+)?(?P<kind>fn)\s+(?P<name>\w+)",
    ),
)

# -- Java ------------------------------------------------------------------

_JAVA = LanguageSpec(
    extensions=frozenset({".java"}),
    patterns=_compile(
        r"^\s*(?:public|private|protected|static|final|abstract|\s)*(?P<kind>class)\s+(?P<name>\w+)",
        r"^\s*(?:public|private|protected|static|final|abstract|\s)*(?P<kind>interface)\s+(?P<name>\w+)",
        r"^\s*(?:public|private|protected|static|final|abstract|\s)*(?P<kind>enum)\s+(?P<name>\w+)",
    ),
)

# -- Ruby ------------------------------------------------------------------

_RUBY = LanguageSpec(
    extensions=frozenset({".rb"}),
    patterns=_compile(
        r"^\s*(?P<kind>class)\s+(?P<name>[\w:]+)",
        r"^\s*(?P<kind>module)\s+(?P<name>[\w:]+)",
        r"^\s*(?:self\.)?(?P<kind>def)\s+(?P<name>\w+[!?=]?)",
    ),
)

# -- C / C++ ---------------------------------------------------------------

_C_CPP = LanguageSpec(
    extensions=frozenset({".c", ".h", ".cpp", ".hpp", ".cc", ".cxx"}),
    patterns=_compile(
        r"^\s*(?:template\s*<[^>]*>\s*)?(?P<kind>class)\s+(?P<name>\w+)",
        r"^\s*(?P<kind>struct)\s+(?P<name>\w+)\s*[{;]",
        r"^\s*(?P<kind>enum)\s+(?:class\s+)?(?P<name>\w+)",
    ),
)

# -- PHP -------------------------------------------------------------------

_PHP = LanguageSpec(
    extensions=frozenset({".php"}),
    patterns=_compile(
        r"^\s*(?:abstract\s+|final\s+)?(?P<kind>class)\s+(?P<name>\w+)",
        r"^\s*(?P<kind>interface)\s+(?P<name>\w+)",
        r"^\s*(?P<kind>trait)\s+(?P<name>\w+)",
        r"^\s*(?:public|private|protected|static|\s)*(?P<kind>function)\s+(?P<name>\w+)",
    ),
)

# -- Kotlin ----------------------------------------------------------------

_KOTLIN = LanguageSpec(
    extensions=frozenset({".kt", ".kts"}),
    patterns=_compile(
        r"^\s*(?:data\s+|sealed\s+|abstract\s+|open\s+|inner\s+)?(?P<kind>class)\s+(?P<name>\w+)",
        r"^\s*(?P<kind>object)\s+(?P<name>\w+)",
        r"^\s*(?P<kind>interface)\s+(?P<name>\w+)",
        r"^\s*(?:(?:public|private|protected|internal|override|open|abstract|suspend)\s+)*(?P<kind>fun)\s+(?:(?:<[^>]+>\s+)?)(?P<name>\w+)",
    ),
)

# -- Scala -----------------------------------------------------------------

_SCALA = LanguageSpec(
    extensions=frozenset({".scala"}),
    patterns=_compile(
        r"^\s*(?:case\s+)?(?P<kind>class)\s+(?P<name>\w+)",
        r"^\s*(?P<kind>object)\s+(?P<name>\w+)",
        r"^\s*(?P<kind>trait)\s+(?P<name>\w+)",
        r"^\s*(?:(?:override|private|protected)\s+)*(?P<kind>def)\s+(?P<name>\w+)",
    ),
)

# -- C# -------------------------------------------------------------------

_CSHARP = LanguageSpec(
    extensions=frozenset({".cs"}),
    patterns=_compile(
        r"^\s*(?:public|private|protected|internal|static|abstract|sealed|partial|\s)*(?P<kind>class)\s+(?P<name>\w+)",
        r"^\s*(?:public|private|protected|internal|static|abstract|sealed|partial|\s)*(?P<kind>interface)\s+(?P<name>\w+)",
        r"^\s*(?:public|private|protected|internal|\s)*(?P<kind>enum)\s+(?P<name>\w+)",
        r"^\s*(?:public|private|protected|internal|static|abstract|sealed|partial|\s)*(?P<kind>struct)\s+(?P<name>\w+)",
    ),
)

# -- Swift -----------------------------------------------------------------

_SWIFT = LanguageSpec(
    extensions=frozenset({".swift"}),
    patterns=_compile(
        r"^\s*(?:public\s+|private\s+|internal\s+|open\s+|final\s+)?(?P<kind>class)\s+(?P<name>\w+)",
        r"^\s*(?:public\s+|private\s+|internal\s+)?(?P<kind>struct)\s+(?P<name>\w+)",
        r"^\s*(?:public\s+|private\s+|internal\s+)?(?P<kind>enum)\s+(?P<name>\w+)",
        r"^\s*(?:public\s+|private\s+|internal\s+|open\s+)?(?P<kind>func)\s+(?P<name>\w+)",
        r"^\s*(?:public\s+|private\s+|internal\s+)?(?:protocol)\s+(?P<name>\w+)",
    ),
)

# -- Elixir ----------------------------------------------------------------

_ELIXIR = LanguageSpec(
    extensions=frozenset({".ex", ".exs"}),
    patterns=_compile(
        r"^\s*def(?P<kind>module)\s+(?P<name>[\w.]+)",
        r"^\s*(?P<kind>def)p?\s+(?P<name>\w+[!?]?)",
    ),
)


# -- Registry --------------------------------------------------------------

LANGUAGE_SPECS: tuple[LanguageSpec, ...] = (
    _PYTHON, _GO, _JS_TS, _RUST, _JAVA, _RUBY, _C_CPP,
    _PHP, _KOTLIN, _SCALA, _CSHARP, _SWIFT, _ELIXIR,
)

_EXT_TO_SPEC: dict[str, LanguageSpec] = {}
for _spec in LANGUAGE_SPECS:
    for _ext in _spec.extensions:
        _EXT_TO_SPEC[_ext] = _spec


def spec_for_extension(ext: str) -> LanguageSpec | None:
    """Return the ``LanguageSpec`` for a file extension, or ``None``."""
    return _EXT_TO_SPEC.get(ext.lower())


# ---------------------------------------------------------------------------
# File parsing
# ---------------------------------------------------------------------------


def parse_file(
    content: str,
    file_path: str,
    spec: LanguageSpec,
    *,
    max_symbols: int = MAX_SYMBOLS_PER_FILE,
) -> list[Symbol]:
    """Extract structural symbols from a single source file.

    Scans *content* line by line, applying *spec*'s regex patterns.
    Returns at most *max_symbols* ``Symbol`` objects.
    """
    symbols: list[Symbol] = []

    for line_number, line in enumerate(content.splitlines(), 1):
        if len(symbols) >= max_symbols:
            break

        stripped = line.rstrip()
        if not stripped:
            continue

        for pattern in spec.patterns:
            m = pattern.match(stripped)
            if m is None:
                continue
            raw_kind = m.group("kind")
            name = m.group("name")
            kind = _resolve_kind(raw_kind)

            # Promote Go methods: func with a receiver is a method.
            if kind == SymbolKind.FUNCTION and raw_kind.lower() == "func":
                if re.match(r"^\s*func\s+\(", stripped):
                    kind = SymbolKind.METHOD

            symbols.append(Symbol(
                name=name,
                kind=kind,
                file_path=file_path,
                line_number=line_number,
                signature=stripped,
            ))
            break  # first matching pattern wins for this line

    return symbols


# ---------------------------------------------------------------------------
# Fuzzy matching / scoring
# ---------------------------------------------------------------------------


def _best_token_score(query_token: str, symbol_tokens: list[str]) -> float:
    """Score how well *query_token* matches the best token in *symbol_tokens*.

    Returns:
        1.0 — exact match
        0.7 — query_token is a prefix of a symbol token
        0.4 — query_token is a substring of a symbol token
        0.0 — no match
    """
    best = 0.0
    for st in symbol_tokens:
        if query_token == st:
            return 1.0
        if st.startswith(query_token) and best < 0.7:
            best = 0.7
        elif query_token in st and best < 0.4:
            best = 0.4
        elif st in query_token and best < 0.4:
            best = 0.4
    return best


def _score_symbol(query_tokens: list[str], symbol: Symbol) -> float:
    """Compute an aggregate match score for *symbol* against *query_tokens*.

    The score is the mean of the best per-query-token scores, normalised
    to [0.0, 1.0].  A score below ``_MIN_SCORE_THRESHOLD`` means the
    symbol is irrelevant.
    """
    if not query_tokens or not symbol.tokens:
        return 0.0

    total = sum(_best_token_score(qt, symbol.tokens) for qt in query_tokens)
    return total / len(query_tokens)


_MIN_SCORE_THRESHOLD: float = 0.3


# ---------------------------------------------------------------------------
# WorkspaceIndex
# ---------------------------------------------------------------------------


@dataclass
class SearchResult:
    """A symbol paired with its relevance score for a given query."""

    symbol: Symbol
    score: float


class WorkspaceIndex:
    """In-memory structural symbol index for a workspace.

    Holds a flat list of ``Symbol`` objects and provides a
    ``search`` method that performs token-aware fuzzy matching.
    """

    __slots__ = ("_symbols", "_truncated", "_files_indexed")

    def __init__(
        self,
        symbols: list[Symbol],
        *,
        files_indexed: int = 0,
        truncated: bool = False,
    ) -> None:
        self._symbols = symbols
        self._files_indexed = files_indexed
        self._truncated = truncated

    @property
    def symbols(self) -> list[Symbol]:
        return self._symbols

    @property
    def size(self) -> int:
        return len(self._symbols)

    @property
    def files_indexed(self) -> int:
        return self._files_indexed

    @property
    def truncated(self) -> bool:
        return self._truncated

    def search(
        self,
        query: str,
        *,
        max_results: int = 20,
    ) -> list[SearchResult]:
        """Find symbols matching *query* using token-aware fuzzy matching.

        Args:
            query:       Natural-language query (e.g. ``"auth middleware"``).
            max_results: Maximum number of results to return.

        Returns:
            Scored results sorted by relevance (descending), then by
            file path for stability.
        """
        query_tokens = query.lower().split()
        if not query_tokens:
            return []

        scored: list[SearchResult] = []
        for symbol in self._symbols:
            score = _score_symbol(query_tokens, symbol)
            if score >= _MIN_SCORE_THRESHOLD:
                scored.append(SearchResult(symbol=symbol, score=score))

        scored.sort(key=lambda r: (-r.score, r.symbol.file_path, r.symbol.line_number))
        return scored[:max_results]


# ---------------------------------------------------------------------------
# Index builder
# ---------------------------------------------------------------------------


def build_workspace_index(
    backend: Any,  # noqa: ANN401
    *,
    max_files: int = MAX_FILES,
) -> WorkspaceIndex:
    """Walk the workspace via *backend* and build a structural symbol index.

    Uses ``backend.list_files()`` for directory traversal (leveraging
    T03's directory cache) and ``backend.read()`` for file content.

    Args:
        backend:   A backend instance (``FilesystemBackend`` or similar)
                   with ``list_files(path)``, ``is_directory(path)``, and
                   ``read(path)`` methods.
        max_files: Stop indexing after this many source files.

    Returns:
        A populated ``WorkspaceIndex``.
    """
    all_symbols: list[Symbol] = []
    files_indexed = 0
    truncated = False
    has_is_dir = hasattr(backend, "is_directory")

    def walk(dir_path: str, depth: int = 0) -> None:
        nonlocal files_indexed, truncated

        if depth > _MAX_WALK_DEPTH or truncated:
            return

        try:
            items = backend.list_files(dir_path)
        except Exception:
            return

        for item in items:
            if truncated:
                return

            item_path = (
                os.path.join(dir_path, item) if dir_path != "." else item
            )
            item_path = item_path.replace("\\", "/")

            if has_is_dir and backend.is_directory(item_path):
                walk(item_path, depth + 1)
                continue

            if not has_is_dir:
                try:
                    walk(item_path, depth + 1)
                except Exception:
                    pass

            _, ext = os.path.splitext(item)
            spec = spec_for_extension(ext)
            if spec is None:
                continue

            if files_indexed >= max_files:
                truncated = True
                return

            try:
                content = backend.read(item_path)
            except Exception:
                continue

            if len(content) > MAX_FILE_SIZE:
                continue

            symbols = parse_file(content, item_path, spec)
            all_symbols.extend(symbols)
            files_indexed += 1

    walk(".")

    logger.info(
        "Workspace index built: %d symbol(s) from %d file(s)%s",
        len(all_symbols),
        files_indexed,
        " (truncated)" if truncated else "",
    )

    return WorkspaceIndex(
        all_symbols,
        files_indexed=files_indexed,
        truncated=truncated,
    )


# ---------------------------------------------------------------------------
# Execute-based index builder (O(1) HTTP calls)
# ---------------------------------------------------------------------------


def build_workspace_index_via_grep(
    backend: Any,  # noqa: ANN401
    *,
    max_files: int = MAX_FILES,
) -> WorkspaceIndex:
    """Build symbol index via a single shell ``grep`` command.

    Instead of walking the filesystem entry-by-entry over HTTP
    (O(N) API calls), runs one ``grep -rn`` in the sandbox to extract
    candidate structural-definition lines, then applies the precise
    language-specific regexes from ``LANGUAGE_SPECS`` as a post-filter.

    This reduces index-build time from minutes to seconds for large
    repositories hosted in cloud sandboxes (Daytona).

    Falls back to :func:`build_workspace_index` if the grep command
    fails unexpectedly.
    """
    import shlex

    include_flags = " ".join(
        f"--include={shlex.quote(f'*{ext}')}"
        for ext in sorted(_INDEXABLE_EXTENSIONS)
    )

    keywords = (
        "class|def|defp|defmodule|func|function|fn|fun"
        "|struct|enum|interface|trait|type|impl|module|object"
    )
    keyword_pattern = (
        f"(^|[^a-zA-Z_0-9])({keywords})[[:space:]]+[A-Za-z_]"
    )

    cmd = (
        f"grep -rn -E {shlex.quote(keyword_pattern)}"
        f" {include_flags}"
        f" --exclude-dir=.git"
        f" . 2>/dev/null"
        f" | head -n 100000"
    )

    try:
        result = backend.execute(cmd)
        stdout = result.stdout if hasattr(result, "stdout") else ""
    except Exception:
        logger.warning(
            "grep-based index build failed; falling back to walk-based build",
            exc_info=True,
        )
        return build_workspace_index(backend, max_files=max_files)

    if not stdout or not stdout.strip():
        logger.info(
            "Workspace index built (via grep): 0 symbol(s) from 0 file(s)"
        )
        return WorkspaceIndex([], files_indexed=0, truncated=False)

    all_symbols: list[Symbol] = []
    files_seen: set[str] = set()

    for raw_line in stdout.splitlines():
        raw_line = raw_line.strip()
        if not raw_line:
            continue

        colon1 = raw_line.find(":")
        if colon1 < 0:
            continue
        colon2 = raw_line.find(":", colon1 + 1)
        if colon2 < 0:
            continue

        file_path = raw_line[:colon1]
        if file_path.startswith("./"):
            file_path = file_path[2:]

        try:
            line_number = int(raw_line[colon1 + 1 : colon2])
        except ValueError:
            continue

        content = raw_line[colon2 + 1 :]
        files_seen.add(file_path)

        _, ext = os.path.splitext(file_path)
        spec = spec_for_extension(ext)
        if spec is None:
            continue

        stripped = content.rstrip()
        if not stripped:
            continue

        for pattern in spec.patterns:
            m = pattern.match(stripped)
            if m is None:
                continue

            raw_kind = m.group("kind")
            name = m.group("name")
            kind = _resolve_kind(raw_kind)

            if kind == SymbolKind.FUNCTION and raw_kind.lower() == "func":
                if re.match(r"^\s*func\s+\(", stripped):
                    kind = SymbolKind.METHOD

            all_symbols.append(Symbol(
                name=name,
                kind=kind,
                file_path=file_path,
                line_number=line_number,
                signature=stripped,
            ))
            break

    truncated = len(files_seen) >= max_files
    logger.info(
        "Workspace index built (via grep): %d symbol(s) from %d file(s)%s",
        len(all_symbols),
        len(files_seen),
        " (truncated)" if truncated else "",
    )

    return WorkspaceIndex(
        all_symbols,
        files_indexed=len(files_seen),
        truncated=truncated,
    )


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------


def format_search_results(
    results: list[SearchResult],
    query: str,
    *,
    index: WorkspaceIndex | None = None,
) -> str:
    """Format search results into a human-readable string for the agent.

    Args:
        results:  Scored search results.
        query:    The original query string (for the summary line).
        index:    Optional index reference for metadata (truncation notice).

    Returns:
        Formatted multi-line string.
    """
    if not results:
        suffix = ""
        if index and index.truncated:
            suffix = (
                f" (index covers {index.files_indexed} of {MAX_FILES}+ "
                f"source files)"
            )
        return f"No definitions found matching \"{query}\"{suffix}"

    lines: list[str] = []

    header = f"Found {len(results)} definition(s) matching \"{query}\""
    if index and index.truncated:
        header += (
            f" (index covers {index.files_indexed} of {MAX_FILES}+ "
            f"source files)"
        )
    header += ":"
    lines.append(header)
    lines.append("")

    for i, result in enumerate(results, 1):
        sym = result.symbol
        lines.append(
            f"{i}. {sym.kind.label} {sym.name}  "
            f"({sym.file_path}:{sym.line_number})"
        )
        lines.append(f"   {sym.signature}")
        lines.append("")

    return "\n".join(lines).rstrip()
