# JARVIS Companion – iOS foundation

This folder contains a **native SwiftUI app skeleton**, not a functioning paired client.
Create a new iOS App project in Xcode (SwiftUI lifecycle, iOS 17+) and add the two Swift files in `JarvisCompanion/`.
An Apple/macOS build environment is required; this repository's Windows CI does not compile Swift.

## Privacy-first sync design (not yet implemented)

1. Windows desktop creates a short-lived one-time pairing challenge only on explicit user action.
2. iPhone and desktop authenticate each other; never expose an unauthenticated HTTP endpoint.
3. Use TLS and authenticated encryption. No public port or automatic cloud upload.
4. PC user selects individual games and data categories (progress, timers, notes); default all OFF.
5. iPhone confirms the same scope; intersection of grants is the only allowed sync set.
6. Only an allowlisted DTO is sent: game id, display name, approved task labels/statuses and timestamps.
7. Never sync screenshots, chat, passwords, tokens, private memory, financial or health data.
8. Pairing can be revoked on either device; revoke tokens and erase cached approved records.
9. Version payloads, limit sizes, and handle offline/replay protection.
10. Test threat model, permissions and device pairing before enabling any network code.

The SwiftUI toggles are **nonfunctional UI previews**; they do not persist or grant permissions.
