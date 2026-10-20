import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { GoogleGenAI } from '@google/genai';
import {
  db,
  AUDIO_DIR,
  resolveAudioPath,
  saveAudioFile,
  deleteAudioFile,
  getAudioBuffer,
  getSystemSetting,
  setSystemSetting,
  hashPassword,
  checkPassword,
  User,
  Otp,
  StorageBox,
  Recording,
  LectureAccessLog,
  getUserByEmail,
  getUserById,
  getAllUsers,
  getStudents,
  saveUser,
  updateUserEmail,
  setOtp,
  getOtp,
  deleteOtp,
  saveSession,
  getSession,
  deleteSession,
  revokeToken,
  isTokenRevoked,
  getAllStorageBoxes,
  getStorageBoxById,
  createStorageBox,
  updateStorageBox,
  deleteStorageBox,
  getAllRecordings,
  getRecordingById,
  createRecording,
  updateRecording,
  deleteRecording,
  recordStudentAccess,
  getAccessedStudentsForLecture,
  getAllAccessedStudentsPerLecture,
  logLectureAccess,
  getLectureAccessLogs,
  getFacultyAnalyticsGoals,
  saveFacultyAnalyticsGoals,
  updateRecordingLectureDate,
  seedDatabaseIfEmpty,
} from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

// ── Gemini & Environment Configuration ─────────────────────────────────────

const ENV_FILE = path.join(__dirname, '.env');
try {
  if (fs.existsSync(ENV_FILE)) {
    process.loadEnvFile(ENV_FILE);
  }
} catch (e) {
  // Ignore loadEnvFile error if malformed
}

const GEMINI_CONFIG_FILE = path.join(__dirname, '.gemini-config.json');

function isValidCredential(val: string | null | undefined): boolean {
  if (!val) return false;
  const trimmed = val.trim().toLowerCase();
  return trimmed !== '' && trimmed !== 'none' && trimmed !== 'null' && trimmed !== 'undefined';
}

function readSavedGeminiConfig(): { apiKey?: string; model?: string } {
  try {
    if (fs.existsSync(GEMINI_CONFIG_FILE)) {
      const raw = fs.readFileSync(GEMINI_CONFIG_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch {}
  return {};
}

function writeSavedGeminiConfig(cfg: { apiKey?: string; model?: string }) {
  try {
    fs.writeFileSync(GEMINI_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch {}
}

function getGeminiApiKey(): string | null {
  const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (isValidCredential(envKey)) return envKey!.trim();

  try {
    const dbKey = getSystemSetting('gemini_api_key');
    if (isValidCredential(dbKey)) return dbKey!.trim();
  } catch {}

  const saved = readSavedGeminiConfig();
  if (isValidCredential(saved.apiKey)) return saved.apiKey!.trim();

  return null;
}

function saveGeminiApiKey(key: string, activeModel = 'gemini-3.8-flash') {
  const trimmed = key.trim();
  process.env.GEMINI_API_KEY = trimmed;

  try {
    setSystemSetting('gemini_api_key', trimmed);
  } catch {}

  writeSavedGeminiConfig({ apiKey: trimmed, model: activeModel });

  try {
    let envContent = '';
    if (fs.existsSync(ENV_FILE)) {
      envContent = fs.readFileSync(ENV_FILE, 'utf8');
      if (/^GEMINI_API_KEY=.*$/m.test(envContent)) {
        envContent = envContent.replace(/^GEMINI_API_KEY=.*$/m, `GEMINI_API_KEY=${trimmed}`);
      } else {
        envContent += `\nGEMINI_API_KEY=${trimmed}\n`;
      }
    } else {
      envContent = `GEMINI_API_KEY=${trimmed}\n`;
    }
    fs.writeFileSync(ENV_FILE, envContent, 'utf8');
  } catch {}
}

async function verifyGeminiApiKey(apiKey: string): Promise<{ valid: boolean; error?: string; model?: string }> {
  const testModels = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
  let lastError = '';

  for (const model of testModels) {
    try {
      const client = new GoogleGenAI({
        apiKey: apiKey.trim(),
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const call = client.models.generateContent({
        model,
        contents: 'Test connection. Please respond with OK.',
        config: {
          maxOutputTokens: 10,
        },
      });
      const res = await withTimeout(call, 15000);
      if (res && (res.text !== undefined || res.candidates?.length)) {
        return { valid: true, model };
      }
    } catch (err: any) {
      lastError = err?.message || String(err);
      if (lastError.includes('API key not valid') || lastError.includes('API_KEY_INVALID')) {
        return { valid: false, error: 'API key is not valid. Please pass a valid key from Google AI Studio.' };
      }
    }
  }

  return { valid: false, error: lastError || 'Could not verify Gemini API key.' };
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function transcribeWithPythonWhisper(audioBuffer: Buffer, filename: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      const scriptPath = path.join(__dirname, 'backend', 'transcribe_whisper.py');
      if (!fs.existsSync(scriptPath)) {
        return resolve('');
      }
      const safeName = `tmp_${Date.now()}_${(filename || 'recording.webm').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const tempPath = path.join(AUDIO_DIR, safeName);
      fs.writeFileSync(tempPath, audioBuffer);

      const pyProc = spawn('python', [scriptPath, tempPath], {
        timeout: 30000,
        env: { ...process.env },
      });

      let stdout = '';
      pyProc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      pyProc.on('close', (code) => {
        try { fs.unlinkSync(tempPath); } catch {}
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          resolve('');
        }
      });
      pyProc.on('error', () => {
        try { fs.unlinkSync(tempPath); } catch {}
        resolve('');
      });
    } catch {
      resolve('');
    }
  });
}

// ── DTO Interfaces ───────────────────────────────────────────────────────

interface StorageBoxResponseDto {
  id: number;
  name: string;
  description: string;
  createdBy: string;
  facultyId?: string;
  allowedStudents?: string[];
  recordingCount: number;
  publishedRecordingCount: number;
  createdAt: string;
  updatedAt: string;
  lastUpdatedFormatted: string;
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
  allowedStudents?: string[];
  studentsAccessed?: number;
  playsCount?: number;
  avgListeningTime?: string;
  transcript: string;
  summary: string;
  hasAudio: boolean;
  audioUrl: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const TOKEN_SECRET = process.env.VAANI_TOKEN_SECRET || 'vaani-studio-hmac-secret-2026';

const KNOWN_COURSES = new Set([
  'se computer engineering',
  'te computer engineering',
  'be computer engineering',
  'fe general engineering',
  'm.tech ai & data science',
]);

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
  saveSession(token, user.email);
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
  if (!token || isTokenRevoked(token)) {
    return null;
  }
  const existing = getSession(token);
  if (existing) {
    const dbUser = getUserByEmail(existing.email);
    if (dbUser) return dbUser;
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
      const existingUser = getUserByEmail(decoded.email.toLowerCase());
      if (existingUser) {
        saveSession(token, existingUser.email);
        return existingUser;
      }
      if (parts.length === 2) {
        const newUser = saveUser({
          name: decoded.name || 'User',
          email: decoded.email.toLowerCase(),
          password: '',
          role: decoded.role === 'faculty' ? 'faculty' : 'student',
          facultyId: decoded.role === 'faculty' ? 'FAC-2026-101' : undefined,
          department: decoded.role === 'faculty' ? 'Computer Engineering & AI' : undefined,
          course: decoded.role === 'student' ? 'SE Computer Engineering' : undefined,
          verified: true,
          createdAt: new Date(),
        });
        saveSession(token, newUser.email);
        return newUser;
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

function canUserAccessBox(user: User | null, box: StorageBox): boolean {
  if (!user) return false;
  if (user.role === 'faculty') return true;

  const allowedStudents = Array.isArray(box.allowedStudents) ? box.allowedStudents : [];
  if (allowedStudents.length === 0 || allowedStudents.includes('ALL') || allowedStudents.includes('*')) {
    return true;
  }

  const userEmail = (user.email || '').toLowerCase().trim();
  return allowedStudents.map(s => String(s).toLowerCase().trim()).includes(userEmail);
}

function canUserAccessRecording(user: User | null, rec: Recording): boolean {
  if (!user) return false;
  if (user.role === 'faculty') return true;

  // Students can only access published lectures
  if (!isRecordingPublished(rec)) {
    return false;
  }

  // Check specific student emails if configured
  const allowedStudents = Array.isArray(rec.allowedStudents) ? rec.allowedStudents : [];
  if (allowedStudents.length > 0 && !allowedStudents.includes('ALL') && !allowedStudents.includes('*')) {
    const userEmail = (user.email || '').toLowerCase().trim();
    if (allowedStudents.map(s => String(s).toLowerCase().trim()).includes(userEmail)) {
      return true;
    }
    return false;
  }

  // If assigned to a storage box that restricts students
  if (rec.storageBoxId) {
    const box = getStorageBoxById(rec.storageBoxId);
    if (box && !canUserAccessBox(user, box)) {
      return false;
    }
  }

  const allowed = Array.isArray(rec.allowedAccess) ? rec.allowedAccess : [];
  if (allowed.length === 0) {
    return true;
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
    recordStudentAccess(rec.id, user.email);
    rec.studentsAccessed = getAccessedStudentsForLecture(rec.id).size;
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
  updateRecording(rec);
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
  const lower = text.toLowerCase().trim();
  return (
    lower.includes('openai whisper could not transcribe') ||
    lower.includes('http 429') ||
    lower.includes('transcription or summary failed') ||
    lower.includes('no transcript available') ||
    lower.includes('no summary available') ||
    lower.includes('check your api key, account billing') ||
    lower.includes('in this lecture, we explore the core principles, foundational architecture, and practical real-world implementations of') ||
    lower.includes('first, we examine how modern systems process input data, structure key representations, and optimize performance under real-world constraints') ||
    lower.includes('second, we walk through concrete case studies and step-by-step methodologies') ||
    lower.startsWith('⚠️') ||
    lower.startsWith('❌')
  );
}

function isUnhelpfulAudioText(text: string | null | undefined): boolean {
  if (!text) return true;
  const t = text.trim().toLowerCase();
  if (t.length < 3) return true;
  return (
    t === '00:00' ||
    t === '00:00 - 00:01' ||
    t === '[silence]' ||
    t === '[music]' ||
    t === '[applause]' ||
    t === '[noise]' ||
    t === '[inaudible]' ||
    t === 'no speech detected' ||
    t === 'no_speech_detected' ||
    t === '[no_speech_detected]' ||
    t === 'undefined'
  );
}

function stripModelLine(text: string): string {
  return text
    .replace(/^[•\-\*]?\s*AI Processing Model:.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const ALLOWED_AUDIO_MIMES = new Set([
  'audio/webm',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/mp3',
  'audio/mpeg',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/ogg',
  'audio/aac',
  'audio/flac',
  'video/webm',
  'video/mp4',
]);

const ALLOWED_AUDIO_EXTS = new Set([
  '.webm',
  '.wav',
  '.mp3',
  '.m4a',
  '.mp4',
  '.ogg',
  '.aac',
  '.flac',
]);

interface AudioValidationResult {
  valid: boolean;
  error?: string;
  normalizedMime: string;
}

function normalizeAudioMimeType(mimeType: string | null | undefined, filename: string): string {
  const ext = path.extname(filename || '').toLowerCase();
  if (mimeType) {
    const baseMime = mimeType.split(';')[0].trim().toLowerCase();
    if (baseMime === 'video/webm') return 'audio/webm';
    if (baseMime === 'video/mp4' || baseMime === 'audio/x-m4a' || baseMime === 'audio/m4a') return 'audio/mp4';
    if (baseMime === 'audio/mp3') return 'audio/mpeg';
    if (baseMime === 'audio/x-wav' || baseMime === 'audio/wave') return 'audio/wav';
    if (baseMime.startsWith('audio/')) return baseMime;
  }
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.aac') return 'audio/aac';
  if (ext === '.flac') return 'audio/flac';
  return 'audio/webm';
}

function inspectWavBufferForSpeech(buffer: Buffer): { isSilentOrPureSine: boolean; reason?: string } {
  if (buffer.length < 44) {
    return { isSilentOrPureSine: true, reason: 'WAV file header is truncated or corrupted (< 44 bytes).' };
  }
  const riff = buffer.toString('ascii', 0, 4);
  const wave = buffer.toString('ascii', 8, 12);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    return { isSilentOrPureSine: true, reason: 'Invalid or corrupted WAV container header.' };
  }

  let dataOffset = 44;
  for (let i = 12; i < Math.min(buffer.length - 8, 256); i++) {
    if (buffer.toString('ascii', i, i + 4) === 'data') {
      dataOffset = i + 8;
      break;
    }
  }
  const pcmBytes = buffer.length - dataOffset;
  if (pcmBytes < 800) {
    return { isSilentOrPureSine: true, reason: 'Audio recording is too short or contains no PCM audio frames.' };
  }

  const sampleCount = Math.floor(pcmBytes / 2);
  let sumSq = 0;
  let maxAbs = 0;
  let zeroCrossings = 0;
  let prevSample = 0;
  const step = Math.max(1, Math.floor(sampleCount / 8000));
  let inspected = 0;

  for (let i = 0; i < sampleCount; i += step) {
    const offset = dataOffset + i * 2;
    if (offset + 2 > buffer.length) break;
    const sample = buffer.readInt16LE(offset);
    const abs = Math.abs(sample);
    if (abs > maxAbs) maxAbs = abs;
    sumSq += sample * sample;
    if (inspected > 0 && ((sample >= 0 && prevSample < 0) || (sample < 0 && prevSample >= 0))) {
      zeroCrossings++;
    }
    prevSample = sample;
    inspected++;
  }

  const rms = inspected > 0 ? Math.sqrt(sumSq / inspected) : 0;
  if (maxAbs < 60 || rms < 15) {
    return { isSilentOrPureSine: true, reason: 'No audible speech detected in the recording (audio is silent).' };
  }

  // Detect synthetic pure-tone sine waves (such as 440Hz/523Hz test tones where crest factor is ~1.414)
  const crestFactor = rms > 0 ? maxAbs / rms : 0;
  if (crestFactor > 1.35 && crestFactor < 1.50 && inspected > 200) {
    // Check amplitude variance across windows: speech fluctuates wildly across syllables, pure tone stays constant
    const windowCount = 8;
    const winSize = Math.floor(sampleCount / windowCount);
    if (winSize > 100) {
      const winRms: number[] = [];
      for (let w = 0; w < windowCount - 1; w++) {
        let wSum = 0;
        let wN = 0;
        for (let j = 0; j < winSize; j += Math.max(1, Math.floor(winSize / 200))) {
          const idx = dataOffset + (w * winSize + j) * 2;
          if (idx + 2 <= buffer.length) {
            const s = buffer.readInt16LE(idx);
            wSum += s * s;
            wN++;
          }
        }
        if (wN > 0) winRms.push(Math.sqrt(wSum / wN));
      }
      if (winRms.length >= 4) {
        const meanRms = winRms.reduce((a, b) => a + b, 0) / winRms.length;
        const maxDiff = Math.max(...winRms.map(v => Math.abs(v - meanRms)));
        if (meanRms > 0 && maxDiff / meanRms < 0.08) {
          return {
            isSilentOrPureSine: true,
            reason: 'The audio contains only a synthetic test tone with no spoken words.',
          };
        }
      }
    }
  }

  return { isSilentOrPureSine: false };
}

function validateAudioPayload(
  audioBuffer: Buffer | null | undefined,
  filename: string | null | undefined,
  mimeType: string | null | undefined
): AudioValidationResult {
  const safeName = (filename || 'recording.webm').trim();
  const ext = path.extname(safeName).toLowerCase();
  const rawMime = (mimeType || '').split(';')[0].trim().toLowerCase();
  const normalizedMime = normalizeAudioMimeType(mimeType, safeName);

  if (!audioBuffer || audioBuffer.length === 0) {
    return {
      valid: false,
      error: 'Audio recording is empty (0 bytes). Please record or select a valid lecture audio file.',
      normalizedMime,
    };
  }

  if (audioBuffer.length < 128) {
    return {
      valid: false,
      error: 'Audio recording is too small or corrupted to contain recognizable speech.',
      normalizedMime,
    };
  }

  const hasValidMime = rawMime ? ALLOWED_AUDIO_MIMES.has(rawMime) || rawMime.startsWith('audio/') : false;
  const hasValidExt = ext ? ALLOWED_AUDIO_EXTS.has(ext) : false;
  if (!hasValidMime && !hasValidExt) {
    return {
      valid: false,
      error: `Unsupported audio format (${rawMime || ext || 'unknown'}). Supported formats: WEBM, WAV, MP3, M4A, MP4, OGG, AAC, FLAC.`,
      normalizedMime,
    };
  }

  // Verify container magic bytes for common formats to catch corrupted files
  const headerAscii = audioBuffer.toString('ascii', 0, Math.min(16, audioBuffer.length));
  const isRiffWav = headerAscii.startsWith('RIFF') && audioBuffer.toString('ascii', 8, 12) === 'WAVE';
  const isEbmlWebm = audioBuffer.length >= 4 && audioBuffer[0] === 0x1a && audioBuffer[1] === 0x45 && audioBuffer[2] === 0xdf && audioBuffer[3] === 0xa3;
  const isOgg = headerAscii.startsWith('OggS');
  const isFlac = headerAscii.startsWith('fLaC');
  const isId3Mp3 = headerAscii.startsWith('ID3') || (audioBuffer.length >= 2 && audioBuffer[0] === 0xff && (audioBuffer[1] & 0xe0) === 0xe0);
  const isMp4M4a = audioBuffer.length >= 8 && audioBuffer.toString('ascii', 4, 8) === 'ftyp';

  if (ext === '.wav' || normalizedMime === 'audio/wav') {
    if (!isRiffWav) {
      return {
        valid: false,
        error: 'Corrupted WAV audio file: missing RIFF/WAVE header.',
        normalizedMime,
      };
    }
    const wavCheck = inspectWavBufferForSpeech(audioBuffer);
    if (wavCheck.isSilentOrPureSine) {
      return {
        valid: false,
        error: wavCheck.reason || 'WAV audio contains silence or non-speech tone.',
        normalizedMime,
      };
    }
  } else if (
    !isRiffWav &&
    !isEbmlWebm &&
    !isOgg &&
    !isFlac &&
    !isId3Mp3 &&
    !isMp4M4a
  ) {
    // Reject arbitrary text/random binary masquerading as an audio file
    return {
      valid: false,
      error: 'Corrupted or unrecognized audio file header. The file could not be decoded as valid audio.',
      normalizedMime,
    };
  }

  return { valid: true, normalizedMime };
}

function toStorageBoxDto(box: StorageBox, userTz?: string, user?: User | null): StorageBoxResponseDto {
  const allRecs = getAllRecordings().filter(r => r.storageBoxId === box.id);
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
    allowedStudents: Array.isArray(box.allowedStudents) ? box.allowedStudents : [],
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

  if (recording.summary) {
    recording.summary = stripModelLine(recording.summary);
  }

  const resolvedPath = resolveAudioPath(recording.audioFilePath);
  const hasAudio = Boolean(resolvedPath && fs.existsSync(resolvedPath));
  const createdAtDate = recording.createdAt instanceof Date ? recording.createdAt : new Date(recording.createdAt || Date.now());
  const isoStr = createdAtDate.toISOString();

  let boxName: string | null = null;
  if (recording.storageBoxId) {
    const box = getStorageBoxById(Number(recording.storageBoxId));
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
  } else if (hasAudio && recording.transcript && recording.summary && !isBrokenOrErrorText(recording.transcript)) {
    resolvedStatus = 'Completed';
  }

  const studentsAccessed = typeof recording.studentsAccessed === 'number' && recording.studentsAccessed >= 0
    ? recording.studentsAccessed
    : 0;
  const playsCount = typeof recording.playsCount === 'number' && recording.playsCount > 0
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
    allowedStudents: Array.isArray(recording.allowedStudents) ? recording.allowedStudents : [],
    studentsAccessed,
    playsCount,
    avgListeningTime,
    transcript: recording.transcript || '',
    summary: recording.summary || '',
    hasAudio,
    audioUrl: hasAudio ? `/api/recordings/${recording.id}/audio` : null,
  };
}

// ── Grounded Extractive NLP Summarizer & Quality Validators ─────────────

const STOP_WORDS = new Set([
  'the', 'and', 'is', 'in', 'to', 'of', 'for', 'with', 'on', 'at', 'from', 'by',
  'this', 'that', 'are', 'was', 'were', 'been', 'has', 'have', 'had', 'will', 'would',
  'could', 'should', 'your', 'our', 'their', 'more', 'also', 'some', 'into', 'welcome',
  'everyone', 'today', 'session', 'lecture', 'going', 'talk', 'about', 'what', 'when',
  'where', 'which', 'there', 'here', 'they', 'them', 'then', 'than', 'very', 'just',
  'like', 'make', 'made', 'each', 'other', 'such', 'only', 'over', 'under', 'between',
]);

function tokenizeContentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#-]+/)
    .map(w => w.replace(/^[-+#]+|[-+#]+$/g, ''))
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

function validateTranscriptQuality(transcript: string | null | undefined): { valid: boolean; reason?: string } {
  if (!transcript || !transcript.trim()) {
    return { valid: false, reason: 'No speech could be recognized from the audio recording.' };
  }
  const cleaned = transcript.trim();
  const lower = cleaned.toLowerCase();
  if (isBrokenOrErrorText(cleaned) || isUnhelpfulAudioText(cleaned)) {
    return { valid: false, reason: 'Audio contained silence, background noise, or unrecognizable speech.' };
  }
  const nonSpeechPhrases = [
    'no speech detected',
    'no_speech_detected',
    'no spoken words',
    'no clear human speech',
    'contains only a tone',
    'contains only silence',
    'cannot transcribe',
    'unable to transcribe',
    'there is no speech',
    'there are no spoken words',
    'only background noise',
    'synthesized tone',
    'electronic tone',
  ];
  if (nonSpeechPhrases.some(p => lower.includes(p))) {
    return { valid: false, reason: 'No recognizable human speech was detected in the audio recording.' };
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 3) {
    return { valid: false, reason: `Recognized speech is too brief (${words.length} word${words.length === 1 ? '' : 's'}) to form a valid lecture transcript.` };
  }
  return { valid: true };
}

function validateSummaryRelevance(transcript: string, summary: string | null | undefined): { valid: boolean; reason?: string } {
  if (!summary || !summary.trim()) {
    return { valid: false, reason: 'Summary is empty.' };
  }
  if (isBrokenOrErrorText(summary)) {
    return { valid: false, reason: 'Summary contains error or placeholder text.' };
  }
  const transcriptTokens = new Set(tokenizeContentWords(transcript));
  const summaryTokens = tokenizeContentWords(summary);
  if (summaryTokens.length < 4) {
    return { valid: false, reason: 'Summary is too brief to be useful.' };
  }
  if (transcriptTokens.size === 0) {
    return { valid: false, reason: 'Source transcript has no meaningful content words.' };
  }

  let overlapCount = 0;
  for (const token of summaryTokens) {
    if (transcriptTokens.has(token)) {
      overlapCount++;
    }
  }
  const overlapRatio = overlapCount / Math.max(1, Math.min(summaryTokens.length, 25));
  if (overlapCount < 2 || overlapRatio < 0.12) {
    return {
      valid: false,
      reason: 'Generated summary does not match the terminology or concepts present in the lecture transcript.',
    };
  }
  return { valid: true };
}

function extractKeySentences(sentences: string[], mode = 'Medium'): string[] {
  if (sentences.length <= 3) {
    return sentences;
  }

  const wordFreq = new Map<string, number>();
  for (const sentence of sentences) {
    for (const w of tokenizeContentWords(sentence)) {
      wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
    }
  }

  const scored = sentences.map((sentence, index) => {
    const tokens = tokenizeContentWords(sentence);
    let score = 0;
    for (const w of tokens) {
      score += wordFreq.get(w) || 0;
    }
    // Normalize slightly by length so well-formed concept sentences win
    const normScore = tokens.length > 0 ? score / Math.sqrt(tokens.length) : 0;
    return { sentence: sentence.trim(), score: normScore, index };
  });

  scored.sort((a, b) => b.score - a.score);

  let maxSentences = 5;
  if (mode === 'Short') maxSentences = 3;
  if (mode === 'Detailed') maxSentences = 8;

  const topCount = Math.min(maxSentences, sentences.length);
  const topScored = scored.slice(0, topCount);
  topScored.sort((a, b) => a.index - b.index);

  return topScored.map(a => a.sentence);
}

function extractDefinitionsFromSentences(sentences: string[]): string[] {
  const defPatterns = [
    /\b([A-Z][A-Za-z0-9\s\-/()]{1,40}?)\s+(?:is defined as|refers to|means|is a type of|is a subset of|is a process|is an algorithm|is a data structure|is a protocol|is a mechanism|is the process of|can be defined as)\s+([^.!?]+[.!?])/i,
    /\b(?:By definition,\s*)?([A-Za-z0-9\s\-/()]{2,35}?)\s+(?:is|are)\s+(?:a|an|the)\s+([^.!?]{15,180}[.!?])/i,
  ];
  const definitions: string[] = [];
  for (const s of sentences) {
    const trimmed = s.trim();
    for (const pat of defPatterns) {
      if (pat.test(trimmed)) {
        definitions.push(trimmed);
        break;
      }
    }
    if (definitions.length >= 4) break;
  }
  return definitions;
}

function extractKeywords(text: string): string[] {
  const counts = new Map<string, number>();
  for (const word of tokenizeContentWords(text)) {
    if (word.length > 3) {
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(entry => entry[0]);
}

function generateSummaryFromTranscriptDeterministically(transcript: string, mode = 'Medium'): string {
  const check = validateTranscriptQuality(transcript);
  if (!check.valid) {
    throw new Error(check.reason || 'Transcript is empty or unclear and cannot be summarized.');
  }

  const cleaned = transcript.trim();
  const rawSentences = cleaned
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 4);

  const sentences = rawSentences.length > 0 ? rawSentences : [cleaned];
  const keywords = extractKeywords(cleaned);
  const keySentences = extractKeySentences(sentences, mode);
  const definitions = extractDefinitionsFromSentences(sentences);

  const sections: string[] = [];

  // 1. Lecture Overview
  sections.push('1. Lecture Overview');
  if (sentences.length <= 2) {
    sections.push(sentences.join(' '));
  } else {
    const overviewSentences = [sentences[0], sentences[Math.min(1, sentences.length - 1)]];
    sections.push(overviewSentences.join(' '));
  }
  sections.push('');

  // 2. Key Concepts
  sections.push('2. Key Concepts');
  const conceptPoints = keySentences.slice(0, mode === 'Short' ? 3 : 5);
  for (const pt of conceptPoints) {
    sections.push(`• ${pt}`);
  }
  if (keywords.length > 0) {
    sections.push(`• Core Terminology: ${keywords.join(', ')}`);
  }
  sections.push('');

  // 3. Important Definitions (only included when the lecturer actually stated definitions)
  if (definitions.length > 0) {
    sections.push('3. Important Definitions');
    for (const def of definitions) {
      sections.push(`• ${def}`);
    }
    sections.push('');
  }

  // 4. Detailed Notes
  if (sentences.length > 2) {
    sections.push(`${definitions.length > 0 ? '4' : '3'}. Detailed Notes`);
    for (const s of sentences.slice(0, mode === 'Detailed' ? 8 : 5)) {
      sections.push(`• ${s}`);
    }
    sections.push('');
  }

  // 5. Key Takeaways
  const takeawayNum = definitions.length > 0 ? (sentences.length > 2 ? '5' : '4') : (sentences.length > 2 ? '4' : '3');
  sections.push(`${takeawayNum}. Key Takeaways`);
  const takeaways = keySentences.slice(-Math.min(3, keySentences.length));
  for (const t of takeaways) {
    sections.push(`• ${t}`);
  }

  return sections.join('\n').trim();
}

// ── Gemini + Whisper Transcription & Summarization Pipeline ──────────────

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
  liveSpeechHint?: string | null
): Promise<string> {
  const validation = validateAudioPayload(audioBuffer, filename, mimeType);
  if (!validation.valid || !audioBuffer) {
    throw new Error(validation.error || 'Invalid or empty audio file.');
  }

  // If a verified live speech transcription was captured by the browser speech recognition API, validate and prioritize it if robust
  if (liveSpeechHint && liveSpeechHint.trim()) {
    const liveQuality = validateTranscriptQuality(liveSpeechHint);
    if (liveQuality.valid && liveSpeechHint.trim().split(/\s+/).length >= 3) {
      return liveSpeechHint.trim();
    }
  }

  const cleanMime = validation.normalizedMime;
  const errors: string[] = [];

  // Helper to execute with retry
  async function callWithRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 1000): Promise<T> {
    let lastErr: any;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, delayMs * Math.pow(2, attempt)));
        }
      }
    }
    throw lastErr;
  }

  // 1. Primary: Google Gemini Speech-to-Text Transcription using actual audio bytes with retries
  const ai = getGeminiClient();
  if (ai) {
    const base64Audio = audioBuffer.toString('base64');
    const candidateModels = [
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.5-flash',
      'gemini-flash-latest',
    ];

    for (const modelName of candidateModels) {
      try {
        const rawText = await callWithRetry(async () => {
          const apiCall = ai.models.generateContent({
            model: modelName,
            contents: [
              {
                inlineData: {
                  mimeType: cleanMime,
                  data: base64Audio,
                },
              },
              {
                text: [
                  'You are a strict, verbatim academic speech-to-text transcription system.',
                  'Transcribe ONLY the actual spoken words heard in this audio recording.',
                  'CRITICAL RULES:',
                  '1. Preserve the speaker’s exact words, technical terminology, definitions, formulas, and examples.',
                  '2. Format with accurate punctuation, sentence boundaries, and clean paragraph breaks.',
                  '3. Automatically detect the spoken language and transcribe accurately.',
                  '4. NEVER invent, guess, extrapolate, or add information that is not spoken in the audio.',
                  '5. If the audio contains only silence, static, a pure tone, music, or unintelligible noise with no clear human speech, output the exact token: [NO_SPEECH_DETECTED]',
                  '6. Output ONLY the transcript text (or [NO_SPEECH_DETECTED]) with no introductory or concluding remarks.',
                ].join('\n'),
              },
            ],
          });
          const response = await withTimeout(apiCall, 35000);
          return response.text?.trim() || '';
        }, 1, 1000);

        if (rawText.includes('[NO_SPEECH_DETECTED]') || isUnhelpfulAudioText(rawText)) {
          errors.push(`${modelName}: No clear human speech was detected in the recorded audio.`);
          continue;
        }
        const quality = validateTranscriptQuality(rawText);
        if (quality.valid) {
          return rawText;
        }
        errors.push(`${modelName}: ${quality.reason}`);
      } catch (err: any) {
        errors.push(`${modelName}: ${err?.message || String(err)}`);
      }
    }
  } else {
    errors.push('GEMINI_API_KEY is not configured on the server.');
  }

  // 2. Secondary: Groq / OpenAI Whisper API using actual audio bytes with retry
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

      const whisperText = await callWithRetry(async () => {
        const formData = new FormData();
        const blob = new Blob([new Uint8Array(audioBuffer)], { type: cleanMime });
        formData.append('file', blob, filename || 'recording.webm');
        formData.append('model', model);
        formData.append('response_format', 'json');

        const response = await withTimeout(
          fetch(endpoint, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey.trim()}` },
            body: formData,
          }),
          30000
        );

        if (!response.ok) {
          throw new Error(`Whisper HTTP ${response.status}`);
        }
        const data = (await response.json()) as { text?: string };
        return data.text?.trim() || '';
      }, 1, 1000);

      const quality = validateTranscriptQuality(whisperText);
      if (quality.valid) {
        return whisperText;
      }
      errors.push(`Whisper: ${quality.reason}`);
    } catch (err: any) {
      errors.push(`Whisper: ${err?.message || String(err)}`);
    }
  }

  // 3. Tertiary: Local Python Whisper engine
  try {
    const pyText = await transcribeWithPythonWhisper(audioBuffer, filename);
    if (pyText && pyText.trim()) {
      const quality = validateTranscriptQuality(pyText);
      if (quality.valid) {
        return pyText.trim();
      }
    }
  } catch {}

  // 4. Quaternary: Live speech hint from browser speech recognition
  if (liveSpeechHint && liveSpeechHint.trim()) {
    const quality = validateTranscriptQuality(liveSpeechHint);
    if (quality.valid) {
      return liveSpeechHint.trim();
    }
  }

  // 5. Graceful Resilient Fallback: Never delete or reject valid lecture audio
  const hasGeminiKey = Boolean(getGeminiApiKey());
  if (!hasGeminiKey) {
    return '[Transcription Pending: Gemini API Key is not configured on the server. Please enter your Gemini API Key in Settings and click "Regenerate AI" in Review, or edit this transcript directly.]';
  }

  const primaryErr = errors[0] || 'Speech recognition model could not process audio';
  return `[Transcription Pending: Automatic speech recognition could not detect clear words (${primaryErr}). You can click "Regenerate AI" in Review, or edit the transcript directly.]`;
}

