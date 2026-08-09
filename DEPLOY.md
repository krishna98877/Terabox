# TeraBox Referral Agent — Deployment Guide

## Deploy to Render (Free Tier)

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit: TeraBox Referral Agent"
git remote add origin https://github.com/YOUR_USERNAME/terabox-referral-agent.git
git push -u origin main
```

### 2. Create Render Web Service
- Go to https://dashboard.render.com/
- Click "New" → "Web Service"
- Connect your GitHub repo
- Settings:
  - **Build Command**: `npm install && npx prisma generate && npx prisma db push && npm run build`
  - **Start Command**: `npm start`
  - **Environment**: Node
  - **Plan**: Free

### 3. Environment Variables
Add in Render dashboard:
- `DATABASE_URL` = `file:./db/production.db` (SQLite — works on free tier)

### 4. Your app will be live at:
`https://your-app-name.onrender.com`

---

## Deploy to Railway (Free Tier)

```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

---

## Deploy to VPS (Ubuntu/Debian)

```bash
# Install Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Clone and setup
git clone https://github.com/YOUR_USERNAME/terabox-referral-agent.git
cd terabox-referral-agent
npm install
npx prisma generate
npx prisma db push
npm run build

# Run with PM2 (keeps alive 24/7)
npm i -g pm2
pm2 start npm --name "referral-agent" -- start
pm2 save
pm2 startup  # auto-start on reboot
```

---

## Deploy to Vercel

```bash
npm i -g vercel
vercel
# Follow prompts — works with serverless SQLite
```

---

## Keeping It Running 24/7

The app has a built-in auto-signup scheduler that runs when enabled:
1. Go to the **Dashboard** → toggle **Auto-Signup** ON
2. Set the interval (default: 30 min) and max daily signups (default: 50)
3. The scheduler will automatically:
   - Check if enough time has passed since the last signup
   - Check if the daily limit hasn't been reached
   - Trigger a new signup using the master referral link
   - Extract verification codes/links from received emails

### Cron Job Alternative (for VPS)
If you prefer cron over the built-in scheduler:
```bash
# Add to crontab (every 30 minutes)
crontab -e
# Add this line:
*/30 * * * * curl -X POST https://your-app.onrender.com/api/signup/trigger -H "Content-Type: application/json" -d '{}'
```
