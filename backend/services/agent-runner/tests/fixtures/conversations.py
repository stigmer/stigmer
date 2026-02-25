"""Conversation fixtures for LangMem summarization evaluation.

This module provides realistic, fact-dense conversation scenarios for testing
the quality and reliability of LangMem's summarization capabilities.

Each conversation fixture:
- Contains 50+ messages to trigger summarization
- Includes critical facts that must be preserved after summarization
- Represents realistic agent-user interactions
- Includes tool calls where appropriate for tool handling tests

Design Principles:
- Facts are distributed throughout the conversation, not clustered at start
- Conversations include natural dialogue patterns (questions, clarifications, corrections)
- Key facts appear in different message types (human, AI, tool results)
- Conversations simulate real-world complexity with context switches
"""

import uuid
from dataclasses import dataclass, field

from langchain_core.messages import (
    AIMessage,
    AnyMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

# =============================================================================
# Critical Facts Registry
# =============================================================================

CRITICAL_FACTS: dict[str, list[str]] = {
    # Key facts that must be preserved in summaries.
    # These are designed to match both config-style (key=value) and natural language summaries.
    "database": [
        "db.prod.example.com",          # Database hostname
        "verify-full",                   # SSL mode
        "5432",                          # Port number
        "/etc/ssl/certs/db.crt",        # SSL certificate path
        "stigmer_production",            # Database name
        "public",                        # Schema name
        "20",                            # Pool size (just the number to match "Pool Size: 20" or "pool_size=20")
        "100",                           # Max connections
        "30",                            # Statement timeout (seconds)
        "scram-sha-256",                 # Authentication method
    ],
    "api": [
        "abc123xyz789",                  # Client ID value
        "1000",                          # Rate limit per hour
        "/oauth/token",                  # Token endpoint
        "api.auth.example.com",          # Auth server hostname
        "Bearer",                        # Token type
        "7",                             # Refresh token TTL (days)
        "read:users",                    # Scope part 1
        "write:data",                    # Scope part 2
        "app.example.com/callback",      # Redirect URI
        "PKCE",                          # PKCE requirement (case insensitive match)
    ],
    "infrastructure": [
        "production",                    # Namespace
        "replicas",                      # Must mention replicas
        "3",                             # Number of replicas
        "2Gi",                           # Memory limit
        "500m",                          # CPU request
        "stigmer-service",               # Service name
        "ClusterIP",                     # Service type
        "8080",                          # Port
        "/health/ready",                 # Readiness path
        "/health/live",                  # Liveness path
    ],
    "tool_calls": [
        "execute_sql",                   # Tool name 1
        "check_connection",              # Tool name 2
        "list_tables",                   # Tool name 3
        "PostgreSQL",                    # Database type
        "15.4",                          # PostgreSQL version
        "index",                         # Indexes were created
    ],
}


# =============================================================================
# Conversation Data Classes
# =============================================================================

def _add_message_ids(messages: list[AnyMessage]) -> list[AnyMessage]:
    """Add unique IDs to messages that don't have them.
    
    LangMem's summarize_messages requires all messages to have an 'id' field.
    This function adds UUIDs to any messages missing IDs.
    
    Args:
        messages: List of LangChain messages
        
    Returns:
        Same messages with IDs added where missing
    """
    result = []
    for i, msg in enumerate(messages):
        if hasattr(msg, 'id') and msg.id:
            result.append(msg)
        else:
            # Create new message with ID
            msg_id = f"msg_{uuid.uuid4().hex[:12]}"
            if isinstance(msg, SystemMessage):
                result.append(SystemMessage(content=msg.content, id=msg_id))
            elif isinstance(msg, HumanMessage):
                result.append(HumanMessage(content=msg.content, id=msg_id))
            elif isinstance(msg, AIMessage):
                result.append(AIMessage(
                    content=msg.content, 
                    id=msg_id,
                    tool_calls=getattr(msg, 'tool_calls', None) or []
                ))
            elif isinstance(msg, ToolMessage):
                result.append(ToolMessage(
                    content=msg.content,
                    id=msg_id,
                    tool_call_id=msg.tool_call_id,
                    name=getattr(msg, 'name', None)
                ))
            else:
                # Fallback: try to copy and add id
                result.append(msg)
    return result


@dataclass
class ConversationFixture:
    """A complete conversation fixture for evaluation testing.
    
    Attributes:
        name: Human-readable name for the conversation
        category: Category for fact lookup (database, api, infrastructure, tool_calls)
        messages: List of LangChain messages
        critical_facts: List of facts that must be preserved after summarization
        description: Description of what this conversation tests
    """
    name: str
    category: str
    messages: list[AnyMessage]
    critical_facts: list[str] = field(default_factory=list)
    description: str = ""
    
    def __post_init__(self):
        if not self.critical_facts:
            self.critical_facts = CRITICAL_FACTS.get(self.category, [])
        # Ensure all messages have IDs for LangMem compatibility
        self.messages = _add_message_ids(self.messages)


# =============================================================================
# Conversation Factory
# =============================================================================

class ConversationFactory:
    """Factory for creating conversation fixtures.
    
    Provides methods to create realistic conversation scenarios for
    different evaluation purposes: quality testing, tool handling,
    multi-cycle stability, and performance benchmarks.
    """
    
    @staticmethod
    def _generate_tool_call_id() -> str:
        """Generate a unique tool call ID."""
        return f"call_{uuid.uuid4().hex[:12]}"
    
    @classmethod
    def create_all(cls) -> list[ConversationFixture]:
        """Create all standard conversation fixtures.
        
        Returns:
            List of all conversation fixtures for comprehensive evaluation.
        """
        return [
            create_database_conversation(),
            create_api_integration_conversation(),
            create_infrastructure_conversation(),
            create_tool_heavy_conversation(),
        ]
    
    @classmethod
    def create_minimal(cls) -> ConversationFixture:
        """Create a minimal conversation for basic testing.
        
        Returns:
            A short conversation with a few key facts.
        """
        return ConversationFixture(
            name="minimal_test",
            category="database",
            description="Minimal conversation for basic functionality testing",
            messages=[
                SystemMessage(content="You are a helpful database administrator."),
                HumanMessage(content="What's the production database host?"),
                AIMessage(content="The production database is at db.prod.example.com on port 5432."),
                HumanMessage(content="What SSL mode should I use?"),
                AIMessage(content="Use ssl_mode=verify-full for production."),
            ],
            critical_facts=["db.prod.example.com", "port=5432", "verify-full"],
        )


# =============================================================================
# Database Configuration Conversation (60+ messages)
# =============================================================================

def create_database_conversation() -> ConversationFixture:
    """Create a realistic database configuration conversation.
    
    This conversation simulates a user setting up a PostgreSQL database
    connection with SSL, connection pooling, and various optimizations.
    
    Key facts distributed throughout:
    - Host: db.prod.example.com
    - Port: 5432
    - SSL mode: verify-full
    - SSL cert: /etc/ssl/certs/db.crt
    - Pool size: 20
    - Max connections: 100
    - Statement timeout: 30s
    - Connect timeout: 10
    - Database: stigmer_production
    - Schema: public
    
    Returns:
        ConversationFixture with 60+ messages and database-related critical facts.
    """
    messages: list[AnyMessage] = [
        SystemMessage(content="""You are an expert database administrator helping configure PostgreSQL connections.
Always provide specific, actionable configuration values.
Prioritize security best practices."""),
        
        # Phase 1: Initial setup questions (messages 1-15)
        HumanMessage(content="I need to set up a PostgreSQL connection for our production environment."),
        AIMessage(content="I'll help you configure a secure PostgreSQL connection. Let me start by understanding your requirements. What's the hostname of your database server?"),
        HumanMessage(content="The hostname is db.prod.example.com"),
        AIMessage(content="Great, db.prod.example.com is noted. What port is PostgreSQL running on? The default is 5432."),
        HumanMessage(content="We're using the default port 5432"),
        AIMessage(content="Perfect, port=5432 it is. Now for security - are you using SSL/TLS for the connection? This is strongly recommended for production."),
        HumanMessage(content="Yes, we need SSL. What mode should I use?"),
        AIMessage(content="For production environments, I recommend ssl_mode=verify-full. This ensures:\n1. The connection is encrypted\n2. The server certificate is validated\n3. The hostname matches the certificate\n\nDo you have your SSL certificate path ready?"),
        HumanMessage(content="Yes, it's at /etc/ssl/certs/db.crt"),
        AIMessage(content="Excellent! Your SSL certificate at ssl_cert=/etc/ssl/certs/db.crt will be used to verify the server. Now let's configure the connection pool."),
        HumanMessage(content="What pool size do you recommend?"),
        AIMessage(content="For a typical production workload, I recommend pool_size=20 as a starting point. This provides good concurrency without overwhelming the database."),
        HumanMessage(content="That sounds reasonable. What about max connections?"),
        AIMessage(content="I'd set max_connections=100 on the server side. This leaves headroom for admin connections while supporting multiple application instances."),
        HumanMessage(content="Got it. Should I set any timeouts?"),
        
        # Phase 2: Timeout configuration (messages 16-30)
        AIMessage(content="Yes, timeouts are crucial for reliability. Let me recommend:\n- statement_timeout=30s for query execution limits\n- connect_timeout=10 for connection establishment"),
        HumanMessage(content="What happens if a query exceeds 30 seconds?"),
        AIMessage(content="When statement_timeout=30s is exceeded, PostgreSQL will cancel the query and return an error. This prevents runaway queries from consuming resources."),
        HumanMessage(content="Can I set different timeouts per query?"),
        AIMessage(content="Yes, you can override statement_timeout per session or per transaction. But the default of 30s is a good safety net."),
        HumanMessage(content="What about idle connection timeout?"),
        AIMessage(content="For idle connections, consider idle_in_transaction_session_timeout. I'd set it to 5 minutes to prevent long-held transactions."),
        HumanMessage(content="We have some batch jobs that run longer. How do I handle those?"),
        AIMessage(content="For batch jobs, either:\n1. Increase timeout in the specific session\n2. Use a separate connection pool with higher limits\n3. Set statement_timeout=0 (no limit) for the job connection"),
        HumanMessage(content="I'll use a separate pool for batch. What's the database name I should connect to?"),
        AIMessage(content="Your production database name should be descriptive. Based on your setup, use database=stigmer_production."),
        HumanMessage(content="And the schema?"),
        AIMessage(content="Use schema=public for the main application tables. You can always create additional schemas for organization later."),
        HumanMessage(content="How do I verify the connection works?"),
        AIMessage(content="You can test with: psql 'host=db.prod.example.com port=5432 dbname=stigmer_production sslmode=verify-full sslcert=/etc/ssl/certs/db.crt'"),
        HumanMessage(content="What if the SSL handshake fails?"),
        
        # Phase 3: Troubleshooting (messages 31-45)
        AIMessage(content="SSL handshake failures with verify-full typically mean:\n1. Certificate doesn't match hostname\n2. Certificate expired\n3. CA chain incomplete\n\nCheck that the cert at /etc/ssl/certs/db.crt is valid."),
        HumanMessage(content="The cert is valid. How do I check if the hostname matches?"),
        AIMessage(content="Run: openssl s_client -connect db.prod.example.com:5432 -starttls postgres\n\nLook for 'CN=' or 'SAN' entries matching your hostname."),
        HumanMessage(content="Got it. What about connection refused errors?"),
        AIMessage(content="Connection refused usually means:\n1. PostgreSQL not running\n2. Firewall blocking port 5432\n3. listen_addresses not including your client IP\n\nVerify port=5432 is open from your client."),
        HumanMessage(content="We use a private network. Are there pg_hba.conf settings I need?"),
        AIMessage(content="Yes, for your production setup at db.prod.example.com, add to pg_hba.conf:\n\nhostssl stigmer_production app_user 10.0.0.0/8 scram-sha-256"),
        HumanMessage(content="What authentication method is best?"),
        AIMessage(content="Use scram-sha-256 for password auth. It's more secure than md5 and works well with pool_size=20 and connection pooling."),
        HumanMessage(content="Can I use certificate authentication instead?"),
        AIMessage(content="Yes! With ssl_cert=/etc/ssl/certs/db.crt, you can enable cert auth. Change pg_hba.conf to 'cert' method and map CN to users."),
        HumanMessage(content="I'll stick with password for now. How do I rotate credentials?"),
        AIMessage(content="For credential rotation:\n1. Create new password\n2. Update connection string\n3. Restart app to pick up new password\n4. Drop old password\n\nWith pool_size=20, you might see brief connection errors during restart."),
        HumanMessage(content="Can we do zero-downtime rotation?"),
        AIMessage(content="Yes, using dual credentials:\n1. Add new password (user can auth with either)\n2. Update apps one by one\n3. Remove old password after all apps updated"),
        HumanMessage(content="That's clever. What monitoring should I set up?"),
        
        # Phase 4: Monitoring and optimization (messages 46-60)
        AIMessage(content="Essential monitoring for your database=stigmer_production:\n1. Connection count vs max_connections=100\n2. Query latency (p95 < statement_timeout=30s)\n3. Pool utilization (active/pool_size=20)\n4. SSL cert expiry"),
        HumanMessage(content="What metrics should trigger alerts?"),
        AIMessage(content="Alert when:\n- Connections > 80 (you're at max_connections=100)\n- Pool wait time > 1s\n- Error rate > 1%\n- SSL cert expires in < 30 days"),
        HumanMessage(content="How do I check current connection count?"),
        AIMessage(content="Query pg_stat_activity:\n\nSELECT count(*) FROM pg_stat_activity WHERE datname='stigmer_production';\n\nCompare against max_connections=100."),
        HumanMessage(content="What about slow queries?"),
        AIMessage(content="Enable pg_stat_statements and log queries exceeding statement_timeout=30s:\n\nSET log_min_duration_statement = '1s';\n\nThis logs any query over 1 second."),
        HumanMessage(content="Should I use connection pooling at the app level too?"),
        AIMessage(content="Yes! App-level pooling with pool_size=20 combined with PgBouncer gives best results. PgBouncer handles connection reuse across app restarts."),
        HumanMessage(content="What PgBouncer mode should I use?"),
        AIMessage(content="Use transaction mode for most apps. It releases connections after each transaction, maximizing pool efficiency while maintaining session state."),
        HumanMessage(content="Does that work with prepared statements?"),
        AIMessage(content="Transaction mode has limited prepared statement support. For heavy prepared statement usage, use session mode or handle at app level."),
        HumanMessage(content="We don't use many prepared statements. Transaction mode it is."),
        AIMessage(content="Great choice. Your final configuration summary:\n- Host: db.prod.example.com\n- Port: port=5432\n- Database: database=stigmer_production\n- Schema: schema=public\n- SSL: ssl_mode=verify-full\n- SSL Cert: ssl_cert=/etc/ssl/certs/db.crt\n- Pool: pool_size=20\n- Max: max_connections=100\n- Query timeout: statement_timeout=30s\n- Connect timeout: connect_timeout=10"),
        HumanMessage(content="Perfect! One more question - what about read replicas?"),
        
        # Phase 5: Advanced topics (messages 61-65)
        AIMessage(content="For read replicas, configure a separate connection string. Your primary remains db.prod.example.com, and you'd add db-replica.prod.example.com for reads."),
        HumanMessage(content="Should the replica have the same pool settings?"),
        AIMessage(content="Yes, use the same pool_size=20 and ssl_mode=verify-full for consistency. You might increase max_connections=100 on replicas since they only handle reads."),
        HumanMessage(content="Great, I think I have everything I need now."),
        AIMessage(content="Excellent! Your production PostgreSQL setup is now configured with security best practices:\n\n1. Secure connection to db.prod.example.com:5432\n2. Strong SSL with verify-full mode\n3. Efficient pooling (pool_size=20)\n4. Safe timeouts (statement_timeout=30s, connect_timeout=10)\n5. Proper monitoring foundations\n\nRemember to backup your ssl_cert=/etc/ssl/certs/db.crt and rotate credentials regularly."),
        HumanMessage(content="Thanks for all the help!"),
        AIMessage(content="You're welcome! Your stigmer_production database on db.prod.example.com is ready for production. Feel free to reach out if you have questions about schema=public migrations or performance tuning."),
    ]
    
    return ConversationFixture(
        name="database_configuration",
        category="database",
        messages=messages,
        description="PostgreSQL database configuration with SSL, pooling, and timeouts",
    )


# =============================================================================
# API Integration Conversation (55+ messages)
# =============================================================================

def create_api_integration_conversation() -> ConversationFixture:
    """Create a realistic API integration conversation.
    
    This conversation simulates a user setting up OAuth2 authentication
    with rate limiting, token management, and security best practices.
    
    Key facts distributed throughout:
    - Client ID: abc123xyz789
    - Rate limit: 1000/hour
    - Token endpoint: /oauth/token
    - Auth server: api.auth.example.com
    - Token type: Bearer
    - Refresh TTL: 7d
    - Access TTL: 1h
    - Scopes: read:users write:data
    - Redirect URI: https://app.example.com/callback
    - PKCE required: true
    
    Returns:
        ConversationFixture with 55+ messages and API-related critical facts.
    """
    messages: list[AnyMessage] = [
        SystemMessage(content="""You are an expert API security engineer helping configure OAuth2 authentication.
Prioritize security and provide specific configuration values.
Always recommend PKCE for public clients."""),
        
        # Phase 1: OAuth2 basics (messages 1-15)
        HumanMessage(content="I need to set up OAuth2 authentication for our application."),
        AIMessage(content="I'll help you configure a secure OAuth2 integration. First, let me understand your setup. What type of application is this - web app, mobile app, or service-to-service?"),
        HumanMessage(content="It's a web application that will be accessing user data."),
        AIMessage(content="For a web app accessing user data, you'll use the Authorization Code flow with PKCE. First, you need to register your client. Have you received your client credentials?"),
        HumanMessage(content="Yes, our client_id is abc123xyz789"),
        AIMessage(content="Great, client_id=abc123xyz789 is noted. Since this is a web app, I strongly recommend enabling pkce_required=true for additional security. PKCE prevents authorization code interception attacks."),
        HumanMessage(content="What's the authorization server URL?"),
        AIMessage(content="You'll be connecting to api.auth.example.com for all OAuth2 operations. The main endpoints are:\n- Authorization: /oauth/authorize\n- Token: /oauth/token\n- Userinfo: /oauth/userinfo"),
        HumanMessage(content="What redirect URI should I configure?"),
        AIMessage(content="For your web app, set redirect_uri=https://app.example.com/callback. This must be HTTPS and exactly match what's registered with the OAuth2 provider."),
        HumanMessage(content="Can I have multiple redirect URIs?"),
        AIMessage(content="Yes, you can register multiple, but for security, keep them minimal. Your primary redirect_uri=https://app.example.com/callback should handle most cases."),
        HumanMessage(content="What scopes should I request?"),
        AIMessage(content="Based on accessing user data, request scope=read:users write:data. Only request what you need - principle of least privilege."),
        HumanMessage(content="What if I need more scopes later?"),
        AIMessage(content="You can request additional scopes incrementally. Start with scope=read:users write:data, then prompt for more when specific features require them."),
        HumanMessage(content="How do I request the authorization code?"),
        AIMessage(content="Redirect users to:\n\nhttps://api.auth.example.com/oauth/authorize?client_id=abc123xyz789&redirect_uri=https://app.example.com/callback&response_type=code&scope=read:users write:data&code_challenge=<PKCE_CHALLENGE>&code_challenge_method=S256"),
        HumanMessage(content="What's the code_challenge?"),
        
        # Phase 2: PKCE and tokens (messages 16-30)
        AIMessage(content="For pkce_required=true, generate a code_verifier (43-128 chars random string), then:\n1. Hash with SHA256\n2. Base64URL encode\n3. That's your code_challenge\n\nSend code_challenge in authorize, code_verifier in token exchange."),
        HumanMessage(content="Got it. How do I exchange the code for tokens?"),
        AIMessage(content="POST to /oauth/token:\n\n```\nPOST https://api.auth.example.com/oauth/token\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=authorization_code\n&code=<AUTH_CODE>\n&redirect_uri=https://app.example.com/callback\n&client_id=abc123xyz789\n&code_verifier=<YOUR_VERIFIER>\n```"),
        HumanMessage(content="What tokens do I get back?"),
        AIMessage(content="You'll receive:\n- access_token (Bearer token for API calls)\n- refresh_token (for getting new access tokens)\n- expires_in (usually access_token_ttl=1h)\n- token_type: Bearer"),
        HumanMessage(content="How long are the tokens valid?"),
        AIMessage(content="Default token lifetimes:\n- Access token: access_token_ttl=1h (1 hour)\n- Refresh token: refresh_token_ttl=7d (7 days)\n\nAlways refresh before expiry for seamless user experience."),
        HumanMessage(content="How do I refresh the access token?"),
        AIMessage(content="POST to /oauth/token with grant_type=refresh_token:\n\n```\nPOST https://api.auth.example.com/oauth/token\nclient_id=abc123xyz789\ngrant_type=refresh_token\nrefresh_token=<YOUR_REFRESH_TOKEN>\n```"),
        HumanMessage(content="Does the refresh token change each time?"),
        AIMessage(content="Yes, for security, refresh token rotation is enabled. Each refresh gives you a new refresh_token with refresh_token_ttl=7d. Store the new one."),
        HumanMessage(content="What if the refresh fails?"),
        AIMessage(content="If refresh fails (expired or revoked), redirect user to re-authenticate via api.auth.example.com. Don't show errors containing client_id=abc123xyz789."),
        HumanMessage(content="How should I store the tokens?"),
        AIMessage(content="For web apps:\n- Store access_token in memory (XSS protection)\n- Store refresh_token in HTTP-only, Secure cookie\n- Never store in localStorage"),
        HumanMessage(content="What about server-side storage?"),
        AIMessage(content="Server-side, encrypt tokens at rest. Use refresh_token_ttl=7d as your cache TTL. Implement proper key rotation."),
        HumanMessage(content="Are there any rate limits I should know about?"),
        
        # Phase 3: Rate limiting (messages 31-45)
        AIMessage(content="Yes! api.auth.example.com enforces 1000/hour rate limit per client_id. This applies to all OAuth2 operations including token refreshes."),
        HumanMessage(content="What happens if I hit the limit?"),
        AIMessage(content="You'll receive HTTP 429 with Retry-After header. At 1000/hour, that's ~16 requests/minute. Cache tokens to stay under."),
        HumanMessage(content="How do I track my usage?"),
        AIMessage(content="Each response includes headers:\n- X-RateLimit-Limit: 1000\n- X-RateLimit-Remaining: <count>\n- X-RateLimit-Reset: <timestamp>"),
        HumanMessage(content="Can we get a higher limit?"),
        AIMessage(content="Contact support to increase from 1000/hour. Enterprise plans offer up to 10,000/hour. For now, optimize with caching."),
        HumanMessage(content="What's the best caching strategy?"),
        AIMessage(content="With access_token_ttl=1h, cache tokens for 55 minutes, then proactively refresh. This avoids expired token errors and reduces refresh calls."),
        HumanMessage(content="Should I cache at user level or app level?"),
        AIMessage(content="Cache per-user since tokens are user-specific. With scope=read:users write:data, each user needs their own token set."),
        HumanMessage(content="What about concurrent requests?"),
        AIMessage(content="Use token locking to prevent race conditions during refresh. Only one thread should refresh at a time; others wait for the new Bearer token."),
        HumanMessage(content="How do I handle token expiry during a request?"),
        AIMessage(content="Implement retry with refresh:\n1. Request fails with 401\n2. Check if token expired\n3. Refresh token\n4. Retry original request with new Bearer token"),
        HumanMessage(content="What errors should I watch for?"),
        AIMessage(content="Key OAuth2 errors from api.auth.example.com:\n- invalid_grant: Refresh token expired (re-auth needed)\n- invalid_client: client_id=abc123xyz789 issue\n- invalid_scope: scope=read:users write:data not allowed\n- rate_limit_exceeded: 1000/hour hit"),
        HumanMessage(content="How do I log these securely?"),
        
        # Phase 4: Security and monitoring (messages 46-55)
        AIMessage(content="Log error types and timestamps, but NEVER log:\n- Tokens (access or refresh)\n- client_secret (if you have one)\n- Authorization codes\n- PKCE verifiers"),
        HumanMessage(content="We don't have a client_secret. Is that okay?"),
        AIMessage(content="Correct! For public clients (web apps), pkce_required=true replaces client_secret. Your client_id=abc123xyz789 with PKCE is secure."),
        HumanMessage(content="Should I validate tokens?"),
        AIMessage(content="Yes, validate access tokens before use:\n1. Check expiry (access_token_ttl=1h)\n2. Verify signature if JWT\n3. Confirm scope=read:users write:data matches your needs"),
        HumanMessage(content="Is there an introspection endpoint?"),
        AIMessage(content="Yes, api.auth.example.com/oauth/introspect lets you check token validity. But this counts against 1000/hour, so prefer local JWT validation."),
        HumanMessage(content="How do I revoke tokens on logout?"),
        AIMessage(content="POST to /oauth/revoke:\n\n```\nPOST https://api.auth.example.com/oauth/revoke\nclient_id=abc123xyz789\ntoken=<REFRESH_TOKEN>\ntoken_type_hint=refresh_token\n```"),
        HumanMessage(content="Does revoking refresh_token also revoke access_token?"),
        AIMessage(content="Yes, revoking refresh_token invalidates all associated tokens. The access_token becomes invalid immediately on api.auth.example.com."),
        HumanMessage(content="Great, I think I have everything I need."),
        AIMessage(content="Excellent! Your OAuth2 configuration summary:\n\n- Server: api.auth.example.com\n- Client: client_id=abc123xyz789\n- Flow: Authorization Code with pkce_required=true\n- Callback: redirect_uri=https://app.example.com/callback\n- Scopes: scope=read:users write:data\n- Access Token: Bearer type, access_token_ttl=1h\n- Refresh Token: refresh_token_ttl=7d with rotation\n- Rate Limit: 1000/hour\n\nYou're ready to integrate!"),
        HumanMessage(content="Thanks for the detailed walkthrough!"),
        AIMessage(content="You're welcome! Your integration with api.auth.example.com using client_id=abc123xyz789 and PKCE is secure. Remember to handle /oauth/token errors gracefully and respect the 1000/hour rate limit."),
    ]
    
    return ConversationFixture(
        name="api_integration",
        category="api",
        messages=messages,
        description="OAuth2 API integration with PKCE, rate limiting, and token management",
    )


# =============================================================================
# Infrastructure Conversation (50+ messages)
# =============================================================================

def create_infrastructure_conversation() -> ConversationFixture:
    """Create a realistic infrastructure setup conversation.
    
    This conversation simulates a user configuring Kubernetes deployments
    with resource limits, health checks, and networking.
    
    Key facts distributed throughout:
    - Namespace: production
    - Replicas: 3
    - Memory limit: 2Gi
    - CPU request: 500m
    - CPU limit: 2000m
    - Service name: stigmer-service
    - Service type: ClusterIP
    - Port: 8080
    - Readiness path: /health/ready
    - Liveness path: /health/live
    
    Returns:
        ConversationFixture with 50+ messages and infrastructure-related critical facts.
    """
    messages: list[AnyMessage] = [
        SystemMessage(content="""You are a Kubernetes expert helping configure production deployments.
Provide specific resource values and YAML configurations.
Prioritize reliability and proper health checks."""),
        
        # Phase 1: Basic deployment (messages 1-15)
        HumanMessage(content="I need to deploy our service to Kubernetes production."),
        AIMessage(content="I'll help you configure a production-ready Kubernetes deployment. Let's start with the basics. What namespace will this be deployed to?"),
        HumanMessage(content="We'll use namespace=production"),
        AIMessage(content="Good choice using namespace=production. Namespaces provide isolation. What's the service name?"),
        HumanMessage(content="The service is called stigmer-service"),
        AIMessage(content="stigmer-service noted. How many replicas do you want for high availability?"),
        HumanMessage(content="We need replicas=3 for redundancy"),
        AIMessage(content="Perfect, replicas=3 gives you N+1 redundancy. If one pod fails, two remain. Now let's configure resources. What are your memory requirements?"),
        HumanMessage(content="Each instance needs about 1.5GB memory"),
        AIMessage(content="For 1.5GB actual usage, I recommend memory_limit=2Gi to provide headroom. This prevents OOMKill while allowing for traffic spikes."),
        HumanMessage(content="What about CPU?"),
        AIMessage(content="For CPU, use:\n- cpu_request=500m (guaranteed)\n- cpu_limit=2000m (burstable)\n\nThis ensures each pod gets 0.5 cores minimum, can burst to 2 cores."),
        HumanMessage(content="Will 500m be enough for steady state?"),
        AIMessage(content="Yes, cpu_request=500m is typically enough for web services. The cpu_limit=2000m handles request spikes. Monitor P95 CPU to tune."),
        HumanMessage(content="How do I set memory requests?"),
        AIMessage(content="Set memory request equal to limit for predictability:\n\n```yaml\nresources:\n  requests:\n    memory: \"2Gi\"\n    cpu: \"500m\"\n  limits:\n    memory: \"2Gi\"\n    cpu: \"2000m\"\n```"),
        HumanMessage(content="Why same for memory but different for CPU?"),
        
        # Phase 2: Resource configuration (messages 16-30)
        AIMessage(content="Memory is incompressible - if a pod exceeds memory_limit=2Gi, it's OOMKilled. CPU is compressible - exceeding cpu_request=500m just means throttling, not termination."),
        HumanMessage(content="Makes sense. What about QoS class?"),
        AIMessage(content="With request=limit for memory and request<limit for CPU, you get 'Burstable' QoS. For 'Guaranteed', set all requests=limits. Burstable is fine for stigmer-service."),
        HumanMessage(content="How do I configure health checks?"),
        AIMessage(content="You need two probes:\n1. Liveness: Is the pod alive? Use liveness_path=/health/live\n2. Readiness: Can it serve traffic? Use readiness_path=/health/ready"),
        HumanMessage(content="What's the difference in behavior?"),
        AIMessage(content="- Liveness at liveness_path=/health/live: Failing restarts the pod\n- Readiness at readiness_path=/health/ready: Failing removes from service, no restart\n\nThis lets pods recover without restart."),
        HumanMessage(content="What port do these check?"),
        AIMessage(content="Configure for port=8080:\n\n```yaml\nlivenessProbe:\n  httpGet:\n    path: /health/live\n    port: 8080\nreadinessProbe:\n  httpGet:\n    path: /health/ready\n    port: 8080\n```"),
        HumanMessage(content="What about probe timing?"),
        AIMessage(content="For stigmer-service with replicas=3:\n\n```yaml\ninitialDelaySeconds: 10\nperiodSeconds: 10\ntimeoutSeconds: 5\nfailureThreshold: 3\n```\n\nThis gives 30s before marking unhealthy."),
        HumanMessage(content="Should readiness and liveness have same timing?"),
        AIMessage(content="For readiness_path=/health/ready, use shorter failureThreshold (2). You want quick traffic removal. For liveness_path=/health/live, use 3 to avoid restart flapping."),
        HumanMessage(content="How do I expose the service?"),
        AIMessage(content="Create a Service resource with type ClusterIP:\n\n```yaml\napiVersion: v1\nkind: Service\nmetadata:\n  name: stigmer-service\n  namespace: production\nspec:\n  type: ClusterIP\n  ports:\n    - port: 8080\n  selector:\n    app: stigmer-service\n```"),
        HumanMessage(content="Why ClusterIP instead of LoadBalancer?"),
        
        # Phase 3: Networking (messages 31-45)
        AIMessage(content="ClusterIP is internal-only - more secure for namespace=production. Use an Ingress for external traffic. This gives you:\n- TLS termination\n- Path-based routing\n- Rate limiting"),
        HumanMessage(content="How do I connect from other services?"),
        AIMessage(content="Internal DNS: stigmer-service.production.svc.cluster.local:8080\n\nOr short form within namespace: stigmer-service:8080 with port=8080"),
        HumanMessage(content="What about service discovery?"),
        AIMessage(content="Kubernetes DNS handles it. Any pod in namespace=production can reach stigmer-service:8080. Other namespaces use the FQDN."),
        HumanMessage(content="Do I need a NetworkPolicy?"),
        AIMessage(content="Yes! For namespace=production, restrict ingress:\n\n```yaml\napiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: stigmer-service-policy\n  namespace: production\nspec:\n  podSelector:\n    matchLabels:\n      app: stigmer-service\n  ingress:\n    - from:\n        - namespaceSelector:\n            matchLabels:\n              access: allowed\n      ports:\n        - port: 8080\n```"),
        HumanMessage(content="What labels do I need on the pods?"),
        AIMessage(content="Essential labels for stigmer-service:\n\n```yaml\nlabels:\n  app: stigmer-service\n  environment: production\n  version: v1.0.0\n```\n\nThese enable selection and monitoring."),
        HumanMessage(content="How do I handle rolling updates?"),
        AIMessage(content="Configure deployment strategy:\n\n```yaml\nstrategy:\n  type: RollingUpdate\n  rollingUpdate:\n    maxSurge: 1\n    maxUnavailable: 0\n```\n\nWith replicas=3, you'll have 3-4 pods during update."),
        HumanMessage(content="What if the new version fails health checks?"),
        AIMessage(content="Kubernetes won't proceed if readiness_path=/health/ready fails. The rollout pauses, old pods stay running. You can then rollback."),
        HumanMessage(content="How do I rollback?"),
        AIMessage(content="kubectl rollout undo deployment/stigmer-service -n production\n\nKubernetes keeps revision history. With replicas=3, rollback is fast."),
        HumanMessage(content="What about pod disruption budget?"),
        
        # Phase 4: Reliability (messages 46-55)
        AIMessage(content="Essential for replicas=3:\n\n```yaml\napiVersion: policy/v1\nkind: PodDisruptionBudget\nmetadata:\n  name: stigmer-service-pdb\n  namespace: production\nspec:\n  minAvailable: 2\n  selector:\n    matchLabels:\n      app: stigmer-service\n```\n\nThis ensures at least 2 pods during maintenance."),
        HumanMessage(content="Does this affect rolling updates?"),
        AIMessage(content="No, PDB applies to voluntary disruptions (node drain, cluster upgrade). Rolling updates respect it automatically."),
        HumanMessage(content="Should I use pod anti-affinity?"),
        AIMessage(content="Yes! Spread replicas=3 across nodes:\n\n```yaml\naffinity:\n  podAntiAffinity:\n    preferredDuringSchedulingIgnoredDuringExecution:\n      - weight: 100\n        podAffinityTerm:\n          labelSelector:\n            matchLabels:\n              app: stigmer-service\n          topologyKey: kubernetes.io/hostname\n```"),
        HumanMessage(content="'Preferred' vs 'required'?"),
        AIMessage(content="Use 'preferred' for stigmer-service - scheduling succeeds even if all nodes full. 'Required' would block scheduling if no spread possible."),
        HumanMessage(content="Great, I think I have everything."),
        AIMessage(content="Excellent! Your Kubernetes deployment summary:\n\n**Deployment:**\n- Name: stigmer-service\n- Namespace: namespace=production\n- Replicas: replicas=3\n\n**Resources:**\n- CPU: cpu_request=500m, cpu_limit=2000m\n- Memory: memory_limit=2Gi\n\n**Health:**\n- Liveness: liveness_path=/health/live\n- Readiness: readiness_path=/health/ready\n- Port: port=8080\n\n**Service:**\n- Type: ClusterIP\n- Internal DNS: stigmer-service.production:8080"),
        HumanMessage(content="Thanks! This is very comprehensive."),
        AIMessage(content="You're welcome! Your stigmer-service in namespace=production with replicas=3 is configured for high availability. Remember to monitor cpu_request=500m utilization and adjust if needed. The ClusterIP service on port=8080 is ready for internal traffic."),
    ]
    
    return ConversationFixture(
        name="infrastructure_setup",
        category="infrastructure",
        messages=messages,
        description="Kubernetes deployment with resources, health checks, and networking",
    )


# =============================================================================
# Tool-Heavy Conversation (50+ messages with tool calls)
# =============================================================================

def create_tool_heavy_conversation() -> ConversationFixture:
    """Create a conversation with many tool calls for tool handling evaluation.
    
    This conversation simulates a database troubleshooting session where
    the agent makes multiple tool calls to diagnose and fix issues.
    
    Key facts distributed throughout:
    - Tool: execute_sql
    - Tool: check_connection
    - Tool: list_tables
    - PostgreSQL version: 15.4
    - Rows affected: 42
    - Query time: 156ms
    
    Returns:
        ConversationFixture with 50+ messages including tool calls and results.
    """
    # Pre-generate all tool call IDs to ensure consistency
    tool_ids = [f"call_{uuid.uuid4().hex[:12]}" for _ in range(15)]
    idx = 0
    
    def next_tool_id() -> str:
        nonlocal idx
        result = tool_ids[idx % len(tool_ids)]
        idx += 1
        return result
    
    # Build messages list with consistent tool call IDs
    messages: list[AnyMessage] = []
    
    # System message
    messages.append(SystemMessage(content="""You are a database troubleshooting agent with access to these tools:
- execute_sql: Run SQL queries
- check_connection: Test database connectivity
- list_tables: List tables in a schema

Use tools to diagnose and fix database issues."""))
    
    # Phase 1: Initial diagnosis
    messages.append(HumanMessage(content="Our production database seems slow. Can you check what's going on?"))
    
    tc_id = next_tool_id()
    messages.append(AIMessage(
        content="I'll investigate the database performance. Let me first check the connection.",
        tool_calls=[{"name": "check_connection", "args": {"host": "db.prod.example.com", "port": 5432}, "id": tc_id}]
    ))
    messages.append(ToolMessage(
        content="Connection successful. PostgreSQL 15.4 on db.prod.example.com:5432. Latency: 2ms.",
        tool_call_id=tc_id,
        name="check_connection"
    ))
    
    messages.append(AIMessage(content="Good news - the connection to db.prod.example.com is healthy, running PostgreSQL 15.4 with 2ms latency. Let me check for long-running queries."))
    messages.append(HumanMessage(content="Yes, please check for slow queries."))
    
    tc_id = next_tool_id()
    messages.append(AIMessage(
        content="I'll query pg_stat_activity for long-running queries.",
        tool_calls=[{"name": "execute_sql", "args": {"query": "SELECT pid, query, state, wait_event_type, now() - query_start AS duration FROM pg_stat_activity WHERE state != 'idle' AND query_start < now() - interval '5 seconds' ORDER BY duration DESC LIMIT 10"}, "id": tc_id}]
    ))
    messages.append(ToolMessage(
        content="query_time_ms=156\nResults:\npid=12345, query='SELECT * FROM large_table WHERE...', state='active', duration='00:02:34'\npid=12346, query='UPDATE users SET...', state='active', duration='00:00:45'\nrows_affected=42 for monitoring query",
        tool_call_id=tc_id,
        name="execute_sql"
    ))
    
    messages.append(AIMessage(content="Found the issue! There's a query running for over 2 minutes on large_table. The execute_sql tool shows query_time_ms=156 for the diagnostic query itself, but that SELECT on large_table is the problem."))
    messages.append(HumanMessage(content="Can you show me what tables exist?"))
    
    tc_id = next_tool_id()
    messages.append(AIMessage(
        content="I'll use list_tables to show all tables in the schema.",
        tool_calls=[{"name": "list_tables", "args": {"schema": "public"}, "id": tc_id}]
    ))
    messages.append(ToolMessage(
        content="Tables in public schema:\n- users (rows: 50000)\n- large_table (rows: 10000000)\n- sessions (rows: 125000)\n- audit_log (rows: 5000000)",
        tool_call_id=tc_id,
        name="list_tables"
    ))
    
    messages.append(AIMessage(content="The list_tables tool shows large_table has 10 million rows - that's likely why queries are slow. Let me check its indexes."))
    messages.append(HumanMessage(content="Good idea. What indexes does it have?"))
    
    tc_id = next_tool_id()
    messages.append(AIMessage(
        content="Let me query the index information.",
        tool_calls=[{"name": "execute_sql", "args": {"query": "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'large_table'"}, "id": tc_id}]
    ))
    messages.append(ToolMessage(
        content="query_time_ms=23\nResults:\nindexname='large_table_pkey', indexdef='CREATE UNIQUE INDEX large_table_pkey ON public.large_table USING btree (id)'\nrows_affected=1",
        tool_call_id=tc_id,
        name="execute_sql"
    ))
    
    # Phase 2: Index analysis
    messages.append(AIMessage(content="The execute_sql result shows only a primary key index on large_table. With 10 million rows and no covering indexes, queries are doing sequential scans."))
    messages.append(HumanMessage(content="What columns should we index?"))
    
    tc_id = next_tool_id()
    messages.append(AIMessage(
        content="Let me check which columns are commonly queried.",
        tool_calls=[{"name": "execute_sql", "args": {"query": "SELECT query, calls, mean_exec_time FROM pg_stat_statements WHERE query LIKE '%large_table%' ORDER BY total_exec_time DESC LIMIT 5"}, "id": tc_id}]
    ))
    messages.append(ToolMessage(
        content="query_time_ms=89\nResults:\nquery='SELECT * FROM large_table WHERE created_at > $1', calls=15000, mean_exec_time=2340.5\nquery='SELECT * FROM large_table WHERE user_id = $1', calls=8500, mean_exec_time=1890.2\nrows_affected=2",
        tool_call_id=tc_id,
        name="execute_sql"
    ))
    
    messages.append(AIMessage(content="The execute_sql analysis shows created_at and user_id are the most queried columns. We should add indexes on both. query_time_ms=89 for this diagnostic."))
    messages.append(HumanMessage(content="Can you create those indexes?"))
    
    tc_id = next_tool_id()
    messages.append(AIMessage(
        content="I'll create indexes concurrently to avoid blocking. First, created_at:",
        tool_calls=[{"name": "execute_sql", "args": {"query": "CREATE INDEX CONCURRENTLY idx_large_table_created_at ON large_table(created_at)"}, "id": tc_id}]
    ))
    messages.append(ToolMessage(
        content="query_time_ms=45230\nIndex created successfully.\nrows_affected=0",
        tool_call_id=tc_id,
        name="execute_sql"
    ))
    
    messages.append(AIMessage(content="First index created (took about 45 seconds on 10 million rows). Now the user_id index:"))
    
    tc_id = next_tool_id()
    messages.append(AIMessage(
        content="Creating the user_id index concurrently.",
        tool_calls=[{"name": "execute_sql", "args": {"query": "CREATE INDEX CONCURRENTLY idx_large_table_user_id ON large_table(user_id)"}, "id": tc_id}]
    ))
    messages.append(ToolMessage(
        content="query_time_ms=38540\nIndex created successfully.\nrows_affected=0",
        tool_call_id=tc_id,
        name="execute_sql"
    ))
    
    messages.append(AIMessage(content="Both indexes are now created on large_table. Let me verify with list_tables again."))
    messages.append(HumanMessage(content="Can you check if the slow query is still running?"))
    
    tc_id = next_tool_id()
    messages.append(AIMessage(
        content="Let me check pg_stat_activity again.",
        tool_calls=[{"name": "check_connection", "args": {"host": "db.prod.example.com", "port": 5432, "check_active_queries": True}, "id": tc_id}]
    ))
    messages.append(ToolMessage(
        content="Connection healthy. PostgreSQL 15.4.\nActive queries: 3\nLongest running: 2 seconds\nNo queries over 5 seconds threshold.",
        tool_call_id=tc_id,
        name="check_connection"
    ))
    
    messages.append(AIMessage(content="The check_connection shows no long-running queries now! The problematic query must have completed. Let's verify the new indexes are being used."))
    
    # Phase 3: Verification
    messages.append(HumanMessage(content="How can we verify the indexes are helping?"))
    
    tc_id = next_tool_id()
    messages.append(AIMessage(
        content="I'll run EXPLAIN ANALYZE on a typical query.",
        tool_calls=[{"name": "execute_sql", "args": {"query": "EXPLAIN ANALYZE SELECT * FROM large_table WHERE created_at > NOW() - INTERVAL '1 day' LIMIT 100"}, "id": tc_id}]
    ))
    messages.append(ToolMessage(
        content="query_time_ms=45\nQUERY PLAN:\nLimit (cost=0.43..8.50 rows=100 width=256) (actual time=0.025..0.089 rows=100 loops=1)\n  -> Index Scan using idx_large_table_created_at on large_table (cost=0.43..80912.89 rows=1000234 width=256)\n        Index Cond: (created_at > (now() - '1 day'::interval))\nPlanning Time: 0.234 ms\nExecution Time: 0.156 ms\nrows_affected=100",
        tool_call_id=tc_id,
        name="execute_sql"
    ))
    
    messages.append(AIMessage(content="Excellent! The execute_sql EXPLAIN shows it's using idx_large_table_created_at (Index Scan). Execution time is 0.156ms - that's the query_time_ms we want to see!"))
    messages.append(HumanMessage(content="That's much faster! What about the user_id queries?"))
    
    tc_id = next_tool_id()
    messages.append(AIMessage(
        content="Let me check the user_id index too.",
        tool_calls=[{"name": "execute_sql", "args": {"query": "EXPLAIN ANALYZE SELECT * FROM large_table WHERE user_id = 12345 LIMIT 50"}, "id": tc_id}]
    ))
    messages.append(ToolMessage(
        content="query_time_ms=12\nQUERY PLAN:\nLimit (cost=0.43..4.52 rows=50 width=256) (actual time=0.018..0.045 rows=42 loops=1)\n  -> Index Scan using idx_large_table_user_id on large_table (cost=0.43..892.34 rows=10923 width=256)\n        Index Cond: (user_id = 12345)\nPlanning Time: 0.189 ms\nExecution Time: 0.089 ms\nrows_affected=42",
        tool_call_id=tc_id,
        name="execute_sql"
    ))
    
    messages.append(AIMessage(content="Perfect! Using idx_large_table_user_id with rows_affected=42. Both indexes are working. query_time_ms=12 for the explain."))
    messages.append(HumanMessage(content="Should we add any other indexes?"))
    
    tc_id = next_tool_id()
    messages.append(AIMessage(
        content="Let me check if there are other slow query patterns.",
        tool_calls=[{"name": "execute_sql", "args": {"query": "SELECT query, calls, mean_exec_time FROM pg_stat_statements WHERE mean_exec_time > 100 AND query NOT LIKE '%pg_%' ORDER BY total_exec_time DESC LIMIT 10"}, "id": tc_id}]
    ))
    messages.append(ToolMessage(
        content="query_time_ms=67\nResults:\nNo rows returned - all queries now under 100ms threshold.\nrows_affected=0",
        tool_call_id=tc_id,
        name="execute_sql"
    ))
    
    messages.append(AIMessage(content="The execute_sql shows no queries over 100ms! The two indexes we added have resolved all slow query issues."))
    messages.append(HumanMessage(content="Great! Can you give me a summary of what we did?"))
    messages.append(AIMessage(content="Absolutely! Here's the troubleshooting summary:\n\n**Diagnosis:**\n1. Used check_connection to verify PostgreSQL 15.4 is healthy\n2. Found long-running query on large_table via execute_sql\n3. Used list_tables to identify 10M row table\n\n**Fix:**\n1. Created idx_large_table_created_at\n2. Created idx_large_table_user_id\n\n**Results:**\n- Query time dropped from 2+ minutes to <1ms\n- rows_affected=42 on test query\n- All queries now under 100ms\n\nThe execute_sql and check_connection tools confirmed the fix is working!"))
    messages.append(HumanMessage(content="Perfect. Should we monitor anything going forward?"))
    
    # Phase 4: Monitoring setup
    tc_id = next_tool_id()
    messages.append(AIMessage(
        content="Yes, let me set up a monitoring query.",
        tool_calls=[{"name": "execute_sql", "args": {"query": "CREATE OR REPLACE VIEW slow_query_monitor AS SELECT pid, query, state, now() - query_start AS duration FROM pg_stat_activity WHERE state != 'idle' AND query_start < now() - interval '5 seconds'"}, "id": tc_id}]
    ))
    messages.append(ToolMessage(
        content="query_time_ms=34\nView created successfully.\nrows_affected=0",
        tool_call_id=tc_id,
        name="execute_sql"
    ))
    
    messages.append(AIMessage(content="Created a slow_query_monitor view. You can now run 'SELECT * FROM slow_query_monitor' anytime. The execute_sql created it in query_time_ms=34."))
    messages.append(HumanMessage(content="Can you verify the view works?"))
    
    tc_id = next_tool_id()
    messages.append(AIMessage(
        content="Let me test the monitoring view.",
        tool_calls=[{"name": "execute_sql", "args": {"query": "SELECT * FROM slow_query_monitor"}, "id": tc_id}]
    ))
    messages.append(ToolMessage(
        content="query_time_ms=8\nResults:\nNo rows - no slow queries currently running.\nrows_affected=0",
        tool_call_id=tc_id,
        name="execute_sql"
    ))
    
    messages.append(AIMessage(content="The view works - showing no slow queries. query_time_ms=8 for the check. PostgreSQL 15.4 is now running optimally."))
    messages.append(HumanMessage(content="Thanks for all the help!"))
    messages.append(AIMessage(content="You're welcome! Summary of tools used:\n\n1. **check_connection**: Verified PostgreSQL 15.4 connectivity and health\n2. **execute_sql**: Ran diagnostics with query_time_ms tracking\n3. **list_tables**: Identified large_table as the problem\n\nKey metrics to remember:\n- rows_affected=42 on indexed queries\n- query_time_ms < 100 for all queries now\n- Both indexes using btree on 10M rows\n\nYour database on db.prod.example.com is optimized!"))
    
    return ConversationFixture(
        name="tool_heavy_troubleshooting",
        category="tool_calls",
        messages=messages,
        description="Database troubleshooting with execute_sql, check_connection, and list_tables tools",
    )


# =============================================================================
# Utility Functions
# =============================================================================

def get_conversation_by_category(category: str) -> ConversationFixture:
    """Get a conversation fixture by category.
    
    Args:
        category: One of 'database', 'api', 'infrastructure', 'tool_calls'
        
    Returns:
        The corresponding ConversationFixture.
        
    Raises:
        ValueError: If category is not recognized.
    """
    factories = {
        "database": create_database_conversation,
        "api": create_api_integration_conversation,
        "infrastructure": create_infrastructure_conversation,
        "tool_calls": create_tool_heavy_conversation,
    }
    
    if category not in factories:
        raise ValueError(f"Unknown category: {category}. Must be one of: {list(factories.keys())}")
    
    return factories[category]()


def count_facts_in_text(text: str, facts: list[str]) -> tuple[int, int, float]:
    """Count how many critical facts appear in text.
    
    Args:
        text: The text to search (e.g., a summary)
        facts: List of facts to look for
        
    Returns:
        Tuple of (found_count, total_count, retention_percentage)
    """
    found = sum(1 for fact in facts if fact in text)
    total = len(facts)
    percentage = (found / total * 100) if total > 0 else 0.0
    return found, total, percentage
