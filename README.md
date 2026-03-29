# Calro — Your AI Nutrition Coach on Telegram

Calro is a friendly Telegram bot that helps you **log meals fast**, **track calories/macros**, and **get simple coaching tips**—right inside chat.
Snap a food photo, type what you ate, or ask the Coach anything about nutrition and habits.

---

## What Calro does (in 1 minute)

- **Log a meal from a photo** → get estimated calories + macros + a short tip
- **Log a meal from text** (e.g., “I ate laksa”) → quick estimates without a photo
- **See today’s progress** toward your calorie goal
- **Review history** and **delete wrong entries** (totals update immediately)
- **Ask the Coach** using quick suggestion buttons or your own questions

---

## Goals (why this exists)

- Make meal logging **effortless** (no extra app, no spreadsheets)
- Give you **useful feedback** (calories/macros + coaching in plain language)
- Keep daily totals **accurate and up to date** (including after deletions)
- Run smoothly in production (Docker + Railway deployment ready)

---

## What’s included (features)

### Meal logging
- **Photo logging** with Gemini image analysis
- **Text logging** for quick manual entries
- Safety checks like **rate limiting** and **image size validation**

### Tracking
- **Daily stats**: calories, macros, and a progress bar
- **Weekly view**: a quick look at recent calorie totals

### History (fix mistakes easily)
- Shows your recent meals
- Each entry includes a **🗑 Delete** button
- A **confirmation step** prevents accidental deletion
- After deletion, your **daily totals recalculate immediately** and stay correct in the database

### Coach mode (dual input)
- A **suggestion panel** with quick question buttons
- You can also **type freely anytime**
- Conversation stays consistent because the bot keeps your **coach memory/context**

### Export
- Download your history as **CSV** via the **📄 Export** button or `/export`

---

## How it works (friendly architecture overview)

Calro has 4 main pieces:

1) **Telegram Bot (Telegraf)**
Handles commands, messages, photos, and button taps.

2) **AI Layer (Gemini)**
- Uses a **text model** for chat + text logging
- Uses a **stronger image model** for photo recognition

### Our Gemini guide rules (food photos)
When you send a food photo, we instruct Gemini to follow these rules to keep results consistent and “local-aware”:

- **Identify the dish first** (especially Singapore hawker staples, but also Western/Indian/Chinese/other cuisines)
- **Use HPB-style baselines** when possible (example: a standard Duck Rice is around ~700 kcal), then adjust based on what’s shown
- **Scale by portion cues** (spoon/chopsticks/bowl or plate rim) to estimate serving size
- **Portion sanity cap**: a normal single-person meal should not exceed **900 kcal** unless it clearly looks like a large sharing portion
- **If unclear/blurry**: ask a short clarification question instead of guessing wildly

For reliability, the bot asks Gemini to return a **strict JSON** response (dish name + kcal breakdown + total + optional clarification question). The bot then formats it into a clean Telegram message.

Example output (what you’ll see in Telegram):

```text
🍽️ Dish Identified: Roasted Duck Rice

📊 Breakdown:
• Rice/Carbs: 320 kcal
• Meat/Protein: 280 kcal
• Sauce/Extras: 80 kcal

🔥 Total Calories: 680 kcal
```

3) **Database (SQLite)**
Stores your profile, meals, and coach memory.
Daily totals are stored as a “daily summary” so stats are fast.

4) **Health endpoint (Express)**
Railway can check `GET /health` to confirm the service is alive.

---

## Your main commands (Telegram)

- `/start` — start / restart onboarding
- `/profile` — view or update your profile
- `/stats` — today’s totals
- `/weekly` — weekly calorie summary
- `/history` — recent meals (with delete buttons)
- `/export` — download your log as CSV
- `/coach` — coach mode (buttons + free text)

---

## Tech stack (what we’re using)

- **Node.js** (Docker uses Node 18 Alpine)
- **TypeScript**
- **Telegraf** (Telegram bot framework)
- **Google Gemini** via `@google/generative-ai`
- **SQLite** via `better-sqlite3`
- **Winston** logging
- **Zod** validation
- **Axios** (download images from Telegram)
- **date-fns**, **csv-writer**
- **Docker** + **Railway**
- **Jest** tests + GitHub Actions CI

---

## Configuration (environment variables)

### Required
- `TELEGRAM_BOT_TOKEN`

### For AI
- `GEMINI_API_KEY`

Recommended (fast + cost-friendly routing):
- `GEMINI_TEXT_MODEL` (example: `gemini-2.5-flash-lite`)
- `GEMINI_IMAGE_MODEL` (example: `gemini-2.5-flash`)

Optional:
- `GEMINI_MODEL` (legacy single-model fallback)
- `DATABASE_URL` (default: `database/calro.db`)
- `PORT` (default: `3000`)
- `LOG_LEVEL` (default: `info`)
- `NODE_ENV`

---

## Railway notes (important)

- Use **1 replica** for Telegram polling bots. More than one instance can cause `409 Conflict`.
- Add a **Volume** mounted at `/app/database` so your SQLite data doesn’t reset on redeploy.
- Redeploy after updating variables so the bot picks up changes.

---

## A quick note about accuracy

Calorie and macro estimates are best-effort. Portion size and photo clarity matter, so treat results as helpful guidance—not medical advice.
