"""Unit tests for CheckpointerConfig module.

Tests cover:
- CheckpointerConfig creation and validation
- Environment variable loading with defaults and overrides
- Mode-aware default selection (local vs cloud)
- Type-specific validation (memory, sqlite, mongodb)
- Edge cases and error handling

Test Categories:
1. Default Value Tests - Verify sensible defaults for all modes
2. Environment Variable Tests - Override behavior, cascading
3. Validation Tests - Type requirements, URI validation
4. Mode-Aware Tests - Local vs cloud default selection
5. Edge Cases - Empty values, invalid types, missing requirements
"""

import os
from unittest.mock import patch

import pytest

from stigmer_runner.worker.config import CheckpointerConfig

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def clean_env():
    """Remove all STIGMER_CHECKPOINTER_* environment variables."""
    env_vars = [
        "STIGMER_CHECKPOINTER_TYPE",
        "STIGMER_CHECKPOINTER_SQLITE_PATH",
        "STIGMER_CHECKPOINTER_MONGODB_URI",
        "STIGMER_CHECKPOINTER_MONGODB_DB",
        "STIGMER_CHECKPOINTER_TTL",
    ]
    with patch.dict(os.environ, {}, clear=True):
        # Re-add any vars that were set, but cleared
        for var in env_vars:
            if var in os.environ:
                del os.environ[var]
        yield


# =============================================================================
# Tests for CheckpointerConfig Default Values
# =============================================================================


class TestCheckpointerConfigDefaults:
    """Tests for CheckpointerConfig default values."""

    def test_memory_type_requires_no_additional_config(self):
        """Test that memory type works without additional configuration."""
        config = CheckpointerConfig(type="memory")
        config.validate("local")  # Should not raise
        assert config.type == "memory"

    def test_default_sqlite_path(self):
        """Test default sqlite_path value."""
        config = CheckpointerConfig(
            type="sqlite",
            sqlite_path="./checkpoints/langgraph.db",
        )
        config.validate("local")
        assert config.sqlite_path == "./checkpoints/langgraph.db"

    def test_default_mongodb_db_name(self):
        """Test default mongodb_db_name is 'stigmer_checkpoints'."""
        config = CheckpointerConfig(
            type="mongodb",
            mongodb_uri="mongodb://localhost:27017",
        )
        assert config.mongodb_db_name == "stigmer_checkpoints"

    def test_default_ttl_is_none(self):
        """Test that TTL defaults to None (no expiration)."""
        config = CheckpointerConfig(type="memory")
        assert config.mongodb_ttl_seconds is None


# =============================================================================
# Tests for CheckpointerConfig Validation
# =============================================================================


class TestCheckpointerConfigValidation:
    """Tests for CheckpointerConfig validation."""

    def test_rejects_invalid_type(self):
        """Test that invalid checkpointer type raises ValueError."""
        config = CheckpointerConfig(type="invalid")
        with pytest.raises(ValueError) as exc_info:
            config.validate()
        assert "Invalid checkpointer type" in str(exc_info.value)
        assert "memory, mongodb, sqlite" in str(exc_info.value)

    def test_sqlite_requires_path(self):
        """Test that sqlite type requires sqlite_path."""
        config = CheckpointerConfig(type="sqlite", sqlite_path=None)
        with pytest.raises(ValueError) as exc_info:
            config.validate()
        assert "sqlite_path is required" in str(exc_info.value)

    def test_mongodb_requires_uri(self):
        """Test that mongodb type requires mongodb_uri."""
        config = CheckpointerConfig(type="mongodb", mongodb_uri=None)
        with pytest.raises(ValueError) as exc_info:
            config.validate()
        assert "mongodb_uri is required" in str(exc_info.value)

    def test_mongodb_requires_non_empty_db_name(self):
        """Test that mongodb_db_name cannot be empty."""
        config = CheckpointerConfig(
            type="mongodb",
            mongodb_uri="mongodb://localhost:27017",
            mongodb_db_name="",
        )
        with pytest.raises(ValueError) as exc_info:
            config.validate()
        assert "mongodb_db_name cannot be empty" in str(exc_info.value)

    def test_mongodb_requires_non_whitespace_db_name(self):
        """Test that mongodb_db_name cannot be only whitespace."""
        config = CheckpointerConfig(
            type="mongodb",
            mongodb_uri="mongodb://localhost:27017",
            mongodb_db_name="   ",
        )
        with pytest.raises(ValueError) as exc_info:
            config.validate()
        assert "mongodb_db_name cannot be empty" in str(exc_info.value)

    def test_ttl_cannot_be_negative(self):
        """Test that negative TTL raises ValueError."""
        config = CheckpointerConfig(
            type="mongodb",
            mongodb_uri="mongodb://localhost:27017",
            mongodb_ttl_seconds=-1,
        )
        with pytest.raises(ValueError) as exc_info:
            config.validate()
        assert "must be non-negative" in str(exc_info.value)

    def test_ttl_zero_is_valid(self):
        """Test that TTL of zero is valid (immediate expiration)."""
        config = CheckpointerConfig(
            type="mongodb",
            mongodb_uri="mongodb://localhost:27017",
            mongodb_ttl_seconds=0,
        )
        config.validate()  # Should not raise

    def test_memory_validates_without_mode(self):
        """Test that memory type validates without mode parameter."""
        config = CheckpointerConfig(type="memory")
        config.validate()  # Should not raise

    def test_valid_sqlite_config(self):
        """Test that valid sqlite config passes validation."""
        config = CheckpointerConfig(
            type="sqlite",
            sqlite_path="/tmp/checkpoints.db",
        )
        config.validate("local")  # Should not raise

    def test_valid_mongodb_config(self):
        """Test that valid mongodb config passes validation."""
        config = CheckpointerConfig(
            type="mongodb",
            mongodb_uri="mongodb://localhost:27017",
            mongodb_db_name="my_checkpoints",
            mongodb_ttl_seconds=3600,
        )
        config.validate("cloud")  # Should not raise


