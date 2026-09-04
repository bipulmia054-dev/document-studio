# Document Studio Android

Native Android client for the existing private Document Studio server. No API key or customer records are bundled. Server address is stored on this device; login uses the server's existing session cookie.

Google ML Kit Document Scanner provides on-device capture, gallery import, edge adjustment, filters and confirmation. The scanner module is downloaded by Google Play Services on first use. Requires Android 6+, Google Play Services and at least 1.7 GB device RAM. OCR, signature cleanup and portrait generation still use the existing server.

Default address: http://100.96.199.117:8765/. The PC must be on and the phone must be connected to the same Tailscale network. Use Settings to select a different private LAN or HTTPS server. HTTP is intended only over trusted LAN/Tailscale; use HTTPS for hosted servers. Never forward port 8765 publicly.

Build with JDK 17, Android SDK 35 and Gradle 8.11.1: `gradle :app:assembleDebug`. The resulting APK is a sideloadable test build, not a Play Store release. Keep the signing key for future updates. Camera/scanner behavior must be checked on a physical Google Play Services Android phone.
