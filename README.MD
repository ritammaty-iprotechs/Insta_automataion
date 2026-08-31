# AI Multi-Platform Auto-Poster

Backend that generates a short AI video (script + voice + visuals, or a native AI video model) and publishes it automatically to **YouTube Shorts**, **Instagram Reels**, and **Facebook Reels** — daily, no manual steps, no database.

This is the current version of the project. It replaces the earlier single-image, Instagram-only, MongoDB-backed version.

---

## Overview

- Generates a script + caption with Gemini
- Generates a short video from that script — either:
  - **Option A:** native AI video generation (Google Veo, via the Gemini API), or
  - **Option B:** assembled video — TTS narration + AI-generated images stitched together with `ffmpeg` (Ken Burns style)
- Uploads the finished video to Cloudinary to get a public URL
- Publishes the same video to:
  - YouTube Shorts (YouTube Data API v3)
  - Instagram Reels (Instagram Graph API)
  - Facebook Reels (Facebook Graph API, Page-based)
- Runs on a daily cron schedule, with a manual `run-now` trigger for testing
- **No database** — each run writes a plain JSON log file instead of persisting to MongoDB

---

## Stack

- Node.js + Express
- node-cron (scheduling)
- Gemini API (script + caption, and optionally video via Veo)
- `ffmpeg` / `fluent-ffmpeg` (video assembly, if using Option B)
- TTS provider (Google TTS or ElevenLabs, if using Option B)
- Cloudinary (video hosting — public URL required by Instagram + Facebook)
- YouTube Data API v3 (OAuth2 + refresh token)
- Instagram Graph API (Instagram Login, Reels)
- Facebook Graph API (Page-based, Reels)

No MongoDB, no Mongoose, no LangGraph, no token encryption layer — those all existed to support persistence and multi-account state that this version doesn't need.

---

## How It Works

1. `cron/scheduler.js` fires the daily job (`DAILY_POST_CRON`), or it's triggered manually via `POST /api/posts/run-now`
2. `services/scriptService.js` calls Gemini to generate `{ script, caption, hashtags }` for the day, based on a rotating theme
3. `services/videoService.js` produces the video:
   - **Option A:** sends the script to Gemini's `generateVideos` (Veo) endpoint, polls until ready, downloads the result
   - **Option B:** `services/ttsService.js` turns the script into narration audio, still images are generated to match it, then `ffmpeg` assembles narration + images + captions + background music into one MP4