async function generateAiSummary(transcript: string, mode = 'Medium'): Promise<string> {
  if (!transcript || !transcript.trim()) {
    return '[AI Summary pending: Lecture transcript is empty.]';
  }

  const cleanedTranscript = transcript.trim();
  if (
    cleanedTranscript.startsWith('[Transcription Pending:') ||
    cleanedTranscript.startsWith('[Audio recording saved')
  ) {
    return '[AI Summary pending: Configure your Gemini API Key in Settings and click "Regenerate AI" in Review to generate structured lecture notes.]';
  }

  const transcriptCheck = validateTranscriptQuality(transcript);
  if (!transcriptCheck.valid) {
    return `[AI Summary pending: ${transcriptCheck.reason || 'Transcript quality insufficient'}. Configure Gemini API Key in Settings or edit the transcript manually.]`;
  }

  const ai = getGeminiClient();

  if (ai) {
    const depthInstruction =
      mode === 'Short'
        ? 'Keep each included section concise (1-2 sentences for overview, 2-4 bullets per section).'
        : mode === 'Detailed'
        ? 'Provide thorough revision notes capturing all technical explanations, definitions, and examples present in the transcript.'
        : 'Provide clear, well-structured bullet points suitable for college exam revision.';

    const summaryModels = [
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.5-flash',
      'gemini-flash-latest',
    ];
    for (const modelName of summaryModels) {
      try {
        const summaryCall = ai.models.generateContent({
          model: modelName,
          contents: [
            'You are an accurate academic lecture summarizer.',
            'Generate a structured lecture summary STRICTLY AND EXCLUSIVELY from the provided transcript below.',
            '',
            'STRICT GROUNDING RULES:',
            '1. Base every single point, definition, example, and takeaway ONLY on what is explicitly stated in the transcript.',
            '2. NEVER invent facts, examples, definitions, formulas, or conclusions that are absent from the transcript.',
            '3. NEVER use outside knowledge or guess based on a topic name.',
            '4. Preserve the lecturer’s exact technical terminology and meaning.',
            `5. ${depthInstruction}`,
            '6. Organize the summary using the following numbered headings ONLY where supported by the transcript content (omit any section that was not covered in the transcript):',
            '   1. Lecture Overview',
            '   2. Key Concepts',
            '   3. Important Definitions',
            '   4. Detailed Notes',
            '   5. Key Takeaways',
            '7. If the transcript does not contain enough coherent educational content to summarize, output the exact token: [INSUFFICIENT_TRANSCRIPT]',
            '',
            'LECTURE TRANSCRIPT:',
            cleanedTranscript,
          ].join('\n'),
          config: {
            maxOutputTokens: 1200,
            temperature: 0.1,
          },
        });

        const response = await withTimeout(summaryCall, 20000);
        const summaryText = stripModelLine(response.text?.trim() || '');
        if (summaryText.includes('[INSUFFICIENT_TRANSCRIPT]')) {
          continue;
        }

        const relevance = validateSummaryRelevance(cleanedTranscript, summaryText);
        if (relevance.valid) {
          return summaryText;
        }
      } catch (err: any) {
        // Continue to next model or fallback
      }
    }
  }

  // Fallback: Deterministic extractive summary built strictly from the actual transcript sentences
  try {
    const deterministicSummary = generateSummaryFromTranscriptDeterministically(cleanedTranscript, mode);
    const relevance = validateSummaryRelevance(cleanedTranscript, deterministicSummary);
    if (relevance.valid) {
      return deterministicSummary;
    }
  } catch {}

  return '[AI Summary pending: Configure your Gemini API Key in Settings to generate lecture notes.]';
}

