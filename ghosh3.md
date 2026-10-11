# Vaani — Complete File-by-File Explanation, API Reference, Backend Guide & 4-Member Ownership (`ghosh3.md`)

---

## 1. Explain Every File in the Project

### Complete Project Folder Tree
Below is the exact folder and file structure verified from the workspace root (`/`):

```text
/ (Project Root)
├── .env.example          # Environment variable template (API keys, SMTP, Server Port)
├── .smtp-config.json     # Local JSON file storing Gmail SMTP settings (never expose secrets)
├── README.md             # Main project README documentation
├── ghosh.md              # Minimal system architecture, tech stack, database & feature summary
├── ghosh3.md             # This complete file-by-file analysis, API reference & 4-member ownership guide
├── metadata.json         # AI Studio applet metadata and browser microphone permission config
├── package.json          # Node.js package manifest, dependencies, and npm scripts
├── bun.lock              # Auto-generated package manager lockfile
├── tsconfig.json         # TypeScript compiler configuration
├── vaani.png             # Brand logo image used in login.html and index.html
├── server.ts             # Complete Node.js + Express backend server, APIs, Auth, AI & In-Memory Store
├── login.html            # Role-based Login, Sign-up, and 6-Digit Email OTP verification page
├── index.html            # Main Single-Page Application (SPA) workspace for Faculty & Students
├── css/                  # Stylesheet folder
│   ├── auth.css          # Styles for login.html (split layout, role switcher, OTP input boxes)
│   └── style.css         # Styles for index.html (sidebar, topbar, cards, recorder, tables, modals)
└── js/                   # Frontend JavaScript folder
    ├── auth.js           # Client-side authentication logic for login.html
    └── app.js            # Client-side workspace logic, microphone recording & API calls for index.html
```

---

### File 1: `/server.ts` (assigned to **Member 1**)
* **Category:** Backend Server, API Routes, Authentication, AI Pipeline & Data Storage
* **Size:** 2,292 lines of TypeScript
* **Purpose:** This is the single backend file that powers the entire Vaani platform. It creates an Express HTTP server on port `3000`, serves all static frontend files (`index.html`, `login.html`, `css/`, `js/`, `vaani.png`), manages users/OTPs/sessions/boxes/recordings in memory, connects to Gmail SMTP for OTP emails, and runs the multi-tier AI transcription and summarization pipeline.
* **Important Data Structures & Variables:**
  * `User`, `StorageBox`, `Recording`, `OtpEntry` (lines 43–138): TypeScript interfaces defining the exact shape of every record.
  * `users`, `sessions`, `otps`, `recordings`, `storageBoxes`, `studentProgress`, `otpRateLimits` (lines 145–151): In-memory JavaScript `Map` collections that act as the live database.
  * `upload` (lines 21–24): `multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })` middleware that receives uploaded/recorded audio files up to 200 MB directly in RAM (`req.file.buffer`).
  * `aiClient` & `getAiClient()` (lines 28–39): Lazily initializes the Google `@google/genai` SDK using `process.env.GEMINI_API_KEY` or `process.env.API_KEY`.
