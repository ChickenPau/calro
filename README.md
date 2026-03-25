# AI Nutrition Coach Telegram Bot 🏃‍♂️

A production-ready Telegram Bot that analyzes food photos using Google Gemini 1.5 Flash API to provide instant nutritional breakdown and running performance optimization tips.

## 🚀 Features

- **Photo Analysis**: Send any food photo to get Calories, Protein, Carbs, and Fats estimates.
- **Sports Nutrition**: Get personalized tips for running performance and power-to-weight ratio.
- **Daily Tracking**: View today's nutrition totals and macro percentages with `/stats`.
- **History**: View your last 10 entries with `/history`.
- **Data Export**: Download your entire history in CSV format with `/export`.
- **Performance**: SQLite database with triggers for real-time daily summary aggregation.
- **Security**: Rate limiting, file size validation, and input sanitization.

## 🛠 Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript
- **Bot Framework**: Telegraf
- **Database**: SQLite (better-sqlite3)
- **AI**: Google Gemini 1.5 Flash
- **Logging**: Winston
- **Validation**: Zod
- **Date Handling**: date-fns

## 📋 Prerequisites

- Node.js 18 or higher
- Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- Google Gemini API Key (from [Google AI Studio](https://aistudio.google.com/))

## ⚙️ Setup

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd calro
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   Copy `.env.example` to `.env` and fill in your keys:
   ```bash
   cp .env.example .env
   ```

4. **Build the project**:
   ```bash
   npm run build
   ```

5. **Start the bot**:
   ```bash
   npm start
   ```

For development:
```bash
npm run dev
```

## 🚂 Railway Deployment (Recommended)

1. **Push code to GitHub**: Create a private repository and push your project.
2. **Connect to Railway**:
   - Go to [Railway.app](https://railway.app/) and create a new project.
   - Connect your GitHub repository.
3. **Configure Environment Variables**:
   In Railway's **Variables** tab, add:
   - `TELEGRAM_BOT_TOKEN`: Your token from @BotFather
   - `GEMINI_API_KEY`: Your key from Google AI Studio
   - `GEMINI_MODEL` (optional): Example `gemini-1.5-flash`
   - `DATABASE_URL`: `/app/database/calro.db` (This is already set in Dockerfile, but good to have)
   - `NODE_ENV`: `production`
4. **Persistent Storage (CRITICAL)**:
   - Go to the **Volumes** tab in your Railway service.
   - Click **Add Volume**.
   - Set the mount path to: `/app/database`
   - This ensures your nutrition data isn't deleted when the bot restarts.

## 🧪 Testing

```bash
npm test
```

## 🐳 Docker Deployment

1. **Build the image**:
   ```bash
   docker build -t ai-nutrition-coach .
   ```

2. **Run the container**:
   ```bash
   docker run -d \
     --name calro-bot \
     -e TELEGRAM_BOT_TOKEN=your_token \
     -e GEMINI_API_KEY=your_key \
     -v $(pwd)/database:/app/database \
     ai-nutrition-coach
   ```

## 📂 Project Structure

- `src/index.ts`: Main entry point and bot controllers.
- `src/services/`: Business logic and AI integration.
- `src/repositories/`: Data access layer for SQLite.
- `src/models/`: TypeScript interfaces and validation schemas.
- `database/init.sql`: SQL schema and triggers.
- `tests/`: Unit tests.

## 📄 License

ISC
