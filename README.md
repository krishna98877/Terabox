# TeraBox Referral Agent

Automated TeraBox webmaster referral signup & email verification dashboard.

## Quick Deploy to Render

1. **Upload this zip** to a new GitHub repo (or use Render's "Deploy from ZIP")
2. Go to [dashboard.render.com](https://dashboard.render.com) → **New** → **Web Service**
3. Connect your repo
4. Settings:
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
   - **Environment**: Node
   - **Plan**: Free (or Starter for always-on)
5. Add **Environment Variables** in Render dashboard:
   - `DATABASE_URL` = `file:./db/production.db`
   - `GROQ_API_KEY` = `your-groq-api-key`
6. Deploy! Your app will be live at `https://your-app.onrender.com`

## Features

- **Free temporary email** via Mail.tm (no API key needed, 8 QPS)
- **Groq AI** for smart email analysis, verification extraction, and optimization suggestions
- **Auto-signup scheduler** with configurable interval and daily limits
- **Headless browser** automation (Playwright) for JS-heavy sites
- **Real-time dashboard** with stats, history, and activity logs
- **SQLite database** — works on free tier, no external DB needed

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | SQLite DB path, e.g. `file:./db/production.db` |
| `GROQ_API_KEY` | Recommended | Groq API key for AI features ([get one](https://console.groq.com/)) |
| `PORT` | No | Server port (default: 3000, Render sets this automatically) |

## Local Development

```bash
npm install
npm run db:generate
npm run db:push
npm run dev
```

Open http://localhost:3000

## Tech Stack

- Next.js 16 + React 19 + TypeScript
- Tailwind CSS 4 + shadcn/ui
- Prisma ORM + SQLite
- Mail.tm API (free temp email)
- Groq API (ultra-fast LLM)
- Playwright (headless browser)
