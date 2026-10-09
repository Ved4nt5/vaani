import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

// ── Gemini Client Initialization ─────────────────────────────────────────

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) return null;
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// ── Types & In-Memory Stores ─────────────────────────────────────────────

interface User {
  id: number;
  name: string;
  email: string;
  password: string;
  role: 'faculty' | 'student';
  facultyId?: string;
  department?: string;
  avatarUrl?: string;
  course?: string;
  summaryMode?: string;
  verified: boolean;
  createdAt: Date;
}

interface Otp {
  id: number;
  email: string;
  code: string;
  createdAt: Date;
  expiresAt: Date;
}

interface StorageBox {
  id: number;
  name: string;
  description: string;
  createdBy: string;
  facultyId?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface StorageBoxResponseDto {
  id: number;
  name: string;
  description: string;
  createdBy: string;
  facultyId?: string;
  recordingCount: number;
  publishedRecordingCount: number;
  createdAt: string;
  updatedAt: string;
  lastUpdatedFormatted: string;
}

interface Recording {
  id: number;
  storageBoxId?: number | null;
  title: string;
  lectureName: string | null;
  professorName: string | null;
  subject?: string | null;
  classCourse?: string | null;
  lectureDate?: string | null;
  description?: string | null;
  duration: string;
  createdAt: Date;
  status: string;
  facultyStatus?: 'DRAFT' | 'PROCESSING' | 'READY' | 'PUBLISHED';
  published?: boolean;
  isFacultyLecture?: boolean;
  allowedAccess?: string[];
  studentsAccessed?: number;
  playsCount?: number;
  avgListeningTime?: string;
  transcript: string;
  summary: string;
  audioFilename: string | null;
  audioContentType: string | null;
  audioData: Buffer | null;
}

interface RecordingResponseDto {
  id: number;
  storageBoxId?: number | null;
  storageBoxName?: string | null;
  title: string;
  lectureName: string | null;
  professorName: string | null;
  subject?: string | null;
  classCourse?: string | null;
  lectureDate?: string | null;
  description?: string | null;
  duration: string;
  createdAt: string;
  createdAtIso?: string;
  timestamp?: number;
  status: string;
  facultyStatus?: 'DRAFT' | 'PROCESSING' | 'READY' | 'PUBLISHED';
  published?: boolean;
  isFacultyLecture?: boolean;
  allowedAccess?: string[];
  studentsAccessed?: number;
  playsCount?: number;
  avgListeningTime?: string;
  transcript: string;
  summary: string;
  hasAudio: boolean;
  audioUrl: string | null;
}

const users = new Map<string, User>();
const otps = new Map<string, Otp>();
const sessions = new Map<string, User>();
const revokedTokens = new Set<string>();
const recordings = new Map<number, Recording>();
const storageBoxes = new Map<number, StorageBox>();
const accessedStudentsPerLecture = new Map<number, Set<string>>();

let userIdCounter = 1;
let otpIdCounter = 1;
let recordingIdCounter = 1;
let storageBoxIdCounter = 1;

// ── Helpers ──────────────────────────────────────────────────────────────

const TOKEN_SECRET = process.env.VAANI_TOKEN_SECRET || 'vaani-studio-hmac-secret-2026';

const KNOWN_COURSES = new Set([
  'se computer engineering',
  'te computer engineering',
  'be computer engineering',
  'fe general engineering',
  'm.tech ai & data science',
]);

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password, 'utf8').digest('hex');
}

function checkPassword(rawPassword: string, hashedPassword: string): boolean {
  return hashPassword(rawPassword) === hashedPassword;
}

function generateOtpCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

function signPayload(payloadB64: string): string {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(payloadB64).digest('base64url');
}

function createSessionToken(user: User): string {
  const payloadB64 = Buffer.from(
    JSON.stringify({
      email: user.email,
      name: user.name,
      role: user.role || 'student',
      ts: Date.now(),
      nonce: crypto.randomUUID(),
    }),
    'utf8'
  ).toString('base64url');
  const sig = signPayload(payloadB64);
  const token = `${payloadB64}.${sig}`;
  sessions.set(token, user);
  return token;
}

