# AI Multi-Platform Auto-Poster

Backend that generates two AI videos daily from the same script — a **short** version and a **long** version — and publishes them automatically: the short video to **Instagram Reels**, and the long video to **YouTube** and **Facebook**. No manual steps, no database.

This is the current version of the project. It replaces the earlier single-image, Instagram-only, MongoDB-backed version (that spec has been removed from this README — see "Legacy Data Note" below for what to do with any leftover data from it).

---

## Overview

- Generates a script + caption with Gemini
- Generates **two videos** from that script — either:
  - **Option A:** native AI video generation (Google Veo, via the Gemini API), or
  - **Option B:** assembled video — TTS narration + AI-generated images stitched together with `ffmpeg` (Ken Burns style)
  - **Short cut** (~30–60s, vertical) — trimmed/condensed script, for Instagram only
  - **Long cut** (2–5+ min, can be landscape or vertical) — full script, for YouTube and Facebook
- Uploads both finished videos to Cloudinary to get public URLs
- Publishes:
  - Short video → Instagram Reels (Instagram Graph API)
  - Long video → YouTube (standard upload, YouTube Data API v3)
  - Long video → Facebook (standard Page video post, Facebook Graph API — not Reels, since it's no longer short-form)
- Runs on a daily cron schedule, with a manual `run-now` trigger for testing
- **No database** — each run writes a plain JSON log file instead of persisting to MongoDB

**Note on NotebookLM:** NotebookLM has no public API, so it can't be called from this pipeline directly. Option B's TTS step (Google TTS or ElevenLabs) is the automatable replacement for it — same "narrated" feel, but fully scriptable end-to-end with no manual export step.

---

## Our Plan (decided flow)

This is the actual daily run, end to end, as planned:

1. **Script** — Gemini API generates the day's full script + caption + hashtags from a rotating topic list, plus a condensed/trimmed version for the short cut.
2. **Voice** — TTS (Google TTS / ElevenLabs) narrates both the short script and the long script (two audio files). This is the automated stand-in for NotebookLM.
3. **Video assembly** — `ffmpeg` renders two MP4s: a short vertical cut (narration + images + waveform + captions, ~30–60s) and a long cut (full narration + images + captions, 2–5+ min).
4. **Hosting** — both finished MP4s are uploaded to Cloudinary to get public URLs (required by Instagram + Facebook).
5. **Publish, in parallel, isolated per platform:**
   - YouTube — long video, direct file upload via Data API v3 (OAuth2 refresh token, set up once).
   - Facebook — long video, standard Page video post via Graph API using the long-lived Page token (not the Reels endpoint).
   - Instagram — short video, Reels media container created with the Cloudinary URL, polled until ready, then published.
6. **Orchestration** — `node-cron` fires this whole flow once a day; a `run-now` route lets you trigger it manually for testing.
7. **Logging** — no database; each run's script, caption, both video URLs, and per-platform success/failure is written to `logs/YYYY-MM-DD.json`.

Google Veo (Option A, native AI video) stays available as a swap-in for steps 2–3 later if you want native AI video generation instead of the TTS+images+ffmpeg assembly — but the decided default for now is Option B, since it's cheaper and already scriptable end-to-end.

---

## Stack

- Node.js + Express
- node-cron (scheduling)
- Gemini API (script + caption, and optionally video via Veo)
- `ffmpeg` / `fluent-ffmpeg` (video assembly, if using Option B)
- TTS provider (Google TTS or ElevenLabs, if using Option B)
- Cloudinary (video hosting — public URL required by Instagram + Facebook)
- YouTube Data API v3 (OAuth2 + refresh token)
- Instagram Graph API (Instagram Login, Reels — short video only)
- Facebook Graph API (Page-based, standard video post — long video)

No MongoDB, no Mongoose, no LangGraph, no token encryption layer — those all existed to support persistence and multi-account state that this version doesn't need.

---

## How It Works

1. `cron/scheduler.js` fires the daily job (`DAILY_POST_CRON`), or it's triggered manually via `POST /api/posts/run-now`
2. `services/scriptService.js` calls Gemini to generate `{ script, shortScript, caption, hashtags }` for the day, based on a rotating theme — `shortScript` is a condensed version of the same story for the Instagram cut
3. `services/videoService.js` produces **two** videos, one per length:
   - **Option A:** sends each script to Gemini's `generateVideos` (Veo) endpoint, polls until ready, downloads the result
   - **Option B:** `services/ttsService.js` narrates each script, matching images are generated, then `ffmpeg` assembles narration + images + captions + background music into two MP4s (`shortVideoPath`, `longVideoPath`)
4. `services/uploadService.js` uploads both finished MP4s to Cloudinary and returns two public video URLs (`shortVideoUrl`, `longVideoUrl`)
5. The three publishers run (independently — one platform failing doesn't block the others):
   - `services/youtubeService.js` uploads `longVideoUrl`/file directly via `videos.insert` (file upload, no public URL needed)
   - `services/instagramService.js` creates a `REELS` media container with `shortVideoUrl`, polls status, publishes
   - `services/facebookService.js` posts `longVideoUrl` to the connected Page via the standard `/{page-id}/videos` endpoint (long-form, not `/video_reels`)
6. The result of the run (script, caption, both video URLs, per-platform success/failure + post IDs) is written to `logs/YYYY-MM-DD.json`

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

### Meta App Review (important, start early)

- Posting to Instagram/Facebook outside of test/dev mode requires Meta to approve your app for the relevant permissions (`pages_manage_posts`, `instagram_content_publish`, etc.)
- This review can take several days, so submit it before you're relying on the daily cron in production

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
- [`src/services/videoService.js`](src/services/videoService.js) — produces both the short and long video (Option A: Veo, or Option B: ffmpeg assembly)
- [`src/services/ttsService.js`](src/services/ttsService.js) — narration audio generation for both scripts (Option B only)
- [`src/services/uploadService.js`](src/services/uploadService.js) — uploads both finished videos to Cloudinary
- [`src/services/youtubeService.js`](src/services/youtubeService.js) — YouTube long-form upload via Data API v3
- [`src/services/instagramService.js`](src/services/instagramService.js) — Instagram Reels container creation (short video), polling, publish
- [`src/services/facebookService.js`](src/services/facebookService.js) — Facebook Page long-form video publish
- [`src/pipeline/runDailyVideoPost.js`](src/pipeline/runDailyVideoPost.js) — orchestrates all of the above in order, per-platform error isolation, writes the day's log
- [`src/cron/scheduler.js`](src/cron/scheduler.js) — daily cron trigger
- [`src/routes/postRoutes.js`](src/routes/postRoutes.js) — health check + manual run-now route

---

## Data / State (No Database)

This version does not use MongoDB or any persistent database. Instead:

| What used to live in Mongo                   | Now lives here                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Account` collection (Instagram tokens)     | Long-lived tokens sit directly in `.env` (Instagram access token, Facebook Page token, YouTube refresh token)                |
| `Post` collection (per-run status)          | `logs/YYYY-MM-DD.json` — one file per day, written at the end of each pipeline run                                          |
| `Log` collection (per-stage debug entries)  | Same `logs/YYYY-MM-DD.json` file, includes a per-stage breakdown (script, video-gen, upload, and each of the 3 publishers)  |

Each log file looks roughly like:

```json
{
  "date": "2026-08-31",
  "script": "...",
  "shortScript": "...",
  "caption": "...",
  "shortVideoUrl": "https://res.cloudinary.com/.../short.mp4",
  "longVideoUrl": "https://res.cloudinary.com/.../long.mp4",
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

# --- Video length targets ---
SHORT_VIDEO_MAX_SECONDS=60
LONG_VIDEO_MIN_SECONDS=120

# --- Scheduler ---
DAILY_POST_CRON=0 9 * * *

# --- Manual trigger protection ---
TRIGGER_SECRET=
```

Removed from the previous version: `MONGO_URI` (no DB), `TOKEN_ENCRYPTION_KEY` (nothing is being encrypted-at-rest in a database anymore — tokens sit in `.env` directly, so keep `.env` out of version control), `GEMINI_IMAGE_MODEL` / Pollinations config (superseded by whichever video generation option is active), `TOKEN_REFRESH_CRON` (Facebook's long-lived Page token doesn't need a refresh cron; Instagram's token refresh can be re-added later if needed, but isn't part of this version yet).

---

## Manual Instagram Setup

1. Create or open your Meta Developer App
2. Add the Instagram product
3. Choose `API setup with Instagram login`
4. Confirm the Instagram account is Business or Creator
5. Copy the App ID and App Secret into `.env`
6. Make sure `INSTAGRAM_REDIRECT_URI` matches the redirect URI in the app settings exactly

## Manual Facebook Setup

1. In the same Meta Developer App, add the Page you want to post to under **App Roles → Roles**
2. Add `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, and `publish_video` permissions
3. Generate a long-lived **Page Access Token** for that Page (via Graph API Explorer or the standard token exchange) and put it in `.env` as `FACEBOOK_PAGE_ACCESS_TOKEN`
4. Note the Page's numeric ID as `FACEBOOK_PAGE_ID`

## Manual YouTube Setup

1. Create/select a project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable **YouTube Data API v3**
3. Create an **OAuth client ID** (Web application), with redirect URI matching `YOUTUBE_REDIRECT_URI`
4. Add your own Google account as a **Test User** on the OAuth consent screen
5. Run the app, visit `GET /api/auth/youtube`, approve access — the callback captures and logs the refresh token
6. Copy that refresh token into `.env` as `YOUTUBE_REFRESH_TOKEN` — this step only needs to happen once

---

## Legacy Data Note

An earlier version of this project stored connected accounts in MongoDB under a Page-based or Instagram Login schema, and only posted single-image content to Instagram. This version reads credentials directly from `.env` instead and posts a short video to Instagram Reels plus a long video to YouTube and Facebook. If you still have a MongoDB instance from that old setup, it is no longer used by this codebase and can be left alone or dropped — nothing here connects to it.

---

## Planned / Future Work

- Possible re-introduction of a lightweight persistence layer (SQLite or a simple DB) if a post-history dashboard or duplicate-run protection beyond same-day file checks becomes necessary.
- Possible Instagram token refresh cron re-added if long-lived tokens start expiring in practice.
- Possible per-platform caption/hashtag variants (currently one caption is reused for all three).