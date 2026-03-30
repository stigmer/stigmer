"""Integration tests: verify shell tools work inside a real Daytona sandbox.

Creates a ``daytona-small`` sandbox, writes sample files, and runs the
shell commands (``find``, ``grep``, ``sed``) that the glob/grep/search
platform tools now delegate to.  Also runs the full Graphton tool
wrappers against the live backend to confirm end-to-end behaviour.

The sandbox is created once per module (session-scoped fixture) and
deleted in teardown, regardless of test outcome.

**Skipped** when ``DAYTONA_API_KEY`` is absent from the environment.
"""

from __future__ import annotations

import logging
import os
import time

import pytest

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Gate: skip entire module if DAYTONA_API_KEY is not set
# ---------------------------------------------------------------------------

_SKIP_DAYTONA = not os.environ.get("DAYTONA_API_KEY")


def _skip_reason() -> str:
    return "Requires DAYTONA_API_KEY env var"


try:
    from daytona import Daytona, DaytonaConfig
    from daytona.common.daytona import CreateSandboxFromSnapshotParams
except ImportError:
    _SKIP_DAYTONA = True

    def _skip_reason() -> str:  # type: ignore[misc]
        return "daytona SDK not installed"


_SNAPSHOT_ID = os.environ.get("DAYTONA_DEV_TOOLS_SNAPSHOT_ID", "daytona-small")

# ---------------------------------------------------------------------------
# Module-scoped sandbox fixture
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def daytona_sandbox():
    """Create a live Daytona sandbox, yield it, then delete it.

    Skips the test if the sandbox fails to start within 180 seconds.
    """
    if _SKIP_DAYTONA:
        pytest.skip(_skip_reason())

    api_key = os.environ["DAYTONA_API_KEY"]
    daytona = Daytona(DaytonaConfig(api_key=api_key))

    logger.info("Creating Daytona sandbox from snapshot %s …", _SNAPSHOT_ID)
    params = CreateSandboxFromSnapshotParams(
        snapshot=_SNAPSHOT_ID,
        auto_delete_interval=5,
    )
    sandbox = daytona.create(params=params)

    # Wait for readiness
    for attempt in range(90):
        try:
            result = sandbox.process.exec("echo ready", timeout=5)
            if result.exit_code == 0:
                logger.info(
                    "Sandbox %s ready after %d poll(s)", sandbox.id, attempt + 1
                )
                break
        except Exception:
            pass
        time.sleep(2)
    else:
        sandbox.delete()
        pytest.fail(f"Sandbox {sandbox.id} did not become ready within 180s")

    yield sandbox

    logger.info("Deleting Daytona sandbox %s …", sandbox.id)
    try:
        sandbox.delete()
    except Exception:
        logger.warning("Failed to delete sandbox %s", sandbox.id, exc_info=True)


@pytest.fixture(scope="module")
def daytona_backend(daytona_sandbox):
    """Create a WorkspaceNormalizingBackend from the live sandbox."""
    from graphton.core.backends.daytona import WorkspaceNormalizingBackend

    try:
        from deepagents_cli.integrations.daytona import DaytonaBackend
    except ImportError:
        pytest.skip("deepagents_cli not installed")

    try:
        workspace_root = daytona_sandbox.get_work_dir().rstrip("/")
    except Exception:
        workspace_root = "/home/daytona"

    inner = DaytonaBackend(daytona_sandbox)
    return WorkspaceNormalizingBackend(inner, workspace_root)


@pytest.fixture(scope="module")
def seeded_backend(daytona_sandbox, daytona_backend):
    """Seed the sandbox with sample files and return the backend."""
    cmds = [
        "mkdir -p src/utils sub/deep",
        "echo 'def hello():\\n    return 42\\ndef world():\\n    pass' > src/main.py",
        "echo 'class Config:\\n    pass' > src/utils/config.py",
        "echo 'apiVersion: v1\\nkind: Chart' > chart.yaml",
        "echo 'readme content' > README.md",
        "echo 'nested data' > sub/deep/data.txt",
    ]
    for cmd in cmds:
        result = daytona_sandbox.process.exec(cmd, timeout=10)
        assert result.exit_code == 0, f"Seed command failed: {cmd}"

    return daytona_backend