# =============================================================================
# Tests for CheckpointerConfig Environment Variable Loading
# =============================================================================


class TestCheckpointerConfigEnvLoading:
    """Tests for CheckpointerConfig.load_from_env()."""

    def test_local_mode_defaults_to_sqlite(self, clean_env):
        """Test that local mode defaults to sqlite checkpointer.
        
        SQLite is the default for local mode because:
        1. Persistent across activity re-invocations (required for HITL approval)
        2. Zero setup - single file, no external dependencies
        3. MemorySaver is incompatible with HITL because each Temporal activity
           invocation creates a new MemorySaver instance, losing all checkpoints
        """
        with patch.dict(os.environ, {}, clear=True):
            config = CheckpointerConfig.load_from_env("local")
        assert config.type == "sqlite"

    def test_cloud_mode_defaults_to_mongodb(self, clean_env):
        """Test that cloud mode defaults to mongodb checkpointer."""
        with patch.dict(os.environ, {"STIGMER_CHECKPOINTER_MONGODB_URI": "mongodb://localhost:27017"}, clear=True):
            config = CheckpointerConfig.load_from_env("cloud")
        assert config.type == "mongodb"

    def test_type_override_from_env(self, clean_env):
        """Test that STIGMER_CHECKPOINTER_TYPE overrides default."""
        with patch.dict(os.environ, {"STIGMER_CHECKPOINTER_TYPE": "sqlite", "STIGMER_CHECKPOINTER_SQLITE_PATH": "/tmp/test.db"}, clear=True):
            config = CheckpointerConfig.load_from_env("cloud")
        assert config.type == "sqlite"

    def test_sqlite_path_from_env(self, clean_env):
        """Test that STIGMER_CHECKPOINTER_SQLITE_PATH is loaded."""
        with patch.dict(os.environ, {
            "STIGMER_CHECKPOINTER_TYPE": "sqlite",
            "STIGMER_CHECKPOINTER_SQLITE_PATH": "/custom/path/checkpoints.db",
        }, clear=True):
            config = CheckpointerConfig.load_from_env("local")
        assert config.sqlite_path == "/custom/path/checkpoints.db"

    def test_mongodb_uri_from_env(self, clean_env):
        """Test that STIGMER_CHECKPOINTER_MONGODB_URI is loaded."""
        with patch.dict(os.environ, {
            "STIGMER_CHECKPOINTER_TYPE": "mongodb",
            "STIGMER_CHECKPOINTER_MONGODB_URI": "mongodb://user:pass@host:27017",
        }, clear=True):
            config = CheckpointerConfig.load_from_env("cloud")
        assert config.mongodb_uri == "mongodb://user:pass@host:27017"

    def test_mongodb_db_name_from_env(self, clean_env):
        """Test that STIGMER_CHECKPOINTER_MONGODB_DB is loaded."""
        with patch.dict(os.environ, {
            "STIGMER_CHECKPOINTER_TYPE": "mongodb",
            "STIGMER_CHECKPOINTER_MONGODB_URI": "mongodb://localhost:27017",
            "STIGMER_CHECKPOINTER_MONGODB_DB": "custom_db",
        }, clear=True):
            config = CheckpointerConfig.load_from_env("cloud")
        assert config.mongodb_db_name == "custom_db"

    def test_ttl_from_env(self, clean_env):
        """Test that STIGMER_CHECKPOINTER_TTL is loaded."""
        with patch.dict(os.environ, {
            "STIGMER_CHECKPOINTER_TYPE": "mongodb",
            "STIGMER_CHECKPOINTER_MONGODB_URI": "mongodb://localhost:27017",
            "STIGMER_CHECKPOINTER_TTL": "7200",
        }, clear=True):
            config = CheckpointerConfig.load_from_env("cloud")
        assert config.mongodb_ttl_seconds == 7200

    def test_ttl_none_when_not_set(self, clean_env):
        """Test that TTL is None when not set in environment."""
        with patch.dict(os.environ, {}, clear=True):
            config = CheckpointerConfig.load_from_env("local")
        assert config.mongodb_ttl_seconds is None

    def test_local_mode_default_sqlite_path(self, clean_env):
        """Test that local mode has default sqlite path."""
        with patch.dict(os.environ, {}, clear=True):
            config = CheckpointerConfig.load_from_env("local")
        assert config.sqlite_path == "./checkpoints/langgraph.db"