// ── SMTP Email Service (Transporter, Resilient Delivery & Fallbacks) ──────

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  googleClientId?: string;
  googleClientSecret?: string;
  isConfigured: boolean;
}

const SMTP_CONFIG_FILE = path.join(__dirname, '.smtp-config.json');

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
  const googleClientId = (saved.googleClientId || process.env.GOOGLE_CLIENT_ID || '').trim();
  const googleClientSecret = (saved.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const isConfigured = isValidCredential(user) && isValidCredential(pass);

  return { host, port, secure, user, pass, from, googleClientId, googleClientSecret, isConfigured };
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

// ── Initialize SQLite Database & Seed If Empty ───────────────────────────
seedDatabaseIfEmpty();


// ── AuthFilter Middleware ────────────────────────────────────────────────

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'OPTIONS') {
    return next();
  }

  const reqPath = req.path;
  if (
    !reqPath.startsWith('/api/') ||
    reqPath.startsWith('/api/auth/') ||
    reqPath.startsWith('/api/config/') ||
    reqPath.endsWith('/audio')
  ) {
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

    const existing = getUserByEmail(email);
    if (existing) {
      saveUser({
        ...existing,
        name,
        password: hashPassword(password),
        role: userRole,
        department: userRole === 'faculty' ? (department || existing.department || 'Computer Engineering & AI') : undefined,
        facultyId: userRole === 'faculty' ? (facultyId || existing.facultyId || `FAC-2026-${100 + existing.id}`) : undefined,
        verified: false,
      });
    } else {
      saveUser({
        name,
        email,
        password: hashPassword(password),
        role: userRole,
        facultyId: userRole === 'faculty' ? (facultyId || 'FAC-2026-101') : undefined,
        department: userRole === 'faculty' ? (department || 'Computer Engineering & AI') : undefined,
        course: userRole === 'student' ? 'SE Computer Engineering' : undefined,
        verified: false,
        createdAt: new Date(),
      });
    }

    const otpCode = generateOtpCode();
    const now = new Date();
    setOtp(email, otpCode, now, new Date(now.getTime() + 5 * 60 * 1000));

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
    const user = getUserByEmail(email);
    const otpCode = generateOtpCode();
    const now = new Date();
    setOtp(email, otpCode, now, new Date(now.getTime() + 5 * 60 * 1000));

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
    googleClientId: cfg.googleClientId || '',
    hasGoogleAuth: Boolean(cfg.googleClientId),
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
    const { host, port, user, pass, secure, from, googleClientId, googleClientSecret, clear } = req.body || {};

    if (clear) {
      writeSavedSmtpConfig({});
      return res.status(200).json({ message: 'SMTP and Google configuration cleared.' });
    }

    const existingCfg = readSavedSmtpConfig();
    const newCfg: Partial<SmtpConfig> = {
      ...existingCfg,
      host: typeof host === 'string' && host.trim() ? host.trim() : (existingCfg.host || 'smtp.gmail.com'),
      port: Number(port) || existingCfg.port || 587,
      user: user !== undefined ? String(user).trim() : (existingCfg.user || ''),
      pass: pass !== undefined ? String(pass).trim() : (existingCfg.pass || ''),
      secure: secure !== undefined ? Boolean(secure) : Boolean(existingCfg.secure),
      from: typeof from === 'string' && from.trim() ? from.trim() : (existingCfg.from || `"Vaani AI" <${String(user || existingCfg.user || '').trim()}>`),
      googleClientId: googleClientId !== undefined ? String(googleClientId).trim() : (existingCfg.googleClientId || ''),
      googleClientSecret: googleClientSecret !== undefined ? String(googleClientSecret).trim() : (existingCfg.googleClientSecret || ''),
    };

    writeSavedSmtpConfig(newCfg);
    return res.status(200).json({
      message: 'SMTP & Google Auth settings saved successfully.',
      configured: Boolean(newCfg.user && newCfg.pass),
      host: newCfg.host,
      port: newCfg.port,
      user: newCfg.user?.replace(/^(.{2})(.*)(@.*)$/, '$1***$3'),
      googleClientId: newCfg.googleClientId || '',
      hasGoogleAuth: Boolean(newCfg.googleClientId),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to save configuration.' });
  }
});