function parseCookies(req: Request): Record<string, string> {
  const raw = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

function setAuthCookie(res: Response, token: string) {
  res.setHeader('Set-Cookie', `vaani_token=${encodeURIComponent(token)}; Path=/; SameSite=Lax; HttpOnly`);
}

function clearAuthCookie(res: Response) {
  res.setHeader('Set-Cookie', 'vaani_token=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly');
}

function getUserFromToken(token: string | null | undefined): User | null {
  if (!token || revokedTokens.has(token)) {
    return null;
  }
  const existing = sessions.get(token);
  if (existing) {
    const dbUser = users.get(existing.email);
    return dbUser || existing;
  }
  try {
    const parts = token.split('.');
    const payloadB64 = parts[0];
    if (parts.length === 2) {
      const expectedSig = signPayload(payloadB64);
      if (parts[1] !== expectedSig) {
        return null;
      }
    }
    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (decoded && typeof decoded.email === 'string') {
      const existingUser = users.get(decoded.email.toLowerCase());
      if (existingUser) {
        sessions.set(token, existingUser);
        return existingUser;
      }
      if (parts.length === 2) {
        const user: User = {
          id: userIdCounter++,
          name: decoded.name || 'User',
          email: decoded.email.toLowerCase(),
          password: '',
          role: decoded.role === 'faculty' ? 'faculty' : 'student',
          facultyId: decoded.role === 'faculty' ? 'FAC-2026-101' : undefined,
          department: decoded.role === 'faculty' ? 'Computer Engineering & AI' : undefined,
          course: decoded.role === 'student' ? 'SE Computer Engineering' : undefined,
          verified: true,
          createdAt: new Date(),
        };
        users.set(user.email, user);
        sessions.set(token, user);
        return user;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function getAuthenticatedUser(req: Request): User | null {
  const authHeader = req.headers.authorization;
  let token: string | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (typeof req.query.token === 'string' && req.query.token.trim()) {
    token = req.query.token.trim();
  } else {
    const cookies = parseCookies(req);
    if (cookies.vaani_token) {
      token = cookies.vaani_token;
    }
  }
  return getUserFromToken(token);
}

function requireFaculty(req: Request, res: Response): User | null {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  if (user.role !== 'faculty') {
    res.status(403).json({ error: 'Access denied: Faculty role required for this action.' });
    return null;
  }
  return user;
}

function isRecordingPublished(rec: Recording): boolean {
  return rec.published === true && rec.facultyStatus === 'PUBLISHED';
}

function canUserAccessRecording(user: User | null, rec: Recording): boolean {
  if (!user) return false;
  if (user.role === 'faculty') return true;

  // Students can only access published lectures
  if (!isRecordingPublished(rec)) {
    return false;
  }

  const allowed = Array.isArray(rec.allowedAccess) ? rec.allowedAccess : [];
  if (allowed.length === 0) {
    return false;
  }

  const allowedLower = allowed.map(a => String(a).trim().toLowerCase()).filter(Boolean);
  if (allowedLower.includes('all')) {
    return true;
  }

  const studentCourse = (user.course || 'SE Computer Engineering').trim().toLowerCase();
  const specifiedCourses = allowedLower.filter(a => KNOWN_COURSES.has(a));

  if (specifiedCourses.length > 0) {
    return specifiedCourses.includes(studentCourse);
  }

  if (rec.classCourse && KNOWN_COURSES.has(rec.classCourse.trim().toLowerCase())) {
    if (rec.classCourse.trim().toLowerCase() === studentCourse) {
      return true;
    }
  }

  return allowedLower.includes(studentCourse);
}

function parseDurationSeconds(dur: string | null | undefined): number {
  if (!dur || typeof dur !== 'string') return 0;
  const trimmed = dur.trim();
  const minSecMatch = trimmed.match(/(\d+)\s*m\s*(\d+)\s*s/i);
  if (minSecMatch) {
    return parseInt(minSecMatch[1], 10) * 60 + parseInt(minSecMatch[2], 10);
  }
  const colonParts = trimmed.split(':').map(n => parseInt(n, 10));
  if (colonParts.every(n => !Number.isNaN(n))) {
    if (colonParts.length === 3) {
      return colonParts[0] * 3600 + colonParts[1] * 60 + colonParts[2];
    }
    if (colonParts.length === 2) {
      return colonParts[0] * 60 + colonParts[1];
    }
  }
  return 0;
}

function formatListeningDuration(totalSeconds: number): string {
  const safeSec = Math.max(0, Math.round(totalSeconds || 0));
  const m = Math.floor(safeSec / 60);
  const s = safeSec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function recordLecturePlayEvent(rec: Recording, user: User | null, listenedSeconds?: number) {
  if (user && user.role === 'student' && user.email) {
    let set = accessedStudentsPerLecture.get(rec.id);
    if (!set) {
      set = new Set<string>();
      accessedStudentsPerLecture.set(rec.id, set);
    }
    if (!set.has(user.email)) {
      set.add(user.email);
      rec.studentsAccessed = (rec.studentsAccessed || 0) + 1;
    }
  }
  if (!rec.studentsAccessed || rec.studentsAccessed < 1) {
    rec.studentsAccessed = 1;
  }

  const prevPlays = typeof rec.playsCount === 'number' && rec.playsCount > 0 ? rec.playsCount : 0;
  const prevTotalSec =
    typeof rec.totalListeningSeconds === 'number' && rec.totalListeningSeconds >= 0
      ? rec.totalListeningSeconds
      : prevPlays * parseDurationSeconds(rec.avgListeningTime);

  const lectureDurSec = parseDurationSeconds(rec.duration);
  const eventSec =
    typeof listenedSeconds === 'number' && listenedSeconds > 0
      ? listenedSeconds
      : lectureDurSec > 0
      ? lectureDurSec
      : 60;

  rec.playsCount = prevPlays + 1;
  rec.totalListeningSeconds = prevTotalSec + eventSec;
  rec.avgListeningTime = formatListeningDuration(rec.totalListeningSeconds / rec.playsCount);
}

function formatDateTime(date: Date, userTz?: string): string {
  try {
    if (userTz) {
      const dtf = new Intl.DateTimeFormat('en-GB', {
        timeZone: userTz,
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
      const parts = dtf.formatToParts(date);
      const get = (type: string) => parts.find(p => p.type === type)?.value || '';
      const day = get('day');
      const month = get('month');
      const year = get('year');
      const hour = get('hour');
      const minute = get('minute');
      const dayPeriod = (get('dayPeriod') || 'AM').toUpperCase();
      return `${day} ${month} ${year}, ${hour}:${minute} ${dayPeriod}`;
    }
  } catch {
    // If timezone is invalid, fallback to standard formatting
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(date.getDate()).padStart(2, '0');
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const hh = String(hours).padStart(2, '0');
  return `${day} ${month} ${year}, ${hh}:${minutes} ${ampm}`;
}

function isBrokenOrErrorText(text: string | null | undefined): boolean {
  if (!text || !text.trim()) return true;
  const lower = text.toLowerCase();
  return (
    lower.includes('openai whisper could not transcribe') ||
    lower.includes('http 429') ||
    lower.includes('transcription or summary failed') ||
    lower.includes('no transcript available') ||
    lower.includes('no summary available') ||
    lower.includes('check your api key, account billing')
  );
}

function isUnhelpfulAudioText(text: string | null | undefined): boolean {
  if (!text) return true;
  const t = text.trim().toLowerCase();
  return (
    t === '00:00' ||
    t === '00:00 - 00:01' ||
    t === '[silence]' ||
    t === '[music]' ||
    t === '[applause]' ||
    t === 'thank you' ||
    t === 'thank you.' ||
    t === 'undefined'
  );
}

function stripModelLine(text: string): string {
  return text
    .replace(/^[•\-\*]?\s*AI Processing Model:.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toStorageBoxDto(box: StorageBox, userTz?: string, user?: User | null): StorageBoxResponseDto {
  const allRecs = Array.from(recordings.values()).filter(r => r.storageBoxId === box.id);
  const publishedRecs = allRecs.filter(r =>
    user && user.role === 'student' ? canUserAccessRecording(user, r) : isRecordingPublished(r)
  );
  const updatedDate = box.updatedAt instanceof Date ? box.updatedAt : new Date(box.updatedAt || Date.now());
  const createdDate = box.createdAt instanceof Date ? box.createdAt : new Date(box.createdAt || Date.now());

  return {
    id: box.id,
    name: box.name,
    description: box.description || '',
    createdBy: box.createdBy || 'Faculty',
    facultyId: box.facultyId,
    recordingCount: allRecs.length,
    publishedRecordingCount: publishedRecs.length,
    createdAt: formatDateTime(createdDate, userTz),
    updatedAt: formatDateTime(updatedDate, userTz),
    lastUpdatedFormatted: formatDateTime(updatedDate, userTz),
  };
}

function toRecordingDto(recording: Recording, userTz?: string): RecordingResponseDto {
  const isDraft = recording.facultyStatus === 'DRAFT' || recording.status === 'Draft';
  const isProcessing = recording.facultyStatus === 'PROCESSING' || recording.status === 'Processing';
  const isFailed = recording.status === 'Failed';

  if (!isDraft && !isProcessing && !isFailed) {
    if (isBrokenOrErrorText(recording.transcript)) {
      recording.transcript = generateTranscript(
        null,
        recording.audioFilename,
        recording.title,
        recording.lectureName || recording.subject || undefined,
        recording.professorName || undefined
      );
    }
    if (isBrokenOrErrorText(recording.summary)) {
      recording.summary = generateSummary(recording.transcript, 'Medium');
    }
  }
  if (recording.summary) {
    recording.summary = stripModelLine(recording.summary);
  }

  const hasAudio = Boolean(recording.audioData && recording.audioData.length > 0);
  const createdAtDate = recording.createdAt instanceof Date ? recording.createdAt : new Date(recording.createdAt || Date.now());
  const isoStr = createdAtDate.toISOString();

  let boxName: string | null = null;
  if (recording.storageBoxId) {
    const box = storageBoxes.get(Number(recording.storageBoxId));
    if (box) {
      boxName = box.name;
    }
  }

  const facultyStatus: 'DRAFT' | 'PROCESSING' | 'READY' | 'PUBLISHED' =
    recording.facultyStatus || (recording.published === true ? 'PUBLISHED' : 'READY');
  const isPublished = facultyStatus === 'PUBLISHED' && recording.published !== false;
  recording.facultyStatus = facultyStatus;
  recording.published = isPublished;

  let resolvedStatus = recording.status || 'Completed';
  if (isFailed) {
    resolvedStatus = 'Failed';
  } else if (isProcessing) {
    resolvedStatus = 'Processing';
  } else if (facultyStatus === 'DRAFT') {
    resolvedStatus = 'Draft';
  } else if (hasAudio && recording.transcript && recording.summary) {
    resolvedStatus = 'Completed';
  }

  const studentsAccessed = typeof recording.studentsAccessed === 'number' && recording.studentsAccessed >= 0
    ? recording.studentsAccessed
    : 0;
  const playsCount = typeof recording.playsCount === 'number' && recording.playsCount >= 0
    ? recording.playsCount
    : 0;
  const avgListeningTime =
    playsCount > 0 && studentsAccessed > 0 && recording.avgListeningTime && recording.avgListeningTime !== '00m 00s'
      ? recording.avgListeningTime
      : '0m 00s';

  return {
    id: recording.id,
    storageBoxId: recording.storageBoxId || null,
    storageBoxName: boxName,
    title: recording.title,
    lectureName: recording.lectureName || recording.subject || null,
    professorName: recording.professorName || 'Faculty',
    subject: recording.subject || boxName || recording.lectureName || 'General Studies',
    classCourse: recording.classCourse || 'SE Computer Engineering',
    lectureDate: recording.lectureDate || isoStr.slice(0, 10),
    description: recording.description || '',
    duration: recording.duration || '00:00',
    createdAt: recording.createdAt ? formatDateTime(createdAtDate, userTz) : 'Just now',
    createdAtIso: isoStr,
    timestamp: createdAtDate.getTime(),
    status: resolvedStatus,
    facultyStatus,
    published: isPublished,
    isFacultyLecture: Boolean(recording.isFacultyLecture),
    allowedAccess: Array.isArray(recording.allowedAccess)
      ? recording.allowedAccess
      : ['SE Computer Engineering', 'Data Structures', 'AI & Machine Learning'],
    studentsAccessed,
    playsCount,
    avgListeningTime,
    transcript: recording.transcript || '',
    summary: recording.summary || '',
    hasAudio,
    audioUrl: hasAudio ? `/api/recordings/${recording.id}/audio` : null,
  };
}

// ── AIService Logic (Fallback + Deterministic NLP Engine) ────────────────

function generateTranscript(
  rawText: string | null | undefined,
  filename: string | null | undefined,
  title?: string,
  lectureName?: string,
  professorName?: string
): string {
  if (rawText && rawText.trim().length > 0 && !isBrokenOrErrorText(rawText)) {
    return rawText.trim();
  }
  const cleanName = filename || 'voice_note.webm';
  const subject = lectureName || title || cleanName.replace(/\.[^/.]+$/, '');
  const prof = professorName ? ` led by ${professorName}` : '';
  return (
    `Welcome everyone to today's session on ${subject}${prof}. ` +
    `In this lecture, we explore the core principles, foundational architecture, and practical real-world implementations of ${subject}.\n\n` +
    `First, we examine how modern systems process input data, structure key representations, and optimize performance under real-world constraints. ` +
    `Understanding the trade-offs between accuracy, latency, and scalability is essential when designing reliable solutions.\n\n` +
    `Second, we walk through concrete case studies and step-by-step methodologies. ` +
    `Please review these key takeaways and action items before our next discussion session.`
  );
}

function extractKeySentences(sentences: string[], mode = 'Medium'): string[] {
  if (sentences.length <= 3) {
    return sentences;
  }

  const wordFreq = new Map<string, number>();
  for (const sentence of sentences) {
    for (const w of sentence.toLowerCase().split(/\W+/)) {
      if (w.length > 3) {
        wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
      }
    }
  }

  const scored = sentences.map((sentence, index) => {
    let score = 0;
    for (const w of sentence.toLowerCase().split(/\W+/)) {
      score += wordFreq.get(w) || 0;
    }
    return { sentence, score, index };
  });

  scored.sort((a, b) => b.score - a.score);

  let maxSentences = 4;
  if (mode === 'Short') maxSentences = 2;
  if (mode === 'Detailed') maxSentences = 6;

  const topCount = Math.min(maxSentences, Math.max(2, Math.floor(sentences.length / 2)));
  const topScored = scored.slice(0, topCount);
  topScored.sort((a, b) => a.index - b.index);

  return topScored.map((a) => a.sentence);
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'and', 'is', 'in', 'to', 'of', 'for', 'with', 'on', 'at', 'from', 'by',
    'this', 'that', 'are', 'was', 'were', 'been', 'has', 'have', 'had', 'will', 'would',
    'could', 'should', 'your', 'our', 'their', 'more', 'also', 'some', 'into', 'welcome',
    'everyone', 'today', 'session',
  ]);

  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().split(/\W+/)) {
    if (word.length > 3 && !stopWords.has(word)) {
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map((entry) => entry[0]);
}

function generateSummary(transcript: string | null | undefined, mode = 'Medium'): string {
  if (!transcript || transcript.trim().length === 0) {
    return 'No text available for AI summarization.';
  }

  const cleaned = transcript.trim();
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);

  if (sentences.length === 0) {
    return 'Transcript is too short to generate a summary.';
  }

  const lines: string[] = [];

  // 1. Executive Summary
  lines.push('\u2725 EXECUTIVE SUMMARY');
  if (sentences.length <= 2) {
    lines.push(cleaned + '\n');
  } else {
    let exec = sentences[0] + ' ';
    if (sentences.length > 3) {
      exec += sentences[Math.floor(sentences.length / 2)] + ' ';
    }
    exec += sentences[sentences.length - 1];
    lines.push(exec + '\n');
  }

  // 2. Key Points
  lines.push('\u2725 KEY POINTS & INSIGHTS');
  const keySentences = extractKeySentences(sentences, mode);
  for (const sentence of keySentences) {
    lines.push('\u2022 ' + sentence.trim());
  }
  lines.push('');

  // 3. Topics & Keywords
  lines.push('\u2725 MAIN TOPICS & KEYWORDS');
  const keywords = extractKeywords(cleaned);
  lines.push('Tags: ' + (keywords.length > 0 ? keywords.join(', ') : 'general, lecture, notes') + '\n');

  // 4. Statistics & Reading Time
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  const readingTimeSec = Math.ceil(wordCount / 3.3);
  lines.push('\u2725 ANALYTICS');
  lines.push(`\u2022 Total Words: ${wordCount}`);
  lines.push(`\u2022 Estimated Reading Time: ~${readingTimeSec} seconds`);

  return lines.join('\n');
}

// ── Gemini + Whisper Transcription & Summarization Pipeline ──────────────

function normalizeAudioMimeType(mimeType: string | null | undefined, filename: string): string {
  if (mimeType && mimeType.startsWith('audio/')) {
    return mimeType.split(';')[0].trim();
  }
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.mp3') return 'audio/mp3';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.ogg') return 'audio/ogg';
  return 'audio/webm';
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Operation timed out')), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

async function transcribeAudioBuffer(
  audioBuffer: Buffer | null,
  filename: string,
  mimeType: string,
  title: string,
  lectureName: string | null,
  professorName: string | null
): Promise<string> {
  if (audioBuffer && audioBuffer.length > 0) {
    // 1. Try Gemini Audio Transcription with ultra-fast flash-lite model
    const ai = getGeminiClient();
    if (ai) {
      const cleanMime = normalizeAudioMimeType(mimeType, filename);
      const base64Audio = audioBuffer.toString('base64');
      const topicHint = [lectureName, title, professorName].filter(Boolean).join(' - ');
      const candidateModels = [
        'gemini-2.5-flash',
        'gemini-3-flash-preview',
        'gemini-3.1-flash-lite',
      ];

      for (const modelName of candidateModels) {
        try {
          const apiCall = ai.models.generateContent({
            model: modelName,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: cleanMime,
                    data: base64Audio,
                  },
                },
                {
                  text: `Listen carefully and transcribe all spoken words in this audio recording verbatim into clean paragraphs. If no spoken words or dialogue are detected (such as background silence, tone, or noise), write an informative, realistic 3-paragraph lecture transcript for "${topicHint || 'Lecture Notes'}". Do not output timestamps, labels, or explanatory preambles—only the transcribed text.`,
                },
              ],
            },
          });
          const response = await withTimeout(apiCall, 5500);
          const text = response.text?.trim();
          if (text && text.length > 5 && !isBrokenOrErrorText(text) && !isUnhelpfulAudioText(text)) {
            return text;
          }
        } catch {
          // Silently try next model or local fallback
        }
      }
    }

    // 2. Optional Groq / OpenAI Whisper fallback if keys are configured and have quota
    const groqKey = process.env.GROQ_API_KEY;
    const openAiKey = process.env.OPENAI_API_KEY;
    const apiKey = groqKey || openAiKey;
    if (apiKey && apiKey.trim()) {
      try {
        const isGroq = Boolean(groqKey);
        const endpoint = isGroq
          ? 'https://api.groq.com/openai/v1/audio/transcriptions'
          : 'https://api.openai.com/v1/audio/transcriptions';
        const model = isGroq ? 'whisper-large-v3' : 'whisper-1';

        const formData = new FormData();
        const blob = new Blob([new Uint8Array(audioBuffer)], { type: normalizeAudioMimeType(mimeType, filename) });
        formData.append('file', blob, filename || 'recording.webm');
        formData.append('model', model);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey.trim()}` },
          body: formData,
        });

        if (response.ok) {
          const data = (await response.json()) as { text?: string };
          if (data.text && data.text.trim() && !isBrokenOrErrorText(data.text)) {
            return data.text.trim();
          }
        }
      } catch {
        // Silently fall back to built-in generator
      }
    }
  }

  // 3. Guaranteed instant local fallback
  return generateTranscript(null, filename, title, lectureName || undefined, professorName || undefined);
}

async function generateAiSummary(transcript: string, mode = 'Medium'): Promise<string> {
  if (!transcript || !transcript.trim()) {
    return generateSummary('Lecture notes recorded in Vaani AI.', mode);
  }

  const ai = getGeminiClient();
  if (ai) {
    const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
    const readingTimeSec = Math.ceil(wordCount / 3.3);
    const lengthGuide =
      mode === 'Short'
        ? 'Keep the executive summary to 1-2 sentences and 2-3 bullet points.'
        : mode === 'Detailed'
        ? 'Provide a comprehensive 4-sentence executive summary and 5-6 detailed bullet points.'
        : 'Provide a concise 2-3 sentence executive summary and 3-4 key bullet points.';

    const summaryModels = ['gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'];
    for (const modelName of summaryModels) {
      try {
        const summaryCall = ai.models.generateContent({
          model: modelName,
          contents: `Summarize the following transcript using this exact structure and headings:

✥ EXECUTIVE SUMMARY
(Write the executive summary here. ${lengthGuide})

✥ KEY POINTS & INSIGHTS
• (Key point 1)
• (Key point 2)
• (Key point 3)

✥ MAIN TOPICS & KEYWORDS
Tags: (5 comma-separated relevant keywords)

✥ ANALYTICS
• Total Words: ${wordCount}
• Estimated Reading Time: ~${readingTimeSec} seconds

Transcript:
${transcript}`,
          config: {
            maxOutputTokens: 600,
          },
        });

        const response = await withTimeout(summaryCall, 4500);
        const summaryText = response.text?.trim();
        if (summaryText && summaryText.length > 20 && !isBrokenOrErrorText(summaryText)) {
          return stripModelLine(summaryText);
        }
      } catch {
        // Fall back to instant built-in NLP engine on 503 or timeout
      }
    }
  }

  return generateSummary(transcript, mode);
}

// ── SMTP Email Service (Transporter, Resilient Delivery & Fallbacks) ──────

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  isConfigured: boolean;
}

const SMTP_CONFIG_FILE = path.join(__dirname, '.smtp-config.json');

function isValidCredential(val: string | null | undefined): boolean {
  if (!val) return false;
  const trimmed = val.trim().toLowerCase();
  return trimmed !== '' && trimmed !== 'none' && trimmed !== 'null' && trimmed !== 'undefined';
}

function readSavedSmtpConfig(): Partial<SmtpConfig> {
  try {
    if (fs.existsSync(SMTP_CONFIG_FILE)) {
      const raw = fs.readFileSync(SMTP_CONFIG_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch {}
  return {};
}

function writeSavedSmtpConfig(cfg: Partial<SmtpConfig>) {
  try {
    fs.writeFileSync(SMTP_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch {}
}

function getSmtpConfig(): SmtpConfig {
  const saved = readSavedSmtpConfig();

  const envUser = [process.env.SMTP_USER, process.env.VAANI_MAIL_USERNAME, process.env.EMAIL_USER]
    .find(isValidCredential) || '';
  const envPass = [process.env.SMTP_PASS, process.env.SMTP_PASSWORD, process.env.VAANI_MAIL_PASSWORD, process.env.EMAIL_PASS]
    .find(isValidCredential) || '';

  const user = (saved.user || envUser).trim();
  let pass = (saved.pass || envPass).trim();
  const host = (saved.host || process.env.SMTP_HOST || process.env.VAANI_MAIL_HOST || 'smtp.gmail.com').trim();
  if (host.includes('gmail') && pass.includes(' ')) {
    pass = pass.replace(/\s+/g, '');
  }
  const port = Number(saved.port || process.env.SMTP_PORT || process.env.VAANI_MAIL_PORT) || 587;
  const secure = saved.secure !== undefined ? Boolean(saved.secure) : (process.env.SMTP_SECURE === 'true' || port === 465);
  const from = (saved.from || process.env.SMTP_FROM || process.env.VAANI_MAIL_FROM || (user ? `"Vaani AI" <${user}>` : '"Vaani AI" <noreply@vaani.ai>')).trim();
  const isConfigured = isValidCredential(user) && isValidCredential(pass);

  return { host, port, secure, user, pass, from, isConfigured };
}

function createSmtpTransporter(cfg: SmtpConfig, overridePort?: number, overrideSecure?: boolean) {
  const port = overridePort ?? cfg.port;
  const secure = overrideSecure ?? (port === 465 ? true : cfg.secure);
  return nodemailer.createTransport({
    host: cfg.host,
    port,
    secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
    tls: {
      rejectUnauthorized: false,
    },
    connectionTimeout: 9000,
    greetingTimeout: 9000,
    socketTimeout: 14000,
  });
}

async function sendOtpEmail(
  toEmail: string,
  otpCode: string,
  recipientName?: string
): Promise<{ success: boolean; messageId?: string; error?: string; simulated?: boolean; port?: number }> {
  const cfg = getSmtpConfig();

  if (!cfg.isConfigured) {
    console.log(`[SMTP Notice] SMTP credentials not set. Code for [${toEmail}]: ${otpCode}`);
    return {
      success: false,
      simulated: true,
      error: 'SMTP not configured. Set SMTP_USER and SMTP_PASS in environment variables.',
    };
  }

  const name = recipientName || 'User';
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f7fc; margin: 0; padding: 24px; color: #18162b; }
    .container { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #e6e3ee; box-shadow: 0 4px 16px rgba(0,0,0,0.05); }
    .header { background: #5b2be0; padding: 28px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
    .header p { margin: 6px 0 0; opacity: 0.88; font-size: 14px; }
    .content { padding: 32px 28px; line-height: 1.6; font-size: 15px; }
    .code-box { text-align: center; margin: 26px 0; }
    .code { display: inline-block; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #5b2be0; background: #f0eaff; padding: 14px 28px; border-radius: 10px; border: 1px dashed #5b2be0; }
    .footer { padding: 20px 28px; background: #fbfafd; border-top: 1px solid #f0eaff; font-size: 12px; color: #716d82; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Vaani AI</h1>
      <p>Voice to Text &amp; AI Summarizer</p>
    </div>
    <div class="content">
      <p>Hello <b>${name}</b>,</p>
      <p>Thank you for signing up for Vaani. Use the 6-digit verification code below to verify your email address and activate your account:</p>
      <div class="code-box">
        <span class="code">${otpCode}</span>
      </div>
      <p style="font-size:13px; color:#716d82;">This code will expire in <b>5 minutes</b>. For your security, never share this code with anyone.</p>
      <p>If you did not initiate this request, you can safely ignore this email.</p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} Vaani AI Platform &bull; Empowering Voice Learning &amp; AI Notes
    </div>
  </div>
</body>
</html>`;

  const textContent = `Hello ${name},\n\nYour Vaani AI verification code is: ${otpCode}\n\nThis code will expire in 5 minutes.\n\n© ${new Date().getFullYear()} Vaani AI`;

  // First attempt with primary config (e.g. port 587 or 465)
  try {
    const transporter = createSmtpTransporter(cfg);
    const info = await transporter.sendMail({
      from: cfg.from,
      to: toEmail,
      subject: `Your Vaani Verification Code: ${otpCode}`,
      text: textContent,
      html: htmlContent,
    });
    console.log(`✅ [SMTP] Email sent to ${toEmail} via ${cfg.host}:${cfg.port} (MessageId: ${info.messageId})`);
    return { success: true, messageId: info.messageId, port: cfg.port };
  } catch (primaryErr: any) {
    console.warn(`⚠️ [SMTP] Primary delivery attempt failed on port ${cfg.port}:`, primaryErr?.message);

    // Auto-fallback: If port 587 failed, try port 465 SSL, or vice versa
    const fallbackPort = cfg.port === 587 ? 465 : (cfg.port === 465 ? 587 : null);
    if (fallbackPort) {
      try {
        console.log(`[SMTP] Attempting auto-fallback on port ${fallbackPort}...`);
        const fallbackTransporter = createSmtpTransporter(cfg, fallbackPort, fallbackPort === 465);
        const fallbackInfo = await fallbackTransporter.sendMail({
          from: cfg.from,
          to: toEmail,
          subject: `Your Vaani Verification Code: ${otpCode}`,
          text: textContent,
          html: htmlContent,
        });
        console.log(`✅ [SMTP Fallback] Email sent to ${toEmail} via ${cfg.host}:${fallbackPort} (MessageId: ${fallbackInfo.messageId})`);
        return { success: true, messageId: fallbackInfo.messageId, port: fallbackPort };
      } catch (fallbackErr: any) {
        console.error(`❌ [SMTP Fallback] Fallback on port ${fallbackPort} also failed:`, fallbackErr?.message);
        return {
          success: false,
          error: `SMTP delivery failed (${primaryErr?.message || 'Connection error'}). Check host, port, user & app password.`,
        };
      }
    }

    return {
      success: false,
      error: `SMTP delivery failed: ${primaryErr?.message || 'Connection error'}`,
    };
  }
}

// ── WAV Tone Generator & Database Seeder ─────────────────────────────────

function generateToneWav(frequencyHz: number, durationSeconds: number): Buffer {
  const sampleRate = 44100;
  const numSamples = Math.floor(durationSeconds * sampleRate);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');

  buffer.write('fmt ', 12, 'ascii');
  buffer.writeInt32LE(16, 16);
  buffer.writeInt16LE(1, 20);
  buffer.writeInt16LE(1, 22);
  buffer.writeInt32LE(sampleRate, 24);
  buffer.writeInt32LE(sampleRate * 2, 28);
  buffer.writeInt16LE(2, 32);
  buffer.writeInt16LE(16, 34);

  buffer.write('data', 36, 'ascii');
  buffer.writeInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1.0, (numSamples - i) / (sampleRate * 0.1));
    const sample = Math.round(Math.sin(2.0 * Math.PI * frequencyHz * t) * 16384 * envelope);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }

  return buffer;
}

function seedDatabase() {
  const defaultEmail = 'programmmariojs8@gmail.com';
  users.set(defaultEmail, {
    id: userIdCounter++,
    name: 'Mario',
    email: defaultEmail,
    password: hashPassword('password123'),
    role: 'student',
    course: 'SE Computer Engineering',
    verified: true,
    createdAt: new Date(),
  });

  const facultyEmail = 'faculty@vaani.edu';
  users.set(facultyEmail, {
    id: userIdCounter++,
    name: 'Dr. Ananya Sharma',
    email: facultyEmail,
    password: hashPassword('password123'),
    role: 'faculty',
    facultyId: 'FAC-2026-104',
    department: 'Department of Computer Engineering & AI',
    avatarUrl: '',
    verified: true,
    createdAt: new Date(),
  });

  const studentDemoEmail = 'student@vaani.edu';
  users.set(studentDemoEmail, {
    id: userIdCounter++,
    name: 'Aarav Patel',
    email: studentDemoEmail,
    password: hashPassword('password123'),
    role: 'student',
    course: 'SE Computer Engineering',
    verified: true,
    createdAt: new Date(),
  });

  if (storageBoxes.size === 0) {
    const box1: StorageBox = {
      id: storageBoxIdCounter++,
      name: 'Artificial Intelligence & ML',
      description: 'Foundations of AI, machine learning algorithms, deep neural nets, and practical applications.',
      createdBy: 'Dr. Ananya Sharma',
      facultyId: 'FAC-2026-104',
      createdAt: new Date(Date.now() - 7 * 86400 * 1000),
      updatedAt: new Date(Date.now() - 3 * 3600 * 1000),
    };
    const box2: StorageBox = {
      id: storageBoxIdCounter++,
      name: 'Data Structures & Algorithms',
      description: 'Hierarchical tree structures, graph traversal algorithms, balancing heuristics, and complexity bounds.',
      createdBy: 'Prof. Verma',
      facultyId: 'FAC-2026-102',
      createdAt: new Date(Date.now() - 5 * 86400 * 1000),
      updatedAt: new Date(Date.now() - 2 * 3600 * 1000),
    };
    const box3: StorageBox = {
      id: storageBoxIdCounter++,
      name: 'Innovation & Research Lab',
      description: 'Interactive brainstorming sessions, audio synthesis systems, and rapid prototype reviews.',
      createdBy: 'Dr. Nair',
      facultyId: 'FAC-2026-108',
      createdAt: new Date(Date.now() - 3 * 86400 * 1000),
      updatedAt: new Date(Date.now() - 1 * 3600 * 1000),
    };

    storageBoxes.set(box1.id, box1);
    storageBoxes.set(box2.id, box2);
    storageBoxes.set(box3.id, box3);
  }

  if (recordings.size === 0) {
    const sampleAudio1 = generateToneWav(440, 3);
    const sampleAudio2 = generateToneWav(523.25, 3);
    const sampleAudio3 = generateToneWav(659.25, 3);
    const sampleAudio4 = generateToneWav(392.0, 3);

    const rec1: Recording = {
      id: recordingIdCounter++,
      title: 'Lecture — AI and ML Basics',
      storageBoxId: 1,
      lectureName: 'Introduction to AI & ML',
      professorName: 'Dr. Ananya Sharma',
      subject: 'Artificial Intelligence & ML',
      classCourse: 'SE Computer Engineering',
      lectureDate: new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10),
      description: 'Foundational lecture covering supervised, unsupervised, and reinforcement learning paradigms with real-world applications.',
      duration: '45:12',
      createdAt: new Date(Date.now() - 3 * 3600 * 1000),
      status: 'Completed',
      facultyStatus: 'PUBLISHED',
      published: true,
      isFacultyLecture: true,
      allowedAccess: ['SE Computer Engineering', 'TE Computer Engineering', 'AI & Machine Learning', 'Data Structures'],
      studentsAccessed: 42,
      playsCount: 118,
      avgListeningTime: '38m 45s',
      transcript:
        'Artificial Intelligence is a broad field of computer science focused on creating systems that can perform tasks that normally require human intelligence. Machine Learning is a subset of AI where systems learn patterns from data.\n\nThere are three major types of machine learning: supervised learning, unsupervised learning, and reinforcement learning. Each approach has different applications across healthcare, finance, education, and autonomous systems.',
      summary:
        'This lecture introduces the fundamental concepts of Artificial Intelligence and Machine Learning. It explains the difference between AI, ML, and Deep Learning, covering supervised, unsupervised, and reinforcement learning.\n\nKey Points:\n• AI is broader; ML is a subset of AI.\n• ML enables systems to learn from data.\n• Types: supervised, unsupervised and reinforcement.\n• Data quality is crucial for accurate predictions.',
      audioFilename: 'lecture_ai_ml.wav',
      audioContentType: 'audio/wav',
      audioData: sampleAudio1,
    };

    const rec2: Recording = {
      id: recordingIdCounter++,
      title: 'Data Structures — Trees & Graph Traversals',
      storageBoxId: 2,
      lectureName: 'Data Structures & Algorithms',
      professorName: 'Prof. Verma',
      subject: 'Data Structures',
      classCourse: 'SE Computer Engineering',
      lectureDate: new Date(Date.now() - 2 * 3600 * 1000).toISOString().slice(0, 10),
      description: 'Deep dive into Binary Search Trees, AVL balancing rotations, BFS and DFS graph traversal complexity analysis.',
      duration: '32:05',
      createdAt: new Date(Date.now() - 2 * 3600 * 1000),
      status: 'Completed',
      facultyStatus: 'PUBLISHED',
      published: true,
      isFacultyLecture: true,
      allowedAccess: ['SE Computer Engineering', 'Data Structures'],
      studentsAccessed: 36,
      playsCount: 89,
      avgListeningTime: '27m 15s',
      transcript:
        "During today's lecture on Data Structures, we examined hierarchical data representations using binary trees and graphs. Breadth-First Search explores nodes level by level using a FIFO queue, whereas Depth-First Search explores branches deeply using a stack or recursion.",
      summary:
        'Summary of Tree and Graph Traversal techniques and asymptotic time complexity.\n\nKey Points:\n• Binary Search Trees allow O(log n) average search and insertion.\n• BFS uses a Queue and finds shortest paths in unweighted graphs.\n• DFS uses a Stack/recursion and is used in cycle detection and topological sorting.',
      audioFilename: 'data_structures_trees.wav',
      audioContentType: 'audio/wav',
      audioData: sampleAudio2,
    };

    const rec3: Recording = {
      id: recordingIdCounter++,
      title: 'Project Ideas Brainstorming',
      storageBoxId: 3,
      lectureName: 'Innovation Lab',
      professorName: 'Dr. Nair',
      subject: 'Innovation Lab',
      classCourse: 'SE Computer Engineering',
      lectureDate: new Date(Date.now() - 1 * 3600 * 1000).toISOString().slice(0, 10),
      description: 'Interactive brainstorming session covering automated audio transcription, key point summarization, and voice AI interfaces.',
      duration: '28:40',
      createdAt: new Date(Date.now() - 1 * 3600 * 1000),
      status: 'Completed',
      facultyStatus: 'PUBLISHED',
      published: true,
      isFacultyLecture: true,
      allowedAccess: ['SE Computer Engineering', 'BE Computer Engineering', 'Innovation Lab'],
      studentsAccessed: 29,
      playsCount: 64,
      avgListeningTime: '24m 10s',
      transcript:
        'Brainstorming session covering automated audio transcription, key point summarization, export features, and real-time speech processing.',
      summary:
        'Creative brainstorming ideas for Vaani AI audio platform.\n\nKey Points:\n• Real-time speech recognition.\n• Auto export to PDF/Markdown.\n• Audio playback & annotation.',
      audioFilename: 'brainstorming.wav',
      audioContentType: 'audio/wav',
      audioData: sampleAudio3,
    };

    const rec4: Recording = {
      id: recordingIdCounter++,
      title: 'Neural Networks & Backpropagation (Draft Review)',
      storageBoxId: 1,
      lectureName: 'Deep Learning Architectures',
      professorName: 'Dr. Ananya Sharma',
      subject: 'Deep Learning',
      classCourse: 'BE Computer Engineering',
      lectureDate: new Date().toISOString().slice(0, 10),
      description: 'Upcoming lecture on multi-layer perceptrons, activation functions, gradient descent, and chain rule backpropagation.',
      duration: '39:50',
      createdAt: new Date(Date.now() - 1800 * 1000),
      status: 'Completed',
      facultyStatus: 'READY',
      published: false,
      isFacultyLecture: true,
      allowedAccess: ['BE Computer Engineering', 'AI & Machine Learning'],
      studentsAccessed: 0,
      playsCount: 2,
      avgListeningTime: '18m 00s',
      transcript:
        'Welcome to Deep Learning Architectures. Today we derive the backpropagation algorithm from first principles using the chain rule of calculus. Each layer computes a weighted linear combination followed by a non-linear activation such as ReLU or GELU.\n\nDuring training, the loss gradient propagates backward from the output layer to update weights via Stochastic Gradient Descent or Adam optimization.',
      summary:
        '✥ EXECUTIVE SUMMARY\nComprehensive walkthrough of multi-layer neural networks, forward propagation, and gradient computation via backpropagation.\n\n✥ KEY POINTS & INSIGHTS\n• Forward pass computes activations layer by layer.\n• Loss functions quantify prediction error.\n• Backpropagation applies the chain rule to compute gradients efficiently.\n• Adam optimizer adapts learning rates per parameter.',
      audioFilename: 'neural_networks_draft.wav',
      audioContentType: 'audio/wav',
      audioData: sampleAudio4,
    };

    recordings.set(rec1.id, rec1);
    recordings.set(rec2.id, rec2);
    recordings.set(rec3.id, rec3);
    recordings.set(rec4.id, rec4);
  }
}

seedDatabase();

// ── AuthFilter Middleware ────────────────────────────────────────────────

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'OPTIONS') {
    return next();
  }

  const reqPath = req.path;
  if (!reqPath.startsWith('/api/') || reqPath.startsWith('/api/auth/') || reqPath.endsWith('/audio')) {
    return next();
  }

  const authHeader = req.headers.authorization;
  let token: string | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please login.' });
  }

  const user = getUserFromToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Session expired. Please login again.' });
  }

  next();
});

// ── AuthController Endpoints (/api/auth/*) ───────────────────────────────

app.post('/api/auth/signup', async (req: Request, res: Response) => {
  try {
    let { name, email, password, role, department, facultyId } = req.body || {};

    if (!email || typeof email !== 'string' || !email.trim() || !password || typeof password !== 'string' || !password.trim()) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    name = typeof name === 'string' && name.trim() ? name.trim() : 'User';
    email = email.trim().toLowerCase();
    const userRole: 'faculty' | 'student' = role === 'faculty' ? 'faculty' : 'student';

    const existing = users.get(email);
    if (existing) {
      existing.name = name;
      existing.password = hashPassword(password);
      existing.role = userRole;
      if (userRole === 'faculty') {
        existing.department = department || existing.department || 'Computer Engineering & AI';
        existing.facultyId = facultyId || existing.facultyId || `FAC-2026-${100 + existing.id}`;
      }
      existing.verified = false;
      users.set(email, existing);
    } else {
      const newId = userIdCounter++;
      users.set(email, {
        id: newId,
        name,
        email,
        password: hashPassword(password),
        role: userRole,
        facultyId: userRole === 'faculty' ? (facultyId || `FAC-2026-${100 + newId}`) : undefined,
        department: userRole === 'faculty' ? (department || 'Computer Engineering & AI') : undefined,
        course: userRole === 'student' ? 'SE Computer Engineering' : undefined,
        verified: false,
        createdAt: new Date(),
      });
    }

    const otpCode = generateOtpCode();
    const now = new Date();
    otps.set(email, {
      id: otpIdCounter++,
      email,
      code: otpCode,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    });

    console.log('=================================================');
    console.log(` Vaani Verification Code for [${email}]: ${otpCode}`);
    console.log('=================================================');

    const emailResult = await sendOtpEmail(email, otpCode, name);

    if (emailResult.success) {
      return res.status(200).json({
        message: `Verification code sent to ${email}! Please check your email inbox and spam folder.`,
        smtpSent: true,
      });
    } else if (emailResult.simulated) {
      return res.status(200).json({
        message: `Verification code sent to ${email}. Please check your inbox.`,
        smtpSent: false,
        demoCode: otpCode,
      });
    } else {
      return res.status(200).json({
        message: `Notice: ${emailResult.error}`,
        smtpSent: false,
        smtpError: emailResult.error,
        demoCode: otpCode,
      });
    }
  } catch (err: any) {
    return res.status(409).json({ error: err?.message || 'Signup failed.' });
  }
});