* **Important Functions & How They Work:**
  * `hashPassword(password)` (lines 160–162): Hashes plain-text passwords using SHA-256 (`crypto.createHash('sha256')`) with a static salt (`vaani_salt_2026`).
  * `generateStatelessToken(user)` & `verifyStatelessToken(token)` (lines 164–200): Creates and verifies tamper-proof Base64URL session tokens signed with `crypto.createHmac('sha256', SECRET_SALT)` valid for 7 days, so logged-in sessions survive even if the server restarts.
  * `getAuthenticatedUser(req)` (lines 203–284): Reads the `Authorization: Bearer <token>` HTTP header, checks `sessions` Map or verifies the stateless HMAC token, and automatically recreates the user in memory if the server restarted.
  * `requireFaculty(req, res)` (lines 286–293): Blocks non-faculty users (`403 Forbidden`) from creating, editing, publishing, or deleting lectures and Storage Boxes.
  * `transcribeAudioBuffer(buffer, mimeType, title, course, description, durationSec)` (lines 601–755):
    1. Converts the raw audio `Buffer` to Base64 and sends it to Google Gemini (`gemini-2.5-flash`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite`) with a strict verbatim transcription prompt.
    2. If Gemini fails or isn't configured, checks for `GROQ_API_KEY` or `OPENAI_API_KEY` and sends `FormData` to Whisper (`whisper-large-v3` or `whisper-1`).
    3. If no external API is reachable, falls back to `generateTranscript()` (lines 456–482) which generates a clean academic transcript based on the lecture's title, course, and description.
  * `generateAiSummary(transcript, title, course, durationSec)` (lines 760–898):
    1. Sends the transcript to Gemini asking for a structured JSON object containing `overview`, `keyPoints`, `ActionItems`, `studyQuestions`, `keywords`, and `topics`.
    2. Normalizes the JSON into formatted Markdown sections (`Overview:`, `Key Takeaways:`, `Important Keywords:`, `Core Topics Covered:`, `Revision Questions:`).
    3. If Gemini is unavailable, falls back to local NLP functions `extractKeySentences()`, `extractKeywords()`, and `generateSummary()` (lines 484–584) which score sentences using word frequency and filter out 85+ English stopwords.
  * `sendOtpEmail(email, code, name)` (lines 1003–1080): Uses `nodemailer` to send a styled HTML email containing the 6-digit OTP code via Gmail SMTP (`smtp.gmail.com` on port `587` with automatic retry on port `465`).
  * `seedDatabase()` (lines 1084–1318): Pre-populates 3 demo accounts (`faculty@vaani.edu`, `student@vaani.edu`, `admin@vaani.edu`), 3 Storage Boxes (`box-cs301`, `box-cs402`, `box-ec204`), and 4 sample lectures complete with mathematical sine-wave WAV audio (`createDemoWavBuffer()`).
* **How It Runs:** Executed via `npm run dev` (`tsx server.ts`), which starts Express listening on `0.0.0.0:3000`.

---

### File 2: `/js/app.js` (assigned to **Member 2**)
* **Category:** Frontend Application Logic (Single-Page Workspace, Microphone Recorder, Storage Boxes, Faculty & Student Views)
* **Size:** 2,583 lines of Vanilla ES6 JavaScript
* **Purpose:** Controls everything inside `index.html` after a user logs in. It verifies the user's session, switches the UI between Faculty and Student mode, captures live microphone audio, communicates with `/api/recordings` and `/api/boxes`, plays audio, and provides an offline `localStorage` fallback.
* **Important Variables & State:**
  * `recordings` (`[]`) & `storageBoxes` (`[]`) (lines 12–13): Local arrays holding the lectures and Storage Boxes fetched from the backend.
  * `facMediaRecorder`, `facAudioChunks`, `facLiveTranscript`, `facRecordSeconds` (lines 17–25): State variables tracking live browser microphone capture and timer seconds.
  * `currentReviewId`, `currentOpenBoxId` (lines 15, 2004): Track which lecture is currently open in the Faculty Review Editor or which Storage Box folder is open.
* **Important Functions & How They Work:**
  * `checkAuth()` (lines 38–83): Runs immediately on page load. Calls `GET /api/auth/me` with `Authorization: Bearer <token>`. If invalid, redirects to `/login.html`.
  * `apiFetch(endpoint, options)` (lines 130–145): Wrapper around browser `fetch()` that automatically attaches the Bearer token from `localStorage.getItem('vaani_token')`.
  * `applyRoleBasedUI()` (lines 169–303): Checks `currentUser.role`. If `'faculty'`, shows `#facultyHome`, `#facultyCreateNavBtn`, `#facultyManageNavBtn`, `#facultyBoxesNavBtn`, and `#facultyProfileNavBtn`. If `'student'`, hides faculty menus and shows student stats and study views.
  * `page(id, btn)` (lines 388–432): The Single-Page Application (SPA) router. Removes `.active` from all `<section class="page">` elements and activates `<section id="...">`.
  * `startFacultyLiveRecording()` & `stopFacultyLiveRecording()` (lines 1068–1160): Requests microphone access via `navigator.mediaDevices.getUserMedia({ audio: true })`, starts `MediaRecorder`, collects audio packets in `facAudioChunks` every 250ms, runs live browser `SpeechRecognition` (`webkitSpeechRecognition`), and builds a real audio `File` (`live-recording-<timestamp>.webm`) when stopped.
  * `submitFacultyLecture(statusMode)` (lines 1246–1342): Validates form fields, packs the recorded audio `File` and metadata into `FormData`, sends `POST /api/recordings`, and opens the Faculty Review screen.
  * `openFacultyReview(id)` (lines 1344–1449): Loads a lecture into `#facultyReview` so the professor can play the audio, edit the transcript/summary textareas, click **Generate Transcript / Generate Summary** (`regenerateFacultyContent()`), replace audio, or click **Publish Lecture** (`publishCurrentLecture()`).
  * `renderRecordings()` & `openDetail(id)` (lines 1612–1889): Renders the Student lecture cards and table rows, handles search and subject dropdown filters, streams audio from `/api/recordings/:id/audio`, downloads audio, and copies AI summaries to the clipboard.
  * `loadStorageBoxes()`, `renderFacultyBoxesView()`, `openBoxDetailModal()`, `openBoxFormModal()`, `deleteBoxFlow()` (lines 2004–2575): Full CRUD and folder browsing system for Storage Boxes.

---

### File 3: `/index.html` (assigned to **Member 3**)
* **Category:** Frontend Main Application Markup (Single-Page Application)
* **Size:** 965 lines of HTML5
* **Purpose:** The main workspace interface loaded after login (`/`). It contains the sidebar navigation, top header bar, and 11 `<section class="page">` views for both Faculty and Students, plus 2 modal dialogs for Storage Boxes.
* **Important Sections & Elements:**
  * **Sidebar (`<aside class="sidebar">`, lines 17–82):** Contains the Vaani logo (`vaani.png`), navigation buttons (`onclick="page('home', this)"`, `page('createLecture')`, `page('manageLectures')`, `page('storageBoxes')`, `page('recordings')`, `page('profile')`, `page('settings')`), storage usage bar, and user profile footer.
  * **`#home` (lines 110–307):** Contains `#studentHome` (stats cards, recent recordings table, latest summary card) and `#facultyHome` (faculty stats cards, recent lectures table, quick actions).
  * **`#createLecture` (lines 310–427):** Faculty lecture creation form with inputs for Title (`#facTitleInput`), Storage Box selector (`#facStorageBoxSelect`), Description (`#facDescInput`), Live Microphone Recorder (`#facRecordBtn`, `#facStopRecordBtn`, `#facLiveTimer`), and action buttons (`Save as Draft`, `Process with AI`).
  * **`#manageLectures` (lines 430–491):** Faculty table of all lectures with search (`#facManageSearch`), subject filter (`#facManageCourseFilter`), and status filter (`Draft`, `Ready`, `Published`).
  * **`#storageBoxes` (lines 494–536):** Grid view where Faculty and Students browse custom Storage Boxes (`#facBoxesGrid`).
  * **`#facultyReview` (lines 539–696):** Side-by-side Faculty editor for editing lecture metadata, replacing audio, editing or regenerating Transcript (`#revTranscriptInput`) and Summary (`#revSummaryInput`), setting student batch access checkboxes, and publishing.
  * **`#profile` (lines 699–761):** Faculty profile & password update form.
  * **`#recordings` & `#detail` (lines 764–869):** Student Browse Lectures grid (`#recGrid`), filter bar, and Lecture Detail player (`#detailAudioEl`, `#detailTranscript`, `#detailSummary`, `#detailDownloadBtn`).
  * **Modals (`#boxFormModal`, `#boxDetailModal`, lines 872–960):** Pop-up modals for creating/renaming Storage Boxes and viewing all lectures inside a selected box.

---

### File 4: `/css/style.css` (assigned to **Member 3**)
* **Category:** Frontend Main Stylesheet
* **Size:** 2,135 lines of CSS3
* **Purpose:** Styles the entire `index.html` workspace using a clean dark-sidebar + warm ivory/terracotta academic theme (`--accent: #c85a32`, `--bg: #f6f5f1`, `--surface: #ffffff`).
* **Important Rules & Classes:**
  * `:root` CSS Custom Properties (lines 3–27): Defines colors, border radii, shadows, and font families (`DM Sans`, `Instrument Serif`, `JetBrains Mono`).
  * `.sidebar`, `.main`, `.topbar`, `.content` (lines 37–207): Builds the fixed 232px left navigation sidebar and scrollable main content viewport.
  * `.page` & `.page.active` (lines 209–215): Implements the SPA view switching (`display: none` by default, `display: block` with `fadeUp` animation when `.active` is present).
  * `.faculty-grid`, `.review-layout`, `.split` (lines 750–1250): Responsive CSS Grid layouts for the Create Lecture page, Faculty Review split editor, and Student Detail view.
  * `.box-card`, `.modal-overlay` (lines 1650–2135): Styles the Storage Box folder cards, hover effects, badges, and modal overlays.
  * `@media (max-width: 1100px)` & `@media (max-width: 768px)`: Responsive breakpoints that collapse multi-column grids and convert the sidebar into a slide-out mobile drawer.

---

### File 5: `/login.html` (assigned to **Member 4**)
* **Category:** Frontend Authentication Markup
* **Size:** 303 lines of HTML5
* **Purpose:** The entry screen for unauthenticated users (`/login.html`). It provides a split-screen layout with academic branding on the left and interactive Login, Sign-up, and 6-digit OTP verification cards on the right.
* **Important Sections & Elements:**
  * **Left Brand Panel (`.brand-panel`, lines 18–92):** Displays the Vaani logo, tagline (*"Every lecture, captured & distilled"*), feature highlights, and a sample AI summary preview card.
  * **Role Switcher (`#roleSelectorBlock`, lines 99–113):** Toggle buttons (`#roleStudentBtn`, `#roleFacultyBtn`) allowing the user to select **Student** or **Faculty (Admin)** before signing in.
  * **Sign In / Create Account Tabs (`#tabSwitcher`, lines 116–120):** Switches between `#loginPanel` and `#signupPanel`.
  * **Login Form (`#loginForm`, lines 123–169):** Email (`#loginEmail`), Password (`#loginPassword`), show/hide password toggle, and two Quick Demo Fill buttons (`Student Demo` and `Faculty Demo`).
  * **Signup Form (`#signupForm`, lines 172–249):** Name, Email, Course/Department input (`#signupCourse`), dynamic Faculty ID input (`#signupFacultyIdField`), Password, and Confirm Password.
  * **OTP Verification Panel (`#otpPanel`, lines 252–297):** Six individual 1-digit input boxes (`.otp-digit`), fallback demo OTP banner (`#otpDemoBox`), Verify button (`#verifyOtpBtn`), and 30-second Resend timer (`#resendOtpBtn`).

---

### File 6: `/js/auth.js` (assigned to **Member 4**)
* **Category:** Frontend Authentication Logic
* **Size:** 504 lines of Vanilla ES6 JavaScript
* **Purpose:** Handles all user interactions on `login.html`, validates inputs, calls `/api/auth/login`, `/api/auth/signup`, `/api/auth/verify-otp`, and `/api/auth/resend-otp`, manages the 6-digit OTP input boxes, and saves the returned session token in `localStorage`.
* **Important Functions & How They Work:**
  * `checkExistingSession()` (lines 17–45): Runs when `login.html` loads. If `localStorage.getItem('vaani_token')` exists and `GET /api/auth/me` succeeds, redirects straight to `/`.
  * `selectRole(role)` (lines 51–89): Switches `selectedRole` between `'student'` and `'faculty'`, updates button labels, and shows/hides the Faculty ID input on the sign-up form.
  * `switchTab(tab)` (lines 94–114): Toggles visibility between `#loginPanel` and `#signupPanel`.
  * `fillDemo(type)` (lines 136–154): Populates `student@vaani.edu` / `student123` or `faculty@vaani.edu` / `faculty123` with one click.
  * `handleLogin(e)` (lines 159–205): Sends `POST /api/auth/login` with `{ email, password, role }`. If successful, triggers `showOtpStep()`.
  * `handleSignup(e)` (lines 210–272): Validates password match and minimum length, sends `POST /api/auth/signup`, and opens the OTP verification panel.
  * `showOtpStep(email, demoCode, emailSent, emailError)` (lines 277–336): Hides the login/signup forms, displays the 6-digit OTP panel, starts the 30-second resend countdown (`startResendTimer()`), and—if SMTP email wasn't configured—displays the fallback `demoCode` banner (`#otpDemoBox`) and auto-fills the 6 boxes so testing is never blocked.
  * `handleVerifyOtp(e)` (lines 382–432): Reads the 6 digits, sends `POST /api/auth/verify-otp`, stores `data.token` (`vaani_token`) and `data.user` (`vaani_user`) in `localStorage`, and redirects to `/`.

---

### File 7: `/css/auth.css` (assigned to **Member 4**)
* **Category:** Frontend Authentication Stylesheet
* **Size:** 715 lines of CSS3
* **Purpose:** Styles `login.html` with a responsive two-column layout (`.auth-layout`), dark brand showcase panel on the left, clean white form card on the right, animated role selector buttons, and 6-box OTP digit inputs.
* **Important Classes:**
  * `.auth-layout`, `.brand-panel`, `.form-panel` (lines 29–196): Split-screen flexbox layout.
  * `.role-btn.active`, `.tab-btn.active` (lines 200–275): Highlights the selected role (`Student` vs. `Faculty`) and active tab (`Sign In` vs. `Create Account`).
  * `.otp-inputs`, `.otp-digit`, `.otp-demo-banner` (lines 480–585): Styles the 6 square OTP boxes and the amber fallback OTP notification banner.

---

### File 8: `/package.json` (assigned to **Member 1**)
* **Category:** Node.js Project Manifest & Dependencies
* **Size:** 30 lines of JSON
* **Purpose:** Declares project metadata, npm scripts, runtime dependencies, and TypeScript devDependencies.
* **Important Scripts & Packages:**
  * `"dev": "tsx server.ts"` & `"start": "tsx server.ts"`: Runs the TypeScript backend server directly using `tsx`.
  * `"build": "tsc --noEmit"`: Type-checks `server.ts` without emitting compiled JS files.
  * `dependencies`: `@google/genai` (`^2.26.0`), `dotenv` (`^17.3.0`), `express` (`^4.21.2`), `multer` (`^1.4.5-lts.1`), `nodemailer` (`^10.0.13`).
  * `devDependencies`: `@types/express`, `@types/multer`, `@types/node`, `tsx`, `typescript`.

---

### File 9: `/tsconfig.json` (assigned to **Member 1**)
* **Category:** TypeScript Compiler Configuration
* **Size:** 15 lines of JSON
* **Purpose:** Configures TypeScript (`ES2022` target, `NodeNext` module resolution, `strict: false`, `esModuleInterop: true`) so `server.ts` compiles cleanly with `tsc --noEmit` and `tsx`.

---

### File 10: `/.env.example` (assigned to **Member 1**)
* **Category:** Environment Variables Template
* **Size:** 24 lines of plain text
* **Purpose:** Documents all environment variables supported by `server.ts` without containing any real secret keys:
  * `GEMINI_API_KEY`: Google Gemini API key for transcription and summarization.
  * `OPENAI_API_KEY` / `GROQ_API_KEY`: Optional fallback Whisper API keys.
  * `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: Gmail SMTP settings for OTP emails.
  * `PORT`: HTTP port (`3000`).

---

### File 11: `/.smtp-config.json` (assigned to **Member 1**)
* **Category:** Local Runtime SMTP Configuration File
* **Size:** 7 lines of JSON
* **Purpose:** Read by `loadSavedSmtpConfig()` (line 915 of `server.ts`) and written by `saveSmtpConfigToFile()` (line 929 of `server.ts`). Stores `{ host, port, user, pass, from }` on disk so Gmail SMTP settings persist across server restarts. *(Note: Contains SMTP credentials in local environments; secret values must never be printed or committed publicly).*

---

### File 12: `/bun.lock` (assigned to **Member 2**)
* **Category:** Package Manager Lockfile
* **Size:** 209 lines
* **Purpose:** Auto-generated lockfile that pins exact versions and integrity hashes of every installed Node package (`express`, `@google/genai`, `multer`, `nodemailer`, etc.) so all four team members install identical dependency versions.

---

### File 13: `/metadata.json` (assigned to **Member 3**)
* **Category:** Application Metadata & Browser Permissions
* **Size:** 8 lines of JSON
* **Purpose:** Configures the AI Studio applet name (`"Vaani - AI Voice to Text & Summarizer"`), description, and requests `"requestFramePermissions": ["microphone"]` so the browser allows `navigator.mediaDevices.getUserMedia({ audio: true })` inside the preview iframe.

---

### File 14: `/vaani.png` (assigned to **Member 3**)
* **Category:** Visual Brand Asset
* **Size:** Binary PNG image (67,719 bytes)
* **Purpose:** Official Vaani brand logo displayed in the sidebar of `index.html` and the brand panel of `login.html`.

---

### File 15: `/README.md` (assigned to **Member 4**)
* **Category:** Primary Project Documentation
* **Size:** 193 lines of Markdown
* **Purpose:** Main documentation file describing Vaani's features, system architecture, tech stack, REST API reference table, and demo login accounts.

---

### File 16: `/ghosh.md` (assigned to **Member 2**)
* **Category:** Architecture & Feature Summary Documentation
* **Size:** 111 lines of Markdown
* **Purpose:** Concise documentation file summarizing the 3-layer system architecture, technology stack, database design notes, and project feature checklist.

---

### File 17: `/ghosh3.md` (assigned to **Member 4**)
* **Category:** Complete Codebase Analysis, API Guide & 4-Member Handover Document
* **Purpose:** This comprehensive reference file explaining every file, every API and external service, backend data architecture, end-to-end workflow, and the 4-member team division.

---

## 2. APIs and External Services

### A. Complete Internal REST API Reference (`server.ts` ↔ `js/auth.js` & `js/app.js`)

Every internal API route is defined in `/server.ts` and called from `/js/auth.js` or `/js/app.js` using `fetch()` / `apiFetch()`:

| # | HTTP Method & Endpoint | Defined In (`server.ts`) | Called From (Frontend File & Function) | Request Payload / Params | Response JSON / Output | Error Handling | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `POST /api/auth/signup` | Lines 1324–1386 | `js/auth.js` → `handleSignup()` | JSON: `{ name, email, password, role, course, facultyId, department }` | `{ message, requireOtp: true, email, emailSent, emailError, demoCode? }` | Returns `400` if missing fields, invalid email, password < 6 chars, or email already registered. Rate-limits OTPs (`429`). | **Implemented & Active** |
| 2 | `POST /api/auth/login` | Lines 1388–1458 | `js/auth.js` → `handleLogin()` | JSON: `{ email, password, role }` | `{ message, requireOtp: true, email, emailSent, emailError, demoCode? }` | Returns `401` on wrong email/password; `403` if selected role (`student` vs `faculty`) does not match account role. | **Implemented & Active** |
| 3 | `POST /api/auth/verify-otp` | Lines 1460–1517 | `js/auth.js` → `handleVerifyOtp()` | JSON: `{ email, code }` | `{ message, token, user }` | Returns `400` if OTP is missing, expired (> 5 mins), or invalid (`attempts` incremented; deleted after 5 failed tries). | **Implemented & Active** |
| 4 | `POST /api/auth/resend-otp` | Lines 1519–1567 | `js/auth.js` → `resendOtp()` | JSON: `{ email }` | `{ message, emailSent, emailError, demoCode? }` | Returns `404` if user not found; `429` if rate limit (5 OTPs / 15 mins) exceeded. | **Implemented & Active** |
| 5 | `GET /api/auth/me` | Lines 1673–1689 | `js/auth.js` → `checkExistingSession()`<br>`js/app.js` → `checkAuth()` | Header: `Authorization: Bearer <token>` | `{ user: { id, name, email, role, course, facultyId, department, avatar } }` | Returns `401 Unauthorized` if token is missing or invalid. | **Implemented & Active** |
| 6 | `POST /api/auth/logout` | Lines 1691–1699 | `js/app.js` → `logout()` | Header: `Authorization: Bearer <token>` | `{ message: "Logged out successfully" }` | Safely deletes token from `sessions` Map and returns `200`. | **Implemented & Active** |
| 7 | `GET /api/auth/smtp-status` | Lines 1570–1585 | `js/app.js` → `loadSmtpStatus()` | None | `{ configured, host, port, user, from }` (masked, no password) | Returns `{ configured: false }` if SMTP is not set up. | **Implemented (Backend + JS ready; no SMTP form inputs in `index.html`)** |
| 8 | `POST /api/auth/save-smtp` | Lines 1587–1635 | `js/app.js` → `saveSmtpConfig()` | JSON: `{ host, port, user, pass, from }` | `{ message, configured: true }` | Returns `400` if `user` or `pass` missing; `500` if SMTP verification fails. | **Implemented (Optional UI hook)** |
| 9 | `POST /api/auth/test-smtp` | Lines 1637–1670 | `js/app.js` → `testSmtpConfig()` | JSON: `{ email }` | `{ message }` | Returns `400` if SMTP not configured; `500` if test email fails. | **Implemented (Optional UI hook)** |
| 10 | `PUT /api/faculty/profile` | Lines 1701–1753 | `js/app.js` → `saveFacultyProfile()` | Header: Bearer Token<br>JSON: `{ name, facultyId, department, avatar, newPassword }` | `{ message, user, token }` (issues refreshed stateless token) | Returns `403` if caller is not Faculty; `400` if name < 2 chars or password < 6 chars. | **Implemented & Active** |
| 11 | `GET /api/boxes` | Lines 1973–1997 | `js/app.js` → `loadStorageBoxes()` | Header: Bearer Token | Array of `StorageBox` objects with computed `lectureCount` (counts only `PUBLISHED` for students, all statuses for faculty). | Returns `200` sorted newest first. | **Implemented & Active** |
| 12 | `POST /api/boxes` | Lines 1999–2024 | `js/app.js` → `saveBoxForm()` | Header: Bearer Token (Faculty)<br>JSON: `{ name, subject, description, iconColor }` | `201 Created` + created `StorageBox` object | Returns `403` if not Faculty; `400` if box `name` is empty. | **Implemented & Active** |
| 13 | `PUT /api/boxes/:id` | Lines 2026–2050 | `js/app.js` → `saveBoxForm()` | Header: Bearer Token (Faculty)<br>JSON: `{ name, subject, description, iconColor }` | Updated `StorageBox` object | Returns `403` if not Faculty; `404` if box ID not found. | **Implemented & Active** |
| 14 | `DELETE /api/boxes/:id` | Lines 2052–2063 | `js/app.js` → `deleteBoxFlow()` | Header: Bearer Token (Faculty) | `{ message: "Storage Box deleted successfully" }` | Unlinks recordings (`rec.storageBoxId = null`) instead of deleting lectures. Returns `404` if box not found. | **Implemented & Active** |
| 15 | `GET /api/recordings` | Lines 1759–1790 | `js/app.js` → `loadRecordings()` | Header: Bearer Token<br>Query: `?search=...&course=...` | Array of `Recording` objects (without raw `audioBuffer` bytes to keep JSON fast). | Filters out `DRAFT`/`READY` lectures if user role is `student`. | **Implemented & Active** |
| 16 | `GET /api/recordings/:id` | Lines 1793–1817 | `js/app.js` → `openDetail()` | Header: Bearer Token | Single `Recording` object | Returns `404` if not found; `403` if student requests unpublished lecture. Increments `studentsAccessed` for students. | **Implemented & Active** |
| 17 | `GET /api/recordings/:id/audio` | Lines 1820–1856 | `js/app.js` → `<audio src="...">` & download links | Query: `?download=1` (optional) | Raw binary audio stream (`Content-Type: audio/webm` or `audio/wav`) | Generates fallback WAV audio via `createDemoWavBuffer()` if no buffer exists; increments `playsCount`. | **Implemented & Active** |
| 18 | `POST /api/recordings` | Lines 1859–1967 | `js/app.js` → `submitFacultyLecture()` | `multipart/form-data`: `audio` file, `title`, `course`, `storageBoxId`, `description`, `durationSec`, `statusMode`, `liveTranscript` | `201 Created` + newly created `Recording` with AI `transcript` & `summary` | Returns `403` if not Faculty; `400` if title < 3 chars or invalid audio MIME type. | **Implemented & Active** |
| 19 | `PUT /api/recordings/:id` | Lines 2065–2109 | `js/app.js` → `saveFacultyReviewChanges()` | Header: Bearer Token (Faculty)<br>JSON: `{ title, course, storageBoxId, description, transcript, summary, status }` | Updated `Recording` object | Returns `403` if not Faculty; `404` if recording not found. | **Implemented & Active** |
| 20 | `POST /api/recordings/:id/regenerate` | Lines 2112–2145 | `js/app.js` → `regenerateFacultyContent()` | Header: Bearer Token (Faculty)<br>JSON: `{ type: 'transcript' \| 'summary' \| 'both' }` | `{ message, recording }` with freshly generated AI transcript/summary | Returns `403` if not Faculty; `404` if recording not found. | **Implemented & Active** |
| 21 | `POST /api/recordings/:id/replace-audio` | Lines 2148–2176 | `js/app.js` → `replaceFacultyAudio()` | `multipart/form-data`: `audio` file, `durationSec`, `reprocess` | `{ message, recording }` | Replaces `rec.audioBuffer` and optionally re-runs AI transcription + summarization. | **Implemented & Active** |
| 22 | `POST /api/recordings/:id/publish` | Lines 2179–2203 | `js/app.js` → `publishCurrentLecture()` & `quickTogglePublish()` | Header: Bearer Token (Faculty)<br>JSON: `{ publish: true \| false }` | `{ message, recording }` | Sets `status` to `'PUBLISHED'` (or `'READY'` when unpublished) and sets `publishedAt` date. | **Implemented & Active** |
| 23 | `POST /api/recordings/:id/access` | Lines 2206–2223 | `js/app.js` → `applyBatchAccess()` | Header: Bearer Token (Faculty)<br>JSON: `{ allowedAccess: string[] }` | `{ message, recording }` | Updates `rec.allowedAccess` array. | **Implemented & Active** |
| 24 | `POST /api/recordings/:id/progress` | Lines 2226–2247 | Not currently called by `js/app.js` | Header: Bearer Token<br>JSON: `{ completed, lastPositionSec }` | `{ message, progress }` | Saves per-student playback progress in `studentProgress` Map. | **Implemented in Backend Only** |
| 25 | `DELETE /api/recordings/:id` | Lines 2250–2262 | `js/app.js` → `deleteFacultyLecture()` | Header: Bearer Token (Faculty) | `{ message: "Deleted successfully" }` | Removes recording from `recordings` Map (`403` if not Faculty, `404` if missing). | **Implemented & Active** |

---

### B. External Services, SDKs, Browser APIs & Credentials

#### 1. Google Gemini AI (`@google/genai` SDK) — **Implemented & Primary AI Service**
* **Where Used:** `/server.ts` (`getAiClient()` at line 30, `transcribeAudioBuffer()` at lines 616–676, `generateAiSummary()` at lines 770–853).
* **How Credentials Work:** Reads `process.env.GEMINI_API_KEY` or `process.env.API_KEY` on the server. The key is never sent to the frontend browser.
* **What It Does:**
  1. **Audio-to-Text Transcription:** Sends inline Base64 audio bytes (`inlineData: { data: base64Audio, mimeType }`) to `ai.models.generateContent()` using a model fallback chain (`gemini-2.5-flash` → `gemini-3-flash-preview` → `gemini-3.1-flash-lite`).
  2. **Structured Lecture Summarization:** Sends the transcript text to `ai.models.generateContent()` with `responseMimeType: 'application/json'` and `responseSchema` (using `Type.OBJECT` and `Type.ARRAY`) to extract `overview`, `keyPoints`, `ActionItems`, `studyQuestions`, `keywords`, and `topics`.
* **Error Handling:** Wrapped in `try / catch` loops across all 3 Gemini models. If the API key is missing, quota is exceeded, or network fails, `server.ts` logs a warning and seamlessly falls back to Tier 2/Tier 3 so the user never gets an error screen.

#### 2. Groq Whisper (`whisper-large-v3`) & OpenAI Whisper (`whisper-1`) — **Implemented as Optional Tier-2 Fallback**
* **Where Used:** `/server.ts` inside `transcribeAudioBuffer()` (lines 681–732).
* **How Credentials Work:** Checks `process.env.GROQ_API_KEY` or `process.env.OPENAI_API_KEY` (documented in `/.env.example`).
* **What It Does:** If Gemini transcription does not return text and a Groq or OpenAI key is configured, constructs a `FormData` payload with the audio `Blob` and sends an HTTP `POST` request to `https://api.groq.com/openai/v1/audio/transcriptions` or `https://api.openai.com/v1/audio/transcriptions`.

#### 3. Local Extractive NLP Engine — **Implemented & Always-Available Tier-3 Fallback**
* **Where Used:** `/server.ts` (`generateTranscript()` lines 456–482, `extractKeySentences()` lines 484–531, `extractKeywords()` lines 533–554, `generateSummary()` lines 556–584).
* **What It Does:** Requires zero API keys or internet access. Tokenizes sentences, filters out 85+ English stopwords, scores sentences by keyword frequency and position, and formats a structured academic summary (`Overview`, `Key Takeaways`, `Important Keywords`, `Study Questions`).

#### 4. Gmail SMTP via `nodemailer` — **Implemented & Configured**
* **Where Used:** `/server.ts` (`getSmtpConfig()`, `createSmtpTransporter()`, `sendOtpEmail()` at lines 900–1080).
* **How Credentials Work:** Reads from environment variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) or from the local file `/.smtp-config.json` (without ever exposing the password to the client).
* **What It Does:** Sends 6-digit OTP verification emails over TLS (`port 587`) or SSL (`port 465`).
* **Error Handling:** If SMTP fails or credentials are invalid, `sendOtpEmail()` returns `{ sent: false, error }`, and `/api/auth/login` or `/api/auth/signup` includes `demoCode` in the response so `js/auth.js` can show the OTP on screen for uninterrupted testing.