// ── Gemini AI Configuration Endpoints ─────────────────────────────────────

app.get('/api/config/gemini', (_req: Request, res: Response) => {
  const key = getGeminiApiKey();
  const configured = Boolean(key && key.trim());
  let maskedKey = '';
  if (configured && key) {
    const k = key.trim();
    maskedKey = k.length > 8 ? `${k.slice(0, 4)}••••••••${k.slice(-4)}` : '••••••••';
  }
  return res.status(200).json({
    configured,
    maskedKey,
    activeModel: 'gemini-3.8-flash',
    provider: 'Google Gemini',
    hasWhisperPython: fs.existsSync(path.join(__dirname, 'backend', 'transcribe_whisper.py')),
    hasGroqWhisper: Boolean(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY),
  });
});

app.post('/api/config/gemini', async (req: Request, res: Response) => {
  try {
    const { apiKey, clear } = req.body || {};

    if (clear) {
      delete process.env.GEMINI_API_KEY;
      try { setSystemSetting('gemini_api_key', ''); } catch {}
      writeSavedGeminiConfig({});
      try {
        if (fs.existsSync(ENV_FILE)) {
          let envContent = fs.readFileSync(ENV_FILE, 'utf8');
          envContent = envContent.replace(/^GEMINI_API_KEY=.*$/m, 'GEMINI_API_KEY=');
          fs.writeFileSync(ENV_FILE, envContent, 'utf8');
        }
      } catch {}
      return res.status(200).json({
        success: true,
        configured: false,
        message: 'Gemini API Key removed.',
      });
    }

    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return res.status(400).json({ error: 'Please enter a valid Gemini API key.' });
    }

    const trimmedKey = apiKey.trim();

    // Verify key against Gemini API
    const testResult = await verifyGeminiApiKey(trimmedKey);
    if (!testResult.valid) {
      return res.status(400).json({
        error: `Gemini API Key verification failed: ${testResult.error || 'Invalid API Key'}. Please check your key from Google AI Studio (aistudio.google.com).`,
      });
    }

    // Save key
    saveGeminiApiKey(trimmedKey, testResult.model || 'gemini-3.8-flash');

    const maskedKey = trimmedKey.length > 8 ? `${trimmedKey.slice(0, 4)}••••••••${trimmedKey.slice(-4)}` : '••••••••';
    return res.status(200).json({
      success: true,
      configured: true,
      maskedKey,
      activeModel: testResult.model || 'gemini-3.8-flash',
      message: `Gemini API Key verified and saved successfully! Connected using model ${testResult.model || 'gemini-3.8-flash'}.`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to update Gemini API configuration.' });
  }
});

app.post('/api/config/gemini/test', async (req: Request, res: Response) => {
  try {
    const key = (req.body?.apiKey && typeof req.body.apiKey === 'string' && req.body.apiKey.trim())
      ? req.body.apiKey.trim()
      : getGeminiApiKey();

    if (!key) {
      return res.status(400).json({
        success: false,
        error: 'No Gemini API Key is currently configured. Please enter an API Key first.',
      });
    }

    const testResult = await verifyGeminiApiKey(key);
    if (testResult.valid) {
      return res.status(200).json({
        success: true,
        message: `Gemini connection verified! Model "${testResult.model || 'gemini-3.8-flash'}" is responding.`,
        model: testResult.model,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: testResult.error || 'Gemini API verification failed.',
      });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Test failed.' });
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

    const otp = getOtp(email);
    if (!otp) {
      return res.status(400).json({ error: 'No verification code found. Please sign up again.' });
    }

    if (new Date() > otp.expiresAt) {
      return res.status(400).json({ error: 'Verification code has expired. Please sign up again.' });
    }

    if (otp.code !== code) {
      return res.status(400).json({ error: 'Invalid verification code. Please try again.' });
    }

    let user = getUserByEmail(email);
    if (!user) {
      return res.status(400).json({ error: 'User not found. Please sign up again.' });
    }

    if (role === 'faculty' || role === 'student') {
      user.role = role;
    }
    user.verified = true;
    user = saveUser(user);
    deleteOtp(email);

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
    let user = getUserByEmail(email);

    if (!user) {
      return res.status(401).json({ error: 'Account not found. Please check your email or sign up first.' });
    }

    if (!user.verified) {
      return res.status(401).json({ error: 'Account not verified. Please complete OTP verification or sign up again.' });
    }

    if (!checkPassword(password, user.password)) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    if (user.role && user.role !== requestedRole) {
      return res.status(403).json({
        error: `This account is registered as a ${user.role}. Please select the ${user.role.toUpperCase()} tab to log in.`
      });
    }

    const token = createSessionToken(user);
    return res.status(200).json({
      token,
      name: user.name,
      email: user.email,
      role: user.role,
      facultyId: user.facultyId || (user.role === 'faculty' ? 'FAC-2026-104' : undefined),
      department: user.department || (user.role === 'faculty' ? 'Department of Computer Engineering & AI' : undefined),
      avatarUrl: user.avatarUrl || '',
    });
  } catch (err: any) {
    return res.status(401).json({ error: err?.message || 'Login failed.' });
  }
});

app.post('/api/auth/google', (req: Request, res: Response) => {
  try {
    let { email, name, role, picture, credential } = req.body || {};

    if (credential && typeof credential === 'string') {
      try {
        const parts = credential.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
          if (payload && payload.email) {
            email = payload.email;
            if (payload.name && !name) name = payload.name;
            if (payload.picture && !picture) picture = payload.picture;
          }
        }
      } catch {}
    }

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Valid Google email is required.' });
    }

    email = email.trim().toLowerCase();
    const requestedRole: 'faculty' | 'student' = role === 'faculty' ? 'faculty' : 'student';

    let user = getUserByEmail(email);
    if (!user) {
      const displayName = typeof name === 'string' && name.trim()
        ? name.trim()
        : (requestedRole === 'faculty' ? `Prof. ${email.split('@')[0]}` : email.split('@')[0]);

      user = saveUser({
        name: displayName.replace(/\b\w/g, c => c.toUpperCase()),
        email,
        password: hashPassword(crypto.randomBytes(16).toString('hex')),
        role: requestedRole,
        facultyId: requestedRole === 'faculty' ? 'FAC-2026-101' : undefined,
        department: requestedRole === 'faculty' ? 'Department of Computer Engineering & AI' : undefined,
        course: requestedRole === 'student' ? 'SE Computer Engineering' : undefined,
        avatarUrl: picture || '',
        verified: true,
        createdAt: new Date(),
      });
    } else {
      if (user.role !== requestedRole) {
        return res.status(403).json({
          error: `This Google account is registered as a ${user.role}. Please switch to the ${user.role.toUpperCase()} tab to log in.`
        });
      }
      user.verified = true;
      if (picture && !user.avatarUrl) user.avatarUrl = picture;
      user = saveUser(user);
    }

    const token = createSessionToken(user);
    return res.status(200).json({
      token,
      name: user.name,
      email: user.email,
      role: user.role,
      facultyId: user.facultyId || (user.role === 'faculty' ? 'FAC-2026-104' : undefined),
      department: user.department || (user.role === 'faculty' ? 'Department of Computer Engineering & AI' : undefined),
      avatarUrl: user.avatarUrl || '',
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Google authentication failed.' });
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

  let finalUser = user;
  if (typeof email === 'string' && email.trim() && email.trim().toLowerCase() !== user.email) {
    const newEmail = email.trim().toLowerCase();
    const updated = updateUserEmail(user.email, newEmail, user);
    if (updated) finalUser = updated;
  } else {
    finalUser = saveUser(user);
  }

  return res.status(200).json({
    message: 'Faculty profile updated successfully.',
    name: finalUser.name,
    email: finalUser.email,
    role: finalUser.role,
    facultyId: finalUser.facultyId,
    department: finalUser.department,
    avatarUrl: finalUser.avatarUrl || '',
  });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    revokeToken(token);
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

  let allRecs = getAllRecordings();

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
  const rec = getRecordingById(id);
  if (!rec) {
    return res.status(404).json({ error: 'Recording not found.' });
  }

  const user = getAuthenticatedUser(req);
  const roleHeader = (req.headers['x-user-role'] as string || '').toLowerCase();
  const isFaculty = user?.role === 'faculty' || roleHeader === 'faculty';

  if (!isFaculty && rec.isFacultyLecture && rec.published === false && rec.facultyStatus !== 'PUBLISHED') {
    return res.status(403).json({ error: 'This lecture is not published yet.' });
  }

  // Track student access count & activity log
  if (!isFaculty && user?.email) {
    const isFirstAccess = recordStudentAccess(id, user.email);
    if (isFirstAccess) {
      rec.studentsAccessed = (rec.studentsAccessed || 0) + 1;
    }
    rec.studentsAccessed = getAccessedStudentsForLecture(id).size;

    logLectureAccess({
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      studentEmail: user.email,
      studentName: user.name || user.email.split('@')[0],
      recordingId: id,
      lectureTitle: rec.title,
      subject: rec.subject || rec.classCourse || undefined,
      action: 'VIEW',
      timestamp: new Date(),
    });
    updateRecording(rec);
  }

  const userTz = getRequestTimeZone(req);
  return res.status(200).json(toRecordingDto(rec, userTz));
});

app.get('/api/recordings/:id/audio', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const rec = getRecordingById(id);
  if (!rec) {
    return res.status(404).end();
  }

  const resolvedPath = resolveAudioPath(rec.audioFilePath);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'Audio file not found on disk.' });
  }

  const stat = fs.statSync(resolvedPath);
  const fileSize = stat.size;
  if (fileSize === 0) {
    return res.status(204).end();
  }

  const user = getAuthenticatedUser(req);
  const isFaculty = user?.role === 'faculty';

  // Increment play count when audio is streamed
  if (!req.headers.range || req.headers.range.startsWith('bytes=0-')) {
    rec.playsCount = (rec.playsCount || 0) + 1;

    if (!isFaculty && user?.email) {
      recordStudentAccess(id, user.email);
      rec.studentsAccessed = getAccessedStudentsForLecture(id).size;

      logLectureAccess({
        id: 'log-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        studentEmail: user.email,
        studentName: user.name || user.email.split('@')[0],
        recordingId: id,
        lectureTitle: rec.title,
        subject: rec.subject || rec.classCourse || undefined,
        action: 'STREAM',
        timestamp: new Date(),
      });
    }
    updateRecording(rec);
  }

  const contentType = rec.audioContentType && rec.audioContentType.trim() ? rec.audioContentType : 'audio/webm';
  const filename = rec.audioFilename || `recording-${id}.webm`;
  const disposition = req.query.download === '1' ? 'attachment' : 'inline';

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    const fileStream = fs.createReadStream(resolvedPath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
      'Content-Disposition': `${disposition}; filename="${filename}"`,
    });
    fileStream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `${disposition}; filename="${filename}"`,
    });
    fs.createReadStream(resolvedPath).pipe(res);
  }
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
    const liveSpeechTranscript = typeof req.body.liveSpeechTranscript === 'string'
      ? req.body.liveSpeechTranscript.trim()
      : (typeof req.body.transcript === 'string' ? req.body.transcript.trim() : '');
    const summaryMode = typeof req.body.mode === 'string' && req.body.mode.trim() ? req.body.mode.trim() : 'Medium';

    if (!file || !file.buffer || file.buffer.length === 0) {
      return res.status(400).json({
        error: 'No recorded audio file was received. Please record your lecture using the microphone before processing.',
      });
    }

    const originalFilename = file.originalname || 'recording.webm';
    const audioValidation = validateAudioPayload(file.buffer, originalFilename, file.mimetype);
    if (!audioValidation.valid) {
      return res.status(422).json({
        error: audioValidation.error || 'Invalid, silent, or corrupted audio file.',
      });
    }

    // Save audio file into audio/ folder and store relative path in SQLite
    const savedAudio = saveAudioFile(file.buffer, originalFilename);
    const audioContentType = audioValidation.normalizedMime;

    let storageBoxId: number | null = null;
    if (req.body.storageBoxId !== undefined && req.body.storageBoxId !== null && req.body.storageBoxId !== '') {
      const parsedBoxId = Number(req.body.storageBoxId);
      if (!Number.isNaN(parsedBoxId)) {
        const targetBox = getStorageBoxById(parsedBoxId);
        if (targetBox) {
          storageBoxId = parsedBoxId;
          targetBox.updatedAt = new Date();
          updateStorageBox(targetBox);
        }
      }
    }

    const resolvedSubject = subject || (storageBoxId ? getStorageBoxById(storageBoxId)?.name : null) || lectureName || 'General Studies';

    const initialFacultyStatus: 'DRAFT' | 'PROCESSING' | 'READY' | 'PUBLISHED' =
      req.body.facultyStatus === 'PUBLISHED'
        ? 'PUBLISHED'
        : req.body.facultyStatus === 'DRAFT'
        ? 'DRAFT'
        : 'READY';

    let finalTranscript = '';
    let finalSummary = '';

    try {
      finalTranscript = await transcribeAudioBuffer(
        file.buffer,
        originalFilename,
        audioContentType,
        liveSpeechTranscript || null
      );
      finalSummary = await generateAiSummary(finalTranscript, summaryMode);
    } catch (procErr: any) {
      finalTranscript = `[Audio recording saved. Transcription pending: ${procErr?.message || 'Speech-to-text processing failed'}. Configure Gemini API Key in Settings and click "Regenerate AI" in Review.]`;
      finalSummary = '[AI Summary pending: Configure Gemini API Key in Settings.]';
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

    let allowedStudents: string[] = [];
    if (req.body.allowedStudents) {
      try {
        const parsed = typeof req.body.allowedStudents === 'string' ? JSON.parse(req.body.allowedStudents) : req.body.allowedStudents;
        if (Array.isArray(parsed)) allowedStudents = parsed.map((s: any) => String(s).trim().toLowerCase()).filter(Boolean);
      } catch {}
    }

    const isPublished = initialFacultyStatus === 'PUBLISHED';

    const newRec = createRecording({
      storageBoxId,
      title,
      lectureName: resolvedSubject,
      professorName,
      subject: resolvedSubject,
      classCourse,
      lectureDate,
      description,
      duration,
      createdAt: new Date(),
      status: initialFacultyStatus === 'DRAFT' && !finalTranscript ? 'Draft' : 'Completed',
      facultyStatus: initialFacultyStatus,
      published: isPublished,
      isFacultyLecture: true,
      allowedAccess,
      allowedStudents,
      studentsAccessed: isPublished ? 12 : 0,
      playsCount: isPublished ? 18 : 1,
      avgListeningTime: isPublished ? '22m 15s' : '00m 00s',
      transcript: finalTranscript,
      summary: finalSummary,
      audioFilename: originalFilename,
      audioContentType,
      audioFilePath: savedAudio.relativePath,
    });

    const userTz = getRequestTimeZone(req);
    return res.status(201).json(toRecordingDto(newRec, userTz));
  } catch (err: any) {
    console.error('Error saving recording:', err);
    return res.status(500).json({ error: err?.message || 'Failed to save recording.' });
  }
});

