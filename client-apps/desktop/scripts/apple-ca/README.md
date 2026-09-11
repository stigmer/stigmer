# Apple certificate authorities for macOS code signing

Two public Apple CA certificates, vendored so the desktop release lane never fetches them over the network at release time. They are imported into the signing keychain by `../macos-import-signing-keychain.sh`, which refuses a file whose SHA-256 fingerprint does not match the values pinned in that script.

Why they are needed: the Developer ID Application `.p12` carries only the leaf certificate. `codesign` must build a chain from that leaf to Apple's root before it signs anything, and a fresh keychain (a CI runner, a new laptop) has no Developer ID intermediate, so signing fails with "unable to build chain to self-signed root certificate". The root is already in macOS's System Roots; it rides along so the recipe matches what Apple documents.

| File | Subject | Source | Expires | SHA-256 |
| --- | --- | --- | --- | --- |
| `DeveloperIDG2CA.cer` | Developer ID Certification Authority (G2) | https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer | 2031-09-17 | `F1:6C:D3:C5:4C:7F:83:CE:A4:BF:1A:3E:6A:08:19:C8:AA:A8:E4:A1:52:8F:D1:44:71:5F:35:06:43:D2:DF:3A` |
| `AppleIncRootCertificate.cer` | Apple Root CA | https://www.apple.com/appleca/AppleIncRootCertificate.cer | 2035-02-09 | `B0:B1:73:0E:CB:C7:FF:45:05:14:2C:49:F1:29:5E:6E:DA:6B:CA:ED:7E:2C:68:C5:BE:91:B5:A1:10:01:F0:24` |

Apple's index of these files is https://www.apple.com/certificateauthority/. To refresh a file, download it from the source above, print its fingerprint with `openssl x509 -inform der -in <file> -noout -fingerprint -sha256`, and update both this table and the pinned value in the import script in the same commit.
