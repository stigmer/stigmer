# Encryption Test Vectors

This directory contains test vectors for verifying cross-platform compatibility between the Java (stigmer-cloud) and Go (stigmer-oss) encryption implementations.

## Purpose

Environment secret values are encrypted using AES-256-GCM before storage. Values encrypted by one implementation must be correctly decrypted by the other, ensuring:

1. **Portability**: Environments created in one system can be used in another
2. **Compatibility**: Both Cloud and OSS versions use the same format
3. **Future-proofing**: Key rotation is supported via version prefix

## Encryption Format

```
enc:v1:<base64(nonce || ciphertext || tag)>
```

Components:
- `enc:v1:` - Version prefix (supports future key rotation)
- `nonce` - 12 bytes (96 bits), randomly generated per encryption
- `ciphertext` - Variable length, the encrypted data
- `tag` - 16 bytes (128 bits), GCM authentication tag

## Test Key

For testing only. **NEVER use this key in production.**

| Format | Value |
|--------|-------|
| ASCII | `01234567890123456789012345678901` |
| Base64 | `MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=` |
| Hex | `3031323334353637383930313233343536373839303132333435363738393031` |

## Running Cross-Platform Tests

### Java (stigmer-cloud)

```bash
cd stigmer-cloud
bazel test //backend/services/stigmer-service:all --test_filter=*EnvironmentSecretService*
```

### Go (stigmer-oss)

```bash
cd stigmer
bazel test //backend/services/stigmer-server/pkg/encryption:encryption_test
```

### Manual Cross-Platform Verification

1. **Encrypt in Java, decrypt in Go**:
   ```java
   // Java: Create encrypted value
   String encrypted = secretService.encrypt("test-secret");
   System.out.println(encrypted);
   // Output: enc:v1:AAAAAAAAAAAABBBB...
   ```
   
   ```go
   // Go: Decrypt the value
   decrypted, err := secretService.Decrypt("enc:v1:AAAAAAAAAAAABBBB...")
   // decrypted should be "test-secret"
   ```

2. **Encrypt in Go, decrypt in Java**:
   ```go
   // Go: Create encrypted value
   encrypted, _ := secretService.Encrypt("test-secret")
   fmt.Println(encrypted)
   // Output: enc:v1:CCCCCCCCCCCCDDDD...
   ```
   
   ```java
   // Java: Decrypt the value
   String decrypted = secretService.decrypt("enc:v1:CCCCCCCCCCCCDDDD...");
   // decrypted should be "test-secret"
   ```

## Generating Production Keys

Generate a secure 256-bit (32-byte) encryption key:

```bash
# Using OpenSSL
openssl rand -base64 32

# Using Go
go run -e 'import ("crypto/rand"; "encoding/base64"; "fmt"); k := make([]byte, 32); rand.Read(k); fmt.Println(base64.StdEncoding.EncodeToString(k))'

# Using Java
java -e 'import java.security.*; import java.util.*; byte[] k = new byte[32]; SecureRandom.getInstanceStrong().nextBytes(k); System.out.println(Base64.getEncoder().encodeToString(k));'
```

## Security Notes

1. **Never log plaintext secrets** - Both implementations redact secrets in logs
2. **Unique nonce per encryption** - Critical for GCM security
3. **Key storage** - Use environment variables or secure key management
4. **Key rotation** - The `v1` prefix supports future key versioning

## Files

- `encryption_test_vectors.json` - Test cases with plaintext values
- `README.md` - This file
