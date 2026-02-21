# Code and UI Evolution

## Why this file exists
This tracks concrete improvements made to stability and user experience so changes are visible over time.

## Current Evolution Snapshot (2026-02-21)

### Code Evolution
- Backend runtime fixed to use consistent ESM imports.
- Removed duplicate server startup listeners.
- Added request payload validation for `/api/tutor`.
- Added graceful handling when `OPENAI_API_KEY` is missing.
- Added timeout guard for OpenAI requests via `REQUEST_TIMEOUT_MS`.
- Added in-memory rate limit for `/api/tutor` (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`).
- Added backend smoke tests for health and key API failure modes.
- Added `.env.example` templates for frontend and backend.
- Added an automated UI screenshot workflow (`before`/`after`/pixel-diff report).

### UI Evolution
- Structured chat layout with clear assistant/user bubbles.
- Added starter prompt chips for common learning flows.
- Added right-side quick mode actions (`Explain`, `Hint`, `Quiz`, `Mark`).
- Preserved responsive mobile behavior with single-column fallback.

## How to review evolution quickly
```bash
# Show all current local changes
git diff

# Show backend-only evolution
git diff -- server/index.js server/tests/smoke.test.js server/.env.example

# Show UI-facing evolution
git diff -- client/src/App.jsx client/src/App.css README.md
```
