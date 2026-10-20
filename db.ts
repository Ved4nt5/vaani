import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Directory Paths ──────────────────────────────────────────────────────────
export const AUDIO_DIR = path.join(__dirname, 'audio');
export const DB_PATH = path.join(__dirname, 'vaani.db');

// Ensure audio folder exists
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

// ── Initialize SQLite Database ───────────────────────────────────────────────
let dbInstance: Database.Database;
try {
  dbInstance = new Database(DB_PATH);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  dbInstance.pragma('synchronous = NORMAL');
  dbInstance.prepare('SELECT 1').get();
} catch (err: any) {
  console.warn('[SQLite] Database corruption or error detected, recreating database:', err?.message);
  try {
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal');
    if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm');
  } catch (e) {
    console.error('Failed to clean up malformed DB files:', e);
  }
  dbInstance = new Database(DB_PATH);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  dbInstance.pragma('synchronous = NORMAL');
}

export const db = dbInstance;

// ── Models & Interfaces ──────────────────────────────────────────────────────

export interface User {
  id: number;
  name: string;
  email: string;
  password: string; // SHA-256 hashed password
  role: 'faculty' | 'student';
  facultyId?: string;
  department?: string;
  avatarUrl?: string;
  course?: string;
  summaryMode?: string;
  verified: boolean;
  createdAt: Date;
}