# =============================================================================
# Raw shell command tests — verify find/grep/sed are available
# =============================================================================


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestShellToolsAvailable:
    """Verify that POSIX utilities exist and work in the sandbox."""

    def test_find_available(self, daytona_sandbox) -> None:
        result = daytona_sandbox.process.exec("find --version 2>&1 || find / -maxdepth 0 -print", timeout=5)
        assert result.exit_code == 0

    def test_grep_available(self, daytona_sandbox) -> None:
        result = daytona_sandbox.process.exec("echo 'hello world' | grep hello", timeout=5)
        assert result.exit_code == 0
        assert "hello" in result.result

    def test_grep_ere_works(self, daytona_sandbox) -> None:
        result = daytona_sandbox.process.exec(
            "echo 'def hello' | grep -E '(def|class) '", timeout=5,
        )
        assert result.exit_code == 0
        assert "def hello" in result.result

    def test_sed_available(self, daytona_sandbox) -> None:
        result = daytona_sandbox.process.exec("echo 'hello' | sed 's/^/f /'", timeout=5)
        assert result.exit_code == 0
        assert "f hello" in result.result

    def test_sort_available(self, daytona_sandbox) -> None:
        result = daytona_sandbox.process.exec(
            "printf 'c\\na\\nb\\n' | sort", timeout=5,
        )
        assert result.exit_code == 0
        lines = result.result.strip().split("\n")
        assert lines == ["a", "b", "c"]

    def test_head_available(self, daytona_sandbox) -> None:
        result = daytona_sandbox.process.exec(
            "seq 100 | head -n 3", timeout=5,
        )
        assert result.exit_code == 0
        lines = result.result.strip().split("\n")
        assert lines == ["1", "2", "3"]


# =============================================================================
# Glob tool — end-to-end via backend.execute()
# =============================================================================


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestGlobOnDaytona:
    @pytest.mark.asyncio
    async def test_glob_finds_python_files(self, seeded_backend) -> None:
        from graphton.core.tool_wrappers import _create_glob_tool

        glob_fn = _create_glob_tool(seeded_backend)
        result = await glob_fn.ainvoke({"pattern": "*.py"})
        assert "main.py" in result
        assert "config.py" in result

    @pytest.mark.asyncio
    async def test_glob_finds_yaml(self, seeded_backend) -> None:
        from graphton.core.tool_wrappers import _create_glob_tool

        glob_fn = _create_glob_tool(seeded_backend)
        result = await glob_fn.ainvoke({"pattern": "chart.yaml"})
        assert "chart.yaml" in result

    @pytest.mark.asyncio
    async def test_glob_no_matches(self, seeded_backend) -> None:
        from graphton.core.tool_wrappers import _create_glob_tool

        glob_fn = _create_glob_tool(seeded_backend)
        result = await glob_fn.ainvoke({"pattern": "*.nonexistent"})
        assert "No files matching" in result

    @pytest.mark.asyncio
    async def test_glob_excludes_git(self, seeded_backend, daytona_sandbox) -> None:
        from graphton.core.tool_wrappers import _create_glob_tool

        daytona_sandbox.process.exec("mkdir -p .git/objects && echo x > .git/objects/hidden.py", timeout=5)
        glob_fn = _create_glob_tool(seeded_backend)
        result = await glob_fn.ainvoke({"pattern": "*.py"})
        assert "hidden.py" not in result


# =============================================================================
# Grep tool — end-to-end via backend.execute()
# =============================================================================


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestGrepOnDaytona:
    @pytest.mark.asyncio
    async def test_grep_finds_pattern(self, seeded_backend) -> None:
        from graphton.core.tool_wrappers import _create_grep_tool

        grep_fn = _create_grep_tool(seeded_backend)
        result = await grep_fn.ainvoke({"pattern": "def ", "include": "*.py"})
        assert "def hello" in result
        assert "def world" in result

    @pytest.mark.asyncio
    async def test_grep_with_alternation(self, seeded_backend) -> None:
        from graphton.core.tool_wrappers import _create_grep_tool

        grep_fn = _create_grep_tool(seeded_backend)
        result = await grep_fn.ainvoke({"pattern": "def|class"})
        assert "def hello" in result
        assert "class Config" in result

    @pytest.mark.asyncio
    async def test_grep_no_matches(self, seeded_backend) -> None:
        from graphton.core.tool_wrappers import _create_grep_tool

        grep_fn = _create_grep_tool(seeded_backend)
        result = await grep_fn.ainvoke({"pattern": "nonexistent_xyz_123"})
        assert "No matches" in result


# =============================================================================
# Search tool — index build via grep
# =============================================================================


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestSearchOnDaytona:
    @pytest.mark.asyncio
    async def test_search_finds_function(self, seeded_backend) -> None:
        from graphton.core.tool_wrappers import _create_search_tool

        search_fn = _create_search_tool(seeded_backend)
        result = await search_fn.ainvoke({"query": "hello"})
        assert "hello" in result

    @pytest.mark.asyncio
    async def test_search_finds_class(self, seeded_backend) -> None:
        from graphton.core.tool_wrappers import _create_search_tool

        search_fn = _create_search_tool(seeded_backend)
        result = await search_fn.ainvoke({"query": "Config"})
        assert "Config" in result


# =============================================================================
# workspace_index — build_workspace_index_via_grep
# =============================================================================


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestWorkspaceIndexOnDaytona:
    def test_builds_index_via_grep(self, seeded_backend) -> None:
        from graphton.core.workspace_index import build_workspace_index_via_grep

        index = build_workspace_index_via_grep(seeded_backend)
        assert index.files_indexed > 0
        names = [s.name for s in index._symbols]
        assert "hello" in names
        assert "Config" in names

    def test_index_search_returns_results(self, seeded_backend) -> None:
        from graphton.core.workspace_index import build_workspace_index_via_grep

        index = build_workspace_index_via_grep(seeded_backend)
        results = index.search("hello")
        assert len(results) >= 1
        assert results[0].symbol.name == "hello"