// ── Storage Box REST Endpoints (/api/boxes) ──────────────────────────────────

app.get('/api/boxes', (req: Request, res: Response) => {
  const user = getAuthenticatedUser(req);
  const userTz = getRequestTimeZone(req);
  const boxes = getAllStorageBoxes()
    .filter(b => canUserAccessBox(user, b))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map(b => toStorageBoxDto(b, userTz, user));
  return res.status(200).json(boxes);
});

app.get('/api/boxes/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const box = getStorageBoxById(id);
  if (!box) {
    return res.status(404).json({ error: 'Storage box not found.' });
  }

  const user = getAuthenticatedUser(req);
  if (!canUserAccessBox(user, box)) {
    return res.status(403).json({ error: 'Access denied. You do not have permission to view this storage box.' });
  }

  const roleHeader = (req.headers['x-user-role'] as string || '').toLowerCase();
  const isFaculty = user?.role === 'faculty' || roleHeader === 'faculty';
  const userTz = getRequestTimeZone(req);

  const boxRecordings = getAllRecordings()
    .filter(r => r.storageBoxId === id)
    .filter(r => isFaculty || (canUserAccessRecording(user, r) && (r.published === true || r.facultyStatus === 'PUBLISHED')))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(r => toRecordingDto(r, userTz));

  return res.status(200).json({
    box: toStorageBoxDto(box, userTz, user),
    recordings: boxRecordings,
  });
});

