# CodeQuest AI Tutor

AI-powered tutoring for KS3, GCSE, and A-Level Computer Science.

## Stack
- Frontend: React + Vite + React Markdown
- Backend: Node.js + Express + OpenAI API
- Deploy: Vercel (frontend), Render (backend)

## Architecture
Frontend (Vercel) -> Express API (Render) -> OpenAI API

## Local Setup

### 1) Clone
```bash
git clone https://github.com/SOL7JJ/codequest-ai-tutor.git
cd codequest-ai-tutor
```

### 2) Backend setup
```bash
cd server
npm install
cp .env.example .env
```

Update `/Users/jamesjonathantossou-ayayi/Desktop/codequest-ai-tutor/server/.env`:
```bash
OPENAI_API_KEY=your_key_here
```

Start backend:
```bash
npm run dev
```

### 3) Frontend setup
```bash
cd ../client
npm install
cp .env.example .env
```

For local development, set `/Users/jamesjonathantossou-ayayi/Desktop/codequest-ai-tutor/client/.env`:
```bash
VITE_API_URL=http://localhost:3000
```

Start frontend:
```bash
npm run dev
```

## Production API URL
Set `VITE_API_URL` in your deployed frontend environment to your backend URL, for example:
```bash
VITE_API_URL=https://codequest-ai-tutor.onrender.com
```

## Backend safety controls
In `/Users/jamesjonathantossou-ayayi/Desktop/codequest-ai-tutor/server/.env`:
- `REQUEST_TIMEOUT_MS`: max time for OpenAI response (default `20000`)
- `RATE_LIMIT_WINDOW_MS`: limiter window size (default `60000`)
- `RATE_LIMIT_MAX`: max requests per IP per window on `/api/tutor` (default `20`)

## Smoke tests
Run backend smoke tests:
```bash
cd server
npm test
```

Current smoke coverage:
- `GET /health` returns `200`
- `POST /api/tutor` rejects missing message with `400`
- `POST /api/tutor` returns clear `500` when `OPENAI_API_KEY` is missing

## UI Screenshot Workflow (Before/After + Diff)
This workflow captures desktop and mobile screenshots and generates a visual diff report.

### Install UI tooling once
```bash
cd client
npm install
npx playwright install chromium
```

### Capture before change
```bash
cd client
npm run ui:before
```

### Capture after change
```bash
cd client
npm run ui:after
```

### Generate visual diffs
```bash
cd client
npm run ui:diff
```

Outputs:
- Before screenshots: `/Users/jamesjonathantossou-ayayi/Desktop/codequest-ai-tutor/client/visual-regression/before`
- After screenshots: `/Users/jamesjonathantossou-ayayi/Desktop/codequest-ai-tutor/client/visual-regression/after`
- Diff report: `/Users/jamesjonathantossou-ayayi/Desktop/codequest-ai-tutor/client/visual-regression/diff-before-vs-after/index.html`

Optional custom capture:
```bash
cd client
npm run ui:capture -- --label experiment-a --url http://127.0.0.1:4173
```

## Code and UI Evolution

### Code Evolution (latest pass)
- Backend fixed from mixed module formats to consistent ESM.
- Removed duplicate server listen calls.
- Removed sensitive key debug logging.
- Added request validation on `/api/tutor`.
- Added graceful missing-key behavior (no startup crash).
- Added timeout and rate limit protection for `/api/tutor`.
- Added automated backend smoke tests.
- Added automated UI screenshot and pixel-diff workflow.

### UI Evolution (current)
- Chat-first interface with assistant/user bubbles.
- Starter prompt chips for quick actions.
- Right-side quick-action panel (`Explain`, `Hint`, `Quiz`, `Mark`).
- Responsive mobile layout (single-column under 768px).

## Live Demo
- Frontend: https://codequest-ai-tutor.vercel.app
- Backend: https://codequest-ai-tutor.onrender.com

## Future Improvements
- Streaming responses
- User accounts and progress tracking
- Saved lessons
- Teacher dashboard