#### 5. Browser Web APIs (`js/app.js`) & CDN Libraries (`index.html`, `login.html`) — **Implemented & Active**
* **`navigator.mediaDevices.getUserMedia` & `MediaRecorder` (`js/app.js` lines 1072–1137):** Captures real live audio from the professor's microphone in WebM/Opus or MP4 format.
* **`window.SpeechRecognition` / `webkitSpeechRecognition` (`js/app.js` lines 1094–1117):** Provides live real-time speech-to-text preview in the browser while the microphone is recording.
* **`navigator.clipboard.writeText` (`js/app.js` line 1882):** Copies AI lecture summaries to the student's clipboard.
* **`window.localStorage` (`js/auth.js` & `js/app.js`):** Stores `vaani_token`, `vaani_user`, and offline fallback recordings (`vaani_recordings_v1`).
* **Lucide Icons CDN & Google Fonts (`index.html`, `login.html`):** Loads UI icons (`https://unpkg.com/lucide@latest`) and typography (`DM Sans`, `Instrument Serif`, `JetBrains Mono`).

#### 6. Services Mentioned in Documentation Only (Not in Active Code)
* **H2 Database / MySQL / JPA (`README.md`, `ghosh.md`):** Mentioned in architectural documentation for academic presentation purposes, **but not used in code**. The actual code in `server.ts` uses **in-memory TypeScript `Map` collections** (`users`, `recordings`, `storageBoxes`, `otps`, `sessions`).