4. `services/uploadService.js` uploads the finished MP4 to Cloudinary and returns a public video URL
5. The three publishers run (independently — one platform failing doesn't block the others):
   - `services/youtubeService.js` uploads directly via `videos.insert` (file upload, no public URL needed)
   - `services/instagramService.js` creates a `REELS` media container with `video_url`, polls status, publishes
   - `services/facebookService.js` posts to the connected Page via `/{page-id}/video_reels` with the same `video_url`
6. The result of the run (script, caption, video URL, per-platform success/failure + post IDs) is written to `logs/YYYY-MM-DD.json`

---

## Setup Requirements

### Instagram

- The Instagram account must be Business or Creator
- The Meta Developer App must use the Instagram product, set up via **API setup with Instagram login**
- No Facebook Login is used for the Instagram side

### Facebook

- Uses the **same Meta Developer App** as Instagram, extended with Page permissions
- Requires the Page added under **App Roles → Roles**, plus `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, and `publish_video` permissions
- Needs a **Page Access Token** (separate from the Instagram user token) — a long-lived Page token is sufficient for a single-page personal setup and doesn't need a refresh cron

### YouTube

- Separate Google Cloud project with **YouTube Data API v3** enabled
- OAuth2 client (Web application type), with your own account added as a Test User on the consent screen
- One-time authorization flow to obtain a **refresh token**, stored in `.env` and reused indefinitely afterward — this is the only manual step; everything after is automated

---

## Local Setup

1. Install dependencies with `npm install`
2. Copy `.env.example` to `.env`
3. Fill in the Gemini, Cloudinary, Instagram, Facebook, and YouTube values (see below)
4. If using Option B video generation, confirm `ffmpeg` is installed on the machine (`ffmpeg -version`)
5. Start the server with `npm run dev`
6. Run the YouTube one-time OAuth flow (`GET /api/auth/youtube` → approve → refresh token captured) before the first real post
7. Trigger a test run manually via `POST /api/posts/run-now` (protected by `TRIGGER_SECRET`) before relying on the cron

---

## API Routes

- `GET /api/auth/instagram` — start Instagram OAuth
- `GET /api/auth/instagram/callback` — Instagram OAuth redirect target
- `GET /api/auth/youtube` — start YouTube OAuth (one-time setup)
- `GET /api/auth/youtube/callback` — YouTube OAuth redirect target, captures refresh token
- `POST /api/posts/run-now` — manually triggers the full pipeline (requires `x-trigger-secret` header)
- `GET /api/health` — basic alive check

There is no `/api/posts` history list or `/api/account` status route in this version — those depended on MongoDB. Post outcomes now live in `logs/YYYY-MM-DD.json` instead of being queryable via an endpoint. This can be added back later as a simple "read the log files" route if a history view is ever needed, without requiring a database.

---

## Key Files

- [`src/services/scriptService.js`](src/services/scriptService.js) — Gemini script + caption generation
- [`src/services/videoService.js`](src/services/videoService.js) — video generation (Option A: Veo, or Option B: ffmpeg assembly)
- [`src/services/ttsService.js`](src/services/ttsService.js) — narration audio generation (Option B only)
- [`src/services/uploadService.js`](src/services/uploadService.js) — uploads finished video to Cloudinary
- [`src/services/youtubeService.js`](src/services/youtubeService.js) — YouTube Shorts upload via Data API v3
- [`src/services/instagramService.js`](src/services/instagramService.js) — Instagram Reels container creation, polling, publish
- [`src/services/facebookService.js`](src/services/facebookService.js) — Facebook Page Reels publish
- [`src/pipeline/runDailyVideoPost.js`](src/pipeline/runDailyVideoPost.js) — orchestrates all of the above in order, per-platform error isolation, writes the day's log
- [`src/cron/scheduler.js`](src/cron/scheduler.js) — daily cron trigger
- [`src/routes/postRoutes.js`](src/routes/postRoutes.js) — health check + manual run-now route

---

## Data / State (No Database)

This version does not use MongoDB or any persistent database. Instead:

| What used to live in Mongo                   | Now lives here                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Account` collection (Instagram tokens)    | Long-lived tokens sit directly in`.env` (Instagram access token, Facebook Page token, YouTube refresh token)              |
| `Post` collection (per-run status)         | `logs/YYYY-MM-DD.json` — one file per day, written at the end of each pipeline run                                       |
| `Log` collection (per-stage debug entries) | Same`logs/YYYY-MM-DD.json` file, includes a per-stage breakdown (script, video-gen, upload, and each of the 3 publishers) |

Each log file looks roughly like:

```json
{
  "date": "2026-08-31",
  "script": "...",
  "caption": "...",
  "videoUrl": "https://res.cloudinary.com/.../video.mp4",
  "platforms": {
    "youtube": { "success": true, "videoId": "..." },
    "instagram": { "success": true, "mediaId": "..." },
    "facebook": { "success": false, "error": "..." }
  }
}
```

If a real post history UI or duplicate-run protection beyond a same-day file check is ever needed, this can be upgraded to a lightweight database later — but it isn't required for the current single-account, single-post-per-day scope.

---

## Environment Variables

```env
# --- Server ---
PORT=5000
NODE_ENV=development

# --- Gemini API (script + caption, and optionally video via Veo) ---
GEMINI_API_KEY=
GEMINI_TEXT_MODEL=gemini-3.6-flash
GEMINI_VIDEO_MODEL=veo-3.0-generate-001

# --- Cloudinary (video hosting — required for Instagram + Facebook video_url) ---
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# --- Instagram (Graph API, Instagram Login) ---
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
INSTAGRAM_REDIRECT_URI=http://localhost:5000/api/auth/instagram/callback
INSTAGRAM_ACCESS_TOKEN=
INSTAGRAM_USER_ID=

# --- Facebook Page (Graph API, same Meta app as Instagram) ---
FACEBOOK_PAGE_ID=
FACEBOOK_PAGE_ACCESS_TOKEN=

# --- YouTube (Data API v3, OAuth2) ---
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REDIRECT_URI=http://localhost:5000/api/auth/youtube/callback
YOUTUBE_REFRESH_TOKEN=

# --- TTS (Option B only) ---
TTS_PROVIDER=google
ELEVENLABS_API_KEY=

# --- Scheduler ---
DAILY_POST_CRON=0 9 * * *

# --- Manual trigger protection ---
TRIGGER_SECRET=
```

Removed from the previous version: `MONGO_URI` (no DB), `TOKEN_ENCRYPTION_KEY` (nothing is being encrypted-at-rest in a database anymore — tokens sit in `.env` directly, so keep `.env` out of version control), `GEMINI_IMAGE_MODEL` / Pollinations config (superseded by whichever video generation option is active), `TOKEN_REFRESH_CRON` (Facebook's long-lived Page token doesn't need a refresh cron; Instagram's token refresh can be re-added later if needed, but isn't part of this version yet).

---

## Manual Instagram Setup (unchanged from before)

1. Create or open your Meta Developer App
2. Add the Instagram product
3. Choose `API setup with Instagram login`
4. Confirm the Instagram account is Business or Creator
5. Copy the App ID and App Secret into `.env`
6. Make sure `INSTAGRAM_REDIRECT_URI` matches the redirect URI in the app settings exactly

## Manual Facebook Setup (new)

1. In the same Meta Developer App, add the Page you want to post to under **App Roles → Roles**
2. Add `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, and `publish_video` permissions
3. Generate a long-lived **Page Access Token** for that Page (via Graph API Explorer or the standard token exchange) and put it in `.env` as `FACEBOOK_PAGE_ACCESS_TOKEN`
4. Note the Page's numeric ID as `FACEBOOK_PAGE_ID`

## Manual YouTube Setup (new)

1. Create/select a project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable **YouTube Data API v3**
3. Create an **OAuth client ID** (Web application), with redirect URI matching `YOUTUBE_REDIRECT_URI`
4. Add your own Google account as a **Test User** on the OAuth consent screen
5. Run the app, visit `GET /api/auth/youtube`, approve access — the callback captures and logs the refresh token
6. Copy that refresh token into `.env` as `YOUTUBE_REFRESH_TOKEN` — this step only needs to happen once

---

## Legacy Data Note

The old version stored connected accounts in MongoDB under a Page-based or Instagram Login schema. This version reads credentials directly from `.env` instead. If you still have a MongoDB instance from the old setup, it is no longer used by this codebase and can be left alone or dropped — nothing here connects to it.

---

## Planned / Future Work

- **Long-form video generation for Facebook and YouTube.** Right now the pipeline is built around one short-form video (Shorts/Reels length, under ~60s) posted identically to all three platforms. A future iteration will add a second, longer-form video generation path — likely a separate `videoService` mode (e.g. `LONG_FORM_ENABLED=true` or a second scheduled job) — for standard YouTube uploads and longer Facebook video posts, generated from a more detailed script rather than the short-form one. This will reuse the same Gemini script stage, Cloudinary hosting, and YouTube/Facebook publishers already built here, with a longer `ffmpeg` assembly (or longer Veo generation) as the main addition — Instagram is not part of this future long-form path since Reels stays short-form by design.
- Possible re-introduction of a lightweight persistence layer (SQLite or a simple DB) if a post-history dashboard or duplicate-run protection beyond same-day file checks becomes necessary.
- Possible Instagram token refresh cron re-added if long-lived tokens start expiring in practic

# IG Auto Poster Backend

Backend for an automated Instagram poster that generates a daily image and caption, uploads the image, and publishes it to one Instagram Business or Creator account using Instagram Login.

## Overview

- Generates captions with Gemini
- Generates images with Pollinations.ai (free, no API key required)
- Uploads images to Cloudinary
- Publishes posts through the Instagram Graph API
- Refreshes long-lived Instagram tokens on a cron schedule
- Stores account tokens encrypted in MongoDB

## Stack

- Node.js + Express
- MongoDB + Mongoose
- LangGraph
- Gemini API (captions)
- Pollinations.ai (images)
- Cloudinary
- Instagram API with Instagram Login

## How It Works

1. The user opens `GET /api/auth/instagram`
2. The backend redirects to `https://www.instagram.com/oauth/authorize`
3. Instagram returns an OAuth `code` to `GET /api/auth/instagram/callback`
4. The backend exchanges that code for a short-lived token, then a long-lived token
5. The backend encrypts and stores `igUserId`, `accessToken`, and `tokenExpiresAt`
6. The daily cron job generates content and publishes the post
7. The token refresh cron job renews long-lived tokens before expiry

## Setup Requirements

- The Instagram account must be Business or Creator
- The Meta Developer App must use the Instagram product
- In Meta, choose `API setup with Instagram login`
- No separate page setup is required
- No Facebook Login is used at any step

## Local Setup

1. Install dependencies with `npm install`
2. Copy `.env.example` to `.env`
3. Fill in the Instagram, Gemini, Cloudinary, MongoDB, and token encryption values
4. Start the server with `npm run dev`

## API Routes

- `GET /api/auth/instagram`
- `GET /api/auth/instagram/callback`
- `GET /api/account`
- `POST /api/posts/run-now`
- `GET /api/posts`
- `GET /api/posts/:id`
- `DELETE /api/posts/:id`

## Key Files

- [`src/config/instagram.js`](src/config/instagram.js) - Instagram API config and env vars
- [`src/services/instagramAuthService.js`](src/services/instagramAuthService.js) - OAuth exchange and token refresh
- [`src/services/instagramService.js`](src/services/instagramService.js) - Create media container, poll status, publish media
- [`src/services/aiService.js`](src/services/aiService.js) - Gemini captions and Pollinations.ai image generation
- [`src/controllers/authController.js`](src/controllers/authController.js) - Connect flow and account upsert
- [`src/controllers/tokenController.js`](src/controllers/tokenController.js) - Weekly token refresh logic
- [`src/models/Account.js`](src/models/Account.js) - Connected account schema
- [`src/cron/scheduler.js`](src/cron/scheduler.js) - Daily post trigger and token refresh cron jobs
- [`src/graph/postPipeline.js`](src/graph/postPipeline.js) - AI generation and publish pipeline

## Data Model

### Account

| Field              | Type    | Notes                                         |
| ------------------ | ------- | --------------------------------------------- |
| `igUserId`       | String  | Instagram user ID returned by Instagram Login |
| `igUsername`     | String  | Display only                                  |
| `accessToken`    | String  | Encrypted long-lived Instagram token          |
| `tokenExpiresAt` | Date    | Token expiry timestamp                        |
| `isActive`       | Boolean | Whether the account is used for auto-posting  |

### Post

| Field             | Type     | Notes                                                  |
| ----------------- | -------- | ------------------------------------------------------ |
| `accountId`     | ObjectId | Refers to`Account`                                   |
| `caption`       | String   | AI-generated caption                                   |
| `imageUrl`      | String   | Public Cloudinary image URL                            |
| `igCreationId`  | String   | Media container ID                                     |
| `igMediaId`     | String   | Published Instagram media ID                           |
| `status`        | String   | `pending`, `processing`, `posted`, or `failed` |
| `scheduledTime` | Date     | Time the post was scheduled                            |
| `publishedAt`   | Date     | Set when publish succeeds                              |
| `errorMessage`  | String   | Populated when a run fails                             |

### Log

| Field       | Type     | Notes                      |
| ----------- | -------- | -------------------------- |
| `postId`  | ObjectId | Refers to`Post`          |
| `stage`   | String   | Pipeline stage name        |
| `status`  | String   | `success` or `failure` |
| `message` | String   | Human-readable details     |

## Environment Variables

```env
# --- Server ---
PORT=5000
NODE_ENV=development

# --- MongoDB ---
MONGO_URI=mongodb://localhost:27017/Instagram

# --- Token Encryption ---
TOKEN_ENCRYPTION_KEY=

# --- Instagram Login ---
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
INSTAGRAM_REDIRECT_URI=http://localhost:5000/api/auth/instagram/callback

# --- Gemini API (captions only) ---
GEMINI_API_KEY=
GEMINI_TEXT_MODEL=gemini-3.6-flash

# --- Cloudinary ---
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# --- Scheduler ---
DAILY_POST_CRON=0 9 * * *
TOKEN_REFRESH_CRON=0 3 * * 1
```

Note: image generation uses Pollinations.ai directly (`https://image.pollinations.ai`), which requires no API key. Gemini is used for captions only.

## Manual Instagram Setup

1. Create or open your Meta Developer App
2. Add the Instagram product
3. Choose `API setup with Instagram login`
4. Confirm the Instagram account is Business or Creator
5. Copy the App ID and App Secret into `.env`
6. Make sure `INSTAGRAM_REDIRECT_URI` matches the redirect URI in the app settings exactly

## Legacy Data Note

If your MongoDB still has accounts created under the old Page-based flow, they are not compatible with the current schema. Delete those legacy documents and reconnect the account through `GET /api/auth/instagram`.