# =============================================================================
# DeepAgentsBackendAdapter — fast path via execute()
# =============================================================================


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestAdapterOnDaytona:
    def test_grep_raw_via_execute(self, seeded_backend) -> None:
        from graphton.core.backends.deepagents_adapter import (
            DeepAgentsBackendAdapter,
        )

        adapter = DeepAgentsBackendAdapter(seeded_backend)
        matches = adapter.grep_raw("def ")
        assert isinstance(matches, list)
        assert len(matches) >= 2
        texts = [m["text"] for m in matches]
        assert any("def hello" in t for t in texts)

    def test_glob_info_via_execute(self, seeded_backend) -> None:
        from graphton.core.backends.deepagents_adapter import (
            DeepAgentsBackendAdapter,
        )

        adapter = DeepAgentsBackendAdapter(seeded_backend)
        matches = adapter.glob_info("*.py")
        paths = [m["path"] for m in matches]
        assert any("main.py" in p for p in paths)

    def test_ls_info_via_execute(self, seeded_backend) -> None:
        from graphton.core.backends.deepagents_adapter import (
            DeepAgentsBackendAdapter,
        )

        adapter = DeepAgentsBackendAdapter(seeded_backend)
        entries = adapter.ls_info(".")
        paths = [e["path"] for e in entries]
        assert any("src" in p for p in paths)

        src_entry = next(e for e in entries if "src" in e["path"])
        assert src_entry["is_dir"] is True


# =============================================================================
# Write overwrite semantics — confirm DaytonaBackend.write behaviour
# =============================================================================


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestDaytonaWriteOverwrite:
    """Confirm whether DaytonaBackend.write can overwrite pre-existing files.

    The upstream ``BaseSandbox.write`` documents create-only semantics
    ("error if file exists").  These tests verify the actual behaviour of
    ``deepagents-cli`` 0.0.x against a live sandbox so fixes can be
    grounded in observed reality rather than documentation assumptions.
    """

    def test_write_new_file_succeeds(self, daytona_sandbox, daytona_backend) -> None:
        """Baseline: writing a brand-new file should always work."""
        result = daytona_backend.write("_test_write_new.txt", "fresh content")
        logger.info("write(new file) returned: %r (type=%s)", result, type(result))

        readback = daytona_sandbox.process.exec("cat _test_write_new.txt", timeout=5)
        assert readback.exit_code == 0
        assert "fresh content" in readback.result

    def test_write_overwrite_existing_file(self, daytona_sandbox, daytona_backend) -> None:
        """Regression: WorkspaceNormalizingBackend.write MUST overwrite
        existing files (delete+retry).

        Seeds a file via shell (simulating init_skill.py's Path.write_text),
        then overwrites via backend.write() — which should succeed after
        the Bug 1 fix.
        """
        seed = daytona_sandbox.process.exec(
            "echo 'original scaffold content' > _test_overwrite.txt", timeout=5,
        )
        assert seed.exit_code == 0

        daytona_backend.write("_test_overwrite.txt", "overwritten content")

        readback = daytona_sandbox.process.exec("cat _test_overwrite.txt", timeout=5)
        assert readback.exit_code == 0
        assert "overwritten content" in readback.result.strip(), (
            f"Write overwrite failed — file still has old content: "
            f"{readback.result.strip()!r}"
        )

    def test_inner_backend_write_return_value(self, daytona_sandbox) -> None:
        """Inspect the raw return value from the inner DaytonaBackend.write
        (without the WorkspaceNormalizingBackend wrapper) to see if it
        returns a WriteResult with an error field."""
        try:
            from deepagents_cli.integrations.daytona import DaytonaBackend
        except ImportError:
            pytest.skip("deepagents_cli not installed")

        inner = DaytonaBackend(daytona_sandbox)

        seed = daytona_sandbox.process.exec(
            "echo 'inner original' > _test_inner_overwrite.txt", timeout=5,
        )
        assert seed.exit_code == 0

        result = inner.write("_test_inner_overwrite.txt", "inner overwritten")
        logger.info(
            "Inner DaytonaBackend.write returned: %r (type=%s, "
            "has error=%s, error=%r)",
            result,
            type(result).__name__,
            hasattr(result, "error"),
            getattr(result, "error", "N/A"),
        )

        readback = daytona_sandbox.process.exec(
            "cat _test_inner_overwrite.txt", timeout=5,
        )
        actual = readback.result.strip()
        logger.info("Inner backend content after overwrite: %r", actual)

        overwrite_worked = "inner overwritten" in actual
        logger.info("Inner backend overwrite succeeded: %s", overwrite_worked)