---

## 3. Backend and Data Architecture

### 1. How the Server Works
* `server.ts` runs an **Express.js** application on port `3000`.
* It uses `express.json({ limit: '150mb' })` for JSON requests, `multer.memoryStorage()` for multipart audio uploads, and `express.static(__dirname)` to serve `index.html`, `login.html`, `css/`, and `js/`.

### 2. Authentication, OTP, Sessions & Role-Based Access Control (RBAC)
1. **Password Security:** Passwords are never stored in plain text. `hashPassword()` hashes every password using SHA-256 with a salt before storing or comparing.
2. **2-Step OTP Flow:** Both Login (`/api/auth/login`) and Signup (`/api/auth/signup`) generate a random 6-digit integer via `crypto.randomInt(100000, 1000000)` and store it in `otps.set(email, { code, expiresAt: Date.now() + 300000, attempts: 0 })`.
3. **Rate Limiting & Brute-Force Protection:** `checkOtpRateLimit()` limits each email to 5 OTP requests per 15 minutes. `/api/auth/verify-otp` deletes the OTP if a user enters the wrong code 5 times.
4. **Dual Session Mechanism (In-Memory + Stateless HMAC Token):** When OTP verification succeeds, `generateStatelessToken(user)` encodes `{ id, email, name, role, course, facultyId, department, exp }` as Base64URL and signs it with HMAC-SHA256. Even if `server.ts` restarts and wipes the in-memory `sessions` Map, `getAuthenticatedUser(req)` verifies the HMAC signature and restores the user's session seamlessly.
5. **Role-Based Access Control (`faculty` vs `student`):**
   * `requireFaculty(req, res)` checks `user.role === 'faculty'`. Only faculty can create/edit/delete Storage Boxes, record lectures, edit transcripts/summaries, regenerate AI notes, or publish/delete recordings.
   * Students calling `GET /api/recordings` only receive recordings where `r.status === 'PUBLISHED'`.