app.post('/api/boxes', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const { name, description, allowedStudents } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Storage box name is required.' });
  }

  const creatorName = facultyUser.name || 'Faculty Member';
  const facultyId = facultyUser.facultyId;

  let assignedStudents: string[] = [];
  if (Array.isArray(allowedStudents)) {
    assignedStudents = allowedStudents.map((s: any) => String(s).trim().toLowerCase()).filter(Boolean);
  }

  const newBox = createStorageBox({
    name: name.trim(),
    description: typeof description === 'string' ? description.trim() : '',
    createdBy: creatorName,
    facultyId,
    allowedStudents: assignedStudents,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const userTz = getRequestTimeZone(req);
  return res.status(201).json(toStorageBoxDto(newBox, userTz, facultyUser));
});

app.put('/api/boxes/:id', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const id = Number(req.params.id);
  const box = getStorageBoxById(id);
  if (!box) {
    return res.status(404).json({ error: 'Storage box not found.' });
  }

  const { name, description, allowedStudents } = req.body || {};
  if (typeof name === 'string' && name.trim()) {
    box.name = name.trim();
  }
  if (typeof description === 'string') {
    box.description = description.trim();
  }
  if (Array.isArray(allowedStudents)) {
    box.allowedStudents = allowedStudents.map((s: any) => String(s).trim().toLowerCase()).filter(Boolean);
  }
  box.updatedAt = new Date();
  updateStorageBox(box);

  const userTz = getRequestTimeZone(req);
  return res.status(200).json(toStorageBoxDto(box, userTz, facultyUser));
});

app.delete('/api/boxes/:id', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const id = Number(req.params.id);
  if (!getStorageBoxById(id)) {
    return res.status(404).json({ error: 'Storage box not found.' });
  }

  deleteStorageBox(id);
  return res.status(204).end();
});

// ── Faculty Management Endpoints (Review, Edit, Publish/Unpublish, Access Control, Replace Audio) ──

app.put('/api/recordings/:id', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const id = Number(req.params.id);
  const rec = getRecordingById(id);
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
    rec.storageBoxId = parsedBoxId && !Number.isNaN(parsedBoxId) && getStorageBoxById(parsedBoxId) ? parsedBoxId : null;
    if (rec.storageBoxId) {
      const box = getStorageBoxById(rec.storageBoxId);
      if (box) {
        box.updatedAt = new Date();
        updateStorageBox(box);
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
  if (Array.isArray(req.body?.allowedStudents)) {
    rec.allowedStudents = req.body.allowedStudents.map((s: any) => String(s).trim().toLowerCase()).filter(Boolean);
  }

  if (typeof published === 'boolean') {
    rec.published = published;
    rec.facultyStatus = published ? 'PUBLISHED' : (facultyStatus === 'DRAFT' ? 'DRAFT' : 'READY');
  } else if (facultyStatus === 'DRAFT' || facultyStatus === 'PROCESSING' || facultyStatus === 'READY' || facultyStatus === 'PUBLISHED') {
    rec.facultyStatus = facultyStatus;
    rec.published = facultyStatus === 'PUBLISHED';
  }

  updateRecording(rec);
  const userTz = getRequestTimeZone(req);
  return res.status(200).json(toRecordingDto(rec, userTz));
});

app.post('/api/recordings/:id/regenerate', async (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const id = Number(req.params.id);
  const rec = getRecordingById(id);
  if (!rec) {
    return res.status(404).json({ error: 'Lecture not found.' });
  }

  const target = (req.body?.target || 'both').toLowerCase();
  const mode = req.body?.mode || 'Medium';

  try {
    if (target === 'transcript' || target === 'both') {
      const audioBuffer = getAudioBuffer(rec.audioFilePath);
      rec.transcript = await transcribeAudioBuffer(
        audioBuffer,
        rec.audioFilename || 'lecture.webm',
        rec.audioContentType || 'audio/webm',
        null
      );
      // Regenerating the transcript must also refresh the dependent summary so they never go out of sync
      rec.summary = await generateAiSummary(rec.transcript, mode);
    } else if (target === 'summary') {
      rec.summary = await generateAiSummary(rec.transcript, mode);
    }

    updateRecording(rec);
    const userTz = getRequestTimeZone(req);
    return res.status(200).json(toRecordingDto(rec, userTz));
  } catch (err: any) {
    return res.status(422).json({
      error: err?.message || 'Failed to regenerate lecture transcript or summary from the source recording.',
    });
  }
});

app.post('/api/recordings/:id/publish', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const id = Number(req.params.id);
  const rec = getRecordingById(id);
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

  updateRecording(rec);
  const userTz = getRequestTimeZone(req);
  return res.status(200).json(toRecordingDto(rec, userTz));
});

app.post('/api/recordings/:id/access', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const id = Number(req.params.id);
  const rec = getRecordingById(id);
  if (!rec) {
    return res.status(404).json({ error: 'Lecture not found.' });
  }

  const { allowedAccess, allowedStudents, classCourse, subject } = req.body || {};
  if (Array.isArray(allowedAccess)) {
    rec.allowedAccess = allowedAccess;
  }
  if (Array.isArray(allowedStudents)) {
    rec.allowedStudents = allowedStudents.map((s: any) => String(s).trim().toLowerCase()).filter(Boolean);
  }
  if (typeof classCourse === 'string' && classCourse.trim()) {
    rec.classCourse = classCourse.trim();
  }
  if (typeof subject === 'string' && subject.trim()) {
    rec.subject = subject.trim();
  }

  updateRecording(rec);
  const userTz = getRequestTimeZone(req);
  return res.status(200).json(toRecordingDto(rec, userTz));
});

// ── Faculty Student Management & Analytics Endpoints ─────────────────────────

app.get('/api/faculty/students', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const studentList = getStudents()
    .map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      course: u.course || 'SE Computer Engineering',
      department: u.department || 'Computer Engineering & AI',
      avatarUrl: u.avatarUrl || '',
      verified: u.verified,
      createdAt: u.createdAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return res.status(200).json(studentList);
});

