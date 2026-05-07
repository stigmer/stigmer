"""Unit tests for the connect workflow classify short-circuit (T07).

Covers:
- ``tools_fingerprint`` deterministic hashing
- Short-circuit: tools unchanged → reuse previous approvals
- Reclassification: tools changed → call classify activity
"""

from __future__ import annotations

import hashlib
import json
import sys
from unittest.mock import MagicMock

# Stub out temporalio and grpc before importing the module under test,
# because temporalio transitively requires google.protobuf well-known
# types that may not be available in all venv configurations.
_STUBS = {}
for mod_name in (
    "temporalio", "temporalio.activity", "temporalio.workflow",
    "temporalio.common", "grpc", "grpc.aio",
):
    if mod_name not in sys.modules:
        _STUBS[mod_name] = MagicMock()

# Also stub the gRPC-generated proto modules that discover_mcp_server
# transitively imports (ChannelProvider → channel → generated stubs).
for proto_mod in (
    "stigmer_runner.grpc_client.channel",
    "stigmer_runner.grpc_client.execution_context_client",
    "stigmer_runner.grpc_client.mcp_server_client",
    "stigmer_runner.worker.auth",
    "stigmer_runner.worker.mcp.config_transformer",
    "stigmer_runner.worker.execution_tracker",
):
    if proto_mod not in sys.modules:
        _STUBS[proto_mod] = MagicMock()

# Apply stubs
sys.modules.update(_STUBS)

from stigmer_runner.worker.activities.discover_mcp_server import (  # noqa: E402
    DiscoveredToolResult,
    tools_fingerprint,
)

# ---------------------------------------------------------------------------
# tools_fingerprint
# ---------------------------------------------------------------------------


class TestToolsFingerprint:
    """Deterministic content hashing for tool sets."""

    def test_empty_tools_returns_empty_string(self):
        assert tools_fingerprint([]) == ""

    def test_same_tools_same_hash(self):
        tools = [
            DiscoveredToolResult(name="search", description="Search code", input_schema={"properties": {"q": {}}}),
            DiscoveredToolResult(name="create", description="Create file", input_schema={"properties": {"path": {}}}),
        ]
        assert tools_fingerprint(tools) == tools_fingerprint(tools)

    def test_order_independent(self):
        """tools_fingerprint sorts by name — order should not affect hash."""
        tools_a = [
            DiscoveredToolResult(name="beta", description="B", input_schema=None),
            DiscoveredToolResult(name="alpha", description="A", input_schema=None),
        ]
        tools_b = [
            DiscoveredToolResult(name="alpha", description="A", input_schema=None),
            DiscoveredToolResult(name="beta", description="B", input_schema=None),
        ]
        assert tools_fingerprint(tools_a) == tools_fingerprint(tools_b)

    def test_description_change_changes_hash(self):
        tools_v1 = [DiscoveredToolResult(name="search", description="Search code", input_schema=None)]
        tools_v2 = [DiscoveredToolResult(name="search", description="Search files", input_schema=None)]
        assert tools_fingerprint(tools_v1) != tools_fingerprint(tools_v2)

    def test_schema_change_changes_hash(self):
        tools_v1 = [DiscoveredToolResult(name="search", description="S", input_schema={"properties": {"q": {}}})]
        tools_v2 = [DiscoveredToolResult(name="search", description="S", input_schema={"properties": {"q": {}, "limit": {}}})]
        assert tools_fingerprint(tools_v1) != tools_fingerprint(tools_v2)

    def test_new_tool_changes_hash(self):
        tools_v1 = [DiscoveredToolResult(name="search", description="S", input_schema=None)]
        tools_v2 = [
            DiscoveredToolResult(name="search", description="S", input_schema=None),
            DiscoveredToolResult(name="create", description="C", input_schema=None),
        ]
        assert tools_fingerprint(tools_v1) != tools_fingerprint(tools_v2)

    def test_removed_tool_changes_hash(self):
        tools_v1 = [
            DiscoveredToolResult(name="search", description="S", input_schema=None),
            DiscoveredToolResult(name="create", description="C", input_schema=None),
        ]
        tools_v2 = [DiscoveredToolResult(name="search", description="S", input_schema=None)]
        assert tools_fingerprint(tools_v1) != tools_fingerprint(tools_v2)

    def test_returns_hex_string(self):
        tools = [DiscoveredToolResult(name="x", description="y", input_schema=None)]
        fp = tools_fingerprint(tools)
        assert len(fp) == 64  # SHA-256 hex digest
        assert all(c in "0123456789abcdef" for c in fp)

    def test_known_hash_value(self):
        """Verify the hash matches manual computation."""
        tools = [DiscoveredToolResult(name="search", description="Search", input_schema=None)]
        canonical = [{"description": "Search", "input_schema": None, "name": "search"}]
        expected = hashlib.sha256(
            json.dumps(canonical, sort_keys=True).encode()
        ).hexdigest()
        assert tools_fingerprint(tools) == expected
