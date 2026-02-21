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
DATABASE_URL=your_postgres_connection_string
JWT_SECRET=your_long_random_secret
APP_URL=http://localhost:5173
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
STRIPE_PRICE_ID_PRO_MONTHLY=price_xxx
STRIPE_PRICE_ID_PREMIUM_MONTHLY=price_xxx
# Optional legacy fallback:
STRIPE_PRICE_ID_MONTHLY=price_xxx
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

## Authentication (Custom Backend)
This project uses backend auth with:
- Password hashing via `bcryptjs`
- Session tokens via JWT (`jsonwebtoken`)
- User records stored in PostgreSQL (`users` table auto-created on startup)

Auth endpoints:
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

Protected tutor endpoints:
- `POST /api/tutor`
- `POST /api/tutor/stream`

## Stripe Subscriptions (Monthly Plan)
This project includes Stripe subscription billing with:
- Stripe Checkout for monthly subscription purchase
- Stripe Billing Portal for self-serve management
- Webhook-driven subscription status sync to PostgreSQL
- Tiered access controls (Free + Pro)

Billing endpoints:
- `GET /api/billing/status`
- `POST /api/billing/create-checkout-session`
- `POST /api/billing/create-portal-session`
- `POST /api/billing/webhook`
- `POST /api/stripe/webhook`

Chat history endpoint:
- `GET /api/chat/history`

Chat messages are persisted in PostgreSQL (`chat_messages` table) per user.

Progress endpoints:
- `GET /api/progress/summary`
- `GET /api/progress/overview`

Student productivity endpoints:
- `GET /api/student/lessons`
- `POST /api/student/lessons`
- `PATCH /api/student/lessons/:lessonId`
- `POST /api/student/quiz-attempts`
- `GET /api/student/tasks`
- `PATCH /api/student/tasks/:taskId`
- `POST /api/code/evaluate`

Teacher endpoints:
- `POST /api/teacher/quizzes/generate`
- `POST /api/teacher/tasks/assign`
- `GET /api/teacher/results`

Progress tracking writes one `learning_events` row per tutor session (user, level, topic, mode, timestamp).
The summary dashboard highlights this-week activity count, top topics, streak days, and recent sessions.

Tutor access tiers:
- Free plan: `Explain` + `Hint` with daily turn limits
- Pro plan (£4.99): unlimited turns + `Quiz`, `Mark`, streaming, saved history
- Premium plan (£9.99): all Pro features + personalized learning path and parent progress reports UI
- Free-user daily tutor requests are tracked in `usage_logs` (default limit: `5/day`).

### Stripe setup
1. Create two monthly recurring prices in Stripe Dashboard (Pro + Premium).
2. Copy Stripe **Price IDs** into:
   - `STRIPE_PRICE_ID_PRO_MONTHLY`
   - `STRIPE_PRICE_ID_PREMIUM_MONTHLY`
3. In Stripe Webhooks, add endpoint:
   - `https://<your-backend-domain>/api/billing/webhook`
4. Subscribe to events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Copy webhook signing secret into `STRIPE_WEBHOOK_SECRET`.
6. Set checkout return URLs via `APP_URL` so Stripe redirects to:
   - success: `https://<your-frontend-domain>/billing/success`
   - cancel: `https://<your-frontend-domain>/billing/cancel`

### Stripe env vars required
- `APP_URL` (full frontend URL, e.g. `https://codequest-ai-tutor.vercel.app`)
- `STRIPE_SECRET_KEY` (`sk_test_...` or `sk_live_...`)
- `STRIPE_PRICE_ID_PRO_MONTHLY` (`price_...`)
- `STRIPE_PRICE_ID_PREMIUM_MONTHLY` (`price_...`)
- `STRIPE_WEBHOOK_SECRET` (`whsec_...`)

### Local Stripe test steps
1. Start backend (`cd server && npm run dev`) and frontend (`cd client && npm run dev`).
2. Ensure local env vars are set (`APP_URL=http://localhost:5173`, Stripe keys/price/whsec).
3. Open `/pricing`, choose **Pro** or **Premium**, and complete Checkout.
4. Stripe should redirect to `/billing/success` and app should refresh billing state.
5. Confirm `GET /api/billing/status` returns `plan: "pro"`.
6. Cancel subscription in Stripe test mode and confirm webhook updates plan to `free`.

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
- `FREE_TIER_DAILY_TURNS`: daily assistant-turn cap for free users (default `5`)
- `TEACHER_EMAILS`: optional comma-separated allowlist for teacher signup role
- `DEMO_RATE_LIMIT_MAX`: max unauthenticated demo tutor requests per window (default `5`)

## Smoke tests
Run backend smoke tests:
```bash
cd server
npm test
```

Manual free-usage limit verification:
```bash
cd server
npm run test:usage-limit
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
- Saved lessons
- Assignment and class groups
- Teacher/parent analytics dashboard