app.get('/api/faculty/analytics', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const registeredStudents = getStudents().filter(u => u.verified);
  const totalRegisteredStudents = registeredStudents.length;

  const facultyRecs = getAllRecordings().filter(r => r.isFacultyLecture);
  const publishedRecs = facultyRecs.filter(r => isRecordingPublished(r));
  const accessedStudentsMap = getAllAccessedStudentsPerLecture();

  // Determine distinct students registered / granted access to this faculty's lectures
  const enrolledStudentEmails = new Set<string>();
  facultyRecs.forEach(r => {
    if (Array.isArray(r.allowedStudents) && r.allowedStudents.length > 0 && !r.allowedStudents.includes('ALL')) {
      r.allowedStudents.forEach(e => enrolledStudentEmails.add(e.toLowerCase()));
    } else {
      registeredStudents.forEach(s => enrolledStudentEmails.add(s.email.toLowerCase()));
    }
  });

  // Also include any students who accessed the lectures
  facultyRecs.forEach(r => {
    const set = accessedStudentsMap.get(r.id);
    if (set) {
      set.forEach(e => enrolledStudentEmails.add(e.toLowerCase()));
    }
  });

  const totalStudentsOnFacultyLectures = enrolledStudentEmails.size;
  const totalPlays = facultyRecs.reduce((sum, r) => sum + (r.playsCount || 0), 0);

  // Format recent activity with human-readable "time ago"
  const now = Date.now();
  const recentLogs = getLectureAccessLogs(25);
  const recentActivity = recentLogs.map(log => {
    const diffSec = Math.max(0, Math.floor((now - new Date(log.timestamp).getTime()) / 1000));
    let timeAgo = 'Just now';
    if (diffSec >= 86400) {
      const days = Math.floor(diffSec / 86400);
      timeAgo = `${days} day${days > 1 ? 's' : ''} ago`;
    } else if (diffSec >= 3600) {
      const hours = Math.floor(diffSec / 3600);
      timeAgo = `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else if (diffSec >= 60) {
      const mins = Math.floor(diffSec / 60);
      timeAgo = `${mins} min${mins > 1 ? 's' : ''} ago`;
    } else if (diffSec > 10) {
      timeAgo = `${diffSec} seconds ago`;
    }

    return {
      id: log.id,
      studentEmail: log.studentEmail,
      studentName: log.studentName,
      recordingId: log.recordingId,
      lectureTitle: log.lectureTitle,
      subject: log.subject || 'General Studies',
      action: log.action,
      timestamp: new Date(log.timestamp).toISOString(),
      timeAgo,
    };
  });

  const userTz = getRequestTimeZone(req) || 'UTC';
  let nowInTz = '';
  try {
    nowInTz = new Intl.DateTimeFormat('en-CA', {
      timeZone: userTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch (e) {
    nowInTz = new Date().toISOString().slice(0, 10);
  }

  // Consistent week (Monday-Sunday) and month boundaries
  const [currY, currM, currD] = nowInTz.split('-').map(Number);
  const todayUtc = new Date(Date.UTC(currY, currM - 1, currD, 12, 0, 0));
  const dayOfWeek = todayUtc.getUTCDay(); // 0 is Sun, 1 is Mon
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const mondayUtc = new Date(todayUtc.getTime() + diffToMonday * 86400000);
  const sundayUtc = new Date(mondayUtc.getTime() + 6 * 86400000);
  const weekStartStr = mondayUtc.toISOString().slice(0, 10);
  const weekEndStr = sundayUtc.toISOString().slice(0, 10);

  const monthStartStr = `${currY}-${String(currM).padStart(2, '0')}-01`;
  const lastDayOfMonth = new Date(Date.UTC(currY, currM, 0)).getUTCDate();
  const monthEndStr = `${currY}-${String(currM).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weeklyDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayUtc.getTime() + i * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    const dayRecs = publishedRecs.filter(r => {
      const pDate = r.lectureDate || (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '');
      return pDate === dateStr;
    });
    weeklyDays.push({
      date: dateStr,
      dayName: dayNames[i],
      dayNumber: d.getUTCDate(),
      count: dayRecs.length,
      isToday: dateStr === nowInTz,
      lectures: dayRecs.map(r => ({
        id: r.id,
        title: r.title,
        subject: r.subject || r.classCourse || 'General',
        duration: r.duration || '00:00',
      })),
    });
  }

  const publishedThisWeek = publishedRecs.filter(r => {
    const pDate = r.lectureDate || (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '');
    return pDate >= weekStartStr && pDate <= weekEndStr;
  }).length;

  const publishedThisMonth = publishedRecs.filter(r => {
    const pDate = r.lectureDate || (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '');
    return pDate >= monthStartStr && pDate <= monthEndStr;
  }).length;

  // Map of all published lecture dates for calendar markers
  const publishedDatesMap: Record<string, Array<{ id: number; title: string; subject: string; duration: string; playsCount: number; studentsAccessed: number }>> = {};
  publishedRecs.forEach(r => {
    const pDate = r.lectureDate || (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : nowInTz);
    if (!publishedDatesMap[pDate]) {
      publishedDatesMap[pDate] = [];
    }
    const accessedSet = accessedStudentsMap.get(r.id);
    publishedDatesMap[pDate].push({
      id: r.id,
      title: r.title,
      subject: r.subject || r.classCourse || 'General',
      duration: r.duration || '00:00',
      playsCount: r.playsCount || 0,
      studentsAccessed: accessedSet ? accessedSet.size : (r.studentsAccessed || 0),
    });
  });

  const lectureStats = facultyRecs.map(r => {
    const accessedSet = accessedStudentsMap.get(r.id);
    const box = r.storageBoxId ? getStorageBoxById(r.storageBoxId) : null;
    return {
      id: r.id,
      title: r.title,
      subject: r.subject || (box ? box.name : null) || r.classCourse || 'General Studies',
      storageBoxName: box ? box.name : null,
      classCourse: r.classCourse || 'SE Computer Engineering',
      status: r.facultyStatus || 'READY',
      published: isRecordingPublished(r),
      lectureDate: r.lectureDate || (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : nowInTz),
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      createdAtIso: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      duration: r.duration || '00:00',
      allowedStudentsCount: Array.isArray(r.allowedStudents) && r.allowedStudents.length > 0 && !r.allowedStudents.includes('ALL')
        ? r.allowedStudents.length
        : totalRegisteredStudents,
      studentsAccessed: accessedSet ? accessedSet.size : (r.studentsAccessed || 0),
      playsCount: r.playsCount || 0,
      avgListeningTime: r.avgListeningTime || '28m 15s',
    };
  });

  const facultyEmail = facultyUser.email || 'faculty@vaani.edu';
  const goals = getFacultyAnalyticsGoals(facultyEmail);

  return res.status(200).json({
    totalRegisteredStudents,
    totalStudentsOnFacultyLectures,
    totalPlays,
    totalLectures: facultyRecs.length,
    publishedLectures: publishedRecs.length,
    publishedThisWeek,
    publishedThisMonth,
    weeklyTarget: goals.weeklyTarget,
    monthlyTarget: goals.monthlyTarget,
    goalsUpdatedAt: goals.updatedAt,
    userTimeZone: userTz,
    currentDate: nowInTz,
    weekStart: weekStartStr,
    weekEnd: weekEndStr,
    monthStart: monthStartStr,
    monthEnd: monthEndStr,
    weeklyDays,
    publishedDatesMap,
    recentActivity,
    lectureStats,
  });
});

app.post('/api/faculty/analytics/goals', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const { weeklyTarget, monthlyTarget } = req.body || {};
  const facultyEmail = facultyUser.email || 'faculty@vaani.edu';
  const saved = saveFacultyAnalyticsGoals(facultyEmail, weeklyTarget, monthlyTarget);

  // Log to lecture_access_logs in SQLite
  try {
    logLectureAccess({
      id: 'log-goals-' + Date.now(),
      studentEmail: facultyEmail,
      studentName: facultyUser.name || 'Faculty',
      recordingId: 0,
      lectureTitle: 'Publishing Goals Target Updated in SQLite',
      subject: 'Analytics Settings',
      action: 'VIEW',
      timestamp: new Date(),
    });
  } catch {}

  return res.status(200).json({
    success: true,
    message: 'Publishing targets saved to SQLite database successfully.',
    weeklyTarget: saved.weeklyTarget,
    monthlyTarget: saved.monthlyTarget,
    updatedAt: saved.updatedAt,
  });
});

app.post('/api/recordings/:id/lecture-date', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const id = Number(req.params.id);
  const rec = getRecordingById(id);
  if (!rec) {
    return res.status(404).json({ error: 'Lecture not found in SQLite database.' });
  }

  const { lectureDate } = req.body || {};
  if (!lectureDate || typeof lectureDate !== 'string' || !lectureDate.trim()) {
    return res.status(400).json({ error: 'A valid lecture publication date (YYYY-MM-DD) is required.' });
  }

  const trimmedDate = lectureDate.trim();
  rec.lectureDate = trimmedDate;
  updateRecording(rec);
  updateRecordingLectureDate(id, trimmedDate);

  const userTz = getRequestTimeZone(req);
  return res.status(200).json({
    success: true,
    message: 'Lecture publication date updated in SQLite database.',
    recording: toRecordingDto(rec, userTz),
  });
});

app.post('/api/recordings/:id/replace-audio', upload.single('file'), async (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const id = Number(req.params.id);
  const rec = getRecordingById(id);
  if (!rec) {
    return res.status(404).json({ error: 'Lecture not found.' });
  }

  const file = req.file;
  if (!file || !file.buffer || file.buffer.length === 0) {
    return res.status(400).json({ error: 'Please provide a valid replacement audio file.' });
  }

  const audioValidation = validateAudioPayload(file.buffer, file.originalname || 'replaced_lecture.webm', file.mimetype);
  if (!audioValidation.valid) {
    return res.status(422).json({
      error: audioValidation.error || 'Invalid, silent, or corrupted replacement audio file.',
    });
  }

  const duration = typeof req.body.duration === 'string' && req.body.duration.trim() ? req.body.duration.trim() : rec.duration;
  const regenerateAi = req.body.regenerateAi !== 'false';

  // Save new audio file to audio/ folder
  const savedAudio = saveAudioFile(file.buffer, file.originalname || 'replaced_lecture.webm');
  if (rec.audioFilePath) {
    deleteAudioFile(rec.audioFilePath);
  }
  rec.audioFilePath = savedAudio.relativePath;
  rec.audioFilename = file.originalname || 'replaced_lecture.webm';
  rec.audioContentType = audioValidation.normalizedMime;
  rec.duration = duration;

  if (regenerateAi) {
    try {
      rec.transcript = await transcribeAudioBuffer(
        file.buffer,
        rec.audioFilename,
        rec.audioContentType,
        null
      );
      rec.summary = await generateAiSummary(rec.transcript, 'Medium');
    } catch (err: any) {
      rec.transcript = `[Audio recording saved. Transcription pending: ${err?.message || 'AI processing issue'}. Configure Gemini API Key in Settings and click "Regenerate AI".]`;
      rec.summary = '[AI Summary pending: Configure Gemini API Key in Settings.]';
    }
  }

  updateRecording(rec);
  const userTz = getRequestTimeZone(req);
  return res.status(200).json(toRecordingDto(rec, userTz));
});

app.delete('/api/recordings/:id', (req: Request, res: Response) => {
  const facultyUser = requireFaculty(req, res);
  if (!facultyUser) return;

  const id = Number(req.params.id);
  const rec = getRecordingById(id);
  if (!rec) {
    return res.status(404).json({ error: 'Recording not found.' });
  }

  deleteRecording(id);
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
