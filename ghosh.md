# Vaani — System Architecture & Tech Stack

## Minimal System Architecture

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

### Core Workflow
1. **Authentication & Access Control**: Users authenticate as either **Faculty** or **Student**. Role guards enforce creation and publishing permissions exclusively for Faculty, while Students receive read-only and playback access.
2. **Organization**: Faculty organize subjects and courses into dynamic **Storage Boxes**.
3. **Capture & Processing**: Faculty record live classroom audio via the browser microphone. The audio stream is sent to the server and processed through the AI pipeline to generate a structured transcript and summary.
4. **Verification & Publishing**: Faculty review, edit, and verify the generated transcript and summary, configure batch access, and publish the lecture.
5. **Consumption**: Students browse Storage Boxes, stream published lecture audio, and study the verified transcripts and summaries.

---

## Tech Stack

### Frontend
- **Markup & Structure**: HTML5
- **Styling**: Custom CSS3 (Responsive Layout, Academic Blue/Slate/Green Theme)
- **Client Logic**: Vanilla JavaScript (ES6+)
- **Audio Capture & Playback**: Web Audio API & MediaStream Recording API (`MediaRecorder`)
- **Iconography**: Lucide Outline Icons

### Backend
- **Runtime Environment**: Node.js
- **Web Framework**: Express.js
- **Language**: TypeScript (`tsx` execution runtime)
- **Authentication**: Token-based Session Management & Role-Based Access Control (RBAC)

### AI & Processing
- **AI SDK**: Google GenAI SDK (`@google/genai`)
- **Capabilities**: Automated Speech-to-Text Transcription & Academic Lecture Summarization

### Data & Database Architecture
- **Relational Database (SQL)**: **H2 Embedded SQL Database** / **MySQL** (for relational entity persistence of Users, OTPs, Storage Boxes, and Lecture Recordings)
- **In-Memory Cache & Runtime Store**: **In-Memory Key-Value Store** (Redis-style in-memory `Map` & `Set` collections for fast session token lookups, OTP TTL tracking, and active runtime state)
- **Database Schema / Entities**:
  - **Users**: Stores user credentials, SHA-256 hashed passwords, roles (`faculty` / `student`), department info, and verification status.
  - **Sessions & OTPs**: Manages active Base64URL session tokens, revoked tokens, and 5-minute TTL OTP verification codes.
  - **Storage Boxes**: Stores dynamic subject/course containers, descriptions, creator metadata, and timestamps.
  - **Recordings**: Stores lecture metadata, processing status (`DRAFT`, `PROCESSING`, `READY`, `PUBLISHED`), verified transcripts, AI summaries, batch access permissions, analytics counters, and binary audio streams (`BLOB` / `Buffer`).
- **Client-Side Storage**: Browser `localStorage` for persisting authentication tokens, active user role, and offline fallback state.

---

## Project Features

### 1. Authentication & Role-Based Access Control (RBAC)
- **Dual-Role Login & Registration**: Separate workflows and permissions for **Faculty** and **Student** accounts.
- **Email OTP Verification**: 6-digit one-time passcode verification sent via Gmail SMTP (with 5-minute TTL expiry) for new user signups.
- **Secure Session Management**: Bearer token authentication with SHA-256 password hashing and instant session revocation on logout.
- **Strict Permission Guards**: Server-side role verification ensuring only Faculty can create, modify, or publish content, while Students have strictly read-and-listen access.

### 2. Dynamic Storage Box System
- **Custom Subject & Course Containers**: Faculty can create, rename, edit, and delete Storage Boxes with any custom subject or course name (no rigid predefined categories).
- **Organized Lecture Grouping**: Lectures can be assigned directly to a Storage Box during creation or moved between boxes later.
- **Box Browsing & Search**: Both Faculty and Students can search Storage Boxes by name or description and view lecture counts and last-updated timestamps.

### 3. Faculty Features (Creation, Review & Publishing)
- **Live Microphone Recording**: In-browser classroom audio capture using the Web MediaRecorder API with a live timer (`Start`, `Stop`, and `Reset` controls).
- **Draft & Metadata Management**: Faculty can save lectures as drafts or process them immediately with custom titles, subjects, classes/courses, dates, and learning objectives.
- **Automated AI Processing Pipeline**:
  1. **Audio Capture**: Captures live recorded classroom audio.
  2. **Speech-to-Text Transcription**: Automatically generates an accurate, structured lecture transcript.
  3. **AI Lecture Summarization**: Generates structured academic study notes, executive overview, and key takeaways.
- **Review, Edit & Regeneration**: Faculty can manually edit transcripts and summaries, or trigger on-demand AI regeneration before publishing.
- **Publish & Batch Access Control**: Faculty can publish (`PUBLISHED`) or unpublish (`READY` / `DRAFT`) lectures at any time and configure which classes or student batches have access.
- **Engagement Analytics**: Faculty dashboard and analytics view tracking total lectures, published count, number of students who accessed each lecture, total audio plays, and average listening time.
- **Faculty Profile Management**: Manage academic credentials, department info, profile photo, and account password.

### 4. Student Features (Study & Playback)
- **Read & Listen-Only Workspace**: Clean, distraction-free academic interface designed for studying published lecture material.
- **In-Browser Audio Streaming & Download**: Built-in HTML5 audio player for streaming published classroom recordings, plus one-click audio download for offline listening.
- **Verified Transcripts & AI Summaries**: Tabbed lecture detail view allowing students to read the faculty-verified transcript alongside the structured AI summary and file details.
- **Quick Study Actions**: One-click **Copy Summary** for revision notes and quick navigation across Storage Boxes and all published lectures.
- **Search & Filtering**: Search published lectures by title, subject, or professor name, and filter by course or subject.

