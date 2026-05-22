"""Tests for StigmerClient execution_target configuration."""

from __future__ import annotations

import pytest

from stigmer import StigmerClient


class TestStigmerClientExecutionTarget:
    """Tests for the execution_target constructor parameter."""

    def test_local_target(self) -> None:
        with StigmerClient(
            "test-key", base_url="localhost:7234", insecure=True, execution_target="local"
        ) as client:
            assert client.default_execution_target == 1  # EXECUTION_TARGET_LOCAL

    def test_cloud_target(self) -> None:
        with StigmerClient(
            "test-key", base_url="localhost:7234", insecure=True, execution_target="cloud"
        ) as client:
            assert client.default_execution_target == 2  # EXECUTION_TARGET_CLOUD

    def test_no_target_defaults_to_unspecified(self) -> None:
        with StigmerClient(
            "test-key", base_url="localhost:7234", insecure=True
        ) as client:
            assert client.default_execution_target == 0  # EXECUTION_TARGET_UNSPECIFIED

    def test_missing_api_key_raises(self) -> None:
        with pytest.raises(ValueError, match="API key is required"):
            StigmerClient(
                "", base_url="localhost:7234", insecure=True, execution_target="local"
            )
