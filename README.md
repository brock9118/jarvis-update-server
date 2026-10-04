# JARVIS ULTRON Server V014 — Corrected

This package is the corrected Render server for JARVIS V014.

## Environment variables
- `JARVIS_LOG_PASSWORD` — existing update-log password
- `JARVIS_MAKER_PASSKEY` — existing private Maker passkey
- `OPENAI_API_KEY` — OpenAI API key; keep secret and never put it in the Android app or GitHub
- `ULTRON_AI_MODEL` — optional; defaults to `gpt-6-luna`

## Guardian routes
- `POST /maker/login`
- `GET /ultron/guardian/status`
- `POST /ultron/guardian/control` with `ENABLE`, `PAUSE`, or `SHUTDOWN`

## AI route
- `POST /ultron/ai/chat`
- Requires Maker session + Guardian `ENABLED` + `OPENAI_API_KEY`

## Important
Guardian state is fail-closed for ULTRON AI: `PAUSED` and `SHUTDOWN` reject AI requests.
The Maker passkey is only read from the server environment and is never returned by the API.

On Render, deploy this server with Start Command:
`node server.js`
