# Vaani — Academic Lecture Capture, Transcription & AI Summarization Platform 🎙️🎓

**Vaani** is a role-based academic platform built for educators and students. It allows **Faculty** to record live classroom lectures directly in the browser, organize courses into custom **Storage Boxes**, automatically generate speech-to-text transcripts and structured AI study summaries, and verify content before publishing it to **Students**.

---

## ✨ Key Features

### 1. Role-Based Access Control (Faculty vs. Student)
- **Dual-Role Authentication**: Dedicated interfaces, navigation, and permission sets for **Faculty** and **Student** accounts.
- **Email OTP Verification**: 6-digit one-time passcode verification sent via Gmail SMTP (5-minute TTL) for new user signups.
- **Session Security**: SHA-256 password hashing and Bearer token session management with instant revocation on logout.
- **Strict Permission Enforcement**: Only Faculty can record, edit, organize, and publish content; Students receive a clean, distraction-free read-and-listen workspace.

### 2. Dynamic Storage Box System
- **Custom Subject & Course Containers**: Faculty can create, rename, edit, and delete Storage Boxes for any custom subject or course (no rigid predefined categories).
- **Structured Lecture Grouping**: Assign lectures directly to a Storage Box during creation or reorganize them across boxes at any time.
- **Search & Browsing**: Both Faculty and Students can search Storage Boxes by name or description and view lecture counts and last-updated dates.

### 3. Faculty Workspace (Creation, Review & Publishing)
- **Live Classroom Audio Recording**: Record lectures directly from the browser microphone using the HTML5 `MediaRecorder` API with a live timer (`Start`, `Stop`, and `Reset` controls).
- **Automated AI Processing Pipeline**:
  1. **Audio Capture**: Captures live recorded classroom audio.
  2. **Speech-to-Text Transcription**: Automatically generates a clean, structured lecture transcript.
  3. **AI Lecture Summarization**: Generates structured academic study notes, executive overviews, and key takeaways.
- **Review, Edit & Regeneration**: Faculty can manually edit transcripts and summaries or trigger on-demand AI regeneration before publishing.
- **Publish & Batch Access Control**: Toggle lectures between `DRAFT`, `READY`, and `PUBLISHED` states and configure which classes or student batches have access.
- **Engagement Analytics**: Track total lectures, published count, number of students who accessed each lecture, total audio plays, and average listening time.
- **Faculty Profile Management**: Manage academic credentials, department info, profile photo, and account password.

### 4. Student Workspace (Study & Playback)
- **Read & Listen-Only Interface**: Clean academic portal displaying only published lectures and Storage Boxes.
- **In-Browser Audio Streaming & Download**: Stream lecture recordings via the built-in audio player or download audio files for offline listening.
- **Verified Transcripts & AI Summaries**: Tabbed lecture detail view with the faculty-verified transcript, structured AI summary, and lecture metadata.
- **Quick Study Tools**: One-click **Copy Summary** for revision notes and fast filtering by title, subject, or professor name.

---

## 🏗️ System Architecture

```
+-------------------------------------------------------------------+
|                           Client Layer                            |
|                                                                   |
|  +-----------------------------+   +---------------------------+  |
|  |      Faculty Interface      |   |     Student Interface     |  |
|  | - Live Audio Recording      |   | - Storage Box Browsing    |  |
|  | - Storage Box Management    |   | - Lecture Audio Playback  |  |
|  | - Transcript/Summary Review |   | - Transcript & Notes View |  |
|  | - Access & Publish Control  |   | - Search & Filtering      |  |
|  +--------------+--------------+   +-------------+-------------+  |
+-----------------|--------------------------------|----------------+
                  |                                |
                  +---------------+----------------+
                                  |
                         REST API / HTTP
                                  |
+---------------------------------v---------------------------------+
|                        Application Server                         |
|                                                                   |
|  +----------------------+  +-----------------+  +--------------+  |
|  | Auth & Role Guard    |  | Lecture Manager |  | Box Manager  |  |
|  | (Faculty vs Student) |  | (CRUD & Status) |  | (Grouping)   |  |
|  +----------------------+  +--------+--------+  +--------------+  |
|                                     |                             |
|                            +--------v--------+                    |
|                            |   AI Pipeline   |                    |
|                            | - Transcription |                    |
|                            | - Summarization |                    |
|                            +--------+--------+                    |
+-------------------------------------|-----------------------------+
                                      |
                  +-------------------+-------------------+
                  |                                       |
+-----------------v-----------------+   +-----------------v-----------------+
|          Storage Layer            |   |        External AI Service        |
|                                   |   |                                   |
| - User Accounts & Roles           |   | - Speech-to-Text Processing       |
| - Storage Boxes & Metadata        |   | - Lecture Summary Generation      |
| - Lecture Audio Streams           |   |                                   |
| - Verified Transcripts & Notes    |   |                                   |
+-----------------------------------+   +-----------------------------------+
```

