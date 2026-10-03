# JARVIS Separate Update-Log Server

This server is intentionally separate from the Android JARVIS system. The app only reads the authenticated update history over HTTPS.

## Run locally

1. Install Node.js 18+.
2. In this folder set a password:
   - Windows PowerShell: `$env:JARVIS_LOG_PASSWORD="choose-a-strong-password"`
   - macOS/Linux: `export JARVIS_LOG_PASSWORD="choose-a-strong-password"`
3. Run `npm start`.
4. For a phone to reach a server on the same Wi-Fi, use the computer's LAN IP and a reachable port; for Internet access, deploy behind HTTPS.

## Production

Use a real HTTPS host. Do not expose this service over plain HTTP on the public Internet. Set `JARVIS_LOG_PASSWORD` as a server-side secret. The password is never embedded in the APK.

## App configuration

The current Android build is configured to use `https://jarvis-update-server.onrender.com` as the HTTPS base URL of the deployed server.

The Update Log button asks for the password, obtains a short-lived session token, and retrieves `/updates`. The server keeps the update history separate from the JARVIS local database.


## Automatic version registration (V005)

JARVIS V005 reports its installed `versionName` to `POST /register-version` when the app starts. The endpoint validates semantic versions and records each version only once. The report is best-effort and does not block app startup.

The server writes the updated history back to `updates.json`. On hosts with ephemeral filesystems, treat this as runtime storage only; move the mutable log to a persistent database/storage layer before relying on it as permanent history.