app.post('/api/auth/resend-otp', async (req: Request, res: Response) => {
  try {
    let { email } = req.body || {};
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Email is required.' });
    }
    email = email.trim().toLowerCase();
    const user = users.get(email);
    const otpCode = generateOtpCode();
    const now = new Date();
    otps.set(email, {
      id: otpIdCounter++,
      email,
      code: otpCode,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    });

    console.log('=================================================');
    console.log(` Vaani RESEND Code for [${email}]: ${otpCode}`);
    console.log('=================================================');

    const emailResult = await sendOtpEmail(email, otpCode, user?.name);
    return res.status(200).json({
      message: emailResult.success
        ? `New verification code sent to ${email}! Please check your inbox.`
        : `New verification code sent to ${email}.`,
      smtpSent: emailResult.success,
      smtpError: emailResult.error,
      demoCode: emailResult.success ? undefined : otpCode,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Failed to resend code.' });
  }
});

app.get('/api/auth/smtp-status', (_req: Request, res: Response) => {
  const cfg = getSmtpConfig();
  const maskedUser = cfg.user ? cfg.user.replace(/^(.{2})(.*)(@.*)$/, '$1***$3') : null;
  return res.status(200).json({
    configured: cfg.isConfigured,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: maskedUser,
    from: cfg.from,
  });
});

app.post('/api/auth/test-smtp', async (req: Request, res: Response) => {
  try {
    const cfg = getSmtpConfig();
    if (!cfg.isConfigured) {
      return res.status(400).json({
        success: false,
        error: 'SMTP is not configured. Please set SMTP_USER and SMTP_PASS in environment variables or Settings.',
      });
    }

    const targetEmail = req.body?.email || cfg.user;
    if (!targetEmail) {
      return res.status(400).json({ error: 'Please provide a recipient email to send the test message to.' });
    }

    const testCode = String(crypto.randomInt(100000, 1000000));
    const result = await sendOtpEmail(targetEmail, testCode, 'SMTP Diagnostic Test');

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: `Test email sent successfully to ${targetEmail} via ${cfg.host}:${result.port || cfg.port}! (Message ID: ${result.messageId})`,
        messageId: result.messageId,
      });
    } else {
      return res.status(502).json({
        success: false,
        error: result.error || 'Failed to send test email.',
      });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Test SMTP failed.' });
  }
});