### 3. How Data is Created, Stored, Retrieved, Updated & Deleted (CRUD)
* **Storage Method:** **In-Memory `Map` Storage** (`server.ts` lines 145–151) + **Local JSON File** (`.smtp-config.json` for SMTP settings) + **Browser `localStorage`** (`vaani_token`, `vaani_user`, `vaani_recordings_v1`).
* **Create:**
  * New users are added via `users.set(email, newUser)`.
  * New Storage Boxes are added via `storageBoxes.set(id, newBox)`.
  * New Lecture Recordings are added via `recordings.set(id, newRecording)`, where `newRecording.audioBuffer` holds the raw binary `Buffer` of the recorded audio in RAM.
* **Read / Retrieve:**
  * `GET /api/boxes` reads `Array.from(storageBoxes.values())` and dynamically counts how many recordings belong to each box (`r.storageBoxId === box.id`).
  * `GET /api/recordings` reads `Array.from(recordings.values())`, strips `audioBuffer` so the JSON list is lightweight, and filters by search query, course/box name, and publish status.
  * `GET /api/recordings/:id/audio` streams `rec.audioBuffer` with `Content-Type: audio/webm` or `audio/wav`.
* **Update:**
  * `PUT /api/boxes/:id` updates box name, subject, description, and syncs the subject name across linked recordings.
  * `PUT /api/recordings/:id`, `POST /api/recordings/:id/regenerate`, `POST /api/recordings/:id/replace-audio`, and `POST /api/recordings/:id/publish` mutate the `Recording` object in `recordings` Map and save it back with `recordings.set(rec.id, rec)`.
* **Delete:**
  * `DELETE /api/recordings/:id` calls `recordings.delete(req.params.id)`.
  * `DELETE /api/boxes/:id` calls `storageBoxes.delete(boxId)` and loops through `recordings` to set `rec.storageBoxId = null` so lectures inside that box become "Unboxed" rather than lost.

### 4. How Frontend Communicates with Backend
* Every API call in `js/app.js` goes through `apiFetch(endpoint, options)` (lines 130–145), which reads `localStorage.getItem('vaani_token')` and adds `Authorization: Bearer <token>`.
* Standard data operations send and receive `application/json`.
* Live audio recording (`submitFacultyLecture()`) and audio replacement (`replaceFacultyAudio()`) send `FormData` (`multipart/form-data`) containing the binary `File` object, which Express parses with `upload.single('audio')`.

