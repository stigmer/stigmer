# Apple certificate authority for macOS code signing

One public Apple CA certificate, vendored so the desktop release lane never fetches it over the network at release time. `../macos-import-signing-keychain.sh` installs it into the login keychain and refuses a file whose SHA-256 fingerprint does not match the value pinned in that script.

Why it is needed: the Developer ID Application `.p12` carries only the leaf certificate. `codesign` must build a chain from that leaf to Apple's root before it signs anything. Apple's root is already in macOS's System Roots; the Developer ID intermediate is not, and on a fresh machine (a CI runner, a new laptop) signing fails with "unable to build chain to self-signed root certificate" until it is installed. On macOS 26 it must be in the login or System keychain: `codesign`'s trust evaluation does not look for intermediates in a file-based keychain on the search list, even one that holds it (the unified log says `Trust evaluate failure: [leaf MissingIntermediate]`).

| File | Subject | Source | Expires | SHA-256 |
| --- | --- | --- | --- | --- |
| `DeveloperIDG2CA.cer` | Developer ID Certification Authority (G2) | https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer | 2031-09-17 | `F1:6C:D3:C5:4C:7F:83:CE:A4:BF:1A:3E:6A:08:19:C8:AA:A8:E4:A1:52:8F:D1:44:71:5F:35:06:43:D2:DF:3A` |

Apple's index of its CA certificates is https://www.apple.com/certificateauthority/. To refresh the file, download it from the source above, print its fingerprint with `openssl x509 -inform der -in DeveloperIDG2CA.cer -noout -fingerprint -sha256`, and update both this table and the pinned value in the import script in the same commit.
