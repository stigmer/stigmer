"""Unit tests for tool wrappers (HITL Phase 3B Sub-Task 2).

Tests cover:
- Approval-aware tool wrapper creation
- interrupt() call when approval required
- Handling of approve/skip/reject decisions
- Backward compatibility with non-approval wrappers
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from graphton.core.tool_wrappers import (
    ApprovalRequirement,
    ToolExecutionRejectedError,
    create_approval_aware_tool_wrapper,
)


# =============================================================================
# TestApprovalRequirement - Tests for ApprovalRequirement dataclass
# =============================================================================


class TestApprovalRequirement:
    """Tests for ApprovalRequirement dataclass."""

    def test_default_values(self):
        """Test that default values are correct."""
        req = ApprovalRequirement()
        assert req.requires_approval is False
        assert req.message == ""
        assert req.mcp_server == ""
        assert req.source == "none"

    def test_custom_values(self):
        """Test that custom values are preserved."""
        req = ApprovalRequirement(
            requires_approval=True,
            message="This is dangerous",
            mcp_server="planton-cloud",
            source="mcp_default",
        )
        assert req.requires_approval is True
        assert req.message == "This is dangerous"
        assert req.mcp_server == "planton-cloud"
        assert req.source == "mcp_default"


# =============================================================================
# TestToolExecutionRejectedError - Tests for rejection exception
# =============================================================================


class TestToolExecutionRejectedError:
    """Tests for ToolExecutionRejectedError exception."""

    def test_basic_rejection(self):
        """Test basic rejection error."""
        error = ToolExecutionRejectedError("delete_resource")
        assert error.tool_name == "delete_resource"
        assert "delete_resource" in str(error)
        assert "rejected" in str(error).lower()

    def test_rejection_with_custom_message(self):
        """Test rejection with custom message."""
        error = ToolExecutionRejectedError(
            "delete_resource",
            message="User explicitly rejected this dangerous operation",
        )
        assert error.tool_name == "delete_resource"
        assert error.message == "User explicitly rejected this dangerous operation"
        assert str(error) == "User explicitly rejected this dangerous operation"

    def test_rejection_is_exception(self):
        """Test that rejection error can be raised and caught."""
        with pytest.raises(ToolExecutionRejectedError) as exc_info:
            raise ToolExecutionRejectedError("test_tool")
        assert exc_info.value.tool_name == "test_tool"


# =============================================================================
# TestApprovalAwareWrapperCreation - Tests for wrapper creation
# =============================================================================


class TestApprovalAwareWrapperCreation:
    """Tests for create_approval_aware_tool_wrapper function."""

    def test_creates_wrapper_without_approval_checker(self):
        """Test that wrapper is created without approval checker."""
        # Setup mock middleware
        mock_middleware = MagicMock()
        mock_tool = MagicMock()
        mock_tool.description = "Test tool description"
        mock_middleware.get_tool.return_value = mock_tool
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=None,
        )
        
        assert wrapper is not None
        assert wrapper.name == "test_tool"  # type: ignore[attr-defined]

    def test_creates_wrapper_with_approval_checker(self):
        """Test that wrapper is created with approval checker."""
        mock_middleware = MagicMock()
        mock_tool = MagicMock()
        mock_tool.description = "Test tool description"
        mock_middleware.get_tool.return_value = mock_tool
        
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=False)
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        assert wrapper is not None
        assert wrapper.name == "test_tool"  # type: ignore[attr-defined]

    def test_raises_error_for_unknown_tool(self):
        """Test that error is raised for unknown tool."""
        mock_middleware = MagicMock()
        mock_middleware.get_tool.side_effect = RuntimeError("Tool not found")
        
        with pytest.raises(RuntimeError) as exc_info:
            create_approval_aware_tool_wrapper(
                tool_name="unknown_tool",
                middleware_instance=mock_middleware,
            )
        
        assert "unknown_tool" in str(exc_info.value)


# =============================================================================
# TestApprovalAwareWrapperExecution - Tests for wrapper execution
# =============================================================================


class TestApprovalAwareWrapperExecution:
    """Tests for approval-aware wrapper execution."""

    @pytest.fixture
    def mock_middleware(self):
        """Create mock middleware with async tool."""
        middleware = MagicMock()
        tool = MagicMock()
        tool.description = "Test tool"
        tool.ainvoke = AsyncMock(return_value="tool_result")
        # Set args_schema to None to avoid issubclass() issues with MagicMock
        tool.args_schema = None
        middleware.get_tool.return_value = tool
        return middleware

    @pytest.mark.asyncio
    async def test_executes_without_approval_check(self, mock_middleware):
        """Test that tool executes when no approval checker provided."""
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=None,
        )
        
        # Use ainvoke for StructuredTool
        result = await wrapper.ainvoke({"arg1": "value1"})
        
        assert result == "tool_result"
        mock_middleware.get_tool.return_value.ainvoke.assert_called_once()

    @pytest.mark.asyncio
    async def test_executes_without_approval_required(self, mock_middleware):
        """Test that tool executes when approval not required."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=False)
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        result = await wrapper.ainvoke({"arg1": "value1"})
        
        assert result == "tool_result"

    @pytest.mark.asyncio
    async def test_calls_interrupt_when_approval_required(self, mock_middleware):
        """Test that interrupt() is called when approval is required."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(
                requires_approval=True,
                message="Dangerous operation",
                mcp_server="test-server",
                source="mcp_default",
            )
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        # Mock interrupt at the langgraph.types module level
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve", "approved_by": "user@test.com"}
            
            result = await wrapper.ainvoke({"arg1": "value1"})
        
        # Verify interrupt was called with correct payload
        mock_interrupt.assert_called_once()
        call_args = mock_interrupt.call_args[0][0]
        assert call_args["tool_name"] == "test_tool"
        assert call_args["message"] == "Dangerous operation"
        assert call_args["mcp_server"] == "test-server"
        assert result == "tool_result"

    @pytest.mark.asyncio
    async def test_returns_skip_message_on_skip_action(self, mock_middleware):
        """Test that skip message is returned when user skips."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "skip", "approved_by": "user@test.com"}
            
            result = await wrapper.ainvoke({"arg1": "value1"})
        
        assert "skipped" in result.lower()
        assert "test_tool" in result

    @pytest.mark.asyncio
    async def test_raises_error_on_reject_action(self, mock_middleware):
        """Test that rejection error is raised when user rejects."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "reject", "approved_by": "user@test.com"}
            
            with pytest.raises(ToolExecutionRejectedError) as exc_info:
                await wrapper.ainvoke({"arg1": "value1"})
        
        assert exc_info.value.tool_name == "test_tool"

    @pytest.mark.asyncio
    async def test_raises_error_on_unknown_action(self, mock_middleware):
        """Test that unknown action is treated as rejection."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "unknown_action"}
            
            with pytest.raises(ToolExecutionRejectedError) as exc_info:
                await wrapper.ainvoke({"arg1": "value1"})
        
        assert "unknown" in str(exc_info.value).lower() or "test_tool" in str(exc_info.value)