---

## 4. Complete Project Workflow (End-to-End Journey)

```text
[1. Login / Signup]  login.html + js/auth.js  ──► POST /api/auth/login (server.ts)
                                              ──► Nodemailer Gmail SMTP (or Demo OTP Banner)
[2. Verify 6-Digit OTP]       js/auth.js      ──► POST /api/auth/verify-otp (server.ts)
                                              ──► Saves Bearer Token in localStorage ──► Redirects to index.html
[3. Workspace Init]  index.html + js/app.js   ──► GET /api/auth/me + GET /api/boxes + GET /api/recordings
                                              ──► applyRoleBasedUI() shows Faculty or Student workspace
[4. Storage Box]              js/app.js       ──► POST /api/boxes (server.ts) ──► Creates subject folder
[5. Live Recording]           js/app.js       ──► navigator.mediaDevices.getUserMedia() + MediaRecorder
                                              ──► Captures live microphone chunks ──► Builds .webm File
[6. AI Processing]            js/app.js       ──► POST /api/recordings (FormData with audio file)
                                              ──► server.ts: multer.memoryStorage()
                                              ──► transcribeAudioBuffer() (Gemini AI -> Whisper -> Local NLP)
                                              ──► generateAiSummary() (Gemini JSON -> Markdown -> Local NLP)
[7. Faculty Review & Publish] js/app.js       ──► openFacultyReview() ──► Edit / Regenerate (POST /regenerate)
                                              ──► Click "Publish Lecture" ──► POST /api/recordings/:id/publish
[8. Student Study Access]     js/app.js       ──► Student logs in ──► Browses Storage Box / Search Filter
                                              ──► Opens Lecture (#detail) ──► Streams GET /api/recordings/:id/audio
                                              ──► Reads verified Transcript & copies AI Summary
```

### Step-by-Step Breakdown:
1. **Authentication & OTP (`login.html` → `js/auth.js` → `server.ts`):**
   * The professor opens `/login.html`, clicks **Faculty (Admin)** (`selectRole('faculty')`), enters credentials (or clicks **Faculty Demo**), and submits `#loginForm`.
   * `handleLogin()` sends `POST /api/auth/login`. `server.ts` verifies the SHA-256 password hash, generates a 6-digit OTP, emails it via `sendOtpEmail()`, and responds with `requireOtp: true`.
   * The professor enters the 6 digits in `#otpPanel`. `handleVerifyOtp()` calls `POST /api/auth/verify-otp`, receives the signed Bearer token, saves it to `localStorage`, and redirects to `/index.html`.
2. **Creating a Storage Box (`index.html` → `js/app.js` → `server.ts`):**
   * On `index.html`, `checkAuth()` and `applyRoleBasedUI()` activate the Faculty Dashboard.
   * The professor clicks **Storage Boxes** in the sidebar (`page('storageBoxes')`), clicks **Create New Box** (`openBoxFormModal()`), enters *"Data Structures (CS301)"*, and saves (`saveBoxForm()` → `POST /api/boxes`).
3. **Live Classroom Audio Recording (`index.html` → `js/app.js`):**
   * The professor opens **Create Lecture** (`page('createLecture')`), enters the lecture title, selects the Storage Box from `#facStorageBoxSelect`, and clicks **Start Recording** (`startFacultyLiveRecording()`).
   * The browser requests microphone permission (`getUserMedia({ audio: true })`), starts `MediaRecorder`, displays a live `HH:MM:SS` timer, and previews live speech via `webkitSpeechRecognition`.
   * When finished, the professor clicks **Stop Recording** (`stopFacultyLiveRecording()`), which packages the recorded `facAudioChunks` into a `File` object (`live-recording-<timestamp>.webm`) and loads it into the preview `<audio>` player.
4. **Uploading & Multi-Tier AI Processing (`js/app.js` → `server.ts`):**
   * The professor clicks **Process with AI** (`submitFacultyLecture('READY')`), which sends `FormData` to `POST /api/recordings`.
   * `server.ts` receives `req.file.buffer` via Multer, runs `transcribeAudioBuffer()` (Gemini 2.5 Flash audio transcription with Whisper/NLP fallback), and runs `generateAiSummary()` (Gemini structured JSON summary formatted into Overview, Key Takeaways, Keywords, Core Topics, and Revision Questions).
   * The new `Recording` is saved in the `recordings` Map with `status: 'READY'`.
5. **Faculty Verification & Publishing (`js/app.js` → `server.ts`):**
   * `openFacultyReview(created.id)` opens the split-screen `#facultyReview` editor.
   * The professor listens to the audio, edits any technical terms in `#revTranscriptInput` or `#revSummaryInput` (or clicks **Generate Summary** to re-run AI via `POST /api/recordings/:id/regenerate`), and clicks **Publish Lecture** (`publishCurrentLecture()` → `POST /api/recordings/:id/publish`).
   * The lecture status changes from `'READY'` to `'PUBLISHED'`.
6. **Student Access, Playback & Revision (`js/app.js` → `server.ts`):**
   * A student logs in via `login.html` (`Role: Student`) and lands on the Student Dashboard (`#studentHome`).
   * The student browses **Storage Boxes** or **Browse Lectures** (`#recordings`), filters by Storage Box/Subject, and clicks the published lecture (`openDetail(id)` → `GET /api/recordings/:id`).
   * The student streams the lecture audio (`GET /api/recordings/:id/audio`), downloads the audio file (`?download=1`), reads the professor-verified transcript, and clicks **Copy Summary** (`copySummaryText()`) for exam notes.

---

## 5. Divide Work Among Four Members

Every single file in the repository (17 files total) is assigned to **one and only one member** below, balanced by code size and technical complexity.

---

### 👤 MEMBER 1: Backend Lead — Server, Auth Security, AI Pipeline & REST APIs

#### Assigned Files (4 Files — Exclusive Ownership)
1. `/server.ts` (Explained in Section 1, File 1)
2. `/package.json` (Explained in Section 1, File 8)
3. `/tsconfig.json` (Explained in Section 1, File 9)
4. `/.env.example` & `/.smtp-config.json` (Explained in Section 1, Files 10 & 11 — 5 total config/backend files)

*(Note: Member 1 owns the 5 backend & server configuration files: `/server.ts`, `/package.json`, `/tsconfig.json`, `/.env.example`, and `/.smtp-config.json`.)*

#### Core Responsibilities
* Explain how the Node.js + Express server starts on port `3000` and serves both static files and `/api/*` endpoints.
* Explain SHA-256 password hashing, 6-digit OTP generation, Gmail SMTP email delivery (`nodemailer`), and stateless HMAC-SHA256 Bearer tokens.
* Explain the 3-tier AI pipeline (`transcribeAudioBuffer()` and `generateAiSummary()`) using `@google/genai`, Whisper, and the local extractive NLP fallback.
* Explain the in-memory `Map` data models (`users`, `storageBoxes`, `recordings`, `otps`, `sessions`) and Multer memory storage (`upload.single('audio')`).

#### Key Functions to Master in `/server.ts`
* `hashPassword()`, `generateStatelessToken()`, `verifyStatelessToken()`, `getAuthenticatedUser()`, `requireFaculty()`
* `transcribeAudioBuffer()`, `generateAiSummary()`, `extractKeySentences()`, `extractKeywords()`
* `sendOtpEmail()`, `seedDatabase()`

#### Live Demo Steps During Presentation
1. Show `package.json` and terminal running `npm run dev` on port `3000`.
2. Open `server.ts` to show the `User`, `StorageBox`, and `Recording` interfaces and `seedDatabase()`.
3. Walk through `transcribeAudioBuffer()` and `generateAiSummary()` to show how Gemini AI is called and how the local NLP fallback prevents crashes.

#### Likely Viva Questions & Answers for Member 1
* **Q1: Where is the audio file stored when a professor uploads a recording?**
  * **Answer:** We use `multer.memoryStorage()` (`server.ts` line 21), which holds the uploaded binary audio inside `req.file.buffer` in RAM and saves it inside `rec.audioBuffer` in the `recordings` `Map` (with a 200 MB limit).
