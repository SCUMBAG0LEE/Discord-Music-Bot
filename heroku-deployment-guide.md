# Heroku Deployment Guide (via Docker + Cloudflare D1)

This guide provides step-by-step instructions on deploying the Discord Music Bot to Heroku using the Docker container stack, and configuring **Cloudflare D1** as a serverless database to achieve persistent server settings, playlists, and favorites.

---

---

## ⚡ Option 1: One-Click Deploy (using app.json)

If you have this project hosted on GitHub, you can deploy it instantly with Heroku's web interface using the provided `app.json` template:

1. Construct the deploy link using your GitHub repository URL:
   `https://heroku.com/deploy?template=https://github.com/your-github-username/your-repo-name`
2. Open that URL in your browser.
3. Heroku will automatically:
   - Set the stack to `container`.
   - Read `app.json` and prompt you to input the Config Vars (`BOT_TOKEN`, `CLIENT_ID`, etc.) via a user-friendly form.
   - Build the container and automatically start 1 eco/basic `worker` dyno.

---

## 🛠️ Option 2: Manual Deployment (via CLI)

Before you start, make sure you have:
1. The **Heroku CLI** installed and authenticated (`heroku login`).
2. A **Cloudflare Account** with access to Cloudflare Workers & Databases (D1 is free to use!).
3. A **Discord Bot Token** and client credentials from the Discord Developer Portal.

---

## 💾 Step 1: Set Up Cloudflare D1

Since Heroku containers use an ephemeral filesystem, we store our database in Cloudflare D1 (serverless SQLite).

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **Workers & Pages** -> **D1** (Databases).
3. Click **Create database** -> **D1 Database** (or create one via Wrangler).
4. Give it a name (e.g., `discord-music-bot`).
5. Once created, copy the following values:
   - **Database ID** (a UUID displayed under the database name).
   - **Account ID** (displayed in the URL or right panel, e.g., `https://dash.cloudflare.com/<ACCOUNT_ID>/workers/...`).
6. Generate an **API Token**:
   - Go to your profile -> **API Tokens** -> **Create Token**.
   - Select the **D1** template (or choose custom permissions with `Account.D1: Edit`).
   - Copy the API Token immediately (you won't be able to see it again).

---

## 🚀 Step 2: Initialize Heroku App

Create the Heroku application and switch its stack to use containers:

```bash
# 1. Create a new Heroku application
heroku create your-bot-app-name

# 2. Set the application stack to container (tells Heroku to look for heroku.yml and Dockerfile)
heroku stack:set container -a your-bot-app-name
```

---

## ⚙️ Step 3: Configure Environment Variables (Config Vars)

Set all required config variables on Heroku. Replace the placeholders with your actual values:

```bash
# Core Bot Variables
heroku config:set BOT_TOKEN="your_discord_bot_token" -a your-bot-app-name
heroku config:set CLIENT_ID="your_discord_client_id" -a your-bot-app-name
heroku config:set BOT_OWNER_ID="your_discord_user_id" -a your-bot-app-name

# Cloudflare D1 Database Variables
heroku config:set CLOUDFLARE_D1_ACCOUNT_ID="your_cloudflare_account_id" -a your-bot-app-name
heroku config:set CLOUDFLARE_D1_DATABASE_ID="your_cloudflare_database_id" -a your-bot-app-name
heroku config:set CLOUDFLARE_D1_API_TOKEN="your_cloudflare_api_token" -a your-bot-app-name

# Optional settings
heroku config:set LOG_LEVEL="INFO" -a your-bot-app-name
heroku config:set ACTIVITY_TYPE="LISTENING" -a your-bot-app-name
heroku config:set ACTIVITY_NAME="music | /help" -a your-bot-app-name
heroku config:set YOUTUBE_PROXY="socks5://username:password@ip:port" -a your-bot-app-name
heroku config:set YOUTUBE_COOKIES="" -a your-bot-app-name
```

---

## 📦 Step 4: Deploy Using Git

Deploy the bot code to Heroku. Heroku will automatically detect `heroku.yml`, build the `Dockerfile` inside their secure cloud servers, and run the container.

```bash
# 1. Add Heroku remote if not already done
heroku git:remote -a your-bot-app-name

# 2. Add and commit all changes (including Dockerfile, heroku.yml, and .dockerignore)
git add .
git commit -m "Configure Docker, Heroku, and Cloudflare D1"

# 3. Push code to Heroku (usually master or main branch)
git push heroku main
```

---

## ⚙️ Step 5: Enable Worker Dyno (CRITICAL!)

Discord bots do not run HTTP web servers. By default, Heroku spins up a `web` dyno which will crash due to port binding boot timeouts (Error R10). 

We defined the bot as a `worker` process in `heroku.yml`. You must turn off the `web` process and scale up the `worker` process:

```bash
# 1. Disable the web process (scale to 0)
heroku ps:scale web=0 -a your-bot-app-name

# 2. Enable the worker process (scale to 1)
heroku ps:scale worker=1 -a your-bot-app-name
```

To view the live application logs and confirm startup:
```bash
heroku logs --tail -a your-bot-app-name
```

---

## 🔄 Updating the Bot / Databases

- **Updating the Bot**: Whenever you push code changes to the Heroku Git remote, Heroku automatically rebuilds the Docker container and restarts the bot cleanly.
- **Database Self-Healing**: On the first start, the bot automatically checks your Cloudflare D1 database and runs the necessary `CREATE TABLE` commands. You do not need to manually configure schemas in D1!
