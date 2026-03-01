"""Unit tests for platform_mount display-humanization utilities.

Covers:
- humanize_platform_refs() — $STIGMER_PLATFORM_DIR → .stigmer
- resolve_display_env_vars() — $KEY → resolved value for agent env vars
"""

import pytest

from graphton.core.backends.platform_mount import (
    humanize_platform_refs,
    resolve_display_env_vars,
)


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


class TestResolveDisplayEnvVars:
    """Resolve agent env-var references to their values in display strings."""

    def test_dollar_prefix(self):
        result = resolve_display_env_vars(
            "--path $OUTPUT_DIR", {"OUTPUT_DIR": "."},
        )
        assert result == "--path ."

    def test_brace_prefix(self):
        result = resolve_display_env_vars(
            "--path ${OUTPUT_DIR}", {"OUTPUT_DIR": "out"},
        )
        assert result == "--path out"

    def test_multiple_vars(self):
        result = resolve_display_env_vars(
            "$OUTPUT_DIR/$PROJECT_NAME",
            {"OUTPUT_DIR": "build", "PROJECT_NAME": "demo"},
        )
        assert result == "build/demo"

    def test_none_env_vars_passthrough(self):
        assert resolve_display_env_vars("$OUTPUT_DIR", None) == "$OUTPUT_DIR"

    def test_empty_env_vars_passthrough(self):
        assert resolve_display_env_vars("$OUTPUT_DIR", {}) == "$OUTPUT_DIR"

    def test_empty_text(self):
        assert resolve_display_env_vars("", {"OUTPUT_DIR": "."}) == ""

    def test_secret_key_not_resolved(self):
        """Keys in secret_keys (from is_secret=true) are never expanded."""
        result = resolve_display_env_vars(
            "echo $API_TOKEN",
            {"API_TOKEN": "sk-secret-xxx"},
            secret_keys={"API_TOKEN"},
        )
        assert result == "echo $API_TOKEN"

    def test_non_secret_key_resolved_regardless_of_name(self):
        """Without is_secret=true, even 'password'-like names are resolved."""
        result = resolve_display_env_vars(
            "echo $DB_PASSWORD",
            {"DB_PASSWORD": "hunter2"},
            secret_keys=set(),
        )
        assert result == "echo hunter2"

    def test_mixed_secret_and_non_secret(self):
        result = resolve_display_env_vars(
            "$OUTPUT_DIR $AUTH_TOKEN",
            {"OUTPUT_DIR": ".", "AUTH_TOKEN": "sk-xxx"},
            secret_keys={"AUTH_TOKEN"},
        )
        assert result == ". $AUTH_TOKEN"

    def test_skips_stigmer_platform_dir(self):
        """$STIGMER_PLATFORM_DIR is handled by humanize_platform_refs, not here."""
        result = resolve_display_env_vars(
            "$STIGMER_PLATFORM_DIR/skills",
            {"STIGMER_PLATFORM_DIR": "/tmp/platform"},
        )
        assert result == "$STIGMER_PLATFORM_DIR/skills"

    def test_no_partial_match(self):
        result = resolve_display_env_vars(
            "$OUTPUT_DIR_EXTRA", {"OUTPUT_DIR": "."},
        )
        assert result == "$OUTPUT_DIR_EXTRA"

    def test_combined_with_humanize(self):
        """Full pipeline: humanize first, then resolve remaining vars."""
        text = "python3 $STIGMER_PLATFORM_DIR/run.py --path $OUTPUT_DIR"
        text = humanize_platform_refs(text)
        text = resolve_display_env_vars(text, {"OUTPUT_DIR": "."})
        assert text == "python3 .stigmer/run.py --path ."

    def test_no_secret_keys_defaults_to_empty(self):
        """When secret_keys is None, all keys are resolved."""
        result = resolve_display_env_vars(
            "$API_TOKEN", {"API_TOKEN": "resolved"},
        )
        assert result == "resolved"
