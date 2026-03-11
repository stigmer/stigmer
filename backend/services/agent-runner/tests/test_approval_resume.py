"""Tests for approval resume fixes: Phase 2 enrichment and interrupt_id fallback.

Tests cover:
- _try_enrich_phase1_entry relaxed matching (ignores from_sub_agent mismatch)
- Phase 2 name-based matching broadened scope (searches sub_agent_executions)

These tests verify the defense-in-depth changes that ensure sub-agent approval
flows resume correctly even when the interrupt payload carries incorrect
from_sub_agent metadata.
"""

from unittest.mock import MagicMock

import pytest

from worker.activities.execute_graphton import _try_enrich_phase1_entry


# =============================================================================
# Helpers
# =============================================================================


def _make_pending_approval(
    tool_call_id: str = "tc-001",
    tool_name: str = "execute",
    from_sub_agent: bool = True,
    interrupt_id: str = "",
):
    """Create a mock PendingApproval proto."""
    pa = MagicMock()
    pa.tool_call_id = tool_call_id
    pa.tool_name = tool_name
    pa.from_sub_agent = from_sub_agent
    pa.interrupt_id = interrupt_id
    return pa


def _make_status_builder(pending_approvals):
    """Create a mock StatusBuilder with the given pending_approvals."""
    sb = MagicMock()
    sb.current_status.pending_approvals = list(pending_approvals)
    return sb


# =============================================================================
# TestTryEnrichPhase1Entry — strict and relaxed matching
# =============================================================================


class TestTryEnrichPhase1EntryStrictMatch:
    """Tests for strict matching (tool_name + from_sub_agent)."""

    def test_strict_match_succeeds(self):
        """Exact tool_name + from_sub_agent match sets interrupt_id."""
        pa = _make_pending_approval(
            tool_name="execute", from_sub_agent=True, interrupt_id="",
        )
        sb = _make_status_builder([pa])

        result = _try_enrich_phase1_entry(sb, "execute", True, "intr-abc")

        assert result is True
        assert pa.interrupt_id == "intr-abc"

    def test_strict_match_skips_already_enriched(self):
        """Entries with an existing interrupt_id are not overwritten."""
        pa = _make_pending_approval(
            tool_name="execute", from_sub_agent=True, interrupt_id="intr-existing",
        )
        sb = _make_status_builder([pa])

        result = _try_enrich_phase1_entry(sb, "execute", True, "intr-new")

        assert result is False
        assert pa.interrupt_id == "intr-existing"

    def test_strict_match_wrong_tool_name(self):
        """No match when tool_name differs."""
        pa = _make_pending_approval(
            tool_name="write", from_sub_agent=True, interrupt_id="",
        )
        sb = _make_status_builder([pa])

        result = _try_enrich_phase1_entry(sb, "execute", True, "intr-abc")

        assert result is False
        assert pa.interrupt_id == ""


class TestTryEnrichPhase1EntryRelaxedMatch:
    """Tests for relaxed matching (tool_name only, ignores from_sub_agent).

    This is the defense-in-depth path: the interrupt payload says
    from_sub_agent=False but Phase 1 recorded from_sub_agent=True.
    Pass 1 (strict) fails, Pass 2 (relaxed) succeeds.
    """

    def test_relaxed_match_from_sub_agent_mismatch(self):
        """Relaxed pass matches when from_sub_agent disagrees."""
        pa = _make_pending_approval(
            tool_name="execute", from_sub_agent=True, interrupt_id="",
        )
        sb = _make_status_builder([pa])

        result = _try_enrich_phase1_entry(sb, "execute", False, "intr-xyz")

        assert result is True
        assert pa.interrupt_id == "intr-xyz"

    def test_relaxed_match_reverse_mismatch(self):
        """Relaxed pass matches with the opposite mismatch direction."""
        pa = _make_pending_approval(
            tool_name="write", from_sub_agent=False, interrupt_id="",
        )
        sb = _make_status_builder([pa])

        result = _try_enrich_phase1_entry(sb, "write", True, "intr-rev")

        assert result is True
        assert pa.interrupt_id == "intr-rev"

    def test_strict_takes_precedence_over_relaxed(self):
        """When strict match exists, relaxed pass is not reached."""
        pa_strict = _make_pending_approval(
            tool_call_id="tc-strict",
            tool_name="execute", from_sub_agent=False, interrupt_id="",
        )
        pa_relaxed_candidate = _make_pending_approval(
            tool_call_id="tc-relaxed",
            tool_name="execute", from_sub_agent=True, interrupt_id="",
        )
        sb = _make_status_builder([pa_strict, pa_relaxed_candidate])

        result = _try_enrich_phase1_entry(sb, "execute", False, "intr-abc")

        assert result is True
        assert pa_strict.interrupt_id == "intr-abc"
        assert pa_relaxed_candidate.interrupt_id == ""

    def test_no_match_at_all(self):
        """Neither strict nor relaxed matches when tool_name differs."""
        pa = _make_pending_approval(
            tool_name="read", from_sub_agent=True, interrupt_id="",
        )
        sb = _make_status_builder([pa])

        result = _try_enrich_phase1_entry(sb, "execute", False, "intr-abc")

        assert result is False
        assert pa.interrupt_id == ""

    def test_empty_pending_approvals(self):
        """Returns False on empty pending_approvals."""
        sb = _make_status_builder([])

        result = _try_enrich_phase1_entry(sb, "execute", False, "intr-abc")

        assert result is False

    def test_multiple_entries_first_match_wins(self):
        """First matching entry in each pass gets the interrupt_id."""
        pa1 = _make_pending_approval(
            tool_call_id="tc-1",
            tool_name="execute", from_sub_agent=True, interrupt_id="",
        )
        pa2 = _make_pending_approval(
            tool_call_id="tc-2",
            tool_name="execute", from_sub_agent=True, interrupt_id="",
        )
        sb = _make_status_builder([pa1, pa2])

        result = _try_enrich_phase1_entry(sb, "execute", True, "intr-first")

        assert result is True
        assert pa1.interrupt_id == "intr-first"
        assert pa2.interrupt_id == ""