# =============================================================================
# TestApprovalAwareWrapperArgHandling - Tests for argument handling
# =============================================================================


class TestApprovalAwareWrapperArgHandling:
    """Tests for argument handling in approval-aware wrapper."""

    @pytest.fixture
    def mock_middleware(self):
        """Create mock middleware with async tool."""
        middleware = MagicMock()
        tool = MagicMock()
        tool.description = "Test tool"
        tool.ainvoke = AsyncMock(return_value="tool_result")
        # Set args_schema to None to avoid issubclass() issues with MagicMock
        tool.args_schema = None
        middleware.get_tool.return_value = tool
        return middleware

    @pytest.mark.asyncio
    async def test_unwraps_input_nested_args(self, mock_middleware):
        """Test that input-nested args are unwrapped."""
        captured_args = {}
        
        def checker(name: str, args: dict) -> ApprovalRequirement:
            captured_args.update(args)
            return ApprovalRequirement(requires_approval=False)
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        await wrapper.ainvoke({"input": {"real_arg": "value"}})
        
        # Args should be unwrapped
        assert "real_arg" in captured_args
        assert captured_args["real_arg"] == "value"

    @pytest.mark.asyncio
    async def test_unwraps_kwargs_nested_args(self, mock_middleware):
        """Test that kwargs-nested args are unwrapped."""
        captured_args = {}
        
        def checker(name: str, args: dict) -> ApprovalRequirement:
            captured_args.update(args)
            return ApprovalRequirement(requires_approval=False)
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        await wrapper.ainvoke({"kwargs": {"real_arg": "value"}})
        
        # Args should be unwrapped
        assert "real_arg" in captured_args

    @pytest.mark.asyncio
    async def test_passes_args_to_approval_checker(self, mock_middleware):
        """Test that args are passed to approval checker."""
        captured_args = {}
        
        def checker(name: str, args: dict) -> ApprovalRequirement:
            captured_args["name"] = name
            captured_args["args"] = args
            return ApprovalRequirement(requires_approval=False)
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        await wrapper.ainvoke({"arg1": "value1", "arg2": "value2"})
        
        assert captured_args["name"] == "test_tool"
        assert captured_args["args"]["arg1"] == "value1"
        assert captured_args["args"]["arg2"] == "value2"