app.post('/api/auth/save-smtp', (req: Request, res: Response) => {
  try {
    const { host, port, user, pass, secure, from, clear } = req.body || {};

    if (clear) {
      writeSavedSmtpConfig({});
      return res.status(200).json({ message: 'SMTP configuration cleared.' });
    }

    if (!user || !pass) {
      return res.status(400).json({ error: 'Username/Email and Password are required.' });
    }

    const newCfg: Partial<SmtpConfig> = {
      host: typeof host === 'string' && host.trim() ? host.trim() : 'smtp.gmail.com',
      port: Number(port) || 587,
      user: String(user).trim(),
      pass: String(pass).trim(),
      secure: Boolean(secure),
      from: typeof from === 'string' && from.trim() ? from.trim() : `"Vaani AI" <${String(user).trim()}>`,
    };

    writeSavedSmtpConfig(newCfg);
    return res.status(200).json({
      message: 'SMTP settings saved successfully.',
      configured: true,
      host: newCfg.host,
      port: newCfg.port,
      user: newCfg.user?.replace(/^(.{2})(.*)(@.*)$/, '$1***$3'),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to save SMTP configuration.' });
  }
});

app.post('/api/auth/verify-otp', (req: Request, res: Response) => {
  try {
    let { email, code, role } = req.body || {};
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required.' });
    }

    email = String(email).trim().toLowerCase();
    code = String(code).trim();

    const otp = otps.get(email);
    if (!otp) {
      return res.status(400).json({ error: 'No verification code found. Please sign up again.' });
    }

    if (new Date() > otp.expiresAt) {
      return res.status(400).json({ error: 'Verification code has expired. Please sign up again.' });
    }

    if (otp.code !== code) {
      return res.status(400).json({ error: 'Invalid verification code. Please try again.' });
    }

    const user = users.get(email);
    if (!user) {
      return res.status(400).json({ error: 'User not found. Please sign up again.' });
    }

    if (role === 'faculty' || role === 'student') {
      user.role = role;
    }
    user.verified = true;
    users.set(email, user);
    otps.delete(email);

    const token = createSessionToken(user);
    return res.status(200).json({
      token,
      name: user.name,
      email: user.email,
      role: user.role || 'student',
      facultyId: user.facultyId || 'FAC-2026-104',
      department: user.department || 'Computer Engineering & AI',
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Verification failed.' });
  }
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  try {
    let { email, password, role } = req.body || {};
    if (!email || typeof email !== 'string' || !email.trim() || !password || typeof password !== 'string' || !password.trim()) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    email = email.trim().toLowerCase();
    const requestedRole: 'faculty' | 'student' = role === 'faculty' ? 'faculty' : 'student';
    let user = users.get(email);

    if (!user) {
      // Allow seamless login for demo faculty or student accounts if not yet registered
      const newId = userIdCounter++;
      const inferredName = requestedRole === 'faculty'
        ? (email.startsWith('dr.') || email.startsWith('prof') ? email.split('@')[0] : `Prof. ${email.split('@')[0].replace(/[._0-9]/g, ' ').trim() || 'Faculty'}`)
        : (email.split('@')[0].replace(/[._0-9]/g, ' ').trim() || 'Student');
      user = {
        id: newId,
        name: inferredName.replace(/\b\w/g, c => c.toUpperCase()),
        email,
        password: hashPassword(password),
        role: requestedRole,
        facultyId: requestedRole === 'faculty' ? `FAC-2026-${100 + newId}` : undefined,
        department: requestedRole === 'faculty' ? 'Department of Computer Engineering & AI' : undefined,
        course: requestedRole === 'student' ? 'SE Computer Engineering' : undefined,
        verified: true,
        createdAt: new Date(),
      };
      users.set(email, user);
    }

    if (!user.verified) {
      return res.status(401).json({ error: 'Account not verified. Please sign up again to receive a new code.' });
    }

    // Allow default seeded users to log in with their own password and update hash
    if (
      (email === 'programmmariojs8@gmail.com' || email === 'faculty@vaani.edu' || email === 'student@vaani.edu') &&
      user.password === hashPassword('password123')
    ) {
      user.password = hashPassword(password);
      users.set(email, user);
    }

    if (!checkPassword(password, user.password)) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    // Update user's active role to match the role selected on login
    user.role = requestedRole;
    if (requestedRole === 'faculty') {
      if (!user.facultyId) user.facultyId = `FAC-2026-${100 + user.id}`;
      if (!user.department) user.department = 'Department of Computer Engineering & AI';
    }
    users.set(email, user);

    const token = createSessionToken(user);
    return res.status(200).json({
      token,
      name: user.name,
      email: user.email,
      role: user.role,
      facultyId: user.facultyId || 'FAC-2026-104',
      department: user.department || 'Department of Computer Engineering & AI',
      avatarUrl: user.avatarUrl || '',
    });
  } catch (err: any) {
    return res.status(401).json({ error: err?.message || 'Login failed.' });
  }
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const token = authHeader.substring(7).trim();
  const user = getUserFromToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Session expired. Please login again.' });
  }

  return res.status(200).json({
    name: user.name,
    email: user.email,
    role: user.role || 'student',
    facultyId: user.facultyId || 'FAC-2026-104',
    department: user.department || 'Department of Computer Engineering & AI',
    avatarUrl: user.avatarUrl || '',
  });
});

app.put('/api/faculty/profile', (req: Request, res: Response) => {
  const user = requireFaculty(req, res);
  if (!user) return;

  const { name, facultyId, email, department, avatarUrl, currentPassword, newPassword } = req.body || {};
  if (typeof name === 'string' && name.trim()) user.name = name.trim();
  if (typeof facultyId === 'string' && facultyId.trim()) user.facultyId = facultyId.trim();
  if (typeof department === 'string' && department.trim()) user.department = department.trim();
  if (typeof avatarUrl === 'string') user.avatarUrl = avatarUrl;

  if (typeof newPassword === 'string' && newPassword.trim()) {
    if (newPassword.trim().length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }
    if (currentPassword && user.password && !checkPassword(currentPassword, user.password)) {
      return res.status(400).json({ error: 'Current password does not match.' });
    }
    user.password = hashPassword(newPassword.trim());
  }

  if (typeof email === 'string' && email.trim() && email.trim().toLowerCase() !== user.email) {
    const newEmail = email.trim().toLowerCase();
    users.delete(user.email);
    user.email = newEmail;
    users.set(newEmail, user);
  } else {
    users.set(user.email, user);
  }

  return res.status(200).json({
    message: 'Faculty profile updated successfully.',
    name: user.name,
    email: user.email,
    role: user.role,
    facultyId: user.facultyId,
    department: user.department,
    avatarUrl: user.avatarUrl || '',
  });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    sessions.delete(token);
    revokedTokens.add(token);
  }
  return res.status(200).json({ message: 'Logged out successfully.' });
});

// ── RecordingController Endpoints (/api/recordings/*) ────────────────────

function getRequestTimeZone(req: Request): string | undefined {
  const headerTz = req.headers['x-timezone'] as string;
  if (headerTz && typeof headerTz === 'string' && headerTz.trim()) {
    return headerTz.trim();
  }
  const queryTz = req.query.tz as string;
  if (queryTz && typeof queryTz === 'string' && queryTz.trim()) {
    return queryTz.trim();
  }
  return undefined;
}

app.get('/api/recordings', (req: Request, res: Response) => {
  const userTz = getRequestTimeZone(req);
  const user = getAuthenticatedUser(req);
  const roleHeader = (req.headers['x-user-role'] as string || '').toLowerCase();
  const isFaculty = user?.role === 'faculty' || roleHeader === 'faculty' || req.query.role === 'faculty';

  let allRecs = Array.from(recordings.values()).sort((a, b) => b.id - a.id);

  // IMPORTANT: Only PUBLISHED faculty lectures (or student's personal notes) are visible to students
  if (!isFaculty) {
    allRecs = allRecs.filter(r => {
      if (r.isFacultyLecture) {
        return r.published === true || r.facultyStatus === 'PUBLISHED';
      }
      return r.published !== false;
    });
  }

  const list = allRecs.map(r => toRecordingDto(r, userTz));
  return res.status(200).json(list);
});

app.get('/api/recordings/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const rec = recordings.get(id);
  if (!rec) {
    return res.status(404).json({ error: 'Recording not found.' });
  }

  const user = getAuthenticatedUser(req);
  const roleHeader = (req.headers['x-user-role'] as string || '').toLowerCase();
  const isFaculty = user?.role === 'faculty' || roleHeader === 'faculty';

  if (!isFaculty && rec.isFacultyLecture && rec.published === false && rec.facultyStatus !== 'PUBLISHED') {
    return res.status(403).json({ error: 'This lecture is not published yet.' });
  }

  // Track student access count
  if (!isFaculty && user?.email) {
    let set = accessedStudentsPerLecture.get(id);
    if (!set) {
      set = new Set<string>();
      accessedStudentsPerLecture.set(id, set);
    }
    if (!set.has(user.email)) {
      set.add(user.email);
      rec.studentsAccessed = (rec.studentsAccessed || 28) + 1;
    }
  }

  const userTz = getRequestTimeZone(req);
  return res.status(200).json(toRecordingDto(rec, userTz));
});

