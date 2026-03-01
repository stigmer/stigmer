"""Unit tests for platform_mount utilities.

Covers humanize_platform_refs() — the display-layer function that replaces
$STIGMER_PLATFORM_DIR environment variable references with the user-facing
.stigmer virtual-mount prefix.
"""

import pytest

from graphton.core.backends.platform_mount import humanize_platform_refs


class TestHumanizePlatformRefs:
    """Replace $STIGMER_PLATFORM_DIR with .stigmer in display strings."""

    def test_dollar_prefix_with_path(self):
        result = humanize_platform_refs(
            "python3 $STIGMER_PLATFORM_DIR/skills/s/run.py"
        )
        assert result == "python3 .stigmer/skills/s/run.py"

    def test_brace_prefix_with_path(self):
        result = humanize_platform_refs(
            "python3 ${STIGMER_PLATFORM_DIR}/skills/s/run.py"
        )
        assert result == "python3 .stigmer/skills/s/run.py"

    def test_standalone_dollar_prefix(self):
        assert humanize_platform_refs("echo $STIGMER_PLATFORM_DIR") == "echo .stigmer"

    def test_standalone_brace_prefix(self):
        assert humanize_platform_refs("echo ${STIGMER_PLATFORM_DIR}") == "echo .stigmer"

    def test_no_env_var_passthrough(self):
        assert humanize_platform_refs("ls -la") == "ls -la"

    def test_empty_string(self):
        assert humanize_platform_refs("") == ""

    def test_none_passthrough(self):
        assert humanize_platform_refs(None) is None  # type: ignore[arg-type]

    def test_multiple_occurrences(self):
        text = (
            "cp $STIGMER_PLATFORM_DIR/a.txt ${STIGMER_PLATFORM_DIR}/b.txt"
        )
        assert humanize_platform_refs(text) == "cp .stigmer/a.txt .stigmer/b.txt"

    def test_mid_string_replacement(self):
        result = humanize_platform_refs(
            "Execute command: python3 $STIGMER_PLATFORM_DIR/skills/skill-creator/scripts/init_skill.py agent-creator --path ."
        )
        assert result == (
            "Execute command: python3 .stigmer/skills/skill-creator/scripts/init_skill.py agent-creator --path ."
        )

    def test_does_not_match_partial_name(self):
        """Ensure $STIGMER_PLATFORM_DIR_EXTRA is not falsely matched."""
        text = "echo $STIGMER_PLATFORM_DIR_EXTRA"
        assert humanize_platform_refs(text) == text
