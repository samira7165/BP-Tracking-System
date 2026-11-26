# Script Checker (NestJS)

Checks that brand promoters (BPs) present a brand correctly. An admin writes the scripts → BPs read and record them in the browser → it's saved on the server → speech is converted to text →
AI checks if what was said matches the script → you get a report.

```
Browser (record) ──upload──▶ NestJS ──▶ uploads/  (video saved)
                                 │
                                 ├─ one-at-a-time queue, then ffmpeg: video → small mp3
                                 ├─ Gemini 3.5 Transcribe: audio → English or Bangla text
                                 ├─ Word-by-word diff (code, free)
                                 ├─ ffmpeg: 3 snapshots (at 25%, 50%, 75%) → Gemini: attire, expression, body language
                                 └─ Gemini 3.5 Flash-Lite: script vs transcript + required keywords (code checks exact matches first) → verdict + report
```

## Run it in VS Code

1. Install **Node.js 18+** (https://nodejs.org).
2. Open this folder in VS Code, then open the terminal (`Ctrl + ``).
3. Start **MySQL** in the XAMPP Control Panel. The database `bp_management` and its tables are created automatically.
   Then install packages:
   ```bash
   npm install
   ```
4. Make your env file and set the admin password in it:
   ```bash
   cp .env.example .env        # Windows PowerShell: copy .env.example .env
   ```
   Edit `.env` → `ADMIN_PASSWORD=...`
5. Start the server:
   ```bash
   npm run start:dev
   ```
6. Open **http://localhost:3000/admin**, log in with `ADMIN_PASSWORD`, add your Gemini API key under **Settings**, and add a script.
7. Open **http://localhost:3000**, choose the script, turn on the camera, record, and click **Upload & check**.

Use your own port if you changed `PORT` in `.env`.

> The camera only works on `http://localhost` or `https://`, so don't open `index.html` directly from the file system.

## Hosting on Render with TiDB Cloud

1. In TiDB Cloud, create a cluster, then press **Connect**. Note the host, port (4000), user and password.
   Under network access, allow connections from anywhere (`0.0.0.0/0`), because Render's addresses change.
2. In Render, create a **Web Service** from this repository:
   - Root Directory: empty
   - Build Command: `npm ci --include=dev && npm run build`
   - Start Command: `npm run start:prod`
   - Add a **Disk**, mount path `/var/data`
3. Environment variables in Render:
   `ADMIN_PASSWORD`, `DB_HOST`, `DB_PORT=4000`, `DB_USER`, `DB_PASSWORD`, `DB_NAME=bp_management`,
   `STORAGE_DIR=/var/data`. Optional: `GEMINI_API_KEY` (or add the key in Settings after logging in).
4. Deploy. The tables are created on the first start.

## What the report contains

| Field | Meaning |
|---|---|
| `verdict` | `MATCHED` (85+), `PARTIALLY_MATCHED` (50–84), `NOT_MATCHED` (<50) |
| `overallScore` | AI's 0–100 judgment (ignores fillers like "um" and tiny speech-to-text errors) |
| `wordAccuracy` | % of script words spoken in the right order (pure code, no AI) |
| `missingParts` / `addedParts` / `changedParts` | What was skipped, added, or said differently |
| `suggestions` | Tips for the next take |
| `diff` | Colour-coded script vs. speech used by the web page |

If the AI call fails, you still get the word-by-word report (`generatedBy: "local-only"`).

## API

Rows marked 🔒 need the admin login cookie.

| Method | URL | What it does |
|---|---|---|
| `POST` | `/api/recordings` | multipart form: `video` (file), `scriptId`, `scriptVersion?` (the script's `updatedAt`), `speaker?` |
| `GET` | `/api/recordings/:id` | For the BP: `checking`, `received` or `retake` (with the reason). Never the result |
| `GET` | `/api/admin/recordings` | 🔒 List all recordings |
| `GET` | `/api/admin/recordings/:id` | 🔒 Status + transcript + report |
| `GET` | `/api/admin/recordings/:id/report` | 🔒 Only the report JSON |
| `GET` | `/api/admin/recordings/:id/video` | 🔒 Stream the saved video |
| `POST` | `/api/admin/recordings/:id/reprocess` | 🔒 Run speech-to-text + AI again |
| `DELETE` | `/api/admin/recordings/:id` | 🔒 Delete recording and video |
| `GET` | `/api/scripts` | Scripts shown on the recording page |
| `POST` | `/api/admin/login` | JSON `{ "password": "..." }`, sets the login cookie |
| `POST` | `/api/admin/logout` | Clears the login cookie |
| `GET` | `/api/admin/scripts` | 🔒 All scripts, including hidden ones |
| `POST` | `/api/admin/scripts` | 🔒 Add a script: JSON `title`, `text`, `language?`, `active?` |
| `PUT` | `/api/admin/scripts/:id` | 🔒 Edit a script (same fields) |
| `GET` | `/api/admin/settings` | 🔒 API key status (never the key itself) and the report prompt |
| `PUT` / `DELETE` | `/api/admin/settings/api-key` | 🔒 Save (JSON `apiKey`) or remove the Gemini key |
| `PUT` | `/api/admin/settings/prompt` | 🔒 Save the report prompt (JSON `prompt`, empty restores the default) |
| `DELETE` | `/api/admin/scripts/:id` | 🔒 Delete a script (its recordings are kept) |

Status goes: `queued → extracting_audio → transcribing → analyzing → done` (or `failed` with an `error` message).
Takes are checked one at a time, in the order they arrive. While `queued`, `queue.ahead` is the number of takes
before it. The queue survives a server restart.

Test with curl:
```bash
curl -F "video=@my-video.mp4" -F "scriptId=<id from /api/scripts>" http://localhost:3000/api/recordings
```

## Project structure

```
src/
  main.ts                         starts server, serves /public
  app.module.ts
  admin/                          password login + guard for admin-only routes
  settings/                       report prompt (MySQL) + API key (data/settings.json, keep it private)
  scripts/                        scripts written by the admin
  database/                       MySQL connection, tables, one-time import of old JSON files
  common/
    paths.ts                      uploads/ and data/ folders
    gemini.ts                     Gemini client + plain-English errors
  recordings/
    recordings.controller.ts      REST endpoints + file upload (multer)
    recordings.service.ts         the pipeline: save → transcribe → analyze
    processing-queue.ts           one-at-a-time queue
    recordings.store.ts           recordings table
    recording.types.ts            Recording / Transcript / Report types
    dto/create-recording.dto.ts   validation for scriptId/speaker
  transcription/
    audio-extractor.service.ts    ffmpeg: video → 16kHz mono mp3
    transcription.service.ts      Gemini speech-to-text
  analysis/
    text-diff.ts                  word-level comparison (English + Bangla)
    report-prompt.ts              default prompt + fixed output format
    analysis.service.ts           AI comparison + report building
public/
  index.html, app.js              recording page
  admin.html, admin.js            admin dashboard
  report.js, style.css            shared report view + styles
```

## Settings (`.env`)

- `TRANSCRIBE_MODEL`: default `gemini-3.5-transcribe`
- `ANALYSIS_MODEL`: default `gemini-3.5-flash-lite`
- `GEMINI_API_KEY`: optional. A key saved in the dashboard is used first.
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`: MySQL login (defaults fit XAMPP)
- `ADMIN_PASSWORD`: password for `/admin` (nobody can log in until it is set)
- `MAX_UPLOAD_MB`: default 200
- `FFMPEG_PATH`: leave empty to use the bundled `ffmpeg-static`

## Notes / next steps

- Bangla works: choose **Bangla** as the script's language in the admin dashboard for better transcription.
- A recording can be up to about one hour long.
- Videos are files in `uploads/`; MySQL only stores their names. Back up both the database and that folder.
- To store videos in S3/Cloudinary instead of `uploads/`, change the multer storage in `recordings.module.ts`.