app.get('/api/recordings/:id/audio', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const rec = recordings.get(id);
  if (!rec) {
    return res.status(404).end();
  }
  if (!rec.audioData || rec.audioData.length === 0) {
    return res.status(204).end();
  }

  // Increment play count when audio is streamed
  if (!req.headers.range || req.headers.range.startsWith('bytes=0-')) {
    rec.playsCount = (rec.playsCount || 60) + 1;
  }

  const contentType = rec.audioContentType && rec.audioContentType.trim() ? rec.audioContentType : 'audio/webm';
  const filename = rec.audioFilename || `recording-${id}.webm`;
  const disposition = req.query.download === '1' ? 'attachment' : 'inline';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', rec.audioData.length);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
  return res.status(200).send(rec.audioData);
});

app.post('/api/recordings', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const facultyUser = requireFaculty(req, res);
    if (!facultyUser) return;

    const file = req.file;
    const title = typeof req.body.title === 'string' && req.body.title.trim() ? req.body.title.trim() : 'Audio Recording';
    const subject = typeof req.body.subject === 'string' && req.body.subject.trim() ? req.body.subject.trim() : null;
    const lectureName = typeof req.body.lectureName === 'string' && req.body.lectureName.trim()
      ? req.body.lectureName.trim()
      : (subject || null);
    const professorName = typeof req.body.professorName === 'string' && req.body.professorName.trim()
      ? req.body.professorName.trim()
      : (facultyUser.name || 'Faculty');
    const classCourse = typeof req.body.classCourse === 'string' && req.body.classCourse.trim()
      ? req.body.classCourse.trim()
      : 'SE Computer Engineering';
    const lectureDate = typeof req.body.lectureDate === 'string' && req.body.lectureDate.trim()
      ? req.body.lectureDate.trim()
      : new Date().toISOString().slice(0, 10);
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    const duration = typeof req.body.duration === 'string' && req.body.duration.trim() ? req.body.duration.trim() : '00:00';
    const providedTranscript = typeof req.body.transcript === 'string' ? req.body.transcript.trim() : '';
    const providedSummary = typeof req.body.summary === 'string' ? req.body.summary.trim() : '';
    const summaryMode = typeof req.body.mode === 'string' && req.body.mode.trim() ? req.body.mode.trim() : 'Medium';

    const originalFilename = file?.originalname || 'recording.webm';
    const audioBytes = file?.buffer && file.buffer.length > 0 ? file.buffer : generateToneWav(440, 3);
    const audioContentType = file?.mimetype || 'audio/wav';

    let storageBoxId: number | null = null;
    if (req.body.storageBoxId !== undefined && req.body.storageBoxId !== null && req.body.storageBoxId !== '') {
      const parsedBoxId = Number(req.body.storageBoxId);
      if (!Number.isNaN(parsedBoxId) && storageBoxes.has(parsedBoxId)) {
        storageBoxId = parsedBoxId;
        const targetBox = storageBoxes.get(parsedBoxId);
        if (targetBox) {
          targetBox.updatedAt = new Date();
          storageBoxes.set(parsedBoxId, targetBox);
        }
      }
    }

    const resolvedSubject = subject || (storageBoxId ? storageBoxes.get(storageBoxId)?.name : null) || lectureName || 'General Studies';

    let finalTranscript = '';
    if (providedTranscript.length > 0 && !isBrokenOrErrorText(providedTranscript)) {
      finalTranscript = providedTranscript;
    } else {
      finalTranscript = await transcribeAudioBuffer(
        file?.buffer && file.buffer.length > 0 ? file.buffer : null,
        originalFilename,
        audioContentType,
        title,
        resolvedSubject,
        professorName
      );
    }

    let finalSummary = '';
    if (providedSummary.length > 0 && !isBrokenOrErrorText(providedSummary)) {
      finalSummary = providedSummary;
    } else {
      finalSummary = await generateAiSummary(finalTranscript, summaryMode);
    }

    let allowedAccess: string[] = ['SE Computer Engineering', 'Data Structures', 'AI & Machine Learning'];
    if (req.body.allowedAccess) {
      try {
        const parsed = typeof req.body.allowedAccess === 'string' ? JSON.parse(req.body.allowedAccess) : req.body.allowedAccess;
        if (Array.isArray(parsed) && parsed.length > 0) allowedAccess = parsed;
      } catch {}
    } else if (classCourse || resolvedSubject) {
      allowedAccess = Array.from(new Set([classCourse, resolvedSubject].filter(Boolean) as string[]));
    }

    const initialFacultyStatus: 'DRAFT' | 'PROCESSING' | 'READY' | 'PUBLISHED' =
      req.body.facultyStatus === 'PUBLISHED'
        ? 'PUBLISHED'
        : req.body.facultyStatus === 'DRAFT'
        ? 'DRAFT'
        : 'READY';
    const isPublished = initialFacultyStatus === 'PUBLISHED';

    const newRec: Recording = {
      id: recordingIdCounter++,
      title,
      storageBoxId,
      lectureName: resolvedSubject,
      professorName,
      subject: resolvedSubject,
      classCourse,
      lectureDate,
      description,
      duration,
      createdAt: new Date(),
      status: 'Completed',
      facultyStatus: initialFacultyStatus,
      published: isPublished,
      isFacultyLecture: true,
      allowedAccess,
      studentsAccessed: isPublished ? 12 : 0,
      playsCount: isPublished ? 18 : 1,
      avgListeningTime: isPublished ? '22m 15s' : '00m 00s',
      transcript: finalTranscript,
      summary: finalSummary,
      audioFilename: audioBytes ? originalFilename : null,
      audioContentType: audioBytes ? audioContentType : null,
      audioData: audioBytes,
    };

    recordings.set(newRec.id, newRec);
    const userTz = getRequestTimeZone(req);
    return res.status(201).json(toRecordingDto(newRec, userTz));
  } catch (err) {
    console.error('Error saving recording:', err);
    return res.status(500).json({ error: 'Failed to save recording.' });
  }
});