* **Q2: What happens if the Google Gemini API key expires or the internet disconnects during a live demo?**
  * **Answer:** `transcribeAudioBuffer()` and `generateAiSummary()` are wrapped in `try/catch` blocks. If Gemini fails, `server.ts` automatically falls back to our built-in local extractive NLP functions (`generateTranscript()`, `extractKeySentences()`, and `extractKeywords()`) which score sentences by word frequency so the lecture is still transcribed and summarized without crashing.
* **Q3: Why don't users get logged out when the server restarts during development?**
  * **Answer:** Because `generateStatelessToken()` signs the user's payload using `crypto.createHmac('sha256', SECRET_SALT)`. When the server restarts, `verifyStatelessToken()` verifies the signature and reconstructs the user session in memory.

---

### 👤 MEMBER 2: Frontend Application Lead — SPA Router, Live Microphone Recorder & API Integration

#### Assigned Files (3 Files — Exclusive Ownership)
1. `/js/app.js` (Explained in Section 1, File 2)
2. `/bun.lock` (Explained in Section 1, File 12)
3. `/ghosh.md` (Explained in Section 1, File 16)

#### Core Responsibilities
* Explain how `js/app.js` manages the Single-Page Application (SPA) routing (`page()`), session verification (`checkAuth()`), and role-based UI switching (`applyRoleBasedUI()`).
* Explain how live classroom audio is captured in the browser using `navigator.mediaDevices.getUserMedia()`, `MediaRecorder`, `facAudioChunks`, and `webkitSpeechRecognition`.
* Explain how `js/app.js` communicates with `server.ts` using `apiFetch()` and `FormData` for creating lectures, managing Storage Boxes, reviewing/regenerating AI notes, and streaming student audio.
* Explain the offline browser fallback (`localStorage` key `vaani_recordings_v1`) when `backendAvailable` is `false`.

#### Key Functions to Master in `/js/app.js`
* `checkAuth()`, `apiFetch()`, `applyRoleBasedUI()`, `page()`
* `startFacultyLiveRecording()`, `stopFacultyLiveRecording()`, `submitFacultyLecture()`
* `openFacultyReview()`, `regenerateFacultyContent()`, `publishCurrentLecture()`
* `loadStorageBoxes()`, `saveBoxForm()`, `deleteBoxFlow()`, `renderRecordings()`, `openDetail()`

#### Live Demo Steps During Presentation
1. Log in as Faculty and create a new Storage Box (`Create New Box` modal).
2. Go to **Create Lecture**, click **Start Recording**, speak into the microphone for 10 seconds, click **Stop Recording**, and click **Process with AI**.
3. In the **Faculty Review** screen, edit the transcript/summary, click **Generate Summary**, and click **Publish Lecture**.

#### Likely Viva Questions & Answers for Member 2
* **Q1: How does the browser record audio without any external plugins?**
  * **Answer:** In `startFacultyLiveRecording()` (`js/app.js` line 1068), we call `navigator.mediaDevices.getUserMedia({ audio: true })` to get the microphone stream, pass it to the HTML5 `MediaRecorder` API, collect audio chunks every 250ms in `facAudioChunks`, and assemble them into a `.webm` `File` object when recording stops.
* **Q2: How do you send both the binary audio file and text fields (title, box ID, description) in a single HTTP request?**
  * **Answer:** In `submitFacultyLecture()`, we construct a `FormData` object (`formData.append('audio', selectedAudioFile)` along with text fields) and send it via `POST /api/recordings` so `multer` on the backend can parse both the binary buffer and text metadata together.
* **Q3: How does deleting a Storage Box affect the lectures inside it?**
  * **Answer:** In `deleteBoxFlow()` (`js/app.js` line 2515) and `DELETE /api/boxes/:id`, deleting a box never deletes its lectures—it sets `rec.storageBoxId = null` so the lectures remain safely accessible as unboxed recordings.

---

### 👤 MEMBER 3: UI/UX & Workspace Architecture Lead — SPA Views, Modals & Responsive Styling

#### Assigned Files (4 Files — Exclusive Ownership)
1. `/index.html` (Explained in Section 1, File 3)
2. `/css/style.css` (Explained in Section 1, File 4)
3. `/metadata.json` (Explained in Section 1, File 13)
4. `/vaani.png` (Explained in Section 1, File 14)

#### Core Responsibilities
* Explain the HTML5 Single-Page Application (SPA) architecture in `index.html`, including how all 11 `<section class="page">` screens and 2 modal dialogs (`#boxFormModal`, `#boxDetailModal`) are structured in a single DOM tree.
* Explain how Faculty-only and Student-only sections (`#studentHome` vs `#facultyHome`, `#createLecture`, `#facultyReview`, `#recordings`, `#detail`) are organized.
* Explain the CSS design system in `css/style.css`, including `:root` CSS variables, CSS Grid/Flexbox split layouts (`.faculty-grid`, `.review-layout`), dark sidebar navigation, and mobile media queries (`@media (max-width: 768px)`).
* Explain `metadata.json` and why `"requestFramePermissions": ["microphone"]` is required for browser audio capture.

#### Key Elements & Selectors to Master in `/index.html` & `/css/style.css`
* `<aside class="sidebar">`, `<header class="topbar">`, `<section class="page" id="...">`
* `#createLecture`, `#manageLectures`, `#storageBoxes`, `#facultyReview`, `#recordings`, `#detail`
* `#boxFormModal`, `#boxDetailModal`
* `.page.active`, `.faculty-grid`, `.review-layout`, `.box-card`, `.modal-overlay`

#### Live Demo Steps During Presentation
1. Tour the workspace layout: Sidebar navigation, Topbar search, Storage Boxes grid, and Student Lecture Detail view.
2. Open the browser's responsive device toolbar to demonstrate how `css/style.css` adapts the desktop layout and sidebar for tablet and mobile screens.
3. Demonstrate the Student view: filtering lectures by Storage Box, streaming classroom audio in `#detailAudioEl`, downloading the audio file, and clicking **Copy Summary**.

#### Likely Viva Questions & Answers for Member 3
* **Q1: Why does clicking sidebar buttons switch screens instantly without reloading the browser tab?**
  * **Answer:** `index.html` uses a Single-Page Application (SPA) layout where every view is a `<section class="page">`. In `css/style.css` (line 209), `.page` has `display: none`, and `.page.active` has `display: block`. Clicking a nav button toggles the `.active` class via `page(id)`.
* **Q2: Why did you use CSS Custom Properties (`:root` variables) in `css/style.css`?**
  * **Answer:** Defining variables like `--accent: #c85a32`, `--bg: #f6f5f1`, and `--surface: #ffffff` at the top of `css/style.css` ensures consistent colors, typography, and spacing across all 2,135 lines of CSS and makes theme adjustments easy.
* **Q3: What is the purpose of `metadata.json`?**
  * **Answer:** It defines the application title and declares `"requestFramePermissions": ["microphone"]` so the browser grants microphone access inside the hosted environment.

---

### 👤 MEMBER 4: Authentication UI & Documentation Lead — Role Login, Signup, OTP Flow & Project Docs

#### Assigned Files (5 Files — Exclusive Ownership)
1. `/login.html` (Explained in Section 1, File 5)
2. `/js/auth.js` (Explained in Section 1, File 6)
3. `/css/auth.css` (Explained in Section 1, File 7)
4. `/README.md` (Explained in Section 1, File 15)
5. `/ghosh3.md` (Explained in Section 1, File 17)

#### Core Responsibilities
* Explain the complete frontend authentication flow in `login.html`, `js/auth.js`, and `css/auth.css`.
* Explain how the Role Selector (`Student` vs `Faculty (Admin)`) dynamically updates the login and signup forms (showing/hiding `#signupFacultyIdField`) and prevents role mismatches.
* Explain how the 6-digit OTP input boxes (`.otp-digit`) work, including auto-focusing the next box on keypress, supporting paste events, running the 30-second resend countdown timer (`startResendTimer()`), and displaying the fallback `demoCode` banner (`#otpDemoBox`).
* Maintain and present the project documentation (`README.md` and `ghosh3.md`).

