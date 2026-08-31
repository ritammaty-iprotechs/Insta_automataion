
# AI Multi-Platform Auto-Poster — Complete Build Plan (Zero to Live)

This is the full step-by-step plan for building this system from scratch: every account you need to create, every credential to generate, every file to write, every test to run, all the way to it running live and unattended. Follow it top to bottom, in order — later phases depend on earlier ones being done first.

---

## 0. End Goal (read this first)

A server that, once a day (or on-demand), automatically:

1. Writes a script + caption with Gemini
2. Turns that script into a short video (AI-generated or assembled)
3. Hosts that video at a public URL
4. Publishes it to YouTube Shorts, Instagram Reels, and Facebook Reels
5. Logs the result to a local file — no database involved

By the end of this plan, that entire loop runs by itself on a schedule.

---

## 1. Prerequisites Checklist

Before writing any code, make sure you have:

- [ ] Node.js installed (v18+ recommended) — check with `node -v`
- [ ] `ffmpeg` installed and on PATH — check with `ffmpeg -version` (only required if you choose Option B video generation, see Phase 4)
- [ ] A Gemini API key (Pro tier, which you already have)
- [ ] A Google account that owns/manages the Instagram Business or Creator account
- [ ] A Facebook Page connected to that same account (or one you can create/manage)
- [ ] A Cloudinary account (free tier is fine to start)
- [ ] A code editor and terminal you're comfortable in
- [ ] Decided: **Option A (Veo native video generation)** or **Option B (assembled video via TTS + images + ffmpeg)** — see Phase 4 before going further, since it changes what you build in that phase

---

## 2. Phase 0 — Accounts & Credentials (do this before any code)

Nothing in later phases works without these. Do all of Phase 0 first, in this order.

### 2.1 Gemini API (already have this)