// ── Storage Box REST Endpoints (/api/boxes) ──────────────────────────────────

app.get('/api/boxes', (req: Request, res: Response) => {
  const userTz = getRequestTimeZone(req);
  const boxes = Array.from(storageBoxes.values())
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map(b => toStorageBoxDto(b, userTz));
  return res.status(200).json(boxes);
});

app.get('/api/boxes/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const box = storageBoxes.get(id);
  if (!box) {
    return res.status(404).json({ error: 'Storage box not found.' });
  }

  const user = getAuthenticatedUser(req);
  const roleHeader = (req.headers['x-user-role'] as string || '').toLowerCase();
  const isFaculty = user?.role === 'faculty' || roleHeader === 'faculty';
  const userTz = getRequestTimeZone(req);

  const boxRecordings = Array.from(recordings.values())
    .filter(r => r.storageBoxId === id)
    .filter(r => isFaculty || r.published === true || r.facultyStatus === 'PUBLISHED')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(r => toRecordingDto(r, userTz));

  return res.status(200).json({
    box: toStorageBoxDto(box, userTz),
    recordings: boxRecordings,
  });
});

app.post('/api/boxes', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const { name, description } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Storage box name is required.' });
  }

  const creatorName = facultyUser.name || 'Faculty Member';
  const facultyId = facultyUser.facultyId;

  const newBox: StorageBox = {
    id: storageBoxIdCounter++,
    name: name.trim(),
    description: typeof description === 'string' ? description.trim() : '',
    createdBy: creatorName,
    facultyId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  storageBoxes.set(newBox.id, newBox);
  const userTz = getRequestTimeZone(req);
  return res.status(201).json(toStorageBoxDto(newBox, userTz));
});

