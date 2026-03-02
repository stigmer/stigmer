"""Unit tests for the structural symbol index (workspace_index).

Covers:
- SymbolKind enum: label property
- Symbol value object: frozen, equality, hashing, token pre-computation
- _tokenize_identifier: camelCase, PascalCase, snake_case, SCREAMING_CASE,
  single-word, acronyms, edge cases
- Parser per language: Python, Go, JS/TS, Rust, Java, Ruby, C/C++, PHP,
  Kotlin, Scala, C#, Swift, Elixir
- Parser edge cases: empty file, no definitions, symbol cap
- WorkspaceIndex.search: exact, prefix, multi-token, ranking, no matches,
  cap enforcement, minimum score threshold
- build_workspace_index: mock backend, file cap, extension filtering
- format_search_results: output formatting, empty results, truncation notice
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from graphton.core.workspace_index import (
    MAX_FILES,
    SearchResult,
    Symbol,
    SymbolKind,
    WorkspaceIndex,
    _score_symbol,
    _tokenize_identifier,
    build_workspace_index,
    format_search_results,
    parse_file,
    spec_for_extension,
)

# =============================================================================
# SymbolKind
# =============================================================================


class TestSymbolKind:
    """SymbolKind enum behaviour."""

    def test_label_returns_value(self) -> None:
        assert SymbolKind.CLASS.label == "class"
        assert SymbolKind.FUNCTION.label == "function"
        assert SymbolKind.METHOD.label == "method"

    def test_all_kinds_have_labels(self) -> None:
        for kind in SymbolKind:
            assert isinstance(kind.label, str)
            assert len(kind.label) > 0


# =============================================================================
# Symbol value object
# =============================================================================


class TestSymbol:
    """Symbol frozen dataclass behaviour."""

    def test_frozen(self) -> None:
        sym = Symbol("Foo", SymbolKind.CLASS, "a.py", 1, "class Foo:")
        with pytest.raises(AttributeError):
            sym.name = "Bar"  # type: ignore[misc]

    def test_equality(self) -> None:
        a = Symbol("Foo", SymbolKind.CLASS, "a.py", 1, "class Foo:")
        b = Symbol("Foo", SymbolKind.CLASS, "a.py", 1, "class Foo:")
        assert a == b

    def test_inequality_different_name(self) -> None:
        a = Symbol("Foo", SymbolKind.CLASS, "a.py", 1, "class Foo:")
        b = Symbol("Bar", SymbolKind.CLASS, "a.py", 1, "class Bar:")
        assert a != b

    def test_hashable(self) -> None:
        sym = Symbol("Foo", SymbolKind.CLASS, "a.py", 1, "class Foo:")
        assert isinstance(hash(sym), int)

    def test_tokens_precomputed(self) -> None:
        sym = Symbol("AuthMiddleware", SymbolKind.CLASS, "a.py", 1, "class AuthMiddleware:")
        assert sym.tokens == ["auth", "middleware"]

    def test_tokens_snake_case(self) -> None:
        sym = Symbol("login_user", SymbolKind.FUNCTION, "a.py", 1, "def login_user():")
        assert sym.tokens == ["login", "user"]


# =============================================================================
# _tokenize_identifier
# =============================================================================


class TestTokenizeIdentifier:
    """Identifier tokenisation for fuzzy matching."""

    def test_camel_case(self) -> None:
        assert _tokenize_identifier("authMiddleware") == ["auth", "middleware"]

    def test_pascal_case(self) -> None:
        assert _tokenize_identifier("AuthMiddleware") == ["auth", "middleware"]

    def test_snake_case(self) -> None:
        assert _tokenize_identifier("login_user") == ["login", "user"]

    def test_screaming_snake_case(self) -> None:
        assert _tokenize_identifier("MAX_RETRY_COUNT") == ["max", "retry", "count"]

    def test_single_word(self) -> None:
        assert _tokenize_identifier("main") == ["main"]

    def test_single_uppercase_word(self) -> None:
        assert _tokenize_identifier("Main") == ["main"]

    def test_acronym_at_start(self) -> None:
        assert _tokenize_identifier("HTTPServer") == ["http", "server"]

    def test_acronym_in_middle(self) -> None:
        assert _tokenize_identifier("getHTTPResponse") == ["get", "http", "response"]

    def test_acronym_at_end(self) -> None:
        assert _tokenize_identifier("parseJSON") == ["parse", "json"]

    def test_mixed_camel_and_underscore(self) -> None:
        assert _tokenize_identifier("get_HTTPResponse") == ["get", "http", "response"]

    def test_empty_string(self) -> None:
        assert _tokenize_identifier("") == []

    def test_leading_underscore(self) -> None:
        assert _tokenize_identifier("_private") == ["private"]

    def test_double_underscore(self) -> None:
        assert _tokenize_identifier("__init__") == ["init"]

    def test_kebab_to_tokens(self) -> None:
        assert _tokenize_identifier("my-component") == ["my", "component"]

    def test_numbers_in_identifier(self) -> None:
        tokens = _tokenize_identifier("Base64Encoder")
        assert tokens == ["base64", "encoder"]

    def test_single_letter(self) -> None:
        assert _tokenize_identifier("x") == ["x"]


# =============================================================================
# spec_for_extension
# =============================================================================


class TestSpecForExtension:
    """Extension-to-language spec lookup."""

    def test_python(self) -> None:
        assert spec_for_extension(".py") is not None

    def test_go(self) -> None:
        assert spec_for_extension(".go") is not None

    def test_typescript(self) -> None:
        assert spec_for_extension(".ts") is not None

    def test_unknown_extension_returns_none(self) -> None:
        assert spec_for_extension(".xyz") is None

    def test_case_insensitive(self) -> None:
        assert spec_for_extension(".PY") is not None

    def test_all_indexable_extensions_have_specs(self) -> None:
        from graphton.core.workspace_index import _INDEXABLE_EXTENSIONS
        for ext in _INDEXABLE_EXTENSIONS:
            assert spec_for_extension(ext) is not None, f"No spec for {ext}"


# =============================================================================
# Parser — Python
# =============================================================================


class TestParsePython:
    """Python definition extraction."""

    def test_class(self) -> None:
        content = "class AuthMiddleware:\n    pass\n"
        spec = spec_for_extension(".py")
        symbols = parse_file(content, "auth.py", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "AuthMiddleware"
        assert symbols[0].kind == SymbolKind.CLASS
        assert symbols[0].line_number == 1

    def test_function(self) -> None:
        content = "def login_user(name: str) -> bool:\n    return True\n"
        spec = spec_for_extension(".py")
        symbols = parse_file(content, "auth.py", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "login_user"
        assert symbols[0].kind == SymbolKind.FUNCTION

    def test_async_def(self) -> None:
        content = "async def fetch_data():\n    pass\n"
        spec = spec_for_extension(".py")
        symbols = parse_file(content, "api.py", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "fetch_data"
        assert symbols[0].kind == SymbolKind.FUNCTION

    def test_indented_method(self) -> None:
        content = "class Foo:\n    def bar(self):\n        pass\n"
        spec = spec_for_extension(".py")
        symbols = parse_file(content, "foo.py", spec)
        assert len(symbols) == 2
        assert symbols[0].name == "Foo"
        assert symbols[1].name == "bar"

    def test_signature_preserved(self) -> None:
        content = "class Foo(Base, Mixin):\n    pass\n"
        spec = spec_for_extension(".py")
        symbols = parse_file(content, "foo.py", spec)
        assert symbols[0].signature == "class Foo(Base, Mixin):"

    def test_async_class(self) -> None:
        content = "async def handler(request):\n    pass\nclass Config:\n    pass\n"
        spec = spec_for_extension(".py")
        symbols = parse_file(content, "app.py", spec)
        assert len(symbols) == 2
        names = [s.name for s in symbols]
        assert "handler" in names
        assert "Config" in names


# =============================================================================
# Parser — Go
# =============================================================================


class TestParseGo:
    """Go definition extraction."""

    def test_func(self) -> None:
        content = "func main() {\n}\n"
        spec = spec_for_extension(".go")
        symbols = parse_file(content, "main.go", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "main"
        assert symbols[0].kind == SymbolKind.FUNCTION

    def test_method_with_receiver(self) -> None:
        content = "func (s *Server) Start() error {\n}\n"
        spec = spec_for_extension(".go")
        symbols = parse_file(content, "server.go", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Start"
        assert symbols[0].kind == SymbolKind.METHOD

    def test_type_struct(self) -> None:
        content = "type Config struct {\n\tHost string\n}\n"
        spec = spec_for_extension(".go")
        symbols = parse_file(content, "config.go", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Config"
        assert symbols[0].kind == SymbolKind.STRUCT

    def test_type_interface(self) -> None:
        content = "type Reader interface {\n\tRead(p []byte) (n int, err error)\n}\n"
        spec = spec_for_extension(".go")
        symbols = parse_file(content, "io.go", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Reader"
        assert symbols[0].kind == SymbolKind.INTERFACE

    def test_generic_func(self) -> None:
        content = "func Map[T any](s []T, f func(T) T) []T {\n}\n"
        spec = spec_for_extension(".go")
        symbols = parse_file(content, "gen.go", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Map"


# =============================================================================
# Parser — JavaScript / TypeScript
# =============================================================================


class TestParseJsTs:
    """JavaScript/TypeScript definition extraction."""

    def test_class(self) -> None:
        content = "class UserService {\n}\n"
        spec = spec_for_extension(".ts")
        symbols = parse_file(content, "service.ts", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "UserService"
        assert symbols[0].kind == SymbolKind.CLASS

    def test_export_function(self) -> None:
        content = "export function fetchUsers() {\n}\n"
        spec = spec_for_extension(".ts")
        symbols = parse_file(content, "api.ts", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "fetchUsers"
        assert symbols[0].kind == SymbolKind.FUNCTION

    def test_export_default_class(self) -> None:
        content = "export default class App {\n}\n"
        spec = spec_for_extension(".tsx")
        symbols = parse_file(content, "App.tsx", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "App"

    def test_interface(self) -> None:
        content = "export interface UserProps {\n  name: string;\n}\n"
        spec = spec_for_extension(".ts")
        symbols = parse_file(content, "types.ts", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "UserProps"
        assert symbols[0].kind == SymbolKind.INTERFACE

    def test_type_alias(self) -> None:
        content = "export type UserId = string;\n"
        spec = spec_for_extension(".ts")
        symbols = parse_file(content, "types.ts", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "UserId"
        assert symbols[0].kind == SymbolKind.TYPE

    def test_enum(self) -> None:
        content = "enum Status {\n  Active,\n  Inactive,\n}\n"
        spec = spec_for_extension(".ts")
        symbols = parse_file(content, "enums.ts", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Status"
        assert symbols[0].kind == SymbolKind.ENUM

    def test_async_function(self) -> None:
        content = "export async function loadData() {\n}\n"
        spec = spec_for_extension(".ts")
        symbols = parse_file(content, "loader.ts", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "loadData"


# =============================================================================
# Parser — Rust
# =============================================================================


class TestParseRust:
    """Rust definition extraction."""

    def test_struct(self) -> None:
        content = "pub struct Config {\n    pub host: String,\n}\n"
        spec = spec_for_extension(".rs")
        symbols = parse_file(content, "config.rs", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Config"
        assert symbols[0].kind == SymbolKind.STRUCT

    def test_enum(self) -> None:
        content = "pub enum Status {\n    Active,\n    Inactive,\n}\n"
        spec = spec_for_extension(".rs")
        symbols = parse_file(content, "types.rs", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Status"
        assert symbols[0].kind == SymbolKind.ENUM

    def test_fn(self) -> None:
        content = "pub fn process(data: &[u8]) -> Result<()> {\n}\n"
        spec = spec_for_extension(".rs")
        symbols = parse_file(content, "lib.rs", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "process"
        assert symbols[0].kind == SymbolKind.FUNCTION

    def test_trait(self) -> None:
        content = "pub trait Handler {\n    fn handle(&self);\n}\n"
        spec = spec_for_extension(".rs")
        symbols = parse_file(content, "handler.rs", spec)
        assert len(symbols) == 2
        assert symbols[0].name == "Handler"
        assert symbols[0].kind == SymbolKind.TRAIT

    def test_impl(self) -> None:
        content = "impl Config {\n    pub fn new() -> Self {\n    }\n}\n"
        spec = spec_for_extension(".rs")
        symbols = parse_file(content, "config.rs", spec)
        assert len(symbols) == 2
        assert symbols[0].name == "Config"
        assert symbols[0].kind == SymbolKind.IMPL

    def test_async_fn(self) -> None:
        content = "pub async fn fetch() -> Result<Response> {\n}\n"
        spec = spec_for_extension(".rs")
        symbols = parse_file(content, "api.rs", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "fetch"


# =============================================================================
# Parser — Java
# =============================================================================


class TestParseJava:
    """Java definition extraction."""

    def test_class(self) -> None:
        content = "public class UserService {\n}\n"
        spec = spec_for_extension(".java")
        symbols = parse_file(content, "UserService.java", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "UserService"
        assert symbols[0].kind == SymbolKind.CLASS

    def test_interface(self) -> None:
        content = "public interface Repository {\n}\n"
        spec = spec_for_extension(".java")
        symbols = parse_file(content, "Repository.java", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Repository"
        assert symbols[0].kind == SymbolKind.INTERFACE

    def test_enum(self) -> None:
        content = "public enum Status {\n    ACTIVE, INACTIVE\n}\n"
        spec = spec_for_extension(".java")
        symbols = parse_file(content, "Status.java", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Status"
        assert symbols[0].kind == SymbolKind.ENUM

    def test_abstract_class(self) -> None:
        content = "public abstract class BaseController {\n}\n"
        spec = spec_for_extension(".java")
        symbols = parse_file(content, "BaseController.java", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "BaseController"


# =============================================================================
# Parser — Ruby
# =============================================================================


class TestParseRuby:
    """Ruby definition extraction."""

    def test_class(self) -> None:
        content = "class UserController < ApplicationController\nend\n"
        spec = spec_for_extension(".rb")
        symbols = parse_file(content, "user_controller.rb", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "UserController"
        assert symbols[0].kind == SymbolKind.CLASS

    def test_module(self) -> None:
        content = "module Authentication\nend\n"
        spec = spec_for_extension(".rb")
        symbols = parse_file(content, "auth.rb", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Authentication"
        assert symbols[0].kind == SymbolKind.MODULE

    def test_def(self) -> None:
        content = "def login(user)\nend\n"
        spec = spec_for_extension(".rb")
        symbols = parse_file(content, "auth.rb", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "login"

    def test_predicate_method(self) -> None:
        content = "def valid?\nend\n"
        spec = spec_for_extension(".rb")
        symbols = parse_file(content, "model.rb", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "valid?"


# =============================================================================
# Parser — C/C++
# =============================================================================


class TestParseCCpp:
    """C/C++ definition extraction."""

    def test_struct(self) -> None:
        content = "struct Config {\n    int timeout;\n};\n"
        spec = spec_for_extension(".h")
        symbols = parse_file(content, "config.h", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Config"
        assert symbols[0].kind == SymbolKind.STRUCT

    def test_class(self) -> None:
        content = "class Server {\npublic:\n    void start();\n};\n"
        spec = spec_for_extension(".hpp")
        symbols = parse_file(content, "server.hpp", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Server"
        assert symbols[0].kind == SymbolKind.CLASS

    def test_enum(self) -> None:
        content = "enum class Color {\n    Red, Green, Blue\n};\n"
        spec = spec_for_extension(".cpp")
        symbols = parse_file(content, "types.cpp", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Color"
        assert symbols[0].kind == SymbolKind.ENUM


# =============================================================================
# Parser — PHP
# =============================================================================


class TestParsePHP:
    """PHP definition extraction."""

    def test_class(self) -> None:
        content = "class UserController {\n}\n"
        spec = spec_for_extension(".php")
        symbols = parse_file(content, "UserController.php", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "UserController"

    def test_function(self) -> None:
        content = "function authenticate($user) {\n}\n"
        spec = spec_for_extension(".php")
        symbols = parse_file(content, "auth.php", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "authenticate"

    def test_interface(self) -> None:
        content = "interface Cacheable {\n}\n"
        spec = spec_for_extension(".php")
        symbols = parse_file(content, "cache.php", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Cacheable"
        assert symbols[0].kind == SymbolKind.INTERFACE

    def test_trait(self) -> None:
        content = "trait Loggable {\n}\n"
        spec = spec_for_extension(".php")
        symbols = parse_file(content, "traits.php", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Loggable"
        assert symbols[0].kind == SymbolKind.TRAIT


# =============================================================================
# Parser — Kotlin
# =============================================================================


class TestParseKotlin:
    """Kotlin definition extraction."""

    def test_data_class(self) -> None:
        content = "data class User(val name: String)\n"
        spec = spec_for_extension(".kt")
        symbols = parse_file(content, "User.kt", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "User"
        assert symbols[0].kind == SymbolKind.CLASS

    def test_fun(self) -> None:
        content = "fun processRequest(request: Request): Response {\n}\n"
        spec = spec_for_extension(".kt")
        symbols = parse_file(content, "handler.kt", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "processRequest"

    def test_object(self) -> None:
        content = "object Database {\n}\n"
        spec = spec_for_extension(".kt")
        symbols = parse_file(content, "db.kt", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Database"
        assert symbols[0].kind == SymbolKind.OBJECT


# =============================================================================
# Parser — Scala
# =============================================================================


class TestParseScala:
    """Scala definition extraction."""

    def test_case_class(self) -> None:
        content = "case class Config(host: String, port: Int)\n"
        spec = spec_for_extension(".scala")
        symbols = parse_file(content, "Config.scala", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Config"

    def test_object(self) -> None:
        content = "object Main {\n  def main(args: Array[String]): Unit = {}\n}\n"
        spec = spec_for_extension(".scala")
        symbols = parse_file(content, "Main.scala", spec)
        assert len(symbols) == 2
        assert symbols[0].name == "Main"
        assert symbols[0].kind == SymbolKind.OBJECT

    def test_trait(self) -> None:
        content = "trait Serializable {\n}\n"
        spec = spec_for_extension(".scala")
        symbols = parse_file(content, "Serializable.scala", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "Serializable"
        assert symbols[0].kind == SymbolKind.TRAIT


# =============================================================================
# Parser — C#
# =============================================================================


class TestParseCSharp:
    """C# definition extraction."""

    def test_class(self) -> None:
        content = "public class UserService {\n}\n"
        spec = spec_for_extension(".cs")
        symbols = parse_file(content, "UserService.cs", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "UserService"
        assert symbols[0].kind == SymbolKind.CLASS

    def test_interface(self) -> None:
        content = "public interface IUserRepository {\n}\n"
        spec = spec_for_extension(".cs")
        symbols = parse_file(content, "IUserRepository.cs", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "IUserRepository"
        assert symbols[0].kind == SymbolKind.INTERFACE

    def test_partial_class(self) -> None:
        content = "public partial class MainForm {\n}\n"
        spec = spec_for_extension(".cs")
        symbols = parse_file(content, "MainForm.cs", spec)
        assert len(symbols) == 1
        assert symbols[0].name == "MainForm"


# =============================================================================
# Parser — edge cases
# =============================================================================


class TestParserEdgeCases:
    """Parser edge cases independent of language."""

    def test_empty_file(self) -> None:
        spec = spec_for_extension(".py")
        symbols = parse_file("", "empty.py", spec)
        assert symbols == []

    def test_file_with_no_definitions(self) -> None:
        content = "# Just a comment\nx = 42\nprint(x)\n"
        spec = spec_for_extension(".py")
        symbols = parse_file(content, "script.py", spec)
        assert symbols == []

    def test_symbol_cap_enforcement(self) -> None:
        lines = [f"def func_{i}(): pass\n" for i in range(300)]
        content = "".join(lines)
        spec = spec_for_extension(".py")
        symbols = parse_file(content, "big.py", spec, max_symbols=10)
        assert len(symbols) == 10

    def test_file_path_preserved(self) -> None:
        content = "class Foo:\n    pass\n"
        spec = spec_for_extension(".py")
        symbols = parse_file(content, "src/models/foo.py", spec)
        assert symbols[0].file_path == "src/models/foo.py"

    def test_blank_lines_skipped(self) -> None:
        content = "\n\n\nclass Foo:\n    pass\n"
        spec = spec_for_extension(".py")
        symbols = parse_file(content, "foo.py", spec)
        assert len(symbols) == 1
        assert symbols[0].line_number == 4


# =============================================================================
# Scoring
# =============================================================================


class TestScoring:
    """_score_symbol fuzzy matching behaviour."""

    def _sym(self, name: str) -> Symbol:
        return Symbol(name, SymbolKind.FUNCTION, "a.py", 1, f"def {name}():")

    def test_exact_match_scores_one(self) -> None:
        score = _score_symbol(["auth"], self._sym("auth"))
        assert score == 1.0

    def test_exact_multi_token_scores_one(self) -> None:
        score = _score_symbol(["auth", "middleware"], self._sym("AuthMiddleware"))
        assert score == 1.0

    def test_prefix_match(self) -> None:
        # "au" is a prefix of token "auth" (from AuthMiddleware) → 0.7
        score = _score_symbol(["au"], self._sym("AuthMiddleware"))
        assert 0.6 < score < 0.8

    def test_substring_match(self) -> None:
        # "ware" is a substring (not prefix) of token "middleware" → 0.4
        score = _score_symbol(["ware"], self._sym("AuthMiddleware"))
        assert 0.3 < score < 0.5

    def test_no_match_scores_zero(self) -> None:
        score = _score_symbol(["xyz"], self._sym("AuthMiddleware"))
        assert score == 0.0

    def test_partial_multi_token(self) -> None:
        score = _score_symbol(["auth", "xyz"], self._sym("AuthMiddleware"))
        assert 0.3 < score < 0.6

    def test_empty_query_scores_zero(self) -> None:
        score = _score_symbol([], self._sym("Foo"))
        assert score == 0.0


# =============================================================================
# WorkspaceIndex.search
# =============================================================================


class TestWorkspaceIndexSearch:
    """WorkspaceIndex.search ranking and filtering."""

    def _build_index(self, *names: str) -> WorkspaceIndex:
        symbols = [
            Symbol(n, SymbolKind.CLASS, f"{n.lower()}.py", i + 1, f"class {n}:")
            for i, n in enumerate(names)
        ]
        return WorkspaceIndex(symbols, files_indexed=len(names))

    def test_exact_match_ranked_first(self) -> None:
        idx = self._build_index("AuthMiddleware", "Authenticator", "Middleware")
        results = idx.search("AuthMiddleware")
        assert results[0].symbol.name == "AuthMiddleware"

    def test_multi_token_query(self) -> None:
        idx = self._build_index("AuthMiddleware", "LogMiddleware", "AuthService")
        results = idx.search("auth middleware")
        assert results[0].symbol.name == "AuthMiddleware"

    def test_no_matches_returns_empty(self) -> None:
        idx = self._build_index("Foo", "Bar")
        results = idx.search("xyz")
        assert results == []

    def test_result_cap(self) -> None:
        idx = self._build_index(*[f"Auth{i}" for i in range(50)])
        results = idx.search("auth", max_results=5)
        assert len(results) == 5

    def test_empty_query_returns_empty(self) -> None:
        idx = self._build_index("Foo")
        results = idx.search("")
        assert results == []

    def test_whitespace_query_returns_empty(self) -> None:
        idx = self._build_index("Foo")
        results = idx.search("   ")
        assert results == []

    def test_minimum_score_threshold(self) -> None:
        idx = self._build_index("AuthMiddleware")
        results = idx.search("completely unrelated query words")
        assert results == []

    def test_case_insensitive(self) -> None:
        idx = self._build_index("AuthMiddleware")
        results = idx.search("AUTH MIDDLEWARE")
        assert len(results) == 1
        assert results[0].symbol.name == "AuthMiddleware"

    def test_ranking_stability_by_filepath(self) -> None:
        symbols = [
            Symbol("Foo", SymbolKind.CLASS, "b.py", 1, "class Foo:"),
            Symbol("Foo", SymbolKind.CLASS, "a.py", 1, "class Foo:"),
        ]
        idx = WorkspaceIndex(symbols, files_indexed=2)
        results = idx.search("foo")
        assert results[0].symbol.file_path == "a.py"
        assert results[1].symbol.file_path == "b.py"

    def test_search_result_has_score(self) -> None:
        idx = self._build_index("AuthMiddleware")
        results = idx.search("auth")
        assert isinstance(results[0], SearchResult)
        assert results[0].score > 0


# =============================================================================
# build_workspace_index
# =============================================================================


class TestBuildWorkspaceIndex:
    """build_workspace_index with mock backend."""

    def _make_backend(
        self,
        files: dict[str, str],
    ) -> MagicMock:
        """Create a mock backend with given files at the root."""
        backend = MagicMock()
        backend.list_files.return_value = list(files.keys())
        backend.is_directory.return_value = False
        backend.read.side_effect = lambda path: files.get(path, "")
        return backend

    def test_indexes_python_file(self) -> None:
        backend = self._make_backend({
            "app.py": "class App:\n    pass\n",
        })
        index = build_workspace_index(backend)
        assert index.size == 1
        assert index.symbols[0].name == "App"

    def test_skips_non_source_files(self) -> None:
        backend = self._make_backend({
            "data.csv": "a,b,c\n1,2,3\n",
            "image.png": "<binary>",
            "app.py": "class App:\n    pass\n",
        })
        index = build_workspace_index(backend)
        assert index.size == 1
        assert index.files_indexed == 1

    def test_file_cap_enforcement(self) -> None:
        files = {f"mod_{i}.py": f"class Mod{i}:\n    pass\n" for i in range(10)}
        backend = self._make_backend(files)
        index = build_workspace_index(backend, max_files=3)
        assert index.files_indexed == 3
        assert index.truncated is True

    def test_empty_workspace(self) -> None:
        backend = self._make_backend({})
        index = build_workspace_index(backend)
        assert index.size == 0
        assert index.files_indexed == 0
        assert index.truncated is False

    def test_read_error_skips_file(self) -> None:
        backend = MagicMock()
        backend.list_files.return_value = ["broken.py", "good.py"]
        backend.is_directory.return_value = False
        backend.read.side_effect = lambda p: (
            (_ for _ in ()).throw(OSError("read failed"))
            if p == "broken.py"
            else "class Good:\n    pass\n"
        )
        index = build_workspace_index(backend)
        assert index.size == 1
        assert index.symbols[0].name == "Good"

    def test_large_file_skipped(self) -> None:
        backend = self._make_backend({
            "huge.py": "x" * 200_000,
        })
        index = build_workspace_index(backend)
        assert index.size == 0

    def test_multiple_languages(self) -> None:
        backend = self._make_backend({
            "app.py": "class App:\n    pass\n",
            "main.go": "func main() {\n}\n",
            "index.ts": "export class Index {\n}\n",
        })
        index = build_workspace_index(backend)
        assert index.size == 3
        names = {s.name for s in index.symbols}
        assert names == {"App", "main", "Index"}


# =============================================================================
# format_search_results
# =============================================================================


class TestFormatSearchResults:
    """Output formatting for search results."""

    def test_no_results(self) -> None:
        output = format_search_results([], "auth")
        assert "No definitions found" in output
        assert "auth" in output

    def test_no_results_with_truncated_index(self) -> None:
        idx = WorkspaceIndex([], files_indexed=50, truncated=True)
        output = format_search_results([], "auth", index=idx)
        assert "No definitions found" in output
        assert "50" in output

    def test_formatted_output_structure(self) -> None:
        sym = Symbol("AuthMiddleware", SymbolKind.CLASS, "auth.py", 15, "class AuthMiddleware(Base):")
        results = [SearchResult(symbol=sym, score=1.0)]
        output = format_search_results(results, "auth")
        assert "1 definition(s)" in output
        assert "class AuthMiddleware" in output
        assert "auth.py:15" in output
        assert "class AuthMiddleware(Base):" in output

    def test_multiple_results_numbered(self) -> None:
        results = [
            SearchResult(
                symbol=Symbol("Foo", SymbolKind.CLASS, "foo.py", 1, "class Foo:"),
                score=1.0,
            ),
            SearchResult(
                symbol=Symbol("Bar", SymbolKind.CLASS, "bar.py", 1, "class Bar:"),
                score=0.8,
            ),
        ]
        output = format_search_results(results, "query")
        assert "1. class Foo" in output
        assert "2. class Bar" in output

    def test_truncation_notice_in_header(self) -> None:
        sym = Symbol("X", SymbolKind.CLASS, "x.py", 1, "class X:")
        idx = WorkspaceIndex([sym], files_indexed=100, truncated=True)
        results = [SearchResult(symbol=sym, score=1.0)]
        output = format_search_results(results, "x", index=idx)
        assert f"{MAX_FILES}+" in output
