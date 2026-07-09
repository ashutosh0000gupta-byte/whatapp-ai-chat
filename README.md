# 🍽️ WhatsApp CRM AI — Restaurant Edition

> AI-powered CRM for restaurants using **Meta WhatsApp Cloud API**, **Supabase**, and **Google Gemini**.

---

## 🏗️ Architecture

```
Customer (WhatsApp)
      ↓
Meta Webhook  →  Express Server (port 3000)
                      ↓              ↓
                 Gemini AI      Supabase DB
                      ↓
                 WhatsApp Reply
                      ↓
              React Dashboard (port 5173)
```

---

## 🚀 Quick Start

### 1. Clone & Install Backend

```bash
cd whatapp-ai-chat
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your real credentials:

| Variable | Where to get it |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API → service_role key |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) |
| `META_ACCESS_TOKEN` | Meta Developer Console → WhatsApp → API Setup |
| `META_PHONE_NUMBER_ID` | Meta Developer Console → WhatsApp → API Setup |
| `WEBHOOK_VERIFY_TOKEN` | Choose any random string (e.g. `my-secret-token-123`) |

### 3. Set Up Supabase Database

1. Go to [supabase.com](https://supabase.com) → your project
2. Open **SQL Editor**
3. Paste and run the entire contents of `supabase/schema.sql`

### 4. Start the Backend

```bash
npm run dev       # development (auto-restart)
# or
npm start         # production
```

Server starts at `http://localhost:3000`

✅ Test: `http://localhost:3000/health`

---

### 5. Register Meta Webhook

1. Go to [Meta Developer Console](https://developers.facebook.com) → your WhatsApp app
2. Navigate to **WhatsApp → Configuration → Webhooks**
3. Set **Callback URL**: `https://your-domain.com/webhook`
4. Set **Verify Token**: same value as `WEBHOOK_VERIFY_TOKEN` in `.env`
5. Subscribe to: `messages`

> 💡 For local testing, use **ngrok**: `ngrok http 3000` and use the ngrok URL.

---

### 6. Start the Dashboard

```bash
cd dashboard
npm install
npm run dev
```

Dashboard opens at `http://localhost:5173`

---

## 📁 Project Structure

```
whatapp-ai-chat/
├── src/
│   ├── index.js                    ← Express server entry point
│   ├── routes/
│   │   ├── webhook.js              ← Meta webhook (GET verify + POST receive)
│   │   └── api.js                  ← REST API for dashboard
│   ├── services/
│   │   ├── gemini.js               ← AI intent detection & reply generation
│   │   ├── whatsapp.js             ← Meta Cloud API wrapper
│   │   └── supabase.js             ← All DB operations
│   └── handlers/
│       ├── messageHandler.js       ← Main orchestrator pipeline
│       └── dbActionExecutor.js     ← Executes Gemini's db_action JSON
├── supabase/
│   └── schema.sql                  ← Full PostgreSQL schema
├── dashboard/                      ← React + Vite agent dashboard
│   └── src/
│       ├── App.jsx                 ← Sidebar + routing
│       ├── api.js                  ← API client
│       └── pages/
│           ├── Overview.jsx        ← KPI cards + pipeline summary
│           ├── Pipeline.jsx        ← Kanban lead board
│           ├── Chats.jsx           ← Conversation view + manual reply
│           ├── Tickets.jsx         ← Support escalations
│           └── Reservations.jsx    ← Table bookings
└── .env.example
```

---

## 🤖 How the AI Works

Every WhatsApp message goes through this pipeline:

1. **Receive** → webhook receives the message
2. **Upsert Customer** → find or create in Supabase
3. **Fetch History** → last 10 messages for context
4. **Gemini AI** → returns `{ intent, reply, db_action }`
5. **Execute DB Action** → insert/update Supabase
6. **Send Reply** → WhatsApp Cloud API
7. **Log Everything** → full audit trail in `messages` table

### Example AI Response

```json
{
  "intent": "booking",
  "reply": "Great! Table for 4 on Saturday at 7pm 🍽️ May I have your name and any special occasion?",
  "db_action": {
    "insert": {
      "table": "reservations",
      "data": {
        "party_size": 4,
        "reserved_time": "19:00:00",
        "status": "pending"
      }
    }
  }
}
```

---

## 📊 Dashboard Features

| Page | Features |
|---|---|
| **Overview** | KPI cards, pipeline summary, quick actions |
| **Pipeline** | Kanban board — new → qualified → converted → lost |
| **Conversations** | All chats, message history, manual reply |
| **Reservations** | Table bookings, confirm/cancel/complete |
| **Tickets** | Escalations, priority flags, resolve/escalate |

---

## 🔔 Automated Reminders

The server runs a cron job every **60 seconds** that:
- Checks `reminders` table for entries where `scheduled_at <= NOW()` and `sent = false`
- Sends the reminder via WhatsApp
- Marks as sent with timestamp

Reservations automatically create a reminder 2 hours before the booking.

---

## 🔒 Security Notes

- Uses **Supabase service role key** on backend (never expose to frontend)
- **Helmet.js** for HTTP security headers
- **Rate limiting** on webhook (1000 req/min) and API (200 req/min)
- Webhook deduplication prevents double-processing Meta retries

---

## 🌐 Deploying to Production

1. Deploy backend to **Railway**, **Render**, or **EC2**
2. Set all environment variables in your hosting platform
3. Point Meta webhook to `https://your-production-url.com/webhook`
4. Deploy dashboard to **Vercel** or **Netlify** with `VITE_API_URL` set

---

## 🆘 Troubleshooting

| Issue | Solution |
|---|---|
| Webhook verification fails | Check `WEBHOOK_VERIFY_TOKEN` matches Meta console |
| No Gemini response | Check `GEMINI_API_KEY` and model name |
| Supabase errors | Verify `SUPABASE_SERVICE_KEY` (service_role, not anon) |
| WhatsApp not sending | Check `META_ACCESS_TOKEN` and `META_PHONE_NUMBER_ID` |