# =============================================================================
# TestApprovalAwareWrapperMetadata - Tests for metadata copying
# =============================================================================


class TestApprovalAwareWrapperMetadata:
    """Tests for metadata preservation in approval-aware wrapper."""

    def test_copies_tool_name(self):
        """Test that tool name is copied to wrapper."""
        mock_middleware = MagicMock()
        mock_tool = MagicMock()
        mock_tool.description = "Test description"
        mock_middleware.get_tool.return_value = mock_tool
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="my_tool",
            middleware_instance=mock_middleware,
        )
        
        assert wrapper.name == "my_tool"  # type: ignore[attr-defined]

    def test_copies_tool_description(self):
        """Test that tool description is copied to wrapper."""
        mock_middleware = MagicMock()
        mock_tool = MagicMock()
        mock_tool.description = "This is a test tool for doing things"
        mock_middleware.get_tool.return_value = mock_tool
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
        )
        
        assert wrapper.description == "This is a test tool for doing things"  # type: ignore[attr-defined]

    def test_copies_args_schema(self):
        """Test that args_schema is copied to wrapper."""
        mock_middleware = MagicMock()
        mock_tool = MagicMock()
        mock_tool.description = "Test"
        mock_tool.args_schema = {"type": "object", "properties": {"arg1": {"type": "string"}}}
        mock_middleware.get_tool.return_value = mock_tool
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
        )
        
        assert wrapper.args_schema == mock_tool.args_schema  # type: ignore[attr-defined]


# =============================================================================
# TestApprovalAwareWrapperIntegration - Integration tests
# =============================================================================


