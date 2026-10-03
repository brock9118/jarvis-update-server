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

## V008 family API

The same HTTPS host now exposes a small authenticated family-linking API used by JARVIS V008:

- `POST /family/create` — creates a family and makes the device the leader.
- `POST /family/invite` — leader-only; creates a single-use Child or Elderly invitation code.
- `POST /family/join` — consumes a single-use invitation and links the device.
- `GET /family/status` — authenticated family members can see linked device names and roles.
- `POST /family/leave` — removes the current device; a leader dissolves the family.

V008 intentionally does **not** transmit, collect, or store family location. Location sharing will require a later release with explicit member controls.

Family records are stored in `families.json` for this development build. Render free web-service filesystems are not durable storage, so this is suitable for testing but not the final production architecture. A persistent database should be added before relying on Family Mode in production.