- Confirm your key works: log into [Google AI Studio](https://aistudio.google.com), confirm the Pro key is active
- If going with **Option A**, also confirm Veo is enabled on that same project — check under the video generation section of AI Studio. If it's not available, fall back to Option B without losing any other progress.

### 2.2 Cloudinary

1. Sign up at [cloudinary.com](https://cloudinary.com) if you haven't already
2. From the dashboard, copy:
   - Cloud name
   - API key
   - API secret
3. Keep these open — they go into `.env` in Phase 3

### 2.3 Meta Developer App — Instagram side

1. Go to [developers.facebook.com](https://developers.facebook.com) → **Create App**
2. Pick any use case (e.g. "Other"), name it, create it
3. On the dashboard, **Add use case** → filter **All** → find **"Manage messaging & content on Instagram"** → Save
4. Left sidebar → **Instagram API** → **API setup with Instagram login** (not the Facebook-login version)
5. Copy the **Instagram App ID** and **Instagram App Secret** shown on that page
6. Under **"Add required permissions"**, click **Add all required permissions**
7. Under **App Roles → Roles**, add your Instagram account as an **Instagram Tester**
8. On your phone, open Instagram → **Settings → Apps and websites → Tester invites** → **Accept**
9. Under **"Set up Instagram business login"**, enter the redirect URI: `http://localhost:5000/api/auth/instagram/callback`
10. For a quick manual token (useful for early testing before OAuth is wired up), use **"Generate token"** next to your tester account and copy it somewhere safe — you'll put it directly in `.env` as `INSTAGRAM_ACCESS_TOKEN`

### 2.4 Meta Developer App — Facebook Page side (same app, extended)

1. In the same app from 2.3, go to **App Roles → Roles** and confirm the Facebook account managing your Page has a role on the app
2. Add the **Facebook Login** or **Pages API** product if it's not already present
3. Request/confirm these permissions are attached to the app: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `publish_video`
4. Go to **Tools → Graph API Explorer**:
   - Select your app from the dropdown
   - Select your user, generate a User Access Token with the permissions above
   - Call `GET /me/accounts` — this returns your Pages, each with its own **Page Access Token**
   - Copy the Page ID and that Page's Access Token
5. Exchange that Page token for a **long-lived** version (Page tokens generated this way from a long-lived user token are typically already long-lived / non-expiring as long as the app stays active — verify this by checking the token's debug info at **Tools → Access Token Debugger**)
6. Save the Page ID as `FACEBOOK_PAGE_ID` and the token as `FACEBOOK_PAGE_ACCESS_TOKEN`

### 2.5 Google Cloud — YouTube Data API v3

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a new project (can be separate from whatever project your Gemini key lives under)
2. **APIs & Services → Library** → search **YouTube Data API v3** → **Enable**
3. **APIs & Services → OAuth consent screen**:
   - User type: External
   - Fill in the required app info (name, support email)
   - Add your own Google account under **Test users**
   - Leave it in "Testing" mode — no Google review needed for personal use
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:5000/api/auth/youtube/callback`
5. Copy the **Client ID** and **Client Secret**
6. You'll get the actual **refresh token** later in Phase 8, once the server exists and the OAuth route can run — that's expected, it's the one credential you can't get until the code is up

### 2.6 Credential Summary

By the end of Phase 0, you should have all of these ready to paste into `.env`:

```
GEMINI_API_KEY
CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET / INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_USER_ID
FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN
YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET   (refresh token comes later)
```

---

## 3. Phase 1 — Project Scaffolding

### 3.1 Create the project

```bash
mkdir ai-auto-poster && cd ai-auto-poster
npm init -y
```

### 3.2 Install dependencies

```bash
npm install express dotenv node-cron axios cloudinary googleapis
npm install fluent-ffmpeg          # only if Option B
npm install --save-dev nodemon
```

### 3.3 Create the folder structure

```bash
mkdir -p src/config src/services src/pipeline src/cron src/routes logs tmp
touch src/server.js
touch src/config/gemini.js src/config/youtube.js src/config/instagram.js src/config/facebook.js src/config/cloudinary.js
touch src/services/scriptService.js src/services/videoService.js src/services/ttsService.js
touch src/services/uploadService.js src/services/youtubeService.js src/services/instagramService.js src/services/facebookService.js
touch src/pipeline/runDailyVideoPost.js
touch src/cron/scheduler.js
touch src/routes/postRoutes.js
touch .env .env.example .gitignore
```

### 3.4 `.gitignore`

```
node_modules/
.env
logs/
tmp/
```

### 3.5 `package.json` scripts

Add to `package.json`:

```json
"scripts": {
  "dev": "nodemon src/server.js",
  "start": "node src/server.js"
}
```

---

## 4. Phase 2 — Environment Configuration

### 4.1 `.env`

Fill in everything gathered in Phase 0 (YouTube refresh token stays blank for now):

```env
# --- Server ---
PORT=5000
NODE_ENV=development

# --- Gemini API ---
GEMINI_API_KEY=
GEMINI_TEXT_MODEL=gemini-3.6-flash
GEMINI_VIDEO_MODEL=veo-3.0-generate-001

# --- Cloudinary ---
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# --- Instagram ---
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
INSTAGRAM_REDIRECT_URI=http://localhost:5000/api/auth/instagram/callback
INSTAGRAM_ACCESS_TOKEN=
INSTAGRAM_USER_ID=

# --- Facebook ---
FACEBOOK_PAGE_ID=
FACEBOOK_PAGE_ACCESS_TOKEN=

# --- YouTube ---
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
TRIGGER_SECRET=choose-a-random-string-here
```

Copy the same structure (with blank values) into `.env.example` so it's safe to commit.

### 4.2 Config files

Each file in `src/config/` just reads and exports its own slice of `process.env` — nothing else. For example, `src/config/cloudinary.js` configures and exports the Cloudinary SDK instance using the three Cloudinary env vars; `src/config/youtube.js` exports the client ID/secret/redirect URI/refresh token as one object for the OAuth2 client to consume; and so on for `gemini.js`, `instagram.js`, `facebook.js`. Keep these dumb on purpose — no logic, just `process.env` reads with a clear export shape, so every other file imports config from one place instead of touching `process.env` directly.

---

## 5. Phase 3 — Script & Caption Generation

**File:** `src/services/scriptService.js`

What this function needs to do:

1. Pick today's theme/topic — reuse the day-of-year rotation idea (e.g. 7 themes cycling by `dayOfYear % 7`) so content doesn't repeat every day
2. Build a prompt asking Gemini for three things at once, structured so they're easy to parse back out: a short video script (voiceover-style narration, timed to roughly 30-45 seconds when spoken), a caption for the social posts, and 5-8 relevant hashtags
3. Call the Gemini text model (`GEMINI_TEXT_MODEL`) with that prompt
4. Parse the response into `{ script, caption, hashtags }` — ask Gemini to respond in a strict JSON shape so this parsing step is a plain `JSON.parse`, not fragile string-splitting
5. Return that object to the pipeline

Test this file in isolation first, before touching video generation — run it standalone and print the output, confirm the script length and JSON shape are both reliable across a few different runs before moving on.

---

## 6. Phase 4 — Video Generation

Build **one** of these two, based on your Phase 0 decision.

### 6.1 Option A — Native video (Veo via Gemini API)

**File:** `src/services/videoService.js`

1. Send the script text from Phase 3 as the prompt to Gemini's `generateVideos` (Veo) endpoint, using `GEMINI_VIDEO_MODEL`
2. This call returns a long-running operation, not the video immediately — poll it (every 10-15s) until status is complete
3. Once complete, download the resulting video file to `tmp/` as an MP4
4. Return the local file path to the pipeline

This is the simpler path code-wise — one API, no ffmpeg — but budget for it taking 1-3+ minutes per run, and confirm your quota covers a daily run before relying on it.

### 6.2 Option B — Assembled video (TTS + images + ffmpeg)

**Files:** `src/services/ttsService.js` + `src/services/videoService.js`

**`ttsService.js`:**

1. Take the script text from Phase 3
2. Send it to your chosen TTS provider (Google TTS or ElevenLabs, based on `TTS_PROVIDER`)
3. Save the returned audio as an MP3/WAV in `tmp/`
4. Return the audio file path and its duration (needed in the next step to time the images correctly)

**`videoService.js`:**

1. Break the script into 3-5 visual beats (either by re-prompting Gemini for "one image prompt per beat" from the same script, or splitting the script by sentence and generating one image per sentence)
2. Generate one still image per beat (Pollinations.ai, same free no-key approach as before, or Gemini image generation)
3. Save each image to `tmp/`
4. Use `fluent-ffmpeg` to:
   - Apply a slow zoom/pan (Ken Burns effect) to each image, with duration proportional to the audio length divided across the number of beats
   - Overlay the narration audio track from `ttsService.js`
   - Optionally overlay burned-in captions (using ffmpeg's `drawtext` filter with the script text, or an `.srt` file if you want proper timed subtitles)
   - Optionally mix in a royalty-free background music track at low volume under the narration
   - Export as one vertical MP4 (1080×1920) to `tmp/`
5. Return the local file path to the pipeline

Test this file with a fixed, hardcoded script first (skip Gemini entirely for this test) so you can iterate on the ffmpeg command quickly without burning API calls each time.

---

## 7. Phase 5 — Video Hosting

**File:** `src/services/uploadService.js`

1. Take the local MP4 path from Phase 4
2. Upload it to Cloudinary with `resource_type: "video"`
3. Return the public `secure_url` Cloudinary gives back — this is the URL Instagram and Facebook will both fetch the video from
4. Optionally delete the local `tmp/` files after a successful upload to keep disk usage flat over time

Test this by uploading any sample MP4 manually first, confirm the returned URL is publicly reachable (open it in an incognito browser tab) before wiring it into the pipeline.

---

## 8. Phase 6 — Platform Publishers

Build and test these **one at a time, in this order** — YouTube first since its failure modes are the most self-contained (no polling, no container step).

### 8.1 YouTube — `src/services/youtubeService.js`

1. Build an OAuth2 client using `googleapis`, configured with `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, and `YOUTUBE_REDIRECT_URI`
2. Set its credentials using `YOUTUBE_REFRESH_TOKEN` (this is why Phase 8's one-time OAuth step has to happen before this can be tested for real)
3. Call `youtube.videos.insert` with:
   - `part: 'snippet,status'`
   - `snippet.title` and `snippet.description` built from the caption + hashtags from Phase 3, with `#Shorts` included
   - `snippet.categoryId` (e.g. `'22'` for People & Blogs, or whatever fits your content)
   - `status.privacyStatus: 'public'`
   - The video file itself streamed from the local `tmp/` path (or from the Cloudinary URL if you prefer, but a direct file upload is simpler and doesn't need Phase 5 to have run first for this one platform)
4. Return `{ success: true, videoId }` on success, `{ success: false, error }` on failure — never throw, so the pipeline can keep going to the next platform

### 8.2 Instagram — `src/services/instagramService.js` (update from the old image version)

1. `createMediaContainer()`: POST to the Instagram Graph API `/media` endpoint with `media_type=REELS`, `video_url` (the Cloudinary URL from Phase 5), and the caption — returns a `creation_id`
2. `checkContainerStatus()`: GET the container's status
3. `waitForContainerReady()`: poll every 5s, timeout after 60s (Reels containers can take longer to process than image containers did — consider extending this timeout to 90-120s)
4. `publishMedia()`: POST to `/media_publish` with the `creation_id`
5. `postReelToInstagram()`: runs all of the above in order, returns `{ success, mediaId }` or `{ success: false, error, failedStage }`

### 8.3 Facebook — `src/services/facebookService.js`

1. POST to `/{FACEBOOK_PAGE_ID}/video_reels` with `upload_phase=start` to initiate the upload session
2. Depending on the exact endpoint version, either supply the `video_url` directly for a hosted-URL upload, or follow the start/transfer/finish phases Facebook's Reels publishing API expects — check the current Graph API version's Reels publishing reference for the exact phase sequence, since Meta has changed this flow across versions
3. Once the video is attached, POST with `upload_phase=finish`, including the caption/description
4. Return `{ success: true, videoId }` or `{ success: false, error }`

### 8.4 Testing each publisher

For each one, write a tiny standalone test script that calls just that service with a real (but throwaway/test) video URL, and confirm the post actually appears on the platform before moving to the next publisher. Don't wire all three into the pipeline until each has been proven working individually — debugging three platforms at once inside a combined pipeline is much harder than debugging one at a time.

---

## 9. Phase 7 — Pipeline Orchestration

**File:** `src/pipeline/runDailyVideoPost.js`

1. Call `scriptService` → get `{ script, caption, hashtags }`
2. Call `videoService` (and `ttsService` first, if Option B) → get the local video file path
3. Call `uploadService` → get the public Cloudinary URL
4. Run all three publishers — `youtubeService`, `instagramService`, `facebookService` — each wrapped so that if one throws or returns `success: false`, it doesn't stop the other two from running. `Promise.allSettled` on the three publisher calls is the right shape here, not a plain `await` chain that would stop at the first failure
5. Assemble a result object combining the script/caption/videoUrl and each platform's outcome
6. Write that result object to `logs/YYYY-MM-DD.json` (create the `logs/` folder if it doesn't exist yet)
7. Return the result object to whatever called the pipeline (the cron job or the manual route)

---

## 10. Phase 8 — Scheduler & Routes

### 10.1 `src/routes/postRoutes.js`

- `GET /api/health` — returns `{ status: 'ok' }`
- `POST /api/posts/run-now` — checks the `x-trigger-secret` header against `TRIGGER_SECRET`, then calls `runDailyVideoPost()` and returns its result
- `GET /api/auth/youtube` — redirects to Google's OAuth consent screen with the right scopes (`https://www.googleapis.com/auth/youtube.upload`)
- `GET /api/auth/youtube/callback` — exchanges the returned `code` for tokens, and **logs the refresh token to the console** (this is a one-time-use debug step — copy that refresh token into `.env` as `YOUTUBE_REFRESH_TOKEN`, then this route has done its job)
- (Instagram's existing `/api/auth/instagram` + `/callback` routes carry over unchanged from before, if you're using the OAuth flow instead of the manually-generated token from Phase 0)

### 10.2 `src/cron/scheduler.js`

- Registers `runDailyVideoPost()` on the schedule defined by `DAILY_POST_CRON` using `node-cron`
- Optionally, before running, check whether `logs/<today>.json` already exists and skip if so — this is your same-day double-post guard, replacing what MongoDB used to do

### 10.3 `src/server.js`

Boot order:

1. Load `.env` via `dotenv`
2. Mount routes from `src/routes/postRoutes.js`
3. Start listening on `PORT`
4. Start the cron job from `src/cron/scheduler.js`

---

## 11. Phase 9 — Local End-to-End Testing

Do these in order, don't skip ahead:

1. `npm run dev`, confirm `GET /api/health` responds
2. Visit `GET /api/auth/youtube`, approve access, copy the refresh token from the console/logs into `.env`, restart the server
3. Call `scriptService` alone (via a quick throwaway script or a temporary debug route) — confirm the JSON shape is reliable
4. Call `videoService` alone with a fixed test script — confirm a valid MP4 lands in `tmp/` and plays correctly when opened manually
5. Call `uploadService` alone with that test MP4 — confirm the returned Cloudinary URL opens and plays in a browser
6. Call each publisher individually with that same test video URL — confirm each platform actually receives the post
7. Only once all of the above pass individually, call `POST /api/posts/run-now` for the first full end-to-end run
8. Check `logs/<today>.json` — confirm all three platforms show `success: true` and the post IDs are real
9. Manually delete or ignore that test log file, then let the cron fire naturally the next day (or temporarily set `DAILY_POST_CRON` to a few minutes from now to watch it trigger live) as the final confirmation

---

## 12. Phase 10 — Deployment

1. Pick a host that can run a long-lived Node process (Render, Railway, a small VPS, etc.) — this needs to be always-on for the cron to fire, not a serverless function that spins down
2. Push the code to a Git repo (with `.env` excluded via `.gitignore`, as already set up in Phase 1)
3. On the host, set every variable from `.env` as an environment variable in the host's dashboard — including the `YOUTUBE_REFRESH_TOKEN` you generated locally in Phase 9 (you don't need to redo the OAuth flow in production, the refresh token works wherever it's used)
4. Update `INSTAGRAM_REDIRECT_URI` and `YOUTUBE_REDIRECT_URI` in both `.env` (host) and in the Meta app / Google Cloud OAuth client settings to point at your real deployed URL instead of `localhost` — only needed if you plan to redo either OAuth flow from production; if the tokens already work, this step can wait
5. Deploy, confirm `GET /api/health` responds on the live URL
6. Trigger `POST /api/posts/run-now` once against the live deployment to confirm everything still works outside your local machine (file paths, `ffmpeg` availability, etc. — these are the most common things that work locally but break on a fresh server)
7. Leave the cron running and check `logs/` after the first scheduled run to confirm

---

## 13. Phase 11 — Going Live Checklist

- [ ] All three platforms tested individually and together at least once
- [ ] `TRIGGER_SECRET` is a real random value, not left blank
- [ ] `.env` is not committed to Git
- [ ] Server survives a restart without losing YouTube auth (refresh token is what makes this true — confirm it's actually saved in the host's env vars, not just your local `.env`)
- [ ] `logs/` folder is being written to on every run and is readable
- [ ] `ffmpeg` (if Option B) is confirmed installed on the production host, not just your local machine
- [ ] Deployed server stays running long enough between restarts for `node-cron` to actually fire (some hosts sleep idle instances — check this specifically if using a free tier)

---

## 14. Future — Long-Form Video (Facebook & YouTube)

Not part of this build, but the plan for later once the short-form pipeline above is stable:

- Add a second video generation mode alongside the short-form one — likely a `LONG_FORM_ENABLED` flag or a second scheduled job entirely, so the two don't interfere
- The long-form script stage reuses `scriptService.js` but asks Gemini for a longer, more detailed script instead of a 30-45 second one
- The long-form video stage reuses the same `videoService.js` approach (Option A or B) but with proportionally more beats/images or a longer Veo generation
- Reuses the exact same `uploadService.js`, `youtubeService.js`, and `facebookService.js` already built here — no changes needed there, since both just accept a video file/URL regardless of length
- Instagram is intentionally excluded from this path — Reels stays short-form, so Instagram keeps using the short-form pipeline only
- This is additive, not a rewrite — nothing in Phases 3-9 above needs to change to support it later

---

## 15. Troubleshooting Quick Reference

| Symptom                                               | Likely cause                                              | Fix                                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Instagram`Insufficient Developer Role`              | Account not accepted as Tester yet                        | Re-check Instagram app → Tester invites → Accept                                          |
| Instagram container stuck`IN_PROGRESS` past timeout | Reels take longer to process than images did              | Extend`waitForContainerReady` timeout to 90-120s                                          |
| YouTube upload fails with auth error                  | Refresh token missing/expired/wrong project               | Redo the`/api/auth/youtube` flow, copy the new refresh token                              |
| Facebook Reels publish fails                          | Wrong upload phase sequence for current Graph API version | Re-check the current version's Reels publishing reference — Meta changes this periodically |
| Video plays locally but platforms reject it           | Wrong resolution/aspect ratio                             | Confirm ffmpeg output (or Veo output) is vertical 1080×1920                                |
| Cron never fires in production                        | Host puts idle instances to sleep                         | Use a host tier that stays always-on, or add an external uptime pinger                      |
| `ffmpeg` works locally, fails on server             | Not installed on the production host                      | Install`ffmpeg` as part of the deployment/build step, or use a buildpack that includes it |
