# JARVIS iOS

Native SwiftUI foundation. The macOS GitHub Actions workflow generates an Xcode project with XcodeGen and builds an unsigned iOS Simulator app. This artifact cannot be installed on a real iPhone.

For a physical iPhone: install Xcode and XcodeGen on a Mac, run `cd ios && xcodegen generate`, open `JarvisCompanion.xcodeproj`, configure an Apple development team and unique bundle ID, then build and run on the device. For distribution without a Mac, the next step is a signed TestFlight workflow with Apple Developer Program and App Store Connect credentials.

No OneDrive OAuth, file download, knowledge import, calendar sync or startup sync has been implemented. These require Microsoft Graph authorization with PKCE, encrypted file decryption on device, ETag version checks at foreground launch, atomic merges, offline edit conflict handling and Keychain-protected credentials. The desktop must also check remote revisions at startup. Never synchronize raw ZIP backups or credentials as knowledge.

## Gaming companion mock-up (PR #8)

`JarvisCompanion/CompanionHomeView.swift` contains an optional, **nonfunctional** gaming companion preview with consent toggles. The current app still starts the knowledge-oriented `ContentView` from the iOS app scaffold. This preview does **not** pair with Windows, transfer game data, upload screenshots or activate any sync permissions.

A future pairing implementation must require explicit approval on both devices, restrict transferred fields, authenticate the devices, protect network traffic and offer revocation. The existing OneDrive/TestFlight setup remains separate from this design. This is documentation, not an implemented synchronization feature.