---

## 🛠️ Tech Stack

### Frontend
- **Markup & Structure**: HTML5 (`index.html`, `login.html`)
- **Styling**: Custom CSS3 (Responsive Layout, Academic Blue/Slate/Green Theme)
- **Client Logic**: Vanilla JavaScript (ES6+) (`js/app.js`, `js/auth.js`)
- **Audio Capture & Playback**: Web Audio API & MediaStream Recording API (`MediaRecorder`)
- **Iconography**: Lucide Outline Icons

### Backend
- **Runtime Environment**: Node.js
- **Web Framework**: Express.js
- **Language**: TypeScript (`tsx` execution runtime)
- **Authentication**: Token-based Session Management & Role-Based Access Control (RBAC)
- **Email Service**: Nodemailer (Gmail SMTP for 6-digit OTP verification)

### AI & Processing
- **Capabilities**: Automated Speech-to-Text Transcription & Academic Lecture Summarization

### Data & Database Architecture
- **Relational Database (SQL)**: **H2 Embedded SQL Database** / **MySQL** (for relational entity persistence of Users, OTPs, Storage Boxes, and Lecture Recordings)
- **In-Memory Cache & Runtime Store**: **In-Memory Key-Value Store** (Redis-style in-memory `Map` & `Set` collections for fast session token lookups, OTP TTL tracking, and active runtime state)
- **Database Entities**:
  - **Users**: Stores user credentials, SHA-256 hashed passwords, roles (`faculty` / `student`), department info, and verification status.
  - **Sessions & OTPs**: Manages active Base64URL session tokens, revoked tokens, and 5-minute TTL OTP verification codes.
  - **Storage Boxes**: Stores dynamic subject/course containers, descriptions, creator metadata, and timestamps.
  - **Recordings**: Stores lecture metadata, processing status (`DRAFT`, `PROCESSING`, `READY`, `PUBLISHED`), verified transcripts, AI summaries, batch access permissions, analytics counters, and binary audio streams (`BLOB` / `Buffer`).
- **Client-Side Storage**: Browser `localStorage` for persisting authentication tokens, active user role, and session state.

---

## 📂 Project Structure

```
vaani/
├── css/
│   ├── auth.css              # Styles for Faculty/Student login, signup & OTP forms
│   └── style.css             # Academic dashboard, Storage Boxes & recorder styles
├── js/
│   ├── auth.js               # Role-based login, signup & OTP frontend logic
│   └── app.js                # Faculty & Student workspace, Storage Boxes, recorder & player
├── index.html                # Main application workspace (Faculty & Student views)
├── login.html                # Role-based Login / Signup / OTP verification page
├── server.ts                 # Express TypeScript server, REST APIs, Auth & AI pipeline
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
├── vaani.png                 # Project logo
└── README.md                 # Project documentation
```

---

## 📡 REST API Reference

### Authentication Endpoints

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/auth/signup` | Public | Register a new Faculty or Student account & send 6-digit OTP |
| `POST` | `/api/auth/verify-otp` | Public | Verify 6-digit OTP code and activate user session |
| `POST` | `/api/auth/resend-otp` | Public | Resend a fresh 6-digit OTP code |
| `POST` | `/api/auth/login` | Public | Log in existing verified user (`faculty` or `student`) |
| `GET` | `/api/auth/me` | Authenticated | Fetch currently logged-in user profile and role |
| `POST` | `/api/auth/logout` | Authenticated | Invalidate current user session token |

### Storage Box Endpoints

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/boxes` | Faculty & Student | List all Storage Boxes with lecture counts |
| `POST` | `/api/boxes` | Faculty Only | Create a new custom Storage Box |
| `PUT` | `/api/boxes/:id` | Faculty Only | Rename or update a Storage Box description |
| `DELETE` | `/api/boxes/:id` | Faculty Only | Delete a Storage Box |

### Lecture Recording Endpoints

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/recordings` | Faculty & Student | List lectures (Faculty sees all; Students see `PUBLISHED` only) |
| `GET` | `/api/recordings/:id` | Faculty & Student | Get full lecture details, transcript, summary, and analytics |
| `GET` | `/api/recordings/:id/audio` | Faculty & Student | Stream or download recorded classroom audio |
| `POST` | `/api/recordings` | Faculty Only | Save recorded audio & trigger AI transcription/summarization |
| `PUT` | `/api/recordings/:id` | Faculty Only | Update lecture metadata, edited transcript/summary, or box assignment |
| `POST` | `/api/recordings/:id/publish` | Faculty Only | Publish or unpublish a lecture for students |
| `POST` | `/api/recordings/:id/regenerate` | Faculty Only | Regenerate AI transcript or summary on demand |
| `DELETE` | `/api/recordings/:id` | Faculty Only | Delete a lecture recording |

