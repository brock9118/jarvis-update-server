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

In `MainActivity.kt`, replace `https://YOUR-UPDATE-SERVER.example.com` with the HTTPS base URL of the deployed server, then rebuild the APK.

The Update Log button asks for the password, obtains a short-lived session token, and retrieves `/updates`. The server keeps the update history separate from the JARVIS local database.
