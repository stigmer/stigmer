"""
Exceptions for the Stigmer Agent SDK.
"""


class AgentError(Exception):
    """Base exception for all agent SDK errors."""
    
    pass


class ValidationError(AgentError):
    """Raised when validation fails."""
    
    def __init__(self, message: str, field: str = None):
        """
        Initialize validation error.
        
        Args:
            message: Error message
            field: Name of the field that failed validation (optional)
        """
        self.field = field
        super().__init__(message)


class ConversionError(AgentError):
    """Raised when proto conversion fails."""
    
    def __init__(self, message: str, source_type: str = None):
        """
        Initialize conversion error.
        
        Args:
            message: Error message
            source_type: Type being converted (optional)
        """
        self.source_type = source_type
        super().__init__(message)
