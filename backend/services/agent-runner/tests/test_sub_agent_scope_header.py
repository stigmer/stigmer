"""Unit test for sub-agent title generation execution_id scope header (T07).

Verifies that ``_generate_sub_agent_subject()`` passes ``execution_id``
through to ``build_llm_kwargs`` so the LLM proxy call carries the
``X-Stigmer-Execution-Id`` scope header.

Uses importlib to load sub_agent.py directly with targeted sys.modules
stubs for broken transitive imports.
"""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

_SRC = Path(__file__).resolve().parents[1] / "src"

# ── Targeted stubbing ─────────────────────────────────────────────────
#
# sub_agent.py imports:
#   1. Proto stubs (broken in this venv)
#   2. graphton.core, langchain_core, etc.
#   3. stigmer_runner.worker.activities.graphton.handlers.formatting
#   4. stigmer_runner.worker.config (works — no proto deps)
#
# Import #3 triggers graphton/__init__.py which imports the ENTIRE
# graphton package (status_builder, approval_policy, etc.), pulling in
# hundreds of proto stubs.
#
# Fix: pre-register graphton and handlers as packages in sys.modules
# (with real __path__ for disk resolution), so Python never executes
# their __init__.py.  Then stub `formatting` as a MagicMock leaf.


def _mock(name: str) -> None:
    """Register MagicMock with __path__ and __spec__."""
    if name in sys.modules:
        return
    m = MagicMock()
    m.__path__ = []
    m.__spec__ = None
    sys.modules[name] = m


def _mock_chain(dotted: str) -> None:
    """Register MagicMock for every prefix of *dotted*."""
    parts = dotted.split(".")
    for i in range(1, len(parts) + 1):
        _mock(".".join(parts[:i]))


def _real_pkg(name: str, path: str) -> None:
    """Register a real package (types.ModuleType with __path__)."""
    if name in sys.modules:
        return
    m = types.ModuleType(name)
    m.__path__ = [path]
    m.__package__ = name
    m.__spec__ = None  # type: ignore[assignment]
    sys.modules[name] = m


# -- Pre-register graphton packages with real __path__ --
# This prevents Python from executing their heavy __init__.py.
_graphton_dir = str(
    _SRC / "stigmer_runner" / "worker" / "activities" / "graphton"
)
_handlers_dir = str(
    _SRC / "stigmer_runner" / "worker" / "activities" / "graphton" / "handlers"
)
_real_pkg("stigmer_runner.worker.activities.graphton", _graphton_dir)
_real_pkg("stigmer_runner.worker.activities.graphton.handlers", _handlers_dir)

# Stub the `formatting` sibling module that sub_agent.py imports
_mock("stigmer_runner.worker.activities.graphton.handlers.formatting")

# External libs
for _m in [
    "temporalio", "temporalio.activity", "temporalio.workflow", "temporalio.common",
    "grpc", "grpc.aio",
    "graphton", "graphton.core", "graphton.core.models",
    "langchain_core", "langchain_core.messages",
]:
    _mock(_m)

# Proto stub chains
for _p in [
    "ai.stigmer.agentic.agentexecution.v1",
    "ai.stigmer.agentic.agentexecution.v1.enum_pb2",
    "ai.stigmer.agentic.agentexecution.v1.subagent_pb2",
]:
    _mock_chain(_p)


# ── Load sub_agent.py via importlib ───────────────────────────────────
#
# importlib.util.spec_from_file_location lets us execute a single .py
# file, bypassing graphton's __init__.py which imports the entire package.

_SUB_AGENT_PATH = (
    _SRC / "stigmer_runner" / "worker" / "activities"
    / "graphton" / "handlers" / "sub_agent.py"
)

_spec = importlib.util.spec_from_file_location(
    "sub_agent_test_target", _SUB_AGENT_PATH,
    submodule_search_locations=[],
)
assert _spec and _spec.loader
_sub_agent_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_sub_agent_mod)  # type: ignore[union-attr]

_generate_sub_agent_subject = _sub_agent_mod._generate_sub_agent_subject


# ── Tests ─────────────────────────────────────────────────────────────


class TestSubAgentSubjectExecutionId:
    """_generate_sub_agent_subject() passes execution_id to build_llm_kwargs."""

    @pytest.mark.asyncio
    async def test_execution_id_forwarded(self):
        captured_kwargs: dict = {}

        fake_config = MagicMock()
        fake_config.llm.model_name = "gpt-4o-mini"
        fake_config.stigmer_proxy_endpoint = "https://proxy"
        fake_config.stigmer_token = "tok"
        fake_config.llm.build_llm_kwargs = lambda **kw: (
            captured_kwargs.update(kw) or {"api_key": "fake"}
        )

        mock_response = MagicMock()
        mock_response.content = "Fix auth tests"
        mock_model = MagicMock()
        mock_model.ainvoke = AsyncMock(return_value=mock_response)

        with (
            patch.object(
                _sub_agent_mod, "Config",
                **{"load_from_env.return_value": fake_config},
            ),
            patch.object(
                _sub_agent_mod, "ModelRegistry",
                **{"get_summarization_model.return_value": "gpt-4o-mini"},
            ),
            patch.object(
                _sub_agent_mod, "parse_model_string",
                return_value=mock_model,
            ),
        ):
            result = await _generate_sub_agent_subject(
                "Fix the authentication middleware tests",
                "explore",
                execution_id="exec-test-789",
            )

        assert captured_kwargs["execution_id"] == "exec-test-789"
        assert result

    @pytest.mark.asyncio
    async def test_no_execution_id_omits_from_kwargs(self):
        captured_kwargs: dict = {}

        fake_config = MagicMock()
        fake_config.llm.model_name = "gpt-4o-mini"
        fake_config.stigmer_proxy_endpoint = "https://proxy"
        fake_config.stigmer_token = "tok"
        fake_config.llm.build_llm_kwargs = lambda **kw: (
            captured_kwargs.update(kw) or {"api_key": "fake"}
        )

        mock_response = MagicMock()
        mock_response.content = "Fix tests"
        mock_model = MagicMock()
        mock_model.ainvoke = AsyncMock(return_value=mock_response)

        with (
            patch.object(
                _sub_agent_mod, "Config",
                **{"load_from_env.return_value": fake_config},
            ),
            patch.object(
                _sub_agent_mod, "ModelRegistry",
                **{"get_summarization_model.return_value": "gpt-4o-mini"},
            ),
            patch.object(
                _sub_agent_mod, "parse_model_string",
                return_value=mock_model,
            ),
        ):
            await _generate_sub_agent_subject(
                "Fix tests",
                "shell",
            )

        assert captured_kwargs.get("execution_id") is None