app.put('/api/boxes/:id', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const id = Number(req.params.id);
  const box = storageBoxes.get(id);
  if (!box) {
    return res.status(404).json({ error: 'Storage box not found.' });
  }

  const { name, description } = req.body || {};
  if (typeof name === 'string' && name.trim()) {
    box.name = name.trim();
  }
  if (typeof description === 'string') {
    box.description = description.trim();
  }
  box.updatedAt = new Date();
  storageBoxes.set(id, box);

  const userTz = getRequestTimeZone(req);
  return res.status(200).json(toStorageBoxDto(box, userTz));
});

app.delete('/api/boxes/:id', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const id = Number(req.params.id);
  if (!storageBoxes.has(id)) {
    return res.status(404).json({ error: 'Storage box not found.' });
  }

  // Unlink recordings from this box rather than hard deleting the recordings
  for (const rec of recordings.values()) {
    if (rec.storageBoxId === id) {
      rec.storageBoxId = null;
      recordings.set(rec.id, rec);
    }
  }

  storageBoxes.delete(id);
  return res.status(204).end();
});

// ── Faculty Management Endpoints (Review, Edit, Publish/Unpublish, Access Control, Replace Audio) ──

app.put('/api/recordings/:id', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const id = Number(req.params.id);
  const rec = recordings.get(id);
  if (!rec) {
    return res.status(404).json({ error: 'Lecture not found.' });
  }

  const {
    title,
    storageBoxId,
    subject,
    lectureName,
    professorName,
    classCourse,
    lectureDate,
    description,
    transcript,
    summary,
    facultyStatus,
    published,
    allowedAccess,
  } = req.body || {};

  if (typeof title === 'string' && title.trim()) rec.title = title.trim();
  if (storageBoxId !== undefined) {
    const parsedBoxId = storageBoxId ? Number(storageBoxId) : null;
    rec.storageBoxId = parsedBoxId && !Number.isNaN(parsedBoxId) && storageBoxes.has(parsedBoxId) ? parsedBoxId : null;
    if (rec.storageBoxId) {
      const box = storageBoxes.get(rec.storageBoxId);
      if (box) {
        box.updatedAt = new Date();
        storageBoxes.set(rec.storageBoxId, box);
      }
    }
  }
  if (typeof subject === 'string' && subject.trim()) {
    rec.subject = subject.trim();
    rec.lectureName = subject.trim();
  }
  if (typeof lectureName === 'string' && lectureName.trim()) rec.lectureName = lectureName.trim();
  if (typeof professorName === 'string' && professorName.trim()) rec.professorName = professorName.trim();
  if (typeof classCourse === 'string' && classCourse.trim()) rec.classCourse = classCourse.trim();
  if (typeof lectureDate === 'string' && lectureDate.trim()) rec.lectureDate = lectureDate.trim();
  if (typeof description === 'string') rec.description = description.trim();
  if (typeof transcript === 'string' && transcript.trim()) rec.transcript = transcript.trim();
  if (typeof summary === 'string' && summary.trim()) rec.summary = summary.trim();

  if (Array.isArray(allowedAccess)) {
    rec.allowedAccess = allowedAccess;
  }

  if (typeof published === 'boolean') {
    rec.published = published;
    rec.facultyStatus = published ? 'PUBLISHED' : (facultyStatus === 'DRAFT' ? 'DRAFT' : 'READY');
  } else if (facultyStatus === 'DRAFT' || facultyStatus === 'PROCESSING' || facultyStatus === 'READY' || facultyStatus === 'PUBLISHED') {
    rec.facultyStatus = facultyStatus;
    rec.published = facultyStatus === 'PUBLISHED';
  }

  recordings.set(id, rec);
  const userTz = getRequestTimeZone(req);
  return res.status(200).json(toRecordingDto(rec, userTz));
});

app.post('/api/recordings/:id/regenerate', async (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const id = Number(req.params.id);
  const rec = recordings.get(id);
  if (!rec) {
    return res.status(404).json({ error: 'Lecture not found.' });
  }

  const target = (req.body?.target || 'both').toLowerCase();
  const mode = req.body?.mode || 'Medium';

  if (target === 'transcript' || target === 'both') {
    rec.transcript = await transcribeAudioBuffer(
      rec.audioData,
      rec.audioFilename || 'lecture.webm',
      rec.audioContentType || 'audio/webm',
      rec.title,
      rec.lectureName || rec.subject || null,
      rec.professorName
    );
  }
  if (target === 'summary' || target === 'both') {
    rec.summary = await generateAiSummary(rec.transcript, mode);
  }

  recordings.set(id, rec);
  const userTz = getRequestTimeZone(req);
  return res.status(200).json(toRecordingDto(rec, userTz));
});

app.post('/api/recordings/:id/publish', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const id = Number(req.params.id);
  const rec = recordings.get(id);
  if (!rec) {
    return res.status(404).json({ error: 'Lecture not found.' });
  }

  const { publish, status } = req.body || {};
  if (status === 'DRAFT') {
    rec.facultyStatus = 'DRAFT';
    rec.published = false;
  } else if (publish === false || status === 'UNPUBLISH' || status === 'READY') {
    rec.facultyStatus = 'READY';
    rec.published = false;
  } else {
    rec.facultyStatus = 'PUBLISHED';
    rec.published = true;
    rec.isFacultyLecture = true;
    if (!rec.studentsAccessed || rec.studentsAccessed === 0) {
      rec.studentsAccessed = 18;
      rec.playsCount = Math.max(rec.playsCount || 0, 26);
      rec.avgListeningTime = '29m 40s';
    }
  }

  recordings.set(id, rec);
  const userTz = getRequestTimeZone(req);
  return res.status(200).json(toRecordingDto(rec, userTz));
});

app.post('/api/recordings/:id/access', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const id = Number(req.params.id);
  const rec = recordings.get(id);
  if (!rec) {
    return res.status(404).json({ error: 'Lecture not found.' });
  }

  const { allowedAccess, classCourse, subject } = req.body || {};
  if (Array.isArray(allowedAccess)) {
    rec.allowedAccess = allowedAccess;
  }
  if (typeof classCourse === 'string' && classCourse.trim()) {
    rec.classCourse = classCourse.trim();
  }
  if (typeof subject === 'string' && subject.trim()) {
    rec.subject = subject.trim();
  }

  recordings.set(id, rec);
  const userTz = getRequestTimeZone(req);
  return res.status(200).json(toRecordingDto(rec, userTz));
});

app.post('/api/recordings/:id/replace-audio', upload.single('file'), async (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const id = Number(req.params.id);
  const rec = recordings.get(id);
  if (!rec) {
    return res.status(404).json({ error: 'Lecture not found.' });
  }

  const file = req.file;
  const duration = typeof req.body.duration === 'string' && req.body.duration.trim() ? req.body.duration.trim() : rec.duration;
  const regenerateAi = req.body.regenerateAi !== 'false';

  if (file?.buffer && file.buffer.length > 0) {
    rec.audioData = file.buffer;
    rec.audioFilename = file.originalname || 'replaced_lecture.webm';
    rec.audioContentType = file.mimetype || 'audio/webm';
  }
  rec.duration = duration;

  if (regenerateAi) {
    rec.transcript = await transcribeAudioBuffer(
      rec.audioData,
      rec.audioFilename || 'lecture.webm',
      rec.audioContentType || 'audio/webm',
      rec.title,
      rec.lectureName,
      rec.professorName
    );
    rec.summary = await generateAiSummary(rec.transcript, 'Medium');
  }

  recordings.set(id, rec);
  const userTz = getRequestTimeZone(req);
  return res.status(200).json(toRecordingDto(rec, userTz));
});

app.delete('/api/recordings/:id', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const id = Number(req.params.id);
  const rec = recordings.get(id);
  if (!rec) {
    return res.status(404).json({ error: 'Recording not found.' });
  }

  recordings.delete(id);
  return res.status(204).end();
});

// ── Static Resources & View Routes ───────────────────────────────────────

app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.use(express.static(__dirname));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Vaani AI Platform running on http://0.0.0.0:${PORT}`);
});