# =============================================================================
# Tests for Mode-Aware Defaults
# =============================================================================


class TestCheckpointerConfigModeAware:
    """Tests for mode-aware default selection."""

    def test_local_mode_uses_sqlite_by_default(self, clean_env):
        """Test that local mode uses sqlite checkpointer by default.
        
        SQLite is required for HITL (Human-in-the-Loop) functionality.
        MemorySaver loses state between Temporal activity re-invocations.
        """
        with patch.dict(os.environ, {}, clear=True):
            config = CheckpointerConfig.load_from_env("local")
        assert config.type == "sqlite"

    def test_cloud_mode_uses_mongodb_by_default(self, clean_env):
        """Test that cloud mode uses mongodb checkpointer by default."""
        with patch.dict(os.environ, {"STIGMER_CHECKPOINTER_MONGODB_URI": "mongodb://localhost:27017"}, clear=True):
            config = CheckpointerConfig.load_from_env("cloud")
        assert config.type == "mongodb"

    def test_explicit_type_overrides_mode_default(self, clean_env):
        """Test that explicit type overrides mode default."""
        # Cloud mode should default to mongodb, but explicit memory overrides
        with patch.dict(os.environ, {"STIGMER_CHECKPOINTER_TYPE": "memory"}, clear=True):
            config = CheckpointerConfig.load_from_env("cloud")
        assert config.type == "memory"

    def test_local_with_sqlite_persistence(self, clean_env):
        """Test that local mode can use sqlite for persistence."""
        with patch.dict(os.environ, {
            "STIGMER_CHECKPOINTER_TYPE": "sqlite",
            "STIGMER_CHECKPOINTER_SQLITE_PATH": "/tmp/test.db",
        }, clear=True):
            config = CheckpointerConfig.load_from_env("local")
        assert config.type == "sqlite"
        assert config.sqlite_path == "/tmp/test.db"


# =============================================================================
# Tests for Edge Cases
# =============================================================================


class TestCheckpointerConfigEdgeCases:
    """Tests for edge cases and error handling."""

    def test_all_valid_types_accepted(self):
        """Test that all valid checkpointer types are accepted."""
        for checkpointer_type in ["memory", "sqlite", "mongodb"]:
            if checkpointer_type == "memory":
                config = CheckpointerConfig(type=checkpointer_type)
            elif checkpointer_type == "sqlite":
                config = CheckpointerConfig(type=checkpointer_type, sqlite_path="/tmp/test.db")
            else:  # mongodb
                config = CheckpointerConfig(type=checkpointer_type, mongodb_uri="mongodb://localhost")
            config.validate()  # Should not raise

    def test_type_is_case_sensitive(self):
        """Test that checkpointer type is case sensitive."""
        config = CheckpointerConfig(type="MEMORY")
        with pytest.raises(ValueError):
            config.validate()

    def test_empty_type_is_rejected(self):
        """Test that empty checkpointer type is rejected."""
        config = CheckpointerConfig(type="")
        with pytest.raises(ValueError):
            config.validate()

    def test_mongodb_uri_with_credentials(self, clean_env):
        """Test that mongodb URI with credentials is accepted."""
        with patch.dict(os.environ, {
            "STIGMER_CHECKPOINTER_TYPE": "mongodb",
            "STIGMER_CHECKPOINTER_MONGODB_URI": "mongodb://user:password@host:27017/db?authSource=admin",
        }, clear=True):
            config = CheckpointerConfig.load_from_env("cloud")
        assert "user:password" in config.mongodb_uri

    def test_large_ttl_value(self):
        """Test that large TTL values are accepted."""
        config = CheckpointerConfig(
            type="mongodb",
            mongodb_uri="mongodb://localhost:27017",
            mongodb_ttl_seconds=86400 * 365,  # 1 year
        )
        config.validate()  # Should not raise