#### Key Functions to Master in `/js/auth.js`
* `checkExistingSession()`, `selectRole(role)`, `switchTab(tab)`, `fillDemo(type)`
* `handleLogin(e)`, `handleSignup(e)`, `showOtpStep()`, `handleVerifyOtp(e)`
* `setupOtpInputs()`, `resendOtp()`, `startResendTimer()`

#### Live Demo Steps During Presentation
1. Start at `/login.html` and demonstrate switching between **Student** and **Faculty (Admin)** roles and **Sign In** vs **Create Account** tabs.
2. Show how clicking **Faculty Demo** or signing up triggers the 6-digit OTP verification screen (`#otpPanel`).
3. Show the OTP verification completing, storing `vaani_token` in `localStorage`, and redirecting into `index.html`.

#### Likely Viva Questions & Answers for Member 4
* **Q1: How do the 6 separate OTP input boxes automatically move the cursor as the user types?**
  * **Answer:** In `setupOtpInputs()` (`js/auth.js` lines 341–377), we attach `input`, `keydown`, and `paste` event listeners to all `.otp-digit` inputs. Typing a digit automatically calls `digits[idx + 1].focus()`, pressing `Backspace` moves focus backward, and pasting a 6-digit number fills all 6 boxes at once.
* **Q2: What happens if a student tries to log in while the "Faculty (Admin)" role button is selected?**
  * **Answer:** `handleLogin()` sends the selected `role` along with `email` and `password` to `POST /api/auth/login`. The backend compares `user.role !== role` and returns a `403 Forbidden` error (*"This account is registered as a Student. Please switch role to Student."*), which `js/auth.js` displays in `#loginError`.
* **Q3: How does the app stay logged in when the user refreshes the page?**
  * **Answer:** When `handleVerifyOtp()` succeeds, `js/auth.js` saves `vaani_token` and `vaani_user` in `window.localStorage`. On page load, `checkExistingSession()` (on `login.html`) and `checkAuth()` (on `index.html`) verify that token with `GET /api/auth/me`.

---

## 6. Final Verification Table (Every File Listed Once & Assigned to Exactly One Member)

Below is the complete verification table accounting for all **17 files** in the project root, `/css`, and `/js`. Note that `ghosh2.md` has been removed as requested, and this complete guide is saved in `ghosh3.md`.

| # | File Path | Purpose | APIs / Services Used | Assigned Member |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `/server.ts` | Main Node.js + Express backend server, 25 REST API endpoints, SHA-256/HMAC auth, Multer audio upload, 3-tier AI transcription/summarization, and in-memory `Map` datastore. | Express.js, Multer, Node `crypto`, Google Gemini (`@google/genai`), optional Groq/OpenAI Whisper API, Nodemailer (Gmail SMTP), Local NLP engine. | **Member 1** |
| 2 | `/package.json` | Node.js project manifest defining scripts (`dev`, `build`, `start`) and npm dependencies. | npm / Node.js runtime (`express`, `@google/genai`, `multer`, `nodemailer`, `dotenv`, `tsx`, `typescript`). | **Member 1** |
| 3 | `/tsconfig.json` | TypeScript compiler configuration (`ES2022`, `NodeNext`) used to type-check and run `server.ts`. | TypeScript compiler (`tsc`). | **Member 1** |
| 4 | `/.env.example` | Template listing supported environment variables (`GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `SMTP_*`, `PORT`) without exposing secrets. | `dotenv` environment configuration. | **Member 1** |
| 5 | `/.smtp-config.json` | Local runtime JSON file read/written by `server.ts` to persist Gmail SMTP settings across restarts. | Node `fs` (`readFileSync` / `writeFileSync`), Gmail SMTP. | **Member 1** |
| 6 | `/js/app.js` | Main frontend SPA controller: session check, role-based UI, live microphone `MediaRecorder`, Storage Boxes CRUD, Faculty Review editor, and Student audio player. | Browser `fetch` (`/api/auth/*`, `/api/boxes/*`, `/api/recordings/*`, `/api/faculty/profile`), `MediaRecorder`, `getUserMedia`, `SpeechRecognition`, `Clipboard API`, `localStorage`. | **Member 2** |
| 7 | `/bun.lock` | Package manager lockfile ensuring deterministic dependency installation across machines. | Bun / npm package resolver. | **Member 2** |
| 8 | `/ghosh.md` | Concise summary of the minimal 3-layer system architecture, tech stack, database notes, and feature checklist. | None (Markdown documentation). | **Member 2** |
| 9 | `/index.html` | Single-Page Application (SPA) HTML workspace containing Faculty & Student dashboards, live recorder UI, review editor, Storage Box modals, and audio player. | Lucide Icons CDN (`unpkg.com/lucide@latest`), Google Fonts CDN, HTML5 `<audio>`. | **Member 3** |
| 10 | `/css/style.css` | Master stylesheet (2,135 lines) for `index.html`: CSS variables, sidebar layout, SPA page transitions, split review grids, Storage Box cards, and mobile media queries. | CSS3 Grid, Flexbox, Custom Properties, Keyframe Animations. | **Member 3** |
| 11 | `/metadata.json` | Applet metadata configuration requesting `"microphone"` frame permission for live browser audio recording. | Browser Permissions Policy (`microphone`). | **Member 3** |
| 12 | `/vaani.png` | Official Vaani brand logo image displayed in `login.html` and `index.html`. | Static image asset served by Express. | **Member 3** |
| 13 | `/login.html` | Split-screen authentication page containing Role Selector (`Student` / `Faculty`), Sign-In form, Sign-Up form, and 6-digit OTP verification panel. | Lucide Icons CDN, Google Fonts CDN. | **Member 4** |
| 14 | `/js/auth.js` | Frontend authentication script handling role selection, demo autofill, login/signup submission, 6-digit OTP box navigation, resend countdown, and token storage. | Browser `fetch` (`POST /api/auth/login`, `/api/auth/signup`, `/api/auth/verify-otp`, `/api/auth/resend-otp`, `GET /api/auth/me`), `localStorage`. | **Member 4** |
| 15 | `/css/auth.css` | Stylesheet (715 lines) for `login.html`: split brand/form layout, role switcher buttons, OTP digit boxes, and responsive breakpoints. | CSS3 Flexbox, Grid, Custom Properties. | **Member 4** |
| 16 | `/README.md` | Primary project README with overview, architecture diagram, REST API table, and demo credentials. | None (Markdown documentation). | **Member 4** |
| 17 | `/ghosh3.md` | Complete file-by-file codebase guide, API & external service breakdown, backend data workflow, and 4-member team division. | None (Markdown documentation). | **Member 4** |

### Verification Checklist Summary
* **Total Files in Project:** 17 files (`server.ts`, `package.json`, `tsconfig.json`, `.env.example`, `.smtp-config.json`, `js/app.js`, `bun.lock`, `ghosh.md`, `index.html`, `css/style.css`, `metadata.json`, `vaani.png`, `login.html`, `js/auth.js`, `css/auth.css`, `README.md`, `ghosh3.md`).
* **Removed Files:** `ghosh2.md` has been deleted as requested.
* **No Duplicate Ownership:** Every file is assigned to exactly one member (Member 1: 5 files, Member 2: 3 files, Member 3: 4 files, Member 4: 5 files).
* **Unverified / Important Codebase Notes Disclosed Honestly:**
  1. **Database Storage:** The codebase (`server.ts`) uses **in-memory TypeScript `Map` collections** seeded by `seedDatabase()`, not an external SQL/MySQL/H2 database server.
  2. **Batch Access Filtering:** While `POST /api/recordings/:id/access` saves `rec.allowedAccess` and `canUserAccessRecording()` is defined in `server.ts`, `GET /api/recordings` currently shows all `PUBLISHED` lectures to students regardless of their course string.
  3. **SMTP UI Settings:** `server.ts` and `js/app.js` contain helper functions for `/api/auth/smtp-status`, `/api/auth/save-smtp`, and `/api/auth/test-smtp`, while active SMTP configuration is read from `.env` or `.smtp-config.json`.
