# Security Review Guidelines

This skill provides comprehensive security review knowledge for code analysis.

## OWASP Top 10 Security Risks

Always check for these critical security vulnerabilities:

### 1. Injection Attacks
- **SQL Injection**: Never concatenate user input into SQL queries
- **Command Injection**: Validate and sanitize system commands
- **LDAP Injection**: Escape special characters in LDAP queries
- **Prevention**: Use parameterized queries, prepared statements, and ORMs

### 2. Broken Authentication
- **Weak Passwords**: Enforce strong password policies
- **Session Management**: Secure session tokens, proper timeout
- **Credential Storage**: Use bcrypt, argon2, or PBKDF2 for hashing
- **MFA**: Recommend multi-factor authentication for sensitive operations

### 3. Sensitive Data Exposure
- **Encryption**: Use TLS for data in transit, encryption for data at rest
- **API Keys**: Never commit secrets to version control
- **PII**: Properly handle personally identifiable information
- **Logging**: Don't log sensitive data (passwords, tokens, credit cards)

### 4. XML External Entities (XXE)
- Disable XML external entity processing
- Use less complex data formats like JSON when possible
- Validate and sanitize XML input

### 5. Broken Access Control
- **Authorization Checks**: Verify permissions on every request
- **IDOR**: Prevent insecure direct object references
- **Path Traversal**: Validate file paths and prevent directory traversal
- **Principle of Least Privilege**: Grant minimal necessary permissions

### 6. Security Misconfiguration
- Remove default credentials
- Disable unnecessary features and services
- Keep software and dependencies updated
- Use secure defaults and hardening guides

### 7. Cross-Site Scripting (XSS)
- **Output Encoding**: Escape user input in HTML, JavaScript, CSS
- **Content Security Policy**: Implement CSP headers
- **Sanitization**: Use trusted libraries for HTML sanitization
- **Context-Aware Encoding**: Different contexts need different encoding

### 8. Insecure Deserialization
- Avoid accepting serialized objects from untrusted sources
- Implement integrity checks and validation
- Use type constraints and safe deserialization methods

### 9. Using Components with Known Vulnerabilities
- Maintain software inventory
- Monitor CVE databases and security advisories
- Use dependency scanning tools (Snyk, Dependabot)
- Keep dependencies updated

### 10. Insufficient Logging & Monitoring
- Log security-relevant events (auth failures, access control violations)
- Implement alerting for suspicious activities
- Protect logs from tampering
- Include context in logs for investigation

## Common Code Review Security Checks

### Input Validation
```
✅ DO:
- Whitelist valid input patterns
- Validate data type, length, format, range
- Reject invalid input with clear error messages

❌ DON'T:
- Trust any user input
- Use blacklists (incomplete, bypass-able)
- Validate only on client side
```

### Authentication & Authorization
```
✅ DO:
- Check permissions on every protected endpoint
- Use established authentication frameworks
- Implement rate limiting
- Use secure session management

❌ DON'T:
- Implement custom authentication (use OAuth, SAML, etc.)
- Store passwords in plain text
- Use weak hashing algorithms (MD5, SHA1)
- Trust client-side authorization checks
```

### Cryptography
```
✅ DO:
- Use established libraries (NaCl, libsodium, OpenSSL)
- Use strong algorithms (AES-256, RSA-2048+)
- Generate cryptographically secure random values
- Rotate keys regularly

❌ DON'T:
- Roll your own crypto
- Hardcode encryption keys
- Use weak algorithms (DES, RC4)
- Use predictable IVs or nonces
```

### API Security
```
✅ DO:
- Implement rate limiting
- Use API keys with proper rotation
- Validate content-type headers
- Return generic error messages

❌ DON'T:
- Expose stack traces in errors
- Allow unlimited requests
- Trust Host headers
- Leak information in error messages
```

## Language-Specific Security

### JavaScript/Node.js
- Avoid `eval()` and `Function()` constructor
- Use `helmet` for Express.js security headers
- Sanitize user input with DOMPurify
- Use `npm audit` to check dependencies

### Python
- Use `secrets` module for cryptographic randomness
- Avoid `pickle` for untrusted data
- Use `bandit` for security linting
- Properly handle file paths with `pathlib`

### Java
- Use PreparedStatement for SQL queries
- Validate deserialization with ObjectInputFilter
- Use secure random generators
- Enable security managers

### Go
- Use `crypto/rand` for random values
- Properly handle errors (don't ignore them)
- Use context for timeouts and cancellation
- Validate TLS certificates

## Security Code Review Checklist

- [ ] All user inputs are validated and sanitized
- [ ] SQL queries use parameterized statements
- [ ] Sensitive data is encrypted in transit and at rest
- [ ] Authentication and authorization are properly implemented
- [ ] Error messages don't leak sensitive information
- [ ] Dependencies are up to date and vulnerability-free
- [ ] Security headers are configured (CSP, HSTS, etc.)
- [ ] Logging includes security events but not sensitive data
- [ ] File operations validate paths and permissions
- [ ] Cryptographic operations use secure libraries and algorithms

## Resources

- OWASP Cheat Sheet Series: https://cheatsheetseries.owasp.org/
- CWE Top 25: https://cwe.mitre.org/top25/
- SANS Secure Coding Guidelines
- Language-specific security best practices
