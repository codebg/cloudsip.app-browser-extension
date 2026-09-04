# Changelog

## [1.1.0] - 2026-09-04

- Added a single-owner SIP registration recovery state machine.
- Added bounded exponential retry for temporary REGISTER failures.
- Added a WSS watchdog for transports that do not recover normally.
- Added an idle WebSocket CRLF keepalive.
- Added connection recovery history to diagnostic reports.
- Prevented duplicate REGISTER requests during recovery.
- Kept explicit Offline presence as the only user-controlled reconnect stop.

## [1.0.1] - 2026-09-04

- Fixed Quick Setup and Advanced Setup fields appearing at the same time in SIP account settings.

## [1.0.0] - 2026-09-04

- Added configurable STUN, TURN and SIP session timers.
- Added automatic SIP reconnection and network recovery.
- Added quick and advanced setup, multiple SIP profiles and configuration import/export.
- Added session-only credentials and sanitized diagnostic reports.
- Added ICE, WSS and live call-quality diagnostics.
- Added attended transfer, conference, call waiting, redial and dial-plan preferences.
- Added optional headset, SIP MESSAGE and BLF modules.
- Replaced global website access with opt-in domain permissions.
- Added whitelist and blacklist policies, context-menu calling and country normalization.
- Added a local CRM bridge using browser events, postMessage, CloudSIP links and extension messaging.

## [0.1.0] - Initial public release

- Prepared the Chromium Manifest V3 extension for public testing.