export interface Otp {
  id: number;
  email: string;
  code: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface StorageBox {
  id: number;
  name: string;
  description: string;
  createdBy: string;
  facultyId?: string;
  allowedStudents?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Recording {
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
  allowedStudents?: string[];
  studentsAccessed?: number;
  playsCount?: number;
  totalListeningSeconds?: number;
  avgListeningTime?: string;
  transcript: string;
  summary: string;
  audioFilename: string | null;
  audioContentType: string | null;
  audioFilePath: string | null;
}

export interface LectureAccessLog {
  id: string;
  studentEmail: string;
  studentName: string;
  recordingId: number;
  lectureTitle: string;
  subject?: string;
  action: 'STREAM' | 'VIEW';
  timestamp: Date;
}

// ── Schema Initialization ───────────────────────────────────────────────────

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('faculty', 'student')),
      faculty_id TEXT,
      department TEXT,
      avatar_url TEXT,
      course TEXT,
      summary_mode TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      code TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL COLLATE NOCASE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS revoked_tokens (
      token TEXT PRIMARY KEY,
      revoked_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS storage_boxes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_by TEXT NOT NULL,
      faculty_id TEXT,
      allowed_students TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storage_box_id INTEGER,
      title TEXT NOT NULL,
      lecture_name TEXT,
      professor_name TEXT,
      subject TEXT,
      class_course TEXT,
      lecture_date TEXT,
      description TEXT,
      duration TEXT,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      faculty_status TEXT,
      published INTEGER NOT NULL DEFAULT 0,
      is_faculty_lecture INTEGER NOT NULL DEFAULT 1,
      allowed_access TEXT,
      allowed_students TEXT,
      students_accessed INTEGER DEFAULT 0,
      plays_count INTEGER DEFAULT 0,
      total_listening_seconds INTEGER DEFAULT 0,
      avg_listening_time TEXT,
      transcript TEXT,
      summary TEXT,
      audio_filename TEXT,
      audio_content_type TEXT,
      audio_file_path TEXT,
      FOREIGN KEY (storage_box_id) REFERENCES storage_boxes(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS accessed_students_per_lecture (
      recording_id INTEGER NOT NULL,
      student_email TEXT NOT NULL COLLATE NOCASE,
      PRIMARY KEY (recording_id, student_email)
    );

    CREATE TABLE IF NOT EXISTS lecture_access_logs (
      id TEXT PRIMARY KEY,
      student_email TEXT NOT NULL,
      student_name TEXT NOT NULL,
      recording_id INTEGER NOT NULL,
      lecture_title TEXT NOT NULL,
      subject TEXT,
      action TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS faculty_analytics_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      faculty_email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      weekly_target INTEGER NOT NULL DEFAULT 3,
      monthly_target INTEGER NOT NULL DEFAULT 6,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_recordings_box ON recordings(storage_box_id);
    CREATE INDEX IF NOT EXISTS idx_access_logs_recording ON lecture_access_logs(recording_id);
  `);
}

// Ensure schema is prepared immediately
initializeDatabase();

export interface FacultyAnalyticsGoals {
  weeklyTarget: number;
  monthlyTarget: number;
  updatedAt: string;
}

export function getFacultyAnalyticsGoals(facultyEmail: string = 'faculty@vaani.edu'): FacultyAnalyticsGoals {
  try {
    const row = db.prepare('SELECT weekly_target, monthly_target, updated_at FROM faculty_analytics_goals WHERE faculty_email = ? COLLATE NOCASE').get(facultyEmail) as any;
    if (row) {
      return {
        weeklyTarget: Number(row.weekly_target) || 3,
        monthlyTarget: Number(row.monthly_target) || 6,
        updatedAt: row.updated_at,
      };
    }
    const wk = getSystemSetting('analytics_weekly_goal');
    const mo = getSystemSetting('analytics_monthly_goal');
    return {
      weeklyTarget: wk ? Number(wk) : 3,
      monthlyTarget: mo ? Number(mo) : 6,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return { weeklyTarget: 3, monthlyTarget: 6, updatedAt: new Date().toISOString() };
  }
}

export function saveFacultyAnalyticsGoals(
  facultyEmail: string = 'faculty@vaani.edu',
  weeklyTarget: number,
  monthlyTarget: number
): FacultyAnalyticsGoals {
  const now = new Date().toISOString();
  const safeWeekly = Math.max(1, Math.min(50, Math.round(Number(weeklyTarget) || 3)));
  const safeMonthly = Math.max(1, Math.min(200, Math.round(Number(monthlyTarget) || 6)));

  try {
    db.prepare(`
      INSERT INTO faculty_analytics_goals (faculty_email, weekly_target, monthly_target, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(faculty_email) DO UPDATE SET
        weekly_target = excluded.weekly_target,
        monthly_target = excluded.monthly_target,
        updated_at = excluded.updated_at
    `).run(facultyEmail, safeWeekly, safeMonthly, now);

    setSystemSetting('analytics_weekly_goal', String(safeWeekly));
    setSystemSetting('analytics_monthly_goal', String(safeMonthly));
  } catch (e) {
    console.error('[DB] saveFacultyAnalyticsGoals error:', e);
  }

  return {
    weeklyTarget: safeWeekly,
    monthlyTarget: safeMonthly,
    updatedAt: now,
  };
}

export function updateRecordingLectureDate(id: number, lectureDate: string): boolean {
  try {
    const trimmed = (lectureDate || '').trim();
    if (!trimmed) return false;
    db.prepare('UPDATE recordings SET lecture_date = ? WHERE id = ?').run(trimmed, id);
    return true;
  } catch {
    return false;
  }
}

export function getSystemSetting(key: string): string | null {
  try {
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : null;
  } catch {
    return null;
  }
}

export function setSystemSetting(key: string, value: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, now);
}

// ── Audio File Management ───────────────────────────────────────────────────

export function resolveAudioPath(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(__dirname, filePath);
}

export function saveAudioFile(
  buffer: Buffer,
  originalFilename: string
): { relativePath: string; absolutePath: string; filename: string } {
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
  }

  // Sanitize filename and make unique
  const ext = path.extname(originalFilename) || '.webm';
  const base = path.basename(originalFilename, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
  const uniqueName = `${base}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  const absolutePath = path.join(AUDIO_DIR, uniqueName);
  const relativePath = path.join('audio', uniqueName).replace(/\\/g, '/');

  fs.writeFileSync(absolutePath, buffer);
  return { relativePath, absolutePath, filename: uniqueName };
}

export function deleteAudioFile(filePath: string | null | undefined) {
  if (!filePath) return;
  const absPath = resolveAudioPath(filePath);
  if (absPath && fs.existsSync(absPath)) {
    try {
      fs.unlinkSync(absPath);
    } catch (e) {
      console.error(`Failed to delete audio file at ${absPath}:`, e);
    }
  }
}

export function getAudioBuffer(filePath: string | null | undefined): Buffer | null {
  if (!filePath) return null;
  const absPath = resolveAudioPath(filePath);
  if (absPath && fs.existsSync(absPath)) {
    try {
      return fs.readFileSync(absPath);
    } catch (e) {
      console.error(`Failed to read audio file at ${absPath}:`, e);
      return null;
    }
  }
  return null;
}

// ── Password Helper ─────────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password, 'utf8').digest('hex');
}

export function checkPassword(rawPassword: string, hashedPassword: string): boolean {
  return hashPassword(rawPassword) === hashedPassword;
}

// ── User Repository ─────────────────────────────────────────────────────────

function rowToUser(row: any): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    password: row.password,
    role: row.role,
    facultyId: row.faculty_id || undefined,
    department: row.department || undefined,
    avatarUrl: row.avatar_url || undefined,
    course: row.course || undefined,
    summaryMode: row.summary_mode || undefined,
    verified: Boolean(row.verified),
    createdAt: new Date(row.created_at),
  };
}

export function getUserByEmail(email: string): User | null {
  if (!email) return null;
  const stmt = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE');
  const row = stmt.get(email.trim().toLowerCase());
  return row ? rowToUser(row) : null;
}

export function getUserById(id: number): User | null {
  const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
  const row = stmt.get(id);
  return row ? rowToUser(row) : null;
}

export function getAllUsers(): User[] {
  const stmt = db.prepare('SELECT * FROM users ORDER BY id ASC');
  const rows = stmt.all();
  return rows.map(rowToUser);
}

export function getStudents(): User[] {
  const stmt = db.prepare("SELECT * FROM users WHERE role = 'student' ORDER BY name ASC");
  const rows = stmt.all();
  return rows.map(rowToUser);
}

export function saveUser(user: {
  id?: number;
  name: string;
  email: string;
  password?: string;
  role: 'faculty' | 'student';
  facultyId?: string;
  department?: string;
  avatarUrl?: string;
  course?: string;
  summaryMode?: string;
  verified?: boolean;
  createdAt?: Date;
}): User {
  const email = user.email.trim().toLowerCase();
  const existing = getUserByEmail(email);

  if (existing) {
    const updatedName = user.name !== undefined ? user.name : existing.name;
    const updatedPassword = user.password !== undefined ? user.password : existing.password;
    const updatedRole = user.role !== undefined ? user.role : existing.role;
    const updatedFacultyId = user.facultyId !== undefined ? user.facultyId : existing.facultyId;
    const updatedDepartment = user.department !== undefined ? user.department : existing.department;
    const updatedAvatarUrl = user.avatarUrl !== undefined ? user.avatarUrl : existing.avatarUrl;
    const updatedCourse = user.course !== undefined ? user.course : existing.course;
    const updatedSummaryMode = user.summaryMode !== undefined ? user.summaryMode : existing.summaryMode;
    const updatedVerified = user.verified !== undefined ? (user.verified ? 1 : 0) : (existing.verified ? 1 : 0);

    const stmt = db.prepare(`
      UPDATE users SET
        name = ?,
        password = ?,
        role = ?,
        faculty_id = ?,
        department = ?,
        avatar_url = ?,
        course = ?,
        summary_mode = ?,
        verified = ?
      WHERE id = ?
    `);

    stmt.run(
      updatedName,
      updatedPassword,
      updatedRole,
      updatedFacultyId || null,
      updatedDepartment || null,
      updatedAvatarUrl || null,
      updatedCourse || null,
      updatedSummaryMode || null,
      updatedVerified,
      existing.id
    );

    return getUserById(existing.id)!;
  }

  const stmt = db.prepare(`
    INSERT INTO users (
      name, email, password, role, faculty_id, department, avatar_url, course, summary_mode, verified, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const createdAtIso = (user.createdAt || new Date()).toISOString();
  const res = stmt.run(
    user.name,
    email,
    user.password || hashPassword('password123'),
    user.role,
    user.facultyId || null,
    user.department || null,
    user.avatarUrl || null,
    user.course || null,
    user.summaryMode || null,
    user.verified ? 1 : 0,
    createdAtIso
  );

  return getUserById(Number(res.lastInsertRowid))!;
}

export function updateUserEmail(oldEmail: string, newEmail: string, updatedFields: Partial<User>): User | null {
  const existing = getUserByEmail(oldEmail);
  if (!existing) return null;

  const stmt = db.prepare(`
    UPDATE users SET
      email = ?,
      name = coalesce(?, name),
      password = coalesce(?, password),
      faculty_id = coalesce(?, faculty_id),
      department = coalesce(?, department),
      avatar_url = coalesce(?, avatar_url)
    WHERE id = ?
  `);

  stmt.run(
    newEmail.trim().toLowerCase(),
    updatedFields.name || null,
    updatedFields.password || null,
    updatedFields.facultyId || null,
    updatedFields.department || null,
    updatedFields.avatarUrl || null,
    existing.id
  );

  return getUserById(existing.id);
}

// ── OTP Repository ──────────────────────────────────────────────────────────

export function setOtp(email: string, code: string, createdAt: Date, expiresAt: Date): Otp {
  const normEmail = email.trim().toLowerCase();
  const stmt = db.prepare(`
    INSERT INTO otps (email, code, created_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      code = excluded.code,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at
  `);
  stmt.run(normEmail, code, createdAt.toISOString(), expiresAt.toISOString());

  const row = db.prepare('SELECT * FROM otps WHERE email = ? COLLATE NOCASE').get(normEmail) as any;
  return {
    id: row.id,
    email: row.email,
    code: row.code,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
  };
}

export function getOtp(email: string): Otp | null {
  if (!email) return null;
  const stmt = db.prepare('SELECT * FROM otps WHERE email = ? COLLATE NOCASE');
  const row = stmt.get(email.trim().toLowerCase()) as any;
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    code: row.code,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
  };
}

export function deleteOtp(email: string) {
  if (!email) return;
  db.prepare('DELETE FROM otps WHERE email = ? COLLATE NOCASE').run(email.trim().toLowerCase());
}

// ── Sessions & Token Management ─────────────────────────────────────────────

export function saveSession(token: string, email: string) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sessions (token, email, created_at)
    VALUES (?, ?, ?)
  `);
  stmt.run(token, email.trim().toLowerCase(), new Date().toISOString());
}

export function getSession(token: string): { token: string; email: string } | null {
  if (!token) return null;
  const stmt = db.prepare('SELECT * FROM sessions WHERE token = ?');
  const row = stmt.get(token) as any;
  return row ? { token: row.token, email: row.email } : null;
}

export function deleteSession(token: string) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function revokeToken(token: string) {
  if (!token) return;
  deleteSession(token);
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO revoked_tokens (token, revoked_at)
    VALUES (?, ?)
  `);
  stmt.run(token, new Date().toISOString());
}

export function isTokenRevoked(token: string): boolean {
  if (!token) return true;
  const stmt = db.prepare('SELECT token FROM revoked_tokens WHERE token = ?');
  return Boolean(stmt.get(token));
}

// ── Storage Boxes Repository ────────────────────────────────────────────────

function rowToStorageBox(row: any): StorageBox {
  let allowedStudents: string[] = [];
  if (row.allowed_students) {
    try {
      allowedStudents = JSON.parse(row.allowed_students);
    } catch {}
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    createdBy: row.created_by,
    facultyId: row.faculty_id || undefined,
    allowedStudents,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function getAllStorageBoxes(): StorageBox[] {
  const stmt = db.prepare('SELECT * FROM storage_boxes ORDER BY id ASC');
  const rows = stmt.all();
  return rows.map(rowToStorageBox);
}

export function getStorageBoxById(id: number): StorageBox | null {
  const stmt = db.prepare('SELECT * FROM storage_boxes WHERE id = ?');
  const row = stmt.get(id);
  return row ? rowToStorageBox(row) : null;
}

export function createStorageBox(box: {
  name: string;
  description: string;
  createdBy: string;
  facultyId?: string;
  allowedStudents?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}): StorageBox {
  const stmt = db.prepare(`
    INSERT INTO storage_boxes (
      name, description, created_by, faculty_id, allowed_students, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date();
  const res = stmt.run(
    box.name,
    box.description || '',
    box.createdBy,
    box.facultyId || null,
    JSON.stringify(box.allowedStudents || []),
    (box.createdAt || now).toISOString(),
    (box.updatedAt || now).toISOString()
  );

  return getStorageBoxById(Number(res.lastInsertRowid))!;
}

export function updateStorageBox(box: StorageBox): StorageBox {
  const stmt = db.prepare(`
    UPDATE storage_boxes SET
      name = ?,
      description = ?,
      created_by = ?,
      faculty_id = ?,
      allowed_students = ?,
      updated_at = ?
    WHERE id = ?
  `);

  stmt.run(
    box.name,
    box.description || '',
    box.createdBy,
    box.facultyId || null,
    JSON.stringify(box.allowedStudents || []),
    (box.updatedAt || new Date()).toISOString(),
    box.id
  );

  return getStorageBoxById(box.id)!;
}

export function deleteStorageBox(id: number) {
  // Unlink recordings from this box
  db.prepare('UPDATE recordings SET storage_box_id = NULL WHERE storage_box_id = ?').run(id);
  db.prepare('DELETE FROM storage_boxes WHERE id = ?').run(id);
}

// ── Recordings Repository ───────────────────────────────────────────────────

function rowToRecording(row: any): Recording {
  let allowedAccess: string[] = [];
  if (row.allowed_access) {
    try {
      allowedAccess = JSON.parse(row.allowed_access);
    } catch {}
  }

  let allowedStudents: string[] = [];
  if (row.allowed_students) {
    try {
      allowedStudents = JSON.parse(row.allowed_students);
    } catch {}
  }

  return {
    id: row.id,
    storageBoxId: row.storage_box_id || null,
    title: row.title,
    lectureName: row.lecture_name || null,
    professorName: row.professor_name || null,
    subject: row.subject || null,
    classCourse: row.class_course || null,
    lectureDate: row.lecture_date || null,
    description: row.description || '',
    duration: row.duration || '00:00',
    createdAt: new Date(row.created_at),
    status: row.status,
    facultyStatus: row.faculty_status || (row.published ? 'PUBLISHED' : 'READY'),
    published: Boolean(row.published),
    isFacultyLecture: Boolean(row.is_faculty_lecture),
    allowedAccess,
    allowedStudents,
    studentsAccessed: row.students_accessed || 0,
    playsCount: row.plays_count || 0,
    totalListeningSeconds: row.total_listening_seconds || 0,
    avgListeningTime: row.avg_listening_time || '00m 00s',
    transcript: row.transcript || '',
    summary: row.summary || '',
    audioFilename: row.audio_filename || null,
    audioContentType: row.audio_content_type || null,
    audioFilePath: row.audio_file_path || null,
  };
}

export function getAllRecordings(): Recording[] {
  const stmt = db.prepare('SELECT * FROM recordings ORDER BY id DESC');
  const rows = stmt.all();
  return rows.map(rowToRecording);
}

export function getRecordingById(id: number): Recording | null {
  const stmt = db.prepare('SELECT * FROM recordings WHERE id = ?');
  const row = stmt.get(id);
  return row ? rowToRecording(row) : null;
}

export function createRecording(rec: {
  storageBoxId?: number | null;
  title: string;
  lectureName?: string | null;
  professorName?: string | null;
  subject?: string | null;
  classCourse?: string | null;
  lectureDate?: string | null;
  description?: string | null;
  duration?: string;
  createdAt?: Date;
  status: string;
  facultyStatus?: 'DRAFT' | 'PROCESSING' | 'READY' | 'PUBLISHED';
  published?: boolean;
  isFacultyLecture?: boolean;
  allowedAccess?: string[];
  allowedStudents?: string[];
  studentsAccessed?: number;
  playsCount?: number;
  totalListeningSeconds?: number;
  avgListeningTime?: string;
  transcript?: string;
  summary?: string;
  audioFilename?: string | null;
  audioContentType?: string | null;
  audioFilePath?: string | null;
}): Recording {
  const stmt = db.prepare(`
    INSERT INTO recordings (
      storage_box_id, title, lecture_name, professor_name, subject, class_course,
      lecture_date, description, duration, created_at, status, faculty_status,
      published, is_faculty_lecture, allowed_access, allowed_students,
      students_accessed, plays_count, total_listening_seconds, avg_listening_time,
      transcript, summary, audio_filename, audio_content_type, audio_file_path
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `);

  const res = stmt.run(
    rec.storageBoxId || null,
    rec.title,
    rec.lectureName || null,
    rec.professorName || null,
    rec.subject || null,
    rec.classCourse || null,
    rec.lectureDate || null,
    rec.description || '',
    rec.duration || '00:00',
    (rec.createdAt || new Date()).toISOString(),
    rec.status || 'Completed',
    rec.facultyStatus || 'READY',
    rec.published ? 1 : 0,
    rec.isFacultyLecture !== false ? 1 : 0,
    JSON.stringify(rec.allowedAccess || []),
    JSON.stringify(rec.allowedStudents || []),
    rec.studentsAccessed || 0,
    rec.playsCount || 0,
    rec.totalListeningSeconds || 0,
    rec.avgListeningTime || '00m 00s',
    rec.transcript || '',
    rec.summary || '',
    rec.audioFilename || null,
    rec.audioContentType || null,
    rec.audioFilePath || null
  );

  return getRecordingById(Number(res.lastInsertRowid))!;
}

export function updateRecording(rec: Recording): Recording {
  const stmt = db.prepare(`
    UPDATE recordings SET
      storage_box_id = ?,
      title = ?,
      lecture_name = ?,
      professor_name = ?,
      subject = ?,
      class_course = ?,
      lecture_date = ?,
      description = ?,
      duration = ?,
      status = ?,
      faculty_status = ?,
      published = ?,
      is_faculty_lecture = ?,
      allowed_access = ?,
      allowed_students = ?,
      students_accessed = ?,
      plays_count = ?,
      total_listening_seconds = ?,
      avg_listening_time = ?,
      transcript = ?,
      summary = ?,
      audio_filename = ?,
      audio_content_type = ?,
      audio_file_path = ?
    WHERE id = ?
  `);

  stmt.run(
    rec.storageBoxId || null,
    rec.title,
    rec.lectureName || null,
    rec.professorName || null,
    rec.subject || null,
    rec.classCourse || null,
    rec.lectureDate || null,
    rec.description || '',
    rec.duration || '00:00',
    rec.status || 'Completed',
    rec.facultyStatus || 'READY',
    rec.published ? 1 : 0,
    rec.isFacultyLecture !== false ? 1 : 0,
    JSON.stringify(rec.allowedAccess || []),
    JSON.stringify(rec.allowedStudents || []),
    rec.studentsAccessed || 0,
    rec.playsCount || 0,
    rec.totalListeningSeconds || 0,
    rec.avgListeningTime || '00m 00s',
    rec.transcript || '',
    rec.summary || '',
    rec.audioFilename || null,
    rec.audioContentType || null,
    rec.audioFilePath || null,
    rec.id
  );

  return getRecordingById(rec.id)!;
}

export function deleteRecording(id: number) {
  const rec = getRecordingById(id);
  if (rec && rec.audioFilePath) {
    deleteAudioFile(rec.audioFilePath);
  }
  db.prepare('DELETE FROM accessed_students_per_lecture WHERE recording_id = ?').run(id);
  db.prepare('DELETE FROM lecture_access_logs WHERE recording_id = ?').run(id);
  db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
}

// ── Student Lecture Access & Tracking ───────────────────────────────────────

export function recordStudentAccess(recordingId: number, studentEmail: string): boolean {
  try {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO accessed_students_per_lecture (recording_id, student_email)
      VALUES (?, ?)
    `);
    const res = stmt.run(recordingId, studentEmail.trim().toLowerCase());
    return res.changes > 0;
  } catch {
    return false;
  }
}

export function getAccessedStudentsForLecture(recordingId: number): Set<string> {
  const stmt = db.prepare('SELECT student_email FROM accessed_students_per_lecture WHERE recording_id = ?');
  const rows = stmt.all(recordingId) as { student_email: string }[];
  return new Set(rows.map(r => r.student_email.toLowerCase()));
}

export function getAllAccessedStudentsPerLecture(): Map<number, Set<string>> {
  const map = new Map<number, Set<string>>();
  const stmt = db.prepare('SELECT recording_id, student_email FROM accessed_students_per_lecture');
  const rows = stmt.all() as { recording_id: number; student_email: string }[];
  for (const row of rows) {
    let set = map.get(row.recording_id);
    if (!set) {
      set = new Set<string>();
      map.set(row.recording_id, set);
    }
    set.add(row.student_email.toLowerCase());
  }
  return map;
}

// ── Lecture Access Logs Repository ──────────────────────────────────────────

export function logLectureAccess(log: LectureAccessLog) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO lecture_access_logs (
      id, student_email, student_name, recording_id, lecture_title, subject, action, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    log.id,
    log.studentEmail,
    log.studentName,
    log.recordingId,
    log.lectureTitle,
    log.subject || null,
    log.action,
    (log.timestamp || new Date()).toISOString()
  );

  // Maintain recent 150 entries limit
  db.exec(`
    DELETE FROM lecture_access_logs
    WHERE id NOT IN (
      SELECT id FROM lecture_access_logs ORDER BY timestamp DESC LIMIT 150
    )
  `);
}

export function getLectureAccessLogs(limit = 100): LectureAccessLog[] {
  const stmt = db.prepare('SELECT * FROM lecture_access_logs ORDER BY timestamp DESC LIMIT ?');
  const rows = stmt.all(limit) as any[];
  return rows.map(r => ({
    id: r.id,
    studentEmail: r.student_email,
    studentName: r.student_name,
    recordingId: r.recording_id,
    lectureTitle: r.lecture_title,
    subject: r.subject || undefined,
    action: r.action,
    timestamp: new Date(r.timestamp),
  }));
}

// ── Sample Audio Wave Generator for Seeding ─────────────────────────────────

export function generateToneWav(frequencyHz: number, durationSeconds: number): Buffer {
  const sampleRate = 44100;
  const numSamples = Math.floor(durationSeconds * sampleRate);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');

  buffer.write('fmt ', 12, 'ascii');
  buffer.writeInt32LE(16, 16);
  buffer.writeInt16LE(1, 20); // PCM
  buffer.writeInt16LE(1, 22); // Mono
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

// ── Database Seeder ─────────────────────────────────────────────────────────

export function seedDatabaseIfEmpty() {
  initializeDatabase();

  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  if (userCount === 0) {
    console.log('[SQLite] Seeding initial users and login credentials...');

    saveUser({
      name: 'Mario',
      email: 'programmmariojs8@gmail.com',
      password: hashPassword('password123'),
      role: 'student',
      course: 'SE Computer Engineering',
      verified: true,
      createdAt: new Date(),
    });

    saveUser({
      name: 'Dr. Ananya Sharma',
      email: 'faculty@vaani.edu',
      password: hashPassword('password123'),
      role: 'faculty',
      facultyId: 'FAC-2026-104',
      department: 'Department of Computer Engineering & AI',
      avatarUrl: '',
      verified: true,
      createdAt: new Date(),
    });

    saveUser({
      name: 'Aarav Patel',
      email: 'student@vaani.edu',
      password: hashPassword('password123'),
      role: 'student',
      course: 'SE Computer Engineering',
      verified: true,
      createdAt: new Date(Date.now() - 10 * 86400 * 1000),
    });

    saveUser({
      name: 'Rohan Sharma',
      email: 'rohan.sharma@vaani.edu',
      password: hashPassword('password123'),
      role: 'student',
      course: 'TE Computer Engineering',
      verified: true,
      createdAt: new Date(Date.now() - 8 * 86400 * 1000),
    });

    saveUser({
      name: 'Priya Deshmukh',
      email: 'priya.deshmukh@vaani.edu',
      password: hashPassword('password123'),
      role: 'student',
      course: 'BE Computer Engineering',
      verified: true,
      createdAt: new Date(Date.now() - 6 * 86400 * 1000),
    });

    saveUser({
      name: 'Neha Kulkarni',
      email: 'neha.kulkarni@vaani.edu',
      password: hashPassword('password123'),
      role: 'student',
      course: 'M.Tech AI & Data Science',
      verified: true,
      createdAt: new Date(Date.now() - 4 * 86400 * 1000),
    });

    saveUser({
      name: 'Aditya Verma',
      email: 'aditya.verma@vaani.edu',
      password: hashPassword('password123'),
      role: 'student',
      course: 'SE Computer Engineering',
      verified: true,
      createdAt: new Date(Date.now() - 2 * 86400 * 1000),
    });
  }

  const boxCount = (db.prepare('SELECT COUNT(*) as c FROM storage_boxes').get() as any).c;
  if (boxCount === 0) {
    console.log('[SQLite] Seeding initial storage boxes...');

    createStorageBox({
      name: 'Artificial Intelligence & ML',
      description: 'Foundations of AI, machine learning algorithms, deep neural nets, and practical applications.',
      createdBy: 'Dr. Ananya Sharma',
      facultyId: 'FAC-2026-104',
      allowedStudents: ['student@vaani.edu', 'rohan.sharma@vaani.edu', 'priya.deshmukh@vaani.edu', 'programmmariojs8@gmail.com'],
      createdAt: new Date(Date.now() - 7 * 86400 * 1000),
      updatedAt: new Date(Date.now() - 3 * 3600 * 1000),
    });

    createStorageBox({
      name: 'Data Structures & Algorithms',
      description: 'Hierarchical tree structures, graph traversal algorithms, balancing heuristics, and complexity bounds.',
      createdBy: 'Prof. Verma',
      facultyId: 'FAC-2026-102',
      allowedStudents: ['student@vaani.edu', 'aditya.verma@vaani.edu', 'programmmariojs8@gmail.com'],
      createdAt: new Date(Date.now() - 5 * 86400 * 1000),
      updatedAt: new Date(Date.now() - 2 * 3600 * 1000),
    });

    createStorageBox({
      name: 'Innovation & Research Lab',
      description: 'Interactive brainstorming sessions, audio synthesis systems, and rapid prototype reviews.',
      createdBy: 'Dr. Nair',
      facultyId: 'FAC-2026-108',
      allowedStudents: [],
      createdAt: new Date(Date.now() - 3 * 86400 * 1000),
      updatedAt: new Date(Date.now() - 1 * 3600 * 1000),
    });
  }

  const recordingCount = (db.prepare('SELECT COUNT(*) as c FROM recordings').get() as any).c;
  if (recordingCount === 0) {
    console.log('[SQLite] Seeding initial recordings & audio files into audio/ folder...');

    // Generate audio tone buffers
    const sampleAudio1 = generateToneWav(440, 3);
    const sampleAudio2 = generateToneWav(523.25, 3);
    const sampleAudio3 = generateToneWav(659.25, 3);
    const sampleAudio4 = generateToneWav(392.0, 3);

    // Save audio files to audio/ directory and get their paths
    const file1 = saveAudioFile(sampleAudio1, 'lecture_ai_ml.wav');
    const file2 = saveAudioFile(sampleAudio2, 'data_structures_trees.wav');
    const file3 = saveAudioFile(sampleAudio3, 'brainstorming.wav');
    const file4 = saveAudioFile(sampleAudio4, 'neural_networks_draft.wav');

    createRecording({
      storageBoxId: 1,
      title: 'Lecture — AI and ML Basics',
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
      allowedStudents: ['student@vaani.edu', 'rohan.sharma@vaani.edu', 'priya.deshmukh@vaani.edu', 'programmmariojs8@gmail.com'],
      studentsAccessed: 42,
      playsCount: 118,
      avgListeningTime: '38m 45s',
      transcript:
        'Artificial Intelligence is a broad field of computer science focused on creating systems that can perform tasks that normally require human intelligence. Machine Learning is a subset of AI where systems learn patterns from data.\n\nThere are three major types of machine learning: supervised learning, unsupervised learning, and reinforcement learning. Each approach has different applications across healthcare, finance, education, and autonomous systems.',
      summary:
        'This lecture introduces the fundamental concepts of Artificial Intelligence and Machine Learning. It explains the difference between AI, ML, and Deep Learning, covering supervised, unsupervised, and reinforcement learning.\n\nKey Points:\n• AI is broader; ML is a subset of AI.\n• ML enables systems to learn from data.\n• Types: supervised, unsupervised and reinforcement.\n• Data quality is crucial for accurate predictions.',
      audioFilename: 'lecture_ai_ml.wav',
      audioContentType: 'audio/wav',
      audioFilePath: file1.relativePath,
    });

    createRecording({
      storageBoxId: 2,
      title: 'Data Structures — Trees & Graph Traversals',
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
      allowedStudents: ['student@vaani.edu', 'aditya.verma@vaani.edu', 'programmmariojs8@gmail.com'],
      studentsAccessed: 36,
      playsCount: 89,
      avgListeningTime: '27m 15s',
      transcript:
        "During today's lecture on Data Structures, we examined hierarchical data representations using binary trees and graphs. Breadth-First Search explores nodes level by level using a FIFO queue, whereas Depth-First Search explores branches deeply using a stack or recursion.",
      summary:
        'Summary of Tree and Graph Traversal techniques and asymptotic time complexity.\n\nKey Points:\n• Binary Search Trees allow O(log n) average search and insertion.\n• BFS uses a Queue and finds shortest paths in unweighted graphs.\n• DFS uses a Stack/recursion and is used in cycle detection and topological sorting.',
      audioFilename: 'data_structures_trees.wav',
      audioContentType: 'audio/wav',
      audioFilePath: file2.relativePath,
    });

    createRecording({
      storageBoxId: 3,
      title: 'Project Ideas Brainstorming',
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
      allowedStudents: [],
      studentsAccessed: 29,
      playsCount: 64,
      avgListeningTime: '24m 10s',
      transcript:
        'Brainstorming session covering automated audio transcription, key point summarization, export features, and real-time speech processing.',
      summary:
        'Creative brainstorming ideas for Vaani AI audio platform.\n\nKey Points:\n• Real-time speech recognition.\n• Auto export to PDF/Markdown.\n• Audio playback & annotation.',
      audioFilename: 'brainstorming.wav',
      audioContentType: 'audio/wav',
      audioFilePath: file3.relativePath,
    });

    createRecording({
      storageBoxId: 1,
      title: 'Neural Networks & Backpropagation (Draft Review)',
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
      allowedStudents: ['student@vaani.edu', 'priya.deshmukh@vaani.edu'],
      studentsAccessed: 0,
      playsCount: 2,
      avgListeningTime: '18m 00s',
      transcript:
        'Welcome to Deep Learning Architectures. Today we derive the backpropagation algorithm from first principles using the chain rule of calculus. Each layer computes a weighted linear combination followed by a non-linear activation such as ReLU or GELU.\n\nDuring training, the loss gradient propagates backward from the output layer to update weights via Stochastic Gradient Descent or Adam optimization.',
      summary:
        '✥ EXECUTIVE SUMMARY\nComprehensive walkthrough of multi-layer neural networks, forward propagation, and gradient computation via backpropagation.\n\n✥ KEY POINTS & INSIGHTS\n• Forward pass computes activations layer by layer.\n• Loss functions quantify prediction error.\n• Backpropagation applies the chain rule to compute gradients efficiently.\n• Adam optimizer adapts learning rates per parameter.',
      audioFilename: 'neural_networks_draft.wav',
      audioContentType: 'audio/wav',
      audioFilePath: file4.relativePath,
    });
  }

  const logCount = (db.prepare('SELECT COUNT(*) as c FROM lecture_access_logs').get() as any).c;
  if (logCount === 0) {
    const now = Date.now();
    logLectureAccess({
      id: 'log-1',
      studentEmail: 'student@vaani.edu',
      studentName: 'Aarav Patel',
      recordingId: 1,
      lectureTitle: 'Lecture — AI and ML Basics',
      subject: 'Artificial Intelligence & ML',
      action: 'STREAM',
      timestamp: new Date(now - 14 * 60 * 1000),
    });

    logLectureAccess({
      id: 'log-2',
      studentEmail: 'rohan.sharma@vaani.edu',
      studentName: 'Rohan Sharma',
      recordingId: 2,
      lectureTitle: 'Data Structures — Trees & Graph Traversals',
      subject: 'Data Structures',
      action: 'VIEW',
      timestamp: new Date(now - 48 * 60 * 1000),
    });

    logLectureAccess({
      id: 'log-3',
      studentEmail: 'priya.deshmukh@vaani.edu',
      studentName: 'Priya Deshmukh',
      recordingId: 1,
      lectureTitle: 'Lecture — AI and ML Basics',
      subject: 'Artificial Intelligence & ML',
      action: 'STREAM',
      timestamp: new Date(now - 2 * 3600 * 1000),
    });

    logLectureAccess({
      id: 'log-4',
      studentEmail: 'neha.kulkarni@vaani.edu',
      studentName: 'Neha Kulkarni',
      recordingId: 3,
      lectureTitle: 'Project Ideas Brainstorming',
      subject: 'Innovation Lab',
      action: 'VIEW',
      timestamp: new Date(now - 5 * 3600 * 1000),
    });
  }
}