class TestApprovalAwareWrapperSubAgent:
    """Tests for sub-agent context in approval-aware wrapper."""

    @pytest.fixture
    def mock_middleware(self):
        """Create mock middleware with async tool."""
        middleware = MagicMock()
        tool = MagicMock()
        tool.description = "Test tool"
        tool.ainvoke = AsyncMock(return_value="tool_result")
        tool.args_schema = None
        middleware.get_tool.return_value = tool
        return middleware

    @pytest.mark.asyncio
    async def test_main_agent_interrupt_has_from_sub_agent_false(self, mock_middleware):
        """Test that main agent interrupt has from_sub_agent=False."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
            sub_agent_name="",  # Empty = main agent
        )
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve"}
            await wrapper.ainvoke({})
        
        call_args = mock_interrupt.call_args[0][0]
        assert call_args["from_sub_agent"] is False
        assert call_args["sub_agent_name"] == ""

    @pytest.mark.asyncio
    async def test_sub_agent_interrupt_has_from_sub_agent_true(self, mock_middleware):
        """Test that sub-agent interrupt has from_sub_agent=True."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
            sub_agent_name="code-reviewer",  # Sub-agent name
        )
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve"}
            await wrapper.ainvoke({})
        
        call_args = mock_interrupt.call_args[0][0]
        assert call_args["from_sub_agent"] is True
        assert call_args["sub_agent_name"] == "code-reviewer"

    @pytest.mark.asyncio
    async def test_sub_agent_context_preserved_in_skip_flow(self, mock_middleware):
        """Test that sub-agent context is preserved even when skipping."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
            sub_agent_name="researcher",
        )
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "skip"}
            result = await wrapper.ainvoke({})
        
        # Verify interrupt was called with sub-agent context
        call_args = mock_interrupt.call_args[0][0]
        assert call_args["from_sub_agent"] is True
        assert call_args["sub_agent_name"] == "researcher"
        # Skip message returned
        assert "skipped" in result.lower()


class TestApprovalAwareWrapperIntegration:
    """Integration tests for approval-aware wrapper."""

    @pytest.fixture
    def mock_middleware(self):
        """Create mock middleware with async tool."""
        middleware = MagicMock()
        tool = MagicMock()
        tool.description = "Delete a cloud resource"
        tool.ainvoke = AsyncMock(return_value={"status": "deleted", "id": "res-123"})
        # Set args_schema to None to avoid issubclass() issues with MagicMock
        tool.args_schema = None
        middleware.get_tool.return_value = tool
        return middleware

    @pytest.mark.asyncio
    async def test_full_approval_flow(self, mock_middleware):
        """Test complete approval flow from check to execution."""
        approval_log = []
        
        def checker(name: str, args: dict) -> ApprovalRequirement:
            approval_log.append(f"Checking {name} with {args}")
            if name == "delete_resource":
                return ApprovalRequirement(
                    requires_approval=True,
                    message=f"Are you sure you want to delete {args.get('resource_id')}?",
                    mcp_server="cloud-api",
                    source="mcp_default",
                )
            return ApprovalRequirement(requires_approval=False)
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="delete_resource",
            middleware_instance=mock_middleware,
            approval_checker=checker,
            mcp_server_name="cloud-api",
        )
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve", "approved_by": "admin@test.com"}
            
            result = await wrapper.ainvoke({"resource_id": "res-123"})
        
        # Verify the full flow
        assert len(approval_log) == 1
        assert "delete_resource" in approval_log[0]
        mock_interrupt.assert_called_once()
        interrupt_payload = mock_interrupt.call_args[0][0]
        assert "res-123" in interrupt_payload["message"]
        assert result == {"status": "deleted", "id": "res-123"}

    @pytest.mark.asyncio
    async def test_multiple_tools_different_policies(self, mock_middleware):
        """Test that different tools can have different approval policies."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            if name == "delete_resource":
                return ApprovalRequirement(requires_approval=True, message="Confirm delete?")
            elif name == "list_resources":
                return ApprovalRequirement(requires_approval=False)
            return ApprovalRequirement(requires_approval=False)
        
        delete_wrapper = create_approval_aware_tool_wrapper(
            tool_name="delete_resource",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        list_wrapper = create_approval_aware_tool_wrapper(
            tool_name="list_resources",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        # list_resources should execute without interrupt
        result = await list_wrapper.ainvoke({})
        assert result == {"status": "deleted", "id": "res-123"}  # Mock returns same for both
        
        # delete_resource should require interrupt
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve"}
            await delete_wrapper.ainvoke({})
        
        mock_interrupt.assert_called_once()
