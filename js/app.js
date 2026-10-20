const API_BASE = '/api/recordings';
const LOCAL_STORAGE_KEY = 'vaani_recordings_v1';
let backendAvailable = true;
let fallbackToastShown = false;
let pollingInterval = null;

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

async function pollRecordingStatus(id) {
  if (!backendAvailable) {
    stopPolling();
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/${id}`, { headers: authHeaders() });
    if (res.ok) {
      const rec = sanitizeRecording(await res.json());
      if (rec.status !== 'Processing') {
        stopPolling();
        if (currentRecording && String(currentRecording.id) === String(id)) {
          openDetail(id);
        }
        loadRecordings();
      }
    }
  } catch (e) {
    stopPolling();
  }
}

// ── Auth & Role helpers ─────────────────────────────────────
function getAuthToken() {
  return localStorage.getItem('vaani_auth_token');
}

function getUserRole() {
  return localStorage.getItem('vaani_user_role') === 'faculty' ? 'faculty' : 'student';
}

function isFacultyRole() {
  return getUserRole() === 'faculty';
}

function getUserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (e) {
    return 'UTC';
  }
}

function authHeaders() {
  const token = getAuthToken();
  const headers = {
    'x-timezone': getUserTimeZone(),
    'x-user-role': getUserRole(),
  };
  if (token) {
    headers['Authorization'] = 'Bearer ' + token;
  }
  return headers;
}

function handleAuthError(res) {
  if (res.status === 401) {
    localStorage.removeItem('vaani_auth_token');
    localStorage.removeItem('vaani_user_name');
    localStorage.removeItem('vaani_user_email');
    localStorage.removeItem('vaani_user_role');
    window.location.href = 'login.html';
    return true;
  }
  return false;
}

// Set user name & role UI dynamically
function setUserInfo() {
  const isFaculty = isFacultyRole();
  const name = localStorage.getItem('vaani_user_name') || (isFaculty ? 'Dr. Ananya Sharma' : 'Student');
  const email = localStorage.getItem('vaani_user_email') || (isFaculty ? 'faculty@vaani.edu' : 'student@vaani.edu');
  const facId = localStorage.getItem('vaani_faculty_id') || 'FAC-2026-104';
  const facDept = localStorage.getItem('vaani_faculty_dept') || 'Department of Computer Engineering & AI';
  const facAvatar = localStorage.getItem('vaani_faculty_avatar') || '';
  const summaryMode = localStorage.getItem('vaani_summary_mode') || 'Medium';

  const profileEl = document.getElementById('profileName');
  const roleBadge = document.getElementById('headerRoleBadge');
  const eyebrow = document.querySelector('#dashboard .eyebrow');
  const facEyebrow = document.getElementById('facultyEyebrow');
  const settingsName = document.getElementById('settingsName');
  const settingsSelect = document.querySelector('#settings select');
  const settingsTz = document.getElementById('settingsTimezone');

  if (profileEl) profileEl.innerHTML = `<i data-lucide="user-circle" style="width:16px;height:16px;color:var(--muted);flex-shrink:0;"></i> <span>${escapeHtml(name)}</span>`;
  if (roleBadge) roleBadge.innerHTML = isFaculty ? '<i data-lucide="graduation-cap"></i> Faculty' : '<i data-lucide="user"></i> Student';
  if (eyebrow) eyebrow.textContent = 'Welcome back, ' + name + '!';
  if (facEyebrow) facEyebrow.textContent = 'Welcome back, ' + name + '!';
  if (settingsName) settingsName.value = name;
  if (settingsSelect) settingsSelect.value = summaryMode;
  if (settingsTz) {
    const tz = getUserTimeZone();
    const offsetMin = -new Date().getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const offHr = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0');
    const offMn = String(Math.abs(offsetMin) % 60).padStart(2, '0');
    settingsTz.value = `${tz} (UTC${sign}${offHr}:${offMn}) — Local Time`;
  }

  // Toggle Sidebar Navigation & Header Actions by Role
  const studentNav = document.getElementById('studentNav');
  const facultyNav = document.getElementById('facultyNav');
  const studentHeaderActions = document.getElementById('studentHeaderActions');
  const facultyHeaderActions = document.getElementById('facultyHeaderActions');

  if (studentNav) studentNav.classList.toggle('hidden', isFaculty);
  if (facultyNav) facultyNav.classList.toggle('hidden', !isFaculty);
  if (studentHeaderActions) studentHeaderActions.classList.toggle('hidden', isFaculty);
  if (facultyHeaderActions) facultyHeaderActions.classList.toggle('hidden', !isFaculty);

  // Populate Faculty Profile section
  const facProfileDisplayName = document.getElementById('facProfileDisplayName');
  const facProfileDisplayDept = document.getElementById('facProfileDisplayDept');
  const facProfileDisplayId = document.getElementById('facProfileDisplayId');
  const facAvatarDisplay = document.getElementById('facAvatarDisplay');
  const facProfNameInput = document.getElementById('facProfNameInput');
  const facProfIdInput = document.getElementById('facProfIdInput');
  const facProfEmailInput = document.getElementById('facProfEmailInput');
  const facProfDeptInput = document.getElementById('facProfDeptInput');

  if (facProfileDisplayName) facProfileDisplayName.textContent = name;
  if (facProfileDisplayDept) facProfileDisplayDept.textContent = facDept;
  if (facProfileDisplayId) facProfileDisplayId.textContent = 'ID: ' + facId;
  if (facProfNameInput) facProfNameInput.value = name;
  if (facProfIdInput) facProfIdInput.value = facId;
  if (facProfEmailInput) facProfEmailInput.value = email;
  if (facProfDeptInput) facProfDeptInput.value = facDept;
  if (facAvatarDisplay) {
    if (facAvatar) {
      facAvatarDisplay.innerHTML = `<img src="${facAvatar}" alt="Profile">`;
    } else {
      facAvatarDisplay.innerHTML = '<i data-lucide="user" style="width:36px;height:36px;color:var(--p)"></i>';
    }
  }

  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
}
setUserInfo();

let recordings = [];
let currentRecording = null;
let currentReviewRecording = null;

function isBrokenText(text) {
  if (!text || !String(text).trim()) return true;
  const lower = String(text).toLowerCase().trim();
  return (
    lower.includes('openai whisper could not transcribe') ||
    lower.includes('http 429') ||
    lower.includes('transcription or summary failed') ||
    lower.includes('no transcript available') ||
    lower.includes('no summary available') ||
    lower.includes('check your api key, account billing') ||
    lower.includes('local mode: transcript is not auto-generated') ||
    lower.includes('local mode summary:') ||
    lower.includes('in this lecture, we explore the core principles, foundational architecture, and practical real-world implementations of') ||
    lower.includes('first, we examine how modern systems process input data, structure key representations, and optimize performance under real-world constraints') ||
    lower.includes('second, we walk through concrete case studies and step-by-step methodologies')
  );
}

function buildExtractiveSummaryFromTranscript(transcript) {
  const cleaned = (transcript || '').trim();
  if (!cleaned || isBrokenText(cleaned)) {
    return '';
  }
  const sentences = cleaned.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 4);
  if (sentences.length === 0) return '';

  const stopWords = new Set(['the','and','is','in','to','of','for','with','on','at','from','by','this','that','are','was','were','been','has','have','had','will','would','could','should','your','our','their','more','also','some','into','welcome','everyone','today','session','lecture']);
  const counts = {};
  for (const w of cleaned.toLowerCase().split(/\W+/)) {
    if (w.length > 3 && !stopWords.has(w)) counts[w] = (counts[w] || 0) + 1;
  }
  const keywords = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0]);

  const overview = sentences.length <= 2
    ? sentences.join(' ')
    : `${sentences[0]} ${sentences[1]}`;
  const keyConcepts = sentences.slice(0, Math.min(5, sentences.length)).map(s => `• ${s}`).join('\n');
  const takeaways = sentences.slice(-Math.min(3, sentences.length)).map(s => `• ${s}`).join('\n');

  const lines = [
    '1. Lecture Overview',
    overview,
    '',
    '2. Key Concepts',
    keyConcepts,
  ];
  if (keywords.length > 0) {
    lines.push(`• Core Terminology: ${keywords.join(', ')}`);
  }
  if (sentences.length > 2) {
    lines.push('');
    lines.push('3. Detailed Notes');
    lines.push(sentences.slice(0, Math.min(6, sentences.length)).map(s => `• ${s}`).join('\n'));
  }
  lines.push('');
  lines.push(`${sentences.length > 2 ? '4' : '3'}. Key Takeaways`);
  lines.push(takeaways);

  return lines.join('\n');
}

function stripModelLine(text) {
  if (!text) return '';
  return String(text)
    .replace(/^[•\-\*]?\s*AI Processing Model:.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeRecording(rec) {
  if (!rec || typeof rec !== 'object') return rec;
  if (rec.summary) {
    rec.summary = stripModelLine(rec.summary);
  }
  if (isBrokenText(rec.transcript)) {
    rec.transcript = '';
  }
  if (isBrokenText(rec.summary)) {
    rec.summary = rec.transcript ? buildExtractiveSummaryFromTranscript(rec.transcript) : '';
  }
  if (!rec.facultyStatus) {
    rec.facultyStatus = rec.published === false ? 'READY' : 'PUBLISHED';
  }
  if (rec.published === undefined) {
    rec.published = rec.facultyStatus === 'PUBLISHED';
  }
  return rec;
}

function loadLocalRecordings() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(data)) return [];
    const cleaned = data.map(r => {
      if (r && r.status === 'Processing') r.status = 'Completed';
      return sanitizeRecording(r);
    });
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cleaned));
    return cleaned;
  } catch (e) {
    return [];
  }
}

function saveLocalRecordings(data) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    try {
      const safeData = (Array.isArray(data) ? data : []).map(r => {
        const copy = { ...r };
        if (copy.audioDataUrl && copy.audioDataUrl.length > 50000) {
          copy.audioDataUrl = null;
        }
        return copy;
      });
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(safeData));
    } catch {}
  }
}

function showFallbackToast() {
  if (!fallbackToastShown) {
    fallbackToastShown = true;
    toast('Backend unavailable. Running in local browser mode.');
  }
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

// ── Toast ──────────────────────────────────────────────────
const toast = m => {
  let t = document.querySelector('#toast');
  if (!t) return;
  t.textContent = m;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
};

// ── Page routing (Role-Protected) ──────────────────────────
const FACULTY_ONLY_PAGES = new Set([
  'facultyDashboard',
  'facultyLectures',
  'facultyUpload',
  'facultyReview',
  'facultyAnalytics',
  'facultyProfile',
]);

function page(id) {
  // Enforce Role Security in UI routing
  if (FACULTY_ONLY_PAGES.has(id) && !isFacultyRole()) {
    toast('❌ ACCESS DENIED: Faculty role required.');
    id = 'dashboard';
  }
  if (id === 'dashboard' && isFacultyRole()) {
    id = 'facultyDashboard';
  }

  // Stop polling and pause detail/review audio when navigating away
  if (id !== 'detail') {
    stopPolling();
    const detailPlayer = document.querySelector('#detailAudioPlayer');
    if (detailPlayer && !detailPlayer.paused) {
      try { detailPlayer.pause(); } catch (e) {}
    }
  }
  if (id !== 'facultyReview') {
    const reviewPlayer = document.querySelector('#facReviewAudioPlayer');
    if (reviewPlayer && !reviewPlayer.paused) {
      try { reviewPlayer.pause(); } catch (e) {}
    }
  }

  if (
    id === 'dashboard' ||
    id === 'recordings' ||
    id === 'facultyDashboard' ||
    id === 'facultyLectures' ||
    id === 'facultyAnalytics'
  ) {
    loadRecordings();
    if (id === 'facultyAnalytics') {
      loadFacultyAnalytics();
    }
  }
  if (id === 'storageBoxes' || id === 'facultyUpload' || id === 'recordings') {
    fetchStorageBoxes();
  }
  if (id === 'settings') {
    loadSmtpStatus();
    loadGeminiConfig();
  }

  document.querySelectorAll('.page').forEach(x => x.classList.toggle('active', x.id === id));
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x.dataset.page === id));
  window.scrollTo(0, 0);
}

document.addEventListener('click', e => {
  let b = e.target.closest('[data-page]');
  if (b) {
    page(b.dataset.page);
  }

  let viewBtn = e.target.closest('.view');
  if (viewBtn) openDetail(viewBtn.dataset.id);

  let deleteBtn = e.target.closest('.delete-rec');
  if (deleteBtn) deleteRecording(deleteBtn.dataset.id);

  // Faculty table action buttons
  let facReviewBtn = e.target.closest('.fac-review-btn');
  if (facReviewBtn) openFacultyReview(facReviewBtn.dataset.id, facReviewBtn.dataset.edit === '1');

  let facPubToggleBtn = e.target.closest('.fac-pub-toggle');
  if (facPubToggleBtn) {
    const publish = facPubToggleBtn.dataset.publish === '1';
    toggleLecturePublish(facPubToggleBtn.dataset.id, publish);
  }
});

// ── Load + Render recordings ───────────────────────────────
async function loadRecordings() {
  try {
    const roleParam = isFacultyRole() ? '?role=faculty' : '?role=student';
    const res = await fetch(API_BASE + roleParam, { headers: authHeaders() });
    if (handleAuthError(res)) return;
    if (!res.ok) throw new Error('Failed to fetch');
    backendAvailable = true;
    const rawList = await res.json();
    recordings = (Array.isArray(rawList) ? rawList : []).map(sanitizeRecording);
    loadLocalRecordings();
    renderRecordings();
    if (isFacultyRole()) {
      renderFacultyViews();
    }
  } catch (err) {
    backendAvailable = false;
    let localList = loadLocalRecordings();
    if (!isFacultyRole()) {
      localList = localList.filter(r => r.published !== false && r.facultyStatus !== 'DRAFT' && r.facultyStatus !== 'READY');
    }
    recordings = localList;
    renderRecordings();
    if (isFacultyRole()) {
      renderFacultyViews();
    }
    showFallbackToast();
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function formatLocalDisplayDate(val) {
  if (!val) return 'Just now';
  let d;
  if (typeof val === 'number') {
    d = new Date(val);
  } else if (val instanceof Date) {
    d = val;
  } else if (typeof val === 'string') {
    const trimmed = val.trim();
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime()) && (trimmed.includes('T') || trimmed.endsWith('Z') || trimmed.includes('-'))) {
      d = parsed;
    } else {
      const match = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (match) {
        const [, day, monStr, yr, hrStr, minStr, ampm] = match;
        const months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
        const mon = months[monStr.toLowerCase()] ?? 0;
        let hr = parseInt(hrStr, 10);
        if (ampm.toUpperCase() === 'PM' && hr < 12) hr += 12;
        if (ampm.toUpperCase() === 'AM' && hr === 12) hr = 0;
        d = new Date(Date.UTC(parseInt(yr, 10), mon, parseInt(day, 10), hr, parseInt(minStr, 10)));
      } else {
        d = isNaN(parsed.getTime()) ? null : parsed;
      }
    }
  }
  if (!d || isNaN(d.getTime())) return String(val);

  const day = String(d.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const hh = String(hours).padStart(2, '0');
  return `${day} ${month} ${year}, ${hh}:${minutes} ${ampm}`;
}

function rowHtml(x) {
  const audioSrc = x.audioDataUrl ? x.audioDataUrl : `${API_BASE}/${x.id}/audio`;
  const displayDate = formatLocalDisplayDate(x.createdAtIso || x.createdAt);
  const canDelete = isFacultyRole();
  const subjectLabel = x.storageBoxName
    ? `<span class="box-tag"><i data-lucide="archive"></i> ${escapeHtml(x.storageBoxName)}</span>`
    : escapeHtml(x.subject || x.lectureName || '-');
  return `
    <tr>
      <td><b>${escapeHtml(x.title)}</b></td>
      <td>${subjectLabel}</td>
      <td>${escapeHtml(x.professorName || '-')}</td>
      <td>${escapeHtml(x.duration || '00:00')}</td>
      <td>${escapeHtml(displayDate)}</td>
      <td><span class="badge badge-published"><i data-lucide="check-circle-2"></i> Published</span></td>
      <td>
        ${x.hasAudio
          ? `<audio controls src="${audioSrc}" preload="metadata" style="height:32px;width:190px;outline:none;border-radius:6px;"></audio>`
          : '<small class="muted">No Audio</small>'}
      </td>
      <td style="white-space:nowrap;">
        <button class="primary act-btn view" data-id="${x.id}"><i data-lucide="headphones"></i> Listen &amp; View</button>
        ${canDelete
          ? `<button class="outline act-btn delete-rec" data-id="${x.id}" style="color:var(--danger);border-color:var(--danger-border);margin-left:4px;"><i data-lucide="trash-2"></i> Delete</button>`
          : ''}
      </td>
    </tr>`;
}

function syncStudentSubjectFilter() {
  const sel = document.getElementById('studentSubjectFilter');
  if (!sel) return;
  const prevVal = sel.value || 'ALL';
  const topics = new Set();
  storageBoxes.forEach(b => {
    if (b.name && b.name.trim()) topics.add(b.name.trim());
  });
  recordings.forEach(r => {
    if (!isFacultyRole() && r.published === false && r.facultyStatus !== 'PUBLISHED') return;
    if (r.storageBoxName && r.storageBoxName.trim()) topics.add(r.storageBoxName.trim());
    else if (r.subject && r.subject.trim()) topics.add(r.subject.trim());
  });

  const opts = ['<option value="ALL">All Storage Boxes &amp; Subjects</option>'];
  Array.from(topics).forEach(t => {
    opts.push(`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`);
  });
  sel.innerHTML = opts.join('');
  if (Array.from(sel.options).some(o => o.value === prevVal)) {
    sel.value = prevVal;
  } else {
    sel.value = 'ALL';
  }
}

function renderRecordings() {
  syncStudentSubjectFilter();
  const dashQuery = (document.getElementById('studentDashSearch')?.value || '').trim().toLowerCase();
  const browseQuery = (document.getElementById('studentBrowseSearch')?.value || '').trim().toLowerCase();
  const subjectFilter = (document.getElementById('studentSubjectFilter')?.value || 'ALL').toLowerCase();

  // Students only see PUBLISHED lectures
  const studentVisible = isFacultyRole()
    ? recordings
    : recordings.filter(r => r.published === true || r.facultyStatus === 'PUBLISHED');

  const dashFiltered = studentVisible.filter(r => {
    if (!dashQuery) return true;
    const hay = `${r.title || ''} ${r.storageBoxName || ''} ${r.subject || ''} ${r.lectureName || ''} ${r.professorName || ''}`.toLowerCase();
    return hay.includes(dashQuery);
  });

  const browseFiltered = studentVisible.filter(r => {
    const hay = `${r.title || ''} ${r.storageBoxName || ''} ${r.subject || ''} ${r.lectureName || ''} ${r.professorName || ''} ${r.classCourse || ''}`.toLowerCase();
    if (browseQuery && !hay.includes(browseQuery)) return false;
    if (subjectFilter !== 'all' && !hay.includes(subjectFilter)) return false;
    return true;
  });

  const dashRows = dashFiltered.map(rowHtml).join('');
  const allRowsHtml = browseFiltered.map(rowHtml).join('');
  const empty8 = '<tr><td colspan="8" style="text-align:center;padding:20px;">No published lectures found matching your search.</td></tr>';
  const rowsEl = document.querySelector('#rows');
  const allRowsEl = document.querySelector('#allrows');
  if (rowsEl) rowsEl.innerHTML = dashRows || empty8;
  if (allRowsEl) allRowsEl.innerHTML = allRowsHtml || empty8;

  const statSumEl = document.querySelector('#statSummaries');
  const statAudEl = document.querySelector('#statAudio');
  if (statSumEl) statSumEl.textContent = studentVisible.length;
  const totalMin = studentVisible.reduce((acc, r) => {
    const parts = (r.duration || '0:0').split(':').map(n => parseInt(n, 10) || 0);
    if (parts.length === 3) {
      return acc + parts[0] * 60 + parts[1] + parts[2] / 60;
    }
    return acc + (parts[0] || 0) + (parts[1] || 0) / 60;
  }, 0);
  if (statAudEl) statAudEl.textContent = (totalMin / 60).toFixed(1) + ' hrs';

  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
}

// ── Detail view ────────────────────────────────────────────
async function openDetail(id) {
  let rec = recordings.find(r => String(r.id) === String(id));
  if (backendAvailable) {
    try {
      const res = await fetch(`${API_BASE}/${id}`, { headers: authHeaders() });
      if (handleAuthError(res)) return;
      if (res.ok) rec = await res.json();
    } catch (e) {}
  }
  if (!rec) return;

  rec = sanitizeRecording(rec);
  currentRecording = rec;
  document.querySelector('#detailTitle').textContent = rec.title;

  // Show storage box / lecture / professor under the title
  const meta = [];
  if (rec.storageBoxName) meta.push('📦 Box: ' + rec.storageBoxName);
  else if (rec.lectureName) meta.push('Subject: ' + rec.lectureName);
  if (rec.professorName) meta.push('Prof: ' + rec.professorName);
  document.querySelector('#detailMeta').textContent = meta.length ? meta.join('  |  ') : 'Processed by Vaani AI';

  document.querySelector('#detailDuration').textContent = rec.duration || '00:00';
  document.querySelector('#detailLecture').textContent  = rec.storageBoxName || rec.lectureName || rec.subject || '-';
  document.querySelector('#detailProfessor').textContent = rec.professorName || '-';
  document.querySelector('#detailCreated').textContent  = formatLocalDisplayDate(rec.createdAtIso || rec.createdAt);
  document.querySelector('#detailStatus').textContent   = rec.status      || 'Completed';

  const isProcessing = rec.status === 'Processing';
  document.querySelector('#transcriptText').innerHTML = isProcessing
    ? '<em style="color:var(--muted,#888)">⏳ Transcribing your audio in the background… refresh will happen automatically.</em>'
    : escapeHtml(rec.transcript || 'No transcript available.').replace(/\n/g, '<br>');
  document.querySelector('#summaryText').textContent = isProcessing
    ? '⏳ Summary will appear once transcription is complete.'
    : (rec.summary || 'No summary available.');

  const audioPlayer = document.querySelector('#detailAudioPlayer');
  const audioCard = audioPlayer ? audioPlayer.closest('.card') : null;
  const downloadBtn = document.querySelector('#download');
  if (rec.hasAudio) {
    audioPlayer.src = rec.audioDataUrl ? rec.audioDataUrl : `${API_BASE}/${rec.id}/audio`;
    audioPlayer.style.display = 'block';
    if (audioCard) audioCard.style.display = 'flex';
    if (downloadBtn) downloadBtn.style.display = '';
  } else {
    audioPlayer.src = '';
    audioPlayer.style.display = 'none';
    if (audioCard) audioCard.style.display = 'none';
    if (downloadBtn) downloadBtn.style.display = 'none';
  }

  // Reset detail tabs to Transcript
  document.querySelectorAll('[data-detail]').forEach(b => b.classList.toggle('active', b.dataset.detail === 'transcript'));
  document.querySelector('#transcript').classList.remove('hidden');
  document.querySelector('#summary').classList.add('hidden');
  document.querySelector('#details').classList.add('hidden');

  page('detail');

  // Start polling if this recording is still being processed
  if (isProcessing && backendAvailable) {
    stopPolling();
    pollingInterval = setInterval(() => pollRecordingStatus(id), 3000);
  }
}

// ── Delete ─────────────────────────────────────────────────
async function deleteRecording(id) {
  if (!isFacultyRole()) {
    toast('❌ ACCESS DENIED: Only Faculty can delete recordings.');
    return;
  }
  if (!backendAvailable) {
    recordings = recordings.filter(r => String(r.id) !== String(id));
    saveLocalRecordings(recordings);
    renderRecordings();
    renderFacultyViews();
    toast('Recording deleted.');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (handleAuthError(res)) return;
    if (res.ok) {
      toast('Recording deleted.');
      await loadRecordings();
      if (currentActiveBoxId) {
        openStorageBoxDetail(currentActiveBoxId);
      }
    } else {
      toast('Failed to delete recording.');
    }
  } catch (err) {
    toast('Server error while deleting.');
  }
}

// ── Detail tab switching ───────────────────────────────────
document.querySelectorAll('[data-detail]').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('[data-detail]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    ['transcript', 'summary', 'details'].forEach(id => {
      document.querySelector('#' + id).classList.toggle('hidden', id !== b.dataset.detail);
    });
  };
});

document.querySelector('#copy').onclick = async () => {
  const text = document.querySelector('#summaryText').textContent || '';
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      throw new Error('Clipboard API unavailable');
    }
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (err) {}
    document.body.removeChild(ta);
  }
  toast('Summary copied to clipboard!');
};

document.querySelector('#download').onclick = () => {
  if (currentRecording && currentRecording.hasAudio) {
    const a = document.createElement('a');
    a.href = currentRecording.audioDataUrl
      ? currentRecording.audioDataUrl
      : `${API_BASE}/${currentRecording.id}/audio?download=1`;
    a.download = `${currentRecording.title}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast('Audio download started!');
  } else {
    toast('No audio available for download.');
  }
};

document.querySelector('#save').onclick = () => {
  const settingsName = document.getElementById('settingsName');
  const settingsSelect = document.querySelector('#settings select');
  if (settingsName && settingsName.value.trim()) {
    localStorage.setItem('vaani_user_name', settingsName.value.trim());
  }
  if (settingsSelect) {
    localStorage.setItem('vaani_summary_mode', settingsSelect.value);
  }
  setUserInfo();
  toast('Settings saved successfully.');
};

// ── SMTP Status & Diagnostic Testing ────────────────────────
async function loadSmtpStatus() {
  const statusEl = document.getElementById('smtpStatusText');
  const recipientInput = document.getElementById('smtpTestRecipient');
  const hostInput = document.getElementById('smtpHostInput');
  const portInput = document.getElementById('smtpPortInput');
  const userInput = document.getElementById('smtpUserInput');
  if (!statusEl) return;
  try {
    const res = await fetch('/api/auth/smtp-status');
    if (res.ok) {
      const data = await res.json();
      if (hostInput && !hostInput.value) hostInput.value = data.host || 'smtp.gmail.com';
      if (portInput && !portInput.value) portInput.value = data.port || 587;
      if (data.configured) {
        statusEl.innerHTML = `<span style="color:#17864a; font-weight:700;">● SMTP Active &amp; Ready</span><br>Connected to <b>${escapeHtml(data.host)}:${data.port}</b> as <code>${escapeHtml(data.user || 'configured-user')}</code> (Sender: <i>${escapeHtml(data.from)}</i>). Live verification emails will be delivered to student inboxes.`;
      } else {
        statusEl.innerHTML = `<span style="color:#d97706; font-weight:700;">▲ SMTP Not Configured</span><br>Enter your Gmail / SMTP credentials below or set <code>SMTP_USER</code> and <code>SMTP_PASS</code> in environment variables. Currently running in demo mode (verification codes are generated instantly on screen).`;
      }
      if (recipientInput && !recipientInput.value) {
        recipientInput.value = localStorage.getItem('vaani_user_email') || '';
      }
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Could not retrieve SMTP status from server.';
  }
}

// ── Gemini AI Configuration & Diagnostics ────────────────────
async function loadGeminiConfig() {
  const badge = document.getElementById('geminiStatusBadge');
  const input = document.getElementById('geminiApiKeyInput');
  const maskedNote = document.getElementById('geminiKeyMaskedNote');
  const diagGemini = document.getElementById('diagGeminiStatus');
  const diagWhisper = document.getElementById('diagWhisperStatus');

  if (!badge) return;

  try {
    const res = await fetch('/api/config/gemini', { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      if (data.configured) {
        badge.style.background = '#eaf9f0';
        badge.style.color = '#17864a';
        badge.style.borderColor = '#bbf7d0';
        badge.innerHTML = `<span>●</span> Gemini Active (${escapeHtml(data.activeModel || 'gemini-3.8-flash')})`;

        if (input && !input.value) {
          input.placeholder = `Configured (${data.maskedKey})`;
        }
        if (maskedNote) {
          maskedNote.innerHTML = `Connected with key <code>${escapeHtml(data.maskedKey)}</code> • Model: <b>${escapeHtml(data.activeModel || 'gemini-3.8-flash')}</b>`;
        }
        if (diagGemini) {
          diagGemini.style.color = '#17864a';
          diagGemini.textContent = `● Active (${data.activeModel || 'gemini-3.8-flash'})`;
        }
      } else {
        badge.style.background = '#fff4e5';
        badge.style.color = '#b45309';
        badge.style.borderColor = '#fed7aa';
        badge.innerHTML = `<span>▲</span> API Key Not Configured`;

        if (input && !input.value) {
          input.placeholder = 'AIzaSy... (Paste your Google Gemini API key)';
        }
        if (maskedNote) {
          maskedNote.innerHTML = '<span style="color:#b45309;">No Gemini API Key found. Automatic transcription will use fallback until a key is added.</span>';
        }
        if (diagGemini) {
          diagGemini.style.color = '#b45309';
          diagGemini.textContent = '▲ Key required';
        }
      }

      if (diagWhisper) {
        diagWhisper.textContent = data.hasWhisperPython ? '● Ready (transcribe_whisper.py)' : '○ Standby';
      }
    }
  } catch (err) {
    if (badge) {
      badge.innerHTML = '<span style="color:#b45309;">▲ Offline</span>';
    }
  }
}

// Wire Gemini buttons
const saveGeminiKeyBtn = document.getElementById('saveGeminiKeyBtn');
if (saveGeminiKeyBtn) {
  saveGeminiKeyBtn.onclick = async () => {
    const input = document.getElementById('geminiApiKeyInput');
    const key = input ? input.value.trim() : '';

    if (!key) {
      toast('Please enter your Gemini API Key first.');
      return;
    }

    const origText = saveGeminiKeyBtn.innerHTML;
    saveGeminiKeyBtn.disabled = true;
    saveGeminiKeyBtn.innerHTML = '⏳ Verifying with Gemini API...';

    try {
      const res = await fetch('/api/config/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ apiKey: key }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        toast('✅ ' + data.message);
        if (input) input.value = '';
        await loadGeminiConfig();
      } else {
        toast('❌ ' + (data.error || 'Failed to verify Gemini API Key.'));
      }
    } catch (err) {
      toast('❌ Connection error: ' + (err.message || String(err)));
    } finally {
      saveGeminiKeyBtn.disabled = false;
      saveGeminiKeyBtn.innerHTML = origText;
    }
  };
}

const testGeminiKeyBtn = document.getElementById('testGeminiKeyBtn');
if (testGeminiKeyBtn) {
  testGeminiKeyBtn.onclick = async () => {
    const input = document.getElementById('geminiApiKeyInput');
    const key = input ? input.value.trim() : '';

    const origText = testGeminiKeyBtn.innerHTML;
    testGeminiKeyBtn.disabled = true;
    testGeminiKeyBtn.innerHTML = '⏳ Testing connection...';

    try {
      const res = await fetch('/api/config/gemini/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ apiKey: key || undefined }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        toast('⚡ ' + data.message);
      } else {
        toast('❌ ' + (data.error || 'Connection failed.'));
      }
    } catch (err) {
      toast('❌ Connection error: ' + (err.message || String(err)));
    } finally {
      testGeminiKeyBtn.disabled = false;
      testGeminiKeyBtn.innerHTML = origText;
    }
  };
}

const clearGeminiKeyBtn = document.getElementById('clearGeminiKeyBtn');
if (clearGeminiKeyBtn) {
  clearGeminiKeyBtn.onclick = async () => {
    if (!confirm('Are you sure you want to remove the configured Gemini API key?')) return;
    try {
      const res = await fetch('/api/config/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ clear: true }),
      });
      if (res.ok) {
        toast('🗑️ Gemini API key cleared.');
        const input = document.getElementById('geminiApiKeyInput');
        if (input) input.value = '';
        await loadGeminiConfig();
      }
    } catch (err) {
      toast('❌ Failed to clear key.');
    }
  };
}

const toggleGeminiKeyVisibility = document.getElementById('toggleGeminiKeyVisibility');
if (toggleGeminiKeyVisibility) {
  toggleGeminiKeyVisibility.onclick = () => {
    const input = document.getElementById('geminiApiKeyInput');
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      toggleGeminiKeyVisibility.textContent = '🔒';
    } else {
      input.type = 'password';
      toggleGeminiKeyVisibility.textContent = '👁️';
    }
  };
}

document.querySelector('#logout').onclick = async () => {
  const token = getAuthToken();
  if (token) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: authHeaders()
      });
    } catch (e) {}
  }
  localStorage.removeItem('vaani_auth_token');
  localStorage.removeItem('vaani_user_name');
  localStorage.removeItem('vaani_user_email');
  toast('Logged out successfully.');
  setTimeout(() => {
    window.location.href = 'login.html';
  }, 400);
};

// ═══════════════════════════════════════════════════════════════════════════
// 👨‍🏫 FACULTY INTERFACE LOGIC
// ═══════════════════════════════════════════════════════════════════════════

// Header Logout Button (in addition to sidebar logout)
const headerLogoutBtn = document.getElementById('headerLogoutBtn');
if (headerLogoutBtn) {
  headerLogoutBtn.onclick = () => {
    const logoutBtn = document.getElementById('logout');
    if (logoutBtn) logoutBtn.click();
  };
}

// Student Search & Subject Filter Listeners
const studentDashSearch = document.getElementById('studentDashSearch');
const studentBrowseSearch = document.getElementById('studentBrowseSearch');
const studentSubjectFilter = document.getElementById('studentSubjectFilter');

if (studentDashSearch) studentDashSearch.addEventListener('input', renderRecordings);
if (studentBrowseSearch) studentBrowseSearch.addEventListener('input', renderRecordings);
if (studentSubjectFilter) studentSubjectFilter.addEventListener('change', renderRecordings);

// Default Faculty Upload Date to Today
const facDateInput = document.getElementById('facDateInput');
if (facDateInput && !facDateInput.value) {
  facDateInput.value = new Date().toISOString().slice(0, 10);
}

function getFacultyStatusBadgeHtml(rec) {
  const st = rec.facultyStatus || (rec.published !== false ? 'PUBLISHED' : 'READY');
  if (st === 'PUBLISHED') {
    return '<span class="badge badge-published"><i data-lucide="check-circle-2"></i> Published</span>';
  }
  if (st === 'PROCESSING') {
    return '<span class="badge badge-processing"><i data-lucide="loader-2"></i> Processing</span>';
  }
  if (st === 'DRAFT') {
    return '<span class="badge badge-draft"><i data-lucide="file-edit"></i> Draft</span>';
  }
  return '<span class="badge badge-ready"><i data-lucide="eye"></i> Ready for Review</span>';
}

function facultyRowHtml(x, showPublishToggle = true) {
  const displayDate = x.lectureDate || formatLocalDisplayDate(x.createdAtIso || x.createdAt);
  const isPub = x.facultyStatus === 'PUBLISHED' || x.published === true;
  const pubBtn = showPublishToggle
    ? (isPub
        ? `<button class="outline act-btn fac-pub-toggle" data-id="${x.id}" data-publish="0" style="color:var(--warning);border-color:var(--warning-border);"><i data-lucide="lock"></i> Unpublish</button>`
        : `<button class="primary act-btn fac-pub-toggle" data-id="${x.id}" data-publish="1" style="background:var(--success);border-color:var(--success);"><i data-lucide="send"></i> Publish</button>`)
    : '';
  const boxOrSubject = x.storageBoxName
    ? `<span class="box-tag"><i data-lucide="archive"></i> ${escapeHtml(x.storageBoxName)}</span>`
    : escapeHtml(x.subject || x.lectureName || 'General');

  return `
    <tr>
      <td><b>${escapeHtml(x.title)}</b></td>
      <td>${boxOrSubject}</td>
      <td>${escapeHtml(x.classCourse || 'SE Computer Engineering')}</td>
      <td>${escapeHtml(displayDate)}</td>
      <td>${getFacultyStatusBadgeHtml(x)}</td>
      <td>${escapeHtml(x.duration || '00:00')}</td>
      <td style="white-space:nowrap;">
        <button class="outline act-btn fac-review-btn" data-id="${x.id}" data-edit="0"><i data-lucide="eye"></i> Review</button>
        <button class="outline act-btn fac-review-btn" data-id="${x.id}" data-edit="1"><i data-lucide="edit-3"></i> Edit</button>
        ${pubBtn}
        <button class="outline act-btn delete-rec" data-id="${x.id}" style="color:var(--danger);border-color:var(--danger-border);"><i data-lucide="trash-2"></i> Delete</button>
      </td>
    </tr>`;
}

function renderFacultyViews() {
  const total = recordings.length;
  const publishedCount = recordings.filter(r => r.facultyStatus === 'PUBLISHED' || r.published === true).length;
  const processingCount = recordings.filter(r => r.facultyStatus === 'PROCESSING' || r.status === 'Processing').length;
  const draftCount = recordings.filter(r => {
    const st = r.facultyStatus || (r.published !== false ? 'PUBLISHED' : 'READY');
    return st === 'DRAFT' || st === 'READY';
  }).length;

  const elTotal = document.getElementById('facStatTotal');
  const elPub = document.getElementById('facStatPublished');
  const elDraft = document.getElementById('facStatDraft');
  const elProc = document.getElementById('facStatProcessing');

  if (elTotal) elTotal.textContent = String(total);
  if (elPub) elPub.textContent = String(publishedCount);
  if (elDraft) elDraft.textContent = String(draftCount);
  if (elProc) elProc.textContent = String(processingCount);

  // Recent Lectures table on Faculty Dashboard
  const recentRowsEl = document.getElementById('facultyRecentRows');
  const emptyRow = '<tr><td colspan="7" style="text-align:center;padding:24px;">No lectures uploaded yet. Click "+ Upload New Lecture" to get started.</td></tr>';
  if (recentRowsEl) {
    recentRowsEl.innerHTML = recordings.slice(0, 6).map(r => facultyRowHtml(r, true)).join('') || emptyRow;
  }

  // My Lectures page table (with search & status filter)
  const allRowsEl = document.getElementById('facultyAllRows');
  const q = (document.getElementById('facSearchInput')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('facFilterStatus')?.value || 'ALL';

  const filtered = recordings.filter(r => {
    const st = r.facultyStatus || (r.published !== false ? 'PUBLISHED' : 'READY');
    if (statusFilter !== 'ALL' && st !== statusFilter) return false;
    if (q) {
      const hay = `${r.title || ''} ${r.storageBoxName || ''} ${r.subject || ''} ${r.lectureName || ''} ${r.classCourse || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (allRowsEl) {
    allRowsEl.innerHTML = filtered.map(r => facultyRowHtml(r, true)).join('') || emptyRow;
  }

  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();

  // If Analytics section is visible, keep it in sync with fresh recordings
  if (document.getElementById('facultyAnalytics')?.classList.contains('active')) {
    loadFacultyAnalytics();
  }
}

// ═══════════════════════════════════════════════════════════════════
// 📊 VAANI FACULTY ANALYTICS CONTROLLER
// ═══════════════════════════════════════════════════════════════════

const facultyAnalyticsState = {
  data: null,
  loading: false,
  error: null,
  selectedDate: null, // 'YYYY-MM-DD'
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(), // 0-11
  weekOffset: 0, // 0 = current week, -1 = last week, +1 = next week
  activityFilter: '',
  tableDateFilter: null,
  eventsInitialized: false,
};

// Date math helper for 7-day week (Monday to Sunday)
function getWeekRangeAndDays(offset = 0) {
  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth();
  const todayD = today.getDate();
  const todayStr = `${todayY}-${String(todayM + 1).padStart(2, '0')}-${String(todayD).padStart(2, '0')}`;

  const dayOfWeek = today.getDay(); // 0 is Sun, 1 is Mon
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const mondayTime = new Date(todayY, todayM, todayD + diffToMonday + (offset * 7)).getTime();

  const days = [];
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayTime + i * 86400000);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const dateNum = d.getDate();
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(dateNum).padStart(2, '0')}`;
    days.push({
      dateStr,
      dayName: dayNames[i],
      dateNum,
      isToday: dateStr === todayStr,
      fullDate: d,
    });
  }

  const startDay = days[0];
  const endDay = days[6];
  const startMonthName = startDay.fullDate.toLocaleString('default', { month: 'short' });
  const endMonthName = endDay.fullDate.toLocaleString('default', { month: 'short' });

  const rangeLabel = startMonthName === endMonthName
    ? `${startMonthName} ${startDay.dateNum} &ndash; ${endDay.dateNum}, ${startDay.fullDate.getFullYear()}`
    : `${startMonthName} ${startDay.dateNum} &ndash; ${endMonthName} ${endDay.dateNum}, ${endDay.fullDate.getFullYear()}`;

  return {
    days,
    startStr: startDay.dateStr,
    endStr: endDay.dateStr,
    rangeLabel,
    isCurrentWeek: offset === 0,
  };
}

// Month calendar grid helper
function getMonthCalendarGrid(year, month) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const totalDays = lastDay.getDate();

  let startDayOfWeek = firstDay.getDay() - 1; // 0 for Monday, 6 for Sunday
  if (startDayOfWeek === -1) startDayOfWeek = 6;

  const prevMonthLastDay = new Date(year, month, 0).getDate();
  const cells = [];

  // Trailing days from previous month
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const dayNum = prevMonthLastDay - i;
    const prevDate = new Date(year, month - 1, dayNum);
    const pY = prevDate.getFullYear();
    const pM = prevDate.getMonth() + 1;
    const dateStr = `${pY}-${String(pM).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    cells.push({
      dateStr,
      dayNum,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
    });
  }

  // Days of current month
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      dateStr,
      dayNum: d,
      isCurrentMonth: true,
      isToday: dateStr === todayStr,
    });
  }

  // Leading days of next month to complete 7-column rows
  const remaining = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const nextDate = new Date(year, month + 1, d);
    const nY = nextDate.getFullYear();
    const nM = nextDate.getMonth() + 1;
    const dateStr = `${nY}-${String(nM).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      dateStr,
      dayNum: d,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
    });
  }

  const monthTitle = firstDay.toLocaleString('default', { month: 'long', year: 'numeric' });
  return { cells, monthTitle, totalDays };
}

// Fetch analytics data from server
async function loadFacultyAnalytics(forceRefresh = false) {
  if (facultyAnalyticsState.loading && !forceRefresh) return;

  initFacultyAnalyticsEvents();
  renderAnalyticsLoading(true);

  try {
    const res = await fetch('/api/faculty/analytics', { headers: authHeaders() });
    if (handleAuthError(res)) return;

    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    const data = await res.json();
    facultyAnalyticsState.data = data;
    facultyAnalyticsState.loading = false;
    facultyAnalyticsState.error = null;

    // Pick a sensible default selected date for the calendar
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (!facultyAnalyticsState.selectedDate) {
      if (data.publishedDatesMap && data.publishedDatesMap[todayStr]) {
        facultyAnalyticsState.selectedDate = todayStr;
      } else {
        // If today has no lectures, check if any date in the current month has lectures
        const monthPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        const datesInMonth = Object.keys(data.publishedDatesMap || {}).filter(d => d.startsWith(monthPrefix)).sort();
        facultyAnalyticsState.selectedDate = datesInMonth.length > 0 ? datesInMonth[datesInMonth.length - 1] : todayStr;
      }
    }

    renderAnalyticsSuccess();
  } catch (err) {
    console.error('[Analytics] Failed to fetch data:', err);
    facultyAnalyticsState.loading = false;
    facultyAnalyticsState.error = err.message || 'Could not connect to analytics service.';
    renderAnalyticsError(facultyAnalyticsState.error);
  }
}

// Render elegant loading skeletons across analytics cards, chart, calendar, and tables
function renderAnalyticsLoading(isLoading) {
  facultyAnalyticsState.loading = isLoading;
  const errorBanner = document.getElementById('anaErrorBanner');
  if (errorBanner) errorBanner.classList.add('hidden');

  if (!isLoading) return;

  // 4 Top KPI skeleton stats
  const kpiIds = ['anaTotalRegistered', 'anaTotalEnrolled', 'anaTotalPlays', 'anaPublishedCount'];
  kpiIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<span class="ana-skeleton ana-skeleton-stat"></span>';
  });

  // Wellbeing skeleton stats
  const weekCountEl = document.getElementById('anaPublishedWeekCount');
  const monthCountEl = document.getElementById('anaPublishedMonthCount');
  if (weekCountEl) weekCountEl.innerHTML = '<span class="ana-skeleton ana-skeleton-stat"></span>';
  if (monthCountEl) monthCountEl.innerHTML = '<span class="ana-skeleton ana-skeleton-stat"></span>';

  // Wellbeing bars skeleton
  const barsContainer = document.getElementById('anaWeekBarsContainer');
  if (barsContainer) {
    barsContainer.innerHTML = Array(7).fill(0).map((_, i) => `
      <div class="wellbeing-bar-col">
        <div class="wellbeing-bar-track">
          <div class="ana-skeleton" style="width:100%;height:${35 + (i * 8)}%;"></div>
        </div>
        <div class="wellbeing-day-label">
          <span class="ana-skeleton" style="width:20px;height:12px;"></span>
        </div>
      </div>
    `).join('');
  }

  // Calendar skeleton cells
  const calGrid = document.getElementById('anaCalendarGrid');
  if (calGrid) {
    calGrid.innerHTML = Array(28).fill(0).map(() => `
      <div class="ana-cal-cell" style="cursor:default;">
        <span class="ana-skeleton" style="width:20px;height:20px;border-radius:4px;"></span>
      </div>
    `).join('');
  }

  // Selected date details skeleton
  const detailList = document.getElementById('anaCalDetailList');
  if (detailList) {
    detailList.innerHTML = `
      <div class="ana-cal-lecture-card">
        <div class="ana-skeleton ana-skeleton-title"></div>
        <div class="ana-skeleton ana-skeleton-text" style="width:60%;"></div>
        <div class="ana-skeleton ana-skeleton-text" style="width:40%;"></div>
      </div>
    `;
  }

  // Recent activity skeleton rows
  const actRows = document.getElementById('anaRecentActivityRows');
  if (actRows) {
    actRows.innerHTML = `
      <tr><td colspan="5" style="padding:18px;"><div class="ana-skeleton ana-skeleton-text"></div></td></tr>
      <tr><td colspan="5" style="padding:18px;"><div class="ana-skeleton ana-skeleton-text" style="width:85%;"></div></td></tr>
      <tr><td colspan="5" style="padding:18px;"><div class="ana-skeleton ana-skeleton-text" style="width:70%;"></div></td></tr>
    `;
  }

  // Breakdown table skeleton rows
  const tableRows = document.getElementById('facultyAnalyticsRows');
  if (tableRows) {
    tableRows.innerHTML = `
      <tr><td colspan="7" style="padding:18px;"><div class="ana-skeleton ana-skeleton-text"></div></td></tr>
      <tr><td colspan="7" style="padding:18px;"><div class="ana-skeleton ana-skeleton-text" style="width:80%;"></div></td></tr>
      <tr><td colspan="7" style="padding:18px;"><div class="ana-skeleton ana-skeleton-text" style="width:65%;"></div></td></tr>
    `;
  }
}

// Render error banner with retry action
function renderAnalyticsError(msg) {
  const errorBanner = document.getElementById('anaErrorBanner');
  const errorMsgEl = document.getElementById('anaErrorMsg');
  if (errorBanner) {
    errorBanner.classList.remove('hidden');
    if (errorMsgEl) errorMsgEl.textContent = msg || 'Could not load analytics. Check server connection.';
  }

  // Reset KPI cards to dashes
  ['anaTotalRegistered', 'anaTotalEnrolled', 'anaTotalPlays', 'anaPublishedCount'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });

  const weekCountEl = document.getElementById('anaPublishedWeekCount');
  const monthCountEl = document.getElementById('anaPublishedMonthCount');
  if (weekCountEl) weekCountEl.textContent = '—';
  if (monthCountEl) monthCountEl.textContent = '—';

  // Details empty state
  const detailList = document.getElementById('anaCalDetailList');
  if (detailList) {
    detailList.innerHTML = `
      <div class="ana-empty-state">
        <div class="ana-empty-icon">⚠️</div>
        <h3 class="ana-empty-title">Analytics Temporarily Unavailable</h3>
        <p class="ana-empty-desc">Failed to connect to the backend analytics server. Click retry to refresh.</p>
        <button type="button" class="primary" onclick="loadFacultyAnalytics(true)">🔄 Retry Analytics</button>
      </div>
    `;
  }

  // Activity stream error state
  const actRows = document.getElementById('anaRecentActivityRows');
  if (actRows) {
    actRows.innerHTML = `
      <tr><td colspan="5" style="text-align:center;padding:32px;" class="muted">
        ⚠️ Unable to load access logs. <button type="button" class="outline" onclick="loadFacultyAnalytics(true)" style="margin-left:8px;padding:4px 10px;font-size:12px;">Retry</button>
      </td></tr>
    `;
  }

  // Breakdown error state
  const tableRows = document.getElementById('facultyAnalyticsRows');
  if (tableRows) {
    tableRows.innerHTML = `
      <tr><td colspan="7" style="text-align:center;padding:32px;" class="muted">
        ⚠️ Unable to load lecture breakdown data. <button type="button" class="outline" onclick="loadFacultyAnalytics(true)" style="margin-left:8px;padding:4px 10px;font-size:12px;">Retry</button>
      </td></tr>
    `;
  }
}

// Render all sections upon successful data retrieval
function renderAnalyticsSuccess() {
  const data = facultyAnalyticsState.data;
  if (!data) return;

  // 1. KPI cards
  const elReg = document.getElementById('anaTotalRegistered');
  const elEnr = document.getElementById('anaTotalEnrolled');
  const elPls = document.getElementById('anaTotalPlays');
  const elPub = document.getElementById('anaPublishedCount');

  if (elReg) elReg.textContent = String(data.totalRegisteredStudents || 0);
  if (elEnr) elEnr.textContent = String(data.totalStudentsOnFacultyLectures || 0);
  if (elPls) elPls.textContent = String(data.totalPlays || 0);
  if (elPub) elPub.textContent = String(data.publishedLectures || 0);

  // 2. Digital Wellbeing Section
  renderWellbeingSection();

  // 3. Interactive Calendar
  renderInteractiveCalendar();

  // 4. Selected Date Details
  renderSelectedDateDetails();

  // 5. Recent Activity Feed
  renderRecentActivityStream();

  // 6. Lecture Engagement Breakdown Table
  renderAnalyticsLecturesTable();

  // Re-initialize lucide icons
  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

// ── 🌿 Digital Wellbeing Overview & 7-Day Bar Chart ───────────────────────────
function renderWellbeingSection() {
  const data = facultyAnalyticsState.data;
  if (!data) return;

  const weekData = getWeekRangeAndDays(facultyAnalyticsState.weekOffset);
  const lectureStats = data.lectureStats || [];

  // Count published lectures for the week currently displayed in chart
  const weekLectures = lectureStats.filter(r => {
    if (!r.published) return false;
    const pDate = r.lectureDate || '';
    return pDate >= weekData.startStr && pDate <= weekData.endStr;
  });
  const weekCount = weekData.isCurrentWeek && typeof data.publishedThisWeek === 'number'
    ? data.publishedThisWeek
    : weekLectures.length;

  // Count published lectures for current month
  const monthCount = typeof data.publishedThisMonth === 'number'
    ? data.publishedThisMonth
    : lectureStats.filter(r => r.published).length;

  // Update Tile Numbers
  const weekNumEl = document.getElementById('anaPublishedWeekCount');
  const monthNumEl = document.getElementById('anaPublishedMonthCount');
  const weekRangeEl = document.getElementById('anaWeekDateRangeLabel');
  const monthBadgeEl = document.getElementById('anaMonthNameBadge');
  const monthRangeEl = document.getElementById('anaMonthDateRangeLabel');
  const weekProgressEl = document.getElementById('anaWeekProgressFill');
  const monthProgressEl = document.getElementById('anaMonthProgressFill');
  const weekGoalText = document.getElementById('anaWeekGoalText');
  const streakBadge = document.getElementById('anaStreakBadge');

  if (weekNumEl) weekNumEl.textContent = String(weekCount);
  if (monthNumEl) monthNumEl.textContent = String(monthCount);
  if (weekRangeEl) weekRangeEl.innerHTML = weekData.rangeLabel;

  const currentMonthName = new Date().toLocaleString('default', { month: 'long' });
  if (monthBadgeEl) monthBadgeEl.textContent = currentMonthName;
  if (monthRangeEl) monthRangeEl.textContent = `Full month of ${currentMonthName}`;

  // Progress tracks loaded directly from SQLite database (defaults 3 / 6)
  const weeklyTarget = Number(data.weeklyTarget) || 3;
  const monthlyTarget = Number(data.monthlyTarget) || 6;

  const weekPct = Math.min(100, Math.round((weekCount / weeklyTarget) * 100));
  if (weekProgressEl) weekProgressEl.style.width = `${weekPct}%`;
  if (weekGoalText) {
    weekGoalText.textContent = weekCount >= weeklyTarget
      ? `Goal achieved: ${weekCount}/${weeklyTarget} lectures / week`
      : `Weekly Target: ${weekCount}/${weeklyTarget} lectures (${weekPct}%)`;
  }

  const monthPct = Math.min(100, Math.round((monthCount / monthlyTarget) * 100));
  if (monthProgressEl) monthProgressEl.style.width = `${monthPct}%`;
  const monthFooterText = document.getElementById('anaMonthSummaryText');
  if (monthFooterText) {
    monthFooterText.textContent = monthCount >= monthlyTarget
      ? `Monthly Goal Met: ${monthCount}/${monthlyTarget} published`
      : `Monthly Pace: ${monthCount}/${monthlyTarget} (${monthPct}%)`;
  }

  if (streakBadge) {
    if (weekCount >= weeklyTarget) {
      streakBadge.textContent = '🌟 Peak Teaching Momentum';
      streakBadge.style.color = '#15803d';
      streakBadge.style.background = '#f0fdf4';
      streakBadge.style.borderColor = '#bbf7d0';
    } else if (weekCount > 0) {
      streakBadge.textContent = '🟢 Steady Teaching Rhythm';
      streakBadge.style.color = '#15803d';
      streakBadge.style.background = '#f0fdf4';
      streakBadge.style.borderColor = '#bbf7d0';
    } else {
      streakBadge.textContent = '🌿 Rest & Prep Cadence';
      streakBadge.style.color = '#b45309';
      streakBadge.style.background = '#fffbeb';
      streakBadge.style.borderColor = '#fde68a';
    }
  }

  // Chart Header label
  const chartWeekRangeLabel = document.getElementById('anaChartWeekRangeLabel');
  if (chartWeekRangeLabel) {
    chartWeekRangeLabel.innerHTML = weekData.rangeLabel;
  }

  // Render 7-day mini bar chart
  const barsContainer = document.getElementById('anaWeekBarsContainer');
  if (!barsContainer) return;

  // Calculate day-by-day counts for the week
  const dayStats = weekData.days.map(d => {
    const dayRecs = lectureStats.filter(r => r.published && r.lectureDate === d.dateStr);
    return {
      ...d,
      count: dayRecs.length,
      lectures: dayRecs,
    };
  });

  const maxDayCount = Math.max(1, ...dayStats.map(d => d.count));
  const totalChartLectures = dayStats.reduce((sum, d) => sum + d.count, 0);

  const summaryHint = document.getElementById('anaChartWeekSummaryHint');
  if (summaryHint) {
    summaryHint.textContent = totalChartLectures === 1
      ? '1 lecture in this week'
      : `${totalChartLectures} lectures in this week`;
  }

  barsContainer.innerHTML = dayStats.map(d => {
    const isSelected = facultyAnalyticsState.selectedDate === d.dateStr;
    const heightPct = d.count > 0 ? Math.max(22, Math.round((d.count / maxDayCount) * 82)) : 0;
    const hasCountClass = d.count > 0 ? 'has-count' : '';
    const todayClass = d.isToday ? 'today' : '';
    const badgeHtml = d.count > 0 ? `<span class="wellbeing-bar-count-badge">${d.count}</span>` : '';

    return `
      <div class="wellbeing-bar-col ${isSelected ? 'selected' : ''}" data-date="${d.dateStr}" title="${escapeHtml(d.dayName)}, ${escapeHtml(d.dateStr)}: ${d.count} published lecture${d.count === 1 ? '' : 's'}">
        ${badgeHtml}
        <div class="wellbeing-bar-track" style="${isSelected ? 'background:#dcd0ff;border:1px solid var(--p);' : ''}">
          <div class="wellbeing-bar-fill ${hasCountClass}" style="height:${heightPct}%;"></div>
        </div>
        <div class="wellbeing-day-label ${todayClass}">
          <span class="wellbeing-day-pill">${d.dateNum}</span>
          <span style="font-size:10.5px;">${d.dayName}</span>
        </div>
      </div>
    `;
  }).join('');

  // Wire click on day bars to focus calendar and details
  barsContainer.querySelectorAll('.wellbeing-bar-col').forEach(col => {
    col.addEventListener('click', () => {
      const dateStr = col.dataset.date;
      if (!dateStr) return;
      selectAnalyticsDate(dateStr);
    });
  });
}

// ── 📅 Interactive Calendar ───────────────────────────────────────────────────
function renderInteractiveCalendar() {
  const data = facultyAnalyticsState.data;
  if (!data) return;

  const year = facultyAnalyticsState.calendarYear;
  const month = facultyAnalyticsState.calendarMonth;
  const monthData = getMonthCalendarGrid(year, month);

  const titleEl = document.getElementById('calMonthYearTitle');
  if (titleEl) titleEl.textContent = monthData.monthTitle;

  const calGrid = document.getElementById('anaCalendarGrid');
  if (!calGrid) return;

  const publishedMap = data.publishedDatesMap || {};
  const selectedDate = facultyAnalyticsState.selectedDate;

  calGrid.innerHTML = monthData.cells.map(cell => {
    const dateStr = cell.dateStr;
    const dayLectures = publishedMap[dateStr] || [];
    const hasLectures = dayLectures.length > 0;
    const lectureCount = dayLectures.length;
    const isSelected = selectedDate === dateStr;

    let markerHtml = '';
    if (hasLectures) {
      if (lectureCount > 1) {
        markerHtml = `<span class="ana-cal-lecture-badge">${lectureCount}</span>`;
      } else {
        markerHtml = `<div class="ana-cal-dot-wrap"><span class="ana-cal-dot"></span></div>`;
      }
    } else {
      markerHtml = `<div class="ana-cal-dot-wrap"></div>`;
    }

    const classes = [
      'ana-cal-cell',
      cell.isCurrentMonth ? '' : 'other-month',
      cell.isToday ? 'today' : '',
      hasLectures ? 'has-lectures' : '',
      isSelected ? 'selected' : '',
    ].filter(Boolean).join(' ');

    const titleText = `${dateStr}${hasLectures ? ' • ' + lectureCount + ' lecture(s)' : ''}`;

    return `
      <button type="button" class="${classes}" data-date="${dateStr}" data-curr="${cell.isCurrentMonth ? 1 : 0}" title="${titleText}">
        <span>${cell.dayNum}</span>
        ${markerHtml}
      </button>
    `;
  }).join('');

  // Attach click listener to calendar day cells
  calGrid.querySelectorAll('.ana-cal-cell').forEach(btn => {
    btn.addEventListener('click', () => {
      const dateStr = btn.dataset.date;
      const isCurr = btn.dataset.curr === '1';
      if (!dateStr) return;

      if (!isCurr) {
        // If clicking a trailing/leading day from adjacent month, shift view to that month
        const [y, m] = dateStr.split('-').map(Number);
        facultyAnalyticsState.calendarYear = y;
        facultyAnalyticsState.calendarMonth = m - 1;
      }

      selectAnalyticsDate(dateStr);
    });
  });

  // Toggle clear filter button visibility
  const clearBtn = document.getElementById('calClearFilterBtn');
  if (clearBtn) {
    clearBtn.classList.toggle('hidden', !selectedDate);
  }
}

// Select a date across calendar, details inspector, wellbeing bars, and table
function selectAnalyticsDate(dateStr) {
  facultyAnalyticsState.selectedDate = dateStr;
  renderInteractiveCalendar();
  renderSelectedDateDetails();
  renderWellbeingSection(); // highlight selected day bar

  // Optionally scroll smoothly to date details if on mobile
  if (window.innerWidth < 960) {
    const detailCard = document.getElementById('anaCalDetailCard');
    if (detailCard) detailCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// Format date into human-friendly string (e.g. "Tuesday, October 20, 2026")
function formatFriendlyDate(dateStr) {
  if (!dateStr) return 'Selected Date';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0));
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// ── 🗓️ Selected Date Inspector & Details ───────────────────────────────────────
function renderSelectedDateDetails() {
  const data = facultyAnalyticsState.data;
  const detailList = document.getElementById('anaCalDetailList');
  const countBadge = document.getElementById('calSelectedDateCountBadge');
  const subtitleEl = document.getElementById('calSelectedDateSubtitle');

  if (!detailList || !data) return;

  const dateStr = facultyAnalyticsState.selectedDate;

  if (!dateStr) {
    if (subtitleEl) subtitleEl.textContent = 'Select a date on the calendar';
    if (countBadge) countBadge.textContent = '0 Lectures';
    detailList.innerHTML = `
      <div class="ana-empty-state">
        <div class="ana-empty-icon"><i data-lucide="calendar"></i></div>
        <h3 class="ana-empty-title">No Date Selected</h3>
        <p class="ana-empty-desc">Click any calendar date to inspect lectures published or scheduled on that day.</p>
        <button type="button" class="primary" id="calPickTodayBtn">Select Today</button>
      </div>
    `;
    const pickToday = document.getElementById('calPickTodayBtn');
    if (pickToday) {
      pickToday.addEventListener('click', () => {
        const now = new Date();
        const tStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        selectAnalyticsDate(tStr);
      });
    }
    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
    return;
  }

  const friendlyDate = formatFriendlyDate(dateStr);
  if (subtitleEl) subtitleEl.textContent = friendlyDate;

  // Filter lectures matching this date
  const lectureStats = data.lectureStats || [];
  const matchingLectures = lectureStats.filter(r => r.lectureDate === dateStr);
  const count = matchingLectures.length;

  if (countBadge) {
    countBadge.textContent = count === 1 ? '1 Lecture' : `${count} Lectures`;
    countBadge.className = count > 0 ? 'badge badge-published' : 'badge';
  }

  // 1. CLEAR EMPTY STATE if no lectures on this date
  if (count === 0) {
    detailList.innerHTML = `
      <div class="ana-empty-state">
        <div class="ana-empty-icon"><i data-lucide="calendar-x-2"></i></div>
        <h3 class="ana-empty-title">No Lectures on this Day</h3>
        <p class="ana-empty-desc">No classroom lectures were published on <b>${escapeHtml(friendlyDate)}</b>. You can pick any highlighted date with a dot marker, or create a new lecture.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
          <button type="button" class="primary cal-new-on-date-btn" data-page="facultyUpload">+ Create New Lecture on this Date</button>
          <button type="button" class="outline" id="calJumpLatestBtn">Jump to Latest Lecture</button>
        </div>
      </div>
    `;

    const newOnDateBtn = detailList.querySelector('.cal-new-on-date-btn');
    if (newOnDateBtn) {
      newOnDateBtn.addEventListener('click', () => {
        const facDateIn = document.getElementById('facDateInput');
        if (facDateIn) facDateIn.value = dateStr;
      });
    }

    const jumpBtn = document.getElementById('calJumpLatestBtn');
    if (jumpBtn) {
      jumpBtn.addEventListener('click', () => {
        const dates = Object.keys(data.publishedDatesMap || {}).sort();
        if (dates.length > 0) {
          const latest = dates[dates.length - 1];
          const [y, m] = latest.split('-').map(Number);
          facultyAnalyticsState.calendarYear = y;
          facultyAnalyticsState.calendarMonth = m - 1;
          selectAnalyticsDate(latest);
        } else {
          toast('No published lectures found.');
        }
      });
    }

    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
    return;
  }

  // 2. RENDER LECTURE DETAILS CARDS WITH SQLITE CONTROLS
  detailList.innerHTML = matchingLectures.map(lec => {
    const isPub = lec.published;
    const statusBadge = isPub
      ? '<span class="badge badge-published">🚀 PUBLISHED</span>'
      : (lec.status === 'READY' ? '<span class="badge badge-ready">✅ READY</span>' : '<span class="badge badge-draft">📝 DRAFT</span>');

    const boxTag = lec.storageBoxName ? `📦 ${escapeHtml(lec.storageBoxName)}` : (lec.subject ? escapeHtml(lec.subject) : 'General');

    return `
      <div class="ana-cal-lecture-card" data-id="${lec.id}">
        <div class="ana-cal-lecture-head">
          <div>
            <h4 class="ana-cal-lecture-title">${escapeHtml(lec.title)}</h4>
            <div class="ana-cal-lecture-meta" style="margin-top:4px;">
              <span>${boxTag}</span>
              <span>&bull;</span>
              <span>${escapeHtml(lec.classCourse || 'SE Computer Engineering')}</span>
            </div>
          </div>
          <div>${statusBadge}</div>
        </div>

        <div class="ana-cal-lecture-meta" style="background:#fff;padding:8px 12px;border-radius:7px;border:1px solid var(--border);margin:6px 0;display:flex;flex-wrap:wrap;gap:12px;align-items:center;font-size:12px;color:var(--muted);">
          <span style="display:inline-flex;align-items:center;gap:4px;"><i data-lucide="clock" style="width:13px;height:13px;"></i> Duration: <b style="color:var(--text);">${escapeHtml(lec.duration || '00:00')}</b></span>
          <span>&bull;</span>
          <span style="display:inline-flex;align-items:center;gap:4px;"><i data-lucide="play" style="width:13px;height:13px;"></i> Plays: <b style="color:var(--text);">${lec.playsCount || 0}</b></span>
          <span>&bull;</span>
          <span style="display:inline-flex;align-items:center;gap:4px;"><i data-lucide="users" style="width:13px;height:13px;"></i> Students: <b style="color:var(--text);">${lec.studentsAccessed || 0}</b></span>
          <span>&bull;</span>
          <span style="display:inline-flex;align-items:center;gap:4px;"><i data-lucide="hourglass" style="width:13px;height:13px;"></i> Avg: <b style="color:var(--text);">${escapeHtml(lec.avgListeningTime || '0m 00s')}</b></span>
        </div>

        <div class="ana-cal-lecture-actions" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
          <button type="button" class="primary act-btn cal-act-review" data-id="${lec.id}" style="padding:6px 12px;font-size:12px;display:inline-flex;align-items:center;gap:5px;">
            <i data-lucide="eye" style="width:13px;height:13px;"></i> Review &amp; Edit
          </button>
          <button type="button" class="outline act-btn cal-act-publish-toggle" data-id="${lec.id}" data-pub="${isPub ? 1 : 0}" style="padding:6px 12px;font-size:12px;display:inline-flex;align-items:center;gap:5px;${isPub ? 'color:var(--warning);border-color:var(--warning-border);' : 'color:var(--success);border-color:var(--success-border);'}">
            ${isPub ? '<i data-lucide="lock" style="width:13px;height:13px;"></i> Unpublish' : '<i data-lucide="send" style="width:13px;height:13px;"></i> Publish'}
          </button>
          <button type="button" class="outline act-btn cal-act-reschedule" data-id="${lec.id}" data-title="${escapeHtml(lec.title)}" data-date="${escapeHtml(lec.lectureDate || '')}" style="padding:6px 12px;font-size:12px;display:inline-flex;align-items:center;gap:5px;">
            <i data-lucide="calendar" style="width:13px;height:13px;"></i> Change Date
          </button>
          <button type="button" class="outline act-btn cal-act-filter-table" data-date="${dateStr}" style="padding:6px 12px;font-size:12px;display:inline-flex;align-items:center;gap:5px;">
            <i data-lucide="list" style="width:13px;height:13px;"></i> In Table
          </button>
        </div>
      </div>
    `;
  }).join('');

  setTimeout(() => { try { lucide.createIcons(); } catch(e){} }, 50);

  // Wire action buttons with real reflection
  detailList.querySelectorAll('.cal-act-review').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (id) openFacultyReview(id, false);
    });
  });

  // Direct Publish/Unpublish toggle reflecting in recordings table
  detailList.querySelectorAll('.cal-act-publish-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const currentlyPublished = btn.dataset.pub === '1';
      const targetPublish = !currentlyPublished;

      btn.disabled = true;
      btn.textContent = 'Updating...';

      try {
        const res = await fetch(`/api/recordings/${id}/publish`, {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ publish: targetPublish }),
        });

        if (handleAuthError(res)) return;

        if (res.ok) {
          toast(targetPublish ? 'Lecture published successfully!' : 'Lecture unpublished.');
          await loadFacultyAnalytics(true);
          loadRecordings();
        } else {
          toast('Failed to update publish status.');
          btn.disabled = false;
        }
      } catch (err) {
        toast('❌ Network error updating lecture.');
        btn.disabled = false;
      }
    });
  });

  // Direct Change Date modal trigger reflecting in SQLite recordings table
  detailList.querySelectorAll('.cal-act-reschedule').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const title = btn.dataset.title;
      const currentD = btn.dataset.date || dateStr;

      const modal = document.getElementById('anaRescheduleModal');
      const idInput = document.getElementById('anaRescheduleLectureId');
      const titleEl = document.getElementById('anaRescheduleLectureTitle');
      const dateInput = document.getElementById('anaRescheduleDateInput');

      if (idInput) idInput.value = id;
      if (titleEl) titleEl.textContent = `Lecture: "${title}"`;
      if (dateInput) dateInput.value = currentD;

      if (modal) modal.classList.remove('hidden');
    });
  });

  detailList.querySelectorAll('.cal-act-filter-table').forEach(btn => {
    btn.addEventListener('click', () => {
      facultyAnalyticsState.tableDateFilter = dateStr;
      renderAnalyticsLecturesTable();
      const tableCard = document.getElementById('facultyAnalyticsRows')?.closest('.card');
      if (tableCard) tableCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
}

// ── 🕒 Recent Student Access Activity Stream ──────────────────────────────────
function renderRecentActivityStream() {
  const data = facultyAnalyticsState.data;
  const rowsEl = document.getElementById('anaRecentActivityRows');
  if (!rowsEl || !data) return;

  const rawLogs = data.recentActivity || [];
  const q = facultyAnalyticsState.activityFilter.trim().toLowerCase();

  const filteredLogs = rawLogs.filter(log => {
    if (!q) return true;
    const hay = `${log.studentName || ''} ${log.studentEmail || ''} ${log.lectureTitle || ''} ${log.subject || ''} ${log.action || ''}`.toLowerCase();
    return hay.includes(q);
  });

  // Empty state if no logs
  if (filteredLogs.length === 0) {
    if (q) {
      rowsEl.innerHTML = `
        <tr><td colspan="5">
          <div class="ana-empty-state" style="padding:28px 16px;margin:8px 0;">
            <div class="ana-empty-icon" style="width:42px;height:42px;"><i data-lucide="search"></i></div>
            <h4 class="ana-empty-title">No Matching Activity Logs</h4>
            <p class="ana-empty-desc">No student access events found matching "<b>${escapeHtml(q)}</b>".</p>
            <button type="button" class="outline" id="anaClearActFilterBtn" style="padding:5px 12px;font-size:12px;">Clear Filter</button>
          </div>
        </td></tr>
      `;
      const clr = document.getElementById('anaClearActFilterBtn');
      if (clr) {
        clr.addEventListener('click', () => {
          facultyAnalyticsState.activityFilter = '';
          const inp = document.getElementById('anaActivitySearchInput');
          if (inp) inp.value = '';
          renderRecentActivityStream();
        });
      }
    } else {
      rowsEl.innerHTML = `
        <tr><td colspan="5">
          <div class="ana-empty-state" style="padding:28px 16px;margin:8px 0;">
            <div class="ana-empty-icon" style="width:42px;height:42px;"><i data-lucide="headphones"></i></div>
            <h4 class="ana-empty-title">No Student Access Activity Yet</h4>
            <p class="ana-empty-desc">Real-time student study sessions, lecture audio streams, and verified accesses will appear here as students listen.</p>
          </div>
        </td></tr>
      `;
    }
    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
    return;
  }

  rowsEl.innerHTML = filteredLogs.map(log => {
    const isStream = log.action === 'STREAM';
    const actionBadge = isStream
      ? '<span class="badge badge-published"><i data-lucide="headphones"></i> Streamed Audio</span>'
      : '<span class="badge badge-processing"><i data-lucide="eye"></i> Opened Lecture</span>';

    return `
      <tr>
        <td>
          <b>${escapeHtml(log.studentName || 'Student')}</b>
          <small class="muted" style="display:block;font-size:11.5px;">${escapeHtml(log.studentEmail || '')}</small>
        </td>
        <td>
          <b>${escapeHtml(log.lectureTitle || 'Lecture')}</b>
          <small class="muted" style="display:block;font-size:11.5px;">${escapeHtml(log.subject || 'General')}</small>
        </td>
        <td>${actionBadge}</td>
        <td>
          <b>${escapeHtml(log.timeAgo || 'Recently')}</b>
          <small class="muted" style="display:block;font-size:11px;">${formatLocalDisplayDate(log.timestamp)}</small>
        </td>
        <td>
          <span style="display:inline-flex;align-items:center;gap:4px;color:var(--success);font-weight:700;font-size:12px;">
            <i data-lucide="check-circle" style="width:13px;height:13px;"></i> Verified Student
          </span>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
}

// ── 📚 Lecture Access & Engagement Breakdown Table ─────────────────────────────
function renderAnalyticsLecturesTable() {
  const data = facultyAnalyticsState.data;
  const rowsEl = document.getElementById('facultyAnalyticsRows');
  const countLabel = document.getElementById('anaLectureCountLabel');
  const clearFilterBtn = document.getElementById('anaTableClearFilterBtn');

  if (!rowsEl || !data) return;

  const rawStats = data.lectureStats || [];
  const dateFilter = facultyAnalyticsState.tableDateFilter;

  const filteredStats = dateFilter
    ? rawStats.filter(r => r.lectureDate === dateFilter)
    : rawStats;

  if (clearFilterBtn) {
    clearFilterBtn.classList.toggle('hidden', !dateFilter);
  }

  if (countLabel) {
    if (dateFilter) {
      countLabel.textContent = `Filtered by date ${dateFilter} (${filteredStats.length} lecture${filteredStats.length === 1 ? '' : 's'})`;
    } else {
      countLabel.textContent = `Showing all ${rawStats.length} faculty lectures`;
    }
  }

  if (filteredStats.length === 0) {
    rowsEl.innerHTML = `
      <tr><td colspan="7">
        <div class="ana-empty-state" style="padding:32px 16px;margin:8px 0;">
          <div class="ana-empty-icon" style="width:42px;height:42px;font-size:18px;"><i data-lucide="book-open"></i></div>
          <h4 class="ana-empty-title">${dateFilter ? 'No Lectures on ' + escapeHtml(dateFilter) : 'No Faculty Lectures Found'}</h4>
          <p class="ana-empty-desc">${dateFilter ? 'No lectures match this specific date.' : 'Upload your first classroom recording to review automated AI summaries and listener metrics.'}</p>
          ${dateFilter ? '<button type="button" class="outline" id="anaResetTableFilterBtn">Show All Lectures</button>' : '<button type="button" class="primary" data-page="facultyUpload">+ Create New Lecture</button>'}
        </div>
      </td></tr>
    `;
    const rst = document.getElementById('anaResetTableFilterBtn');
    if (rst) {
      rst.addEventListener('click', () => {
        facultyAnalyticsState.tableDateFilter = null;
        renderAnalyticsLecturesTable();
      });
    }
    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
    return;
  }

  rowsEl.innerHTML = filteredStats.map(r => {
    const isPub = r.published;
    const statusBadge = isPub
      ? '<span class="badge badge-published"><i data-lucide="check-circle-2"></i> Published</span>'
      : (r.status === 'READY' ? '<span class="badge badge-ready"><i data-lucide="eye"></i> Ready</span>' : '<span class="badge badge-draft"><i data-lucide="file-edit"></i> Draft</span>');

    const boxTag = r.storageBoxName
      ? `<span class="box-tag"><i data-lucide="archive"></i> ${escapeHtml(r.storageBoxName)}</span>`
      : (r.subject ? escapeHtml(r.subject) : 'General');
    const scopeLabel = r.allowedStudentsCount
      ? `${r.allowedStudentsCount} Enrolled Students`
      : 'All Registered Students';

    return `
      <tr>
        <td>
          <b>${escapeHtml(r.title)}</b>
          <small class="muted" style="display:block;font-size:11.5px;">${escapeHtml(r.lectureDate || '')} &bull; ${escapeHtml(r.duration || '00:00')}</small>
        </td>
        <td>${boxTag}</td>
        <td>${statusBadge}</td>
        <td><span class="badge" style="background:var(--bg-subtle);color:var(--p);font-weight:600;"><i data-lucide="users" style="width:11px;height:11px;"></i> ${escapeHtml(scopeLabel)}</span></td>
        <td><b>${r.studentsAccessed || 0}</b> students</td>
        <td><b>${r.playsCount || 0}</b> plays</td>
        <td><b>${escapeHtml(r.avgListeningTime || '0m 00s')}</b></td>
      </tr>
    `;
  }).join('');

  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
}

// ── Attach Analytics Event Listeners (Once) ───────────────────────────────────
function initFacultyAnalyticsEvents() {
  if (facultyAnalyticsState.eventsInitialized) return;
  facultyAnalyticsState.eventsInitialized = true;

  // Refresh & Retry buttons
  const refreshBtn = document.getElementById('anaRefreshBtn');
  const retryBtn = document.getElementById('anaRetryBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadFacultyAnalytics(true));
  if (retryBtn) retryBtn.addEventListener('click', () => loadFacultyAnalytics(true));

  // Wellbeing week switcher
  const prevWeekBtn = document.getElementById('anaChartPrevWeekBtn');
  const nextWeekBtn = document.getElementById('anaChartNextWeekBtn');
  const todayWeekBtn = document.getElementById('anaChartTodayWeekBtn');

  if (prevWeekBtn) {
    prevWeekBtn.addEventListener('click', () => {
      facultyAnalyticsState.weekOffset--;
      renderWellbeingSection();
    });
  }
  if (nextWeekBtn) {
    nextWeekBtn.addEventListener('click', () => {
      facultyAnalyticsState.weekOffset++;
      renderWellbeingSection();
    });
  }
  if (todayWeekBtn) {
    todayWeekBtn.addEventListener('click', () => {
      facultyAnalyticsState.weekOffset = 0;
      renderWellbeingSection();
    });
  }

  // Calendar month switcher
  const prevMonthBtn = document.getElementById('calPrevMonthBtn');
  const nextMonthBtn = document.getElementById('calNextMonthBtn');
  const todayBtn = document.getElementById('calTodayBtn');
  const clearFilterBtn = document.getElementById('calClearFilterBtn');
  const tableClearFilterBtn = document.getElementById('anaTableClearFilterBtn');

  if (prevMonthBtn) {
    prevMonthBtn.addEventListener('click', () => {
      if (facultyAnalyticsState.calendarMonth === 0) {
        facultyAnalyticsState.calendarMonth = 11;
        facultyAnalyticsState.calendarYear--;
      } else {
        facultyAnalyticsState.calendarMonth--;
      }
      renderInteractiveCalendar();
    });
  }
  if (nextMonthBtn) {
    nextMonthBtn.addEventListener('click', () => {
      if (facultyAnalyticsState.calendarMonth === 11) {
        facultyAnalyticsState.calendarMonth = 0;
        facultyAnalyticsState.calendarYear++;
      } else {
        facultyAnalyticsState.calendarMonth++;
      }
      renderInteractiveCalendar();
    });
  }
  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      const now = new Date();
      facultyAnalyticsState.calendarYear = now.getFullYear();
      facultyAnalyticsState.calendarMonth = now.getMonth();
      const tStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      selectAnalyticsDate(tStr);
    });
  }
  if (clearFilterBtn) {
    clearFilterBtn.addEventListener('click', () => {
      facultyAnalyticsState.selectedDate = null;
      renderInteractiveCalendar();
      renderSelectedDateDetails();
      renderWellbeingSection();
    });
  }
  if (tableClearFilterBtn) {
    tableClearFilterBtn.addEventListener('click', () => {
      facultyAnalyticsState.tableDateFilter = null;
      renderAnalyticsLecturesTable();
    });
  }

  // Live activity search filter
  const actSearch = document.getElementById('anaActivitySearchInput');
  if (actSearch) {
    actSearch.addEventListener('input', (e) => {
      facultyAnalyticsState.activityFilter = e.target.value || '';
      renderRecentActivityStream();
    });
  }

  // Goals configuration modal (reflects in SQLite faculty_analytics_goals table)
  const goalsModal = document.getElementById('anaGoalsModal');
  const openGoalsBtn = document.getElementById('anaOpenGoalsModalBtn');
  const closeGoalsBtn = document.getElementById('anaCloseGoalsModalBtn');
  const cancelGoalsBtn = document.getElementById('anaCancelGoalsModalBtn');
  const goalsForm = document.getElementById('anaGoalsForm');
  const inWeekly = document.getElementById('anaInputWeeklyGoal');
  const inMonthly = document.getElementById('anaInputMonthlyGoal');

  if (openGoalsBtn && goalsModal) {
    openGoalsBtn.addEventListener('click', () => {
      if (inWeekly) inWeekly.value = facultyAnalyticsState.data?.weeklyTarget || 3;
      if (inMonthly) inMonthly.value = facultyAnalyticsState.data?.monthlyTarget || 6;
      goalsModal.classList.remove('hidden');
    });
  }
  if (closeGoalsBtn && goalsModal) {
    closeGoalsBtn.addEventListener('click', () => goalsModal.classList.add('hidden'));
  }
  if (cancelGoalsBtn && goalsModal) {
    cancelGoalsBtn.addEventListener('click', () => goalsModal.classList.add('hidden'));
  }
  if (goalsForm && goalsModal) {
    goalsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const weeklyTarget = Number(inWeekly?.value) || 3;
      const monthlyTarget = Number(inMonthly?.value) || 6;
      const submitBtn = document.getElementById('anaSaveGoalsBtn');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving to SQLite...'; }

      try {
        const res = await fetch('/api/faculty/analytics/goals', {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ weeklyTarget, monthlyTarget }),
        });

        if (handleAuthError(res)) return;

        if (res.ok) {
          const json = await res.json();
          if (facultyAnalyticsState.data) {
            facultyAnalyticsState.data.weeklyTarget = json.weeklyTarget;
            facultyAnalyticsState.data.monthlyTarget = json.monthlyTarget;
          }
          goalsModal.classList.add('hidden');
          renderWellbeingSection();
          toast('✅ Publishing goals saved to SQLite database!');
        } else {
          toast('❌ Failed to save goals to SQLite.');
        }
      } catch (err) {
        toast('❌ Network error saving goals.');
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '💾 Save to SQLite'; }
      }
    });
  }

  // Reschedule date modal (reflects in SQLite recordings.lecture_date)
  const reschedModal = document.getElementById('anaRescheduleModal');
  const closeReschedBtn = document.getElementById('anaCloseRescheduleModalBtn');
  const cancelReschedBtn = document.getElementById('anaCancelRescheduleBtn');
  const reschedForm = document.getElementById('anaRescheduleForm');

  if (closeReschedBtn && reschedModal) {
    closeReschedBtn.addEventListener('click', () => reschedModal.classList.add('hidden'));
  }
  if (cancelReschedBtn && reschedModal) {
    cancelReschedBtn.addEventListener('click', () => reschedModal.classList.add('hidden'));
  }
  if (reschedForm && reschedModal) {
    reschedForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('anaRescheduleLectureId')?.value;
      const lectureDate = document.getElementById('anaRescheduleDateInput')?.value;
      if (!id || !lectureDate) return;

      try {
        const res = await fetch(`/api/recordings/${id}/lecture-date`, {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ lectureDate }),
        });

        if (handleAuthError(res)) return;

        if (res.ok) {
          reschedModal.classList.add('hidden');
          toast('✅ Lecture date updated in SQLite database!');
          facultyAnalyticsState.selectedDate = lectureDate;
          await loadFacultyAnalytics(true);
          loadRecordings();
        } else {
          toast('❌ Failed to update lecture date in SQLite.');
        }
      } catch (err) {
        toast('❌ Network error rescheduling lecture.');
      }
    });
  }
}

const facSearchInput = document.getElementById('facSearchInput');
const facFilterStatus = document.getElementById('facFilterStatus');
if (facSearchInput) facSearchInput.addEventListener('input', renderFacultyViews);
if (facFilterStatus) facFilterStatus.addEventListener('change', renderFacultyViews);

// ── Faculty Upload & Live Recording Lecture Handling ─────────────────────────
const facUploadTab = document.getElementById('facUploadTab');
const facRecordTab = document.getElementById('facRecordTab');
const facUploadPane = document.getElementById('facUploadPane');
const facRecordPane = document.getElementById('facRecordPane');

const facAudioInput = document.getElementById('facAudioInput');
const facDropZone = document.getElementById('facDropZone');
const facFileInfoBox = document.getElementById('facFileInfoBox');
const facFileInfoName = document.getElementById('facFileInfoName');
const facFileInfoSize = document.getElementById('facFileInfoSize');
const facUploadAudioPreview = document.getElementById('facUploadAudioPreview');
const facRemoveFileBtn = document.getElementById('facRemoveFileBtn');
const facultyUploadForm = document.getElementById('facultyUploadForm');
const facSaveDraftBtn = document.getElementById('facSaveDraftBtn');
const facUploadErrorBox = document.getElementById('facUploadErrorBox');
const facUploadErrorMsg = document.getElementById('facUploadErrorMsg');
const facRetryUploadBtn = document.getElementById('facRetryUploadBtn');

// Faculty Live Recorder DOM & State
const facMicBtn = document.getElementById('facMicBtn');
const facStartRecBtn = document.getElementById('facStartRecBtn');
const facPauseRecBtn = document.getElementById('facPauseRecBtn');
const facStopRecBtn = document.getElementById('facStopRecBtn');
const facResetRecBtn = document.getElementById('facResetRecBtn');
const facTimerEl = document.getElementById('facTimer');
const facRecordMsg = document.getElementById('facRecordMsg');
const facRecordStatus = document.getElementById('facRecordStatus');

const facWaveformCanvas = document.getElementById('facWaveformCanvas');
const facWaveformContainer = document.getElementById('facWaveformContainer');
const waveformStatusBadge = document.getElementById('waveformStatusBadge');
const waveformStatusText = document.getElementById('waveformStatusText');
const waveformDecibelText = document.getElementById('waveformDecibelText');
const recPulseDot = document.getElementById('recPulseDot');

let facSelectedFile = null;
let facUploadedDuration = '00:00';
let facLiveSpeechTranscript = '';

let facMediaRecorder = null;
let facMediaStream = null;
let facRecChunks = [];
let facRecTimerInterval = null;
let facRecSeconds = 0;
let facRecSpeechRecognition = null;
let facIsRecording = false;
let facIsPaused = false;
let lastAttemptedStatus = 'READY';

// Audio Context & Analyser for live responsive waveform
let facAudioCtx = null;
let facAnalyser = null;
let facAudioSource = null;
let facWaveformAnimId = null;

// Switch between Upload Audio File tab and Record Lecture Live tab
if (facUploadTab && facRecordTab && facUploadPane && facRecordPane) {
  facUploadTab.onclick = () => {
    facUploadTab.classList.add('active');
    facRecordTab.classList.remove('active');
    facUploadPane.classList.remove('hidden');
    facRecordPane.classList.add('hidden');
  };
  facRecordTab.onclick = () => {
    facRecordTab.classList.add('active');
    facUploadTab.classList.remove('active');
    facRecordPane.classList.remove('hidden');
    facUploadPane.classList.add('hidden');
  };
}

// Auto-fill Subject when Storage Box is selected
const facStorageBoxSelect = document.getElementById('facStorageBoxSelect');
if (facStorageBoxSelect) {
  facStorageBoxSelect.addEventListener('change', () => {
    const boxId = facStorageBoxSelect.value;
    const subInput = document.getElementById('facSubjectInput');
    if (boxId && subInput && !subInput.value.trim()) {
      const box = storageBoxes.find(b => String(b.id) === String(boxId));
      if (box) subInput.value = box.name;
    }
  });
}

function showUploadError(msg) {
  if (facUploadErrorBox && facUploadErrorMsg) {
    facUploadErrorMsg.textContent = msg || '❌ Upload failed. Please try again.';
    facUploadErrorBox.classList.remove('hidden');
  }
  const badge = document.getElementById('facPipelineStateBadge');
  if (badge) {
    badge.textContent = '❌ FAILED';
    badge.style.background = '#fef2f2';
    badge.style.color = '#b91c1c';
  }
  toast(msg || '❌ Upload failed. Please try again.');
}

function hideUploadError() {
  if (facUploadErrorBox) {
    facUploadErrorBox.classList.add('hidden');
  }
  const badge = document.getElementById('facPipelineStateBadge');
  if (badge) {
    badge.style.background = '';
    badge.style.color = '';
  }
}

if (facRetryUploadBtn) {
  facRetryUploadBtn.onclick = () => {
    hideUploadError();
    submitFacultyLecture(lastAttemptedStatus || 'READY');
  };
}

function formatTimerClock(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatShortDuration(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// ── Live Responsive Waveform Engine ──────────────────────────────────────
function drawIdleWaveform() {
  if (facIsRecording && !facIsPaused) return;
  const canvas = document.getElementById('facWaveformCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 540;
  const height = canvas.clientHeight || 72;

  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  // Subtle center line
  const centerY = height / 2;
  ctx.strokeStyle = 'rgba(232, 227, 218, 0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();

  // Subtle harmonic baseline wave
  const time = Date.now() * 0.0022;
  ctx.beginPath();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = facIsPaused ? '#d97706' : 'rgba(88, 28, 56, 0.35)';

  for (let x = 0; x <= width; x += 3) {
    const normX = x / width;
    const envelope = Math.sin(normX * Math.PI);
    const y = centerY + Math.sin(normX * 12 + time) * 6 * envelope + Math.sin(normX * 6 - time * 0.7) * 4 * envelope;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  if (facIsPaused) {
    ctx.fillStyle = '#b45309';
    ctx.font = '600 11px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RECORDING PAUSED', width / 2, centerY - 14);
  }
  ctx.restore();

  if (!facIsRecording || facIsPaused) {
    facWaveformAnimId = requestAnimationFrame(drawIdleWaveform);
  }
}

function startWaveformVisualization(stream) {
  cancelAnimationFrame(facWaveformAnimId);
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!facAudioCtx || facAudioCtx.state === 'closed') {
      facAudioCtx = new AudioContextClass();
    } else if (facAudioCtx.state === 'suspended') {
      facAudioCtx.resume();
    }

    facAudioSource = facAudioCtx.createMediaStreamSource(stream);
    facAnalyser = facAudioCtx.createAnalyser();
    facAnalyser.fftSize = 256;
    facAnalyser.smoothingTimeConstant = 0.78;
    facAudioSource.connect(facAnalyser);

    const canvas = document.getElementById('facWaveformCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const bufferLength = facAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const container = document.getElementById('facWaveformContainer');
    if (container) {
      container.style.display = 'block';
    }

    function renderFrame() {
      if (!facIsRecording) return;
      if (facIsPaused) {
        facWaveformAnimId = requestAnimationFrame(renderFrame);
        return;
      }

      facWaveformAnimId = requestAnimationFrame(renderFrame);
      facAnalyser.getByteFrequencyData(dataArray);

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth || 540;
      const height = canvas.clientHeight || 72;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const centerY = height / 2;
      ctx.strokeStyle = 'rgba(232, 227, 218, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      const barCount = 48;
      const barSpacing = 3;
      const totalSpacing = barSpacing * (barCount - 1);
      const barWidth = Math.max(2, (width - 24 - totalSpacing) / barCount);
      const startX = (width - (barCount * barWidth + totalSpacing)) / 2;

      let sum = 0;
      const step = Math.floor(bufferLength / barCount) || 1;

      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, '#be123c');
      grad.addColorStop(0.3, '#9f1239');
      grad.addColorStop(0.5, '#581c38');
      grad.addColorStop(0.7, '#9f1239');
      grad.addColorStop(1, '#be123c');

      ctx.fillStyle = grad;

      for (let i = 0; i < barCount; i++) {
        const val = dataArray[i * step] || 0;
        sum += val;
        const percent = val / 255;
        const barHeight = Math.max(4, percent * (height - 14));
        const x = startX + i * (barWidth + barSpacing);
        const y = centerY - barHeight / 2;
        const r = Math.min(barWidth / 2, 2.5);

        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, barWidth, barHeight, r);
        } else {
          ctx.rect(x, y, barWidth, barHeight);
        }
        ctx.fill();
      }

      ctx.restore();
    }

    renderFrame();
  } catch (e) {
    console.error('Audio visualization initialization error:', e);
  }
}

function stopWaveformVisualization() {
  cancelAnimationFrame(facWaveformAnimId);
  if (facAudioSource) {
    try { facAudioSource.disconnect(); } catch (e) {}
    facAudioSource = null;
  }
  if (facAnalyser) {
    try { facAnalyser.disconnect(); } catch (e) {}
    facAnalyser = null;
  }
  if (facAudioCtx && facAudioCtx.state !== 'closed') {
    try { facAudioCtx.close(); } catch (e) {}
    facAudioCtx = null;
  }

  const container = document.getElementById('facWaveformContainer');
  if (container) container.style.display = 'none';
}

function toggleFacultyPauseRecording() {
  if (!facIsRecording || !facMediaRecorder) return;
  const pauseBtn = document.getElementById('facPauseRecBtn');
  const statusBadge = document.getElementById('waveformStatusBadge');
  const statusText = document.getElementById('waveformStatusText');
  const pulseDot = document.getElementById('recPulseDot');
  const container = document.getElementById('facWaveformContainer');
  const decibelText = document.getElementById('waveformDecibelText');

  if (!facIsPaused) {
    facIsPaused = true;
    try { facMediaRecorder.pause(); } catch (e) {}
    if (facRecSpeechRecognition) {
      try { facRecSpeechRecognition.stop(); } catch (e) {}
    }
    clearInterval(facRecTimerInterval);

    if (facRecordMsg) facRecordMsg.textContent = 'Recording Paused';
    if (facRecordStatus) facRecordStatus.textContent = 'Recording is paused. Click "Resume" to continue capturing audio.';
    if (pauseBtn) {
      pauseBtn.innerHTML = '<i data-lucide="play"></i> Resume';
      pauseBtn.classList.remove('outline');
      pauseBtn.classList.add('primary');
    }
    if (container) {
      container.classList.remove('recording');
      container.classList.add('paused');
    }
    if (statusBadge) {
      statusBadge.classList.remove('live');
      statusBadge.classList.add('paused');
    }
    if (statusText) statusText.textContent = 'Recording Paused';
    if (pulseDot) pulseDot.className = 'rec-pulse-dot paused';
    if (decibelText) decibelText.textContent = 'Paused';
    if (facMicBtn) facMicBtn.classList.remove('recording');
    drawIdleWaveform();
    toast('Recording paused.');
  } else {
    facIsPaused = false;
    try { facMediaRecorder.resume(); } catch (e) {}
    if (facRecSpeechRecognition) {
      try { facRecSpeechRecognition.start(); } catch (e) {}
    }
    facRecTimerInterval = setInterval(() => {
      facRecSeconds++;
      if (facTimerEl) facTimerEl.textContent = formatTimerClock(facRecSeconds);
    }, 1000);

    if (facRecordMsg) facRecordMsg.textContent = 'Recording Live Classroom Audio...';
    if (facRecordStatus) facRecordStatus.textContent = 'Speak clearly into your microphone. Click "Stop Recording" when finished.';
    if (pauseBtn) {
      pauseBtn.innerHTML = '<i data-lucide="pause"></i> Pause';
      pauseBtn.classList.remove('primary');
      pauseBtn.classList.add('outline');
    }
    if (container) {
      container.classList.add('recording');
      container.classList.remove('paused');
    }
    if (statusBadge) {
      statusBadge.classList.add('live');
      statusBadge.classList.remove('paused');
    }
    if (statusText) statusText.textContent = 'Live Audio Recording';
    if (pulseDot) pulseDot.className = 'rec-pulse-dot recording';
    if (facMicBtn) facMicBtn.classList.add('recording');
    toast('Recording resumed.');
  }

  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
}

function pauseBtnReset() {
  const pauseBtn = document.getElementById('facPauseRecBtn');
  if (pauseBtn) {
    pauseBtn.innerHTML = '<i data-lucide="pause"></i> Pause';
    pauseBtn.className = 'outline disabled';
    pauseBtn.disabled = true;
  }
}

async function startFacultyLiveRecording() {
  if (!isFacultyRole()) {
    toast('Access denied. Faculty role required.');
    return;
  }
  if (facIsRecording) return;

  hideUploadError();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    facMediaStream = stream;
    facRecChunks = [];
    facRecSeconds = 0;
    facLiveSpeechTranscript = '';
    facIsRecording = true;
    facIsPaused = false;

    let options = {};
    if (typeof MediaRecorder !== 'undefined') {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options = { mimeType: 'audio/webm;codecs=opus' };
      } else if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm')) {
        options = { mimeType: 'audio/webm' };
      } else if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/mp4')) {
        options = { mimeType: 'audio/mp4' };
      }
      facMediaRecorder = new MediaRecorder(stream, options);
      facMediaRecorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) {
          facRecChunks.push(e.data);
        }
      };
      facMediaRecorder.onstop = () => {
        const mimeType = facMediaRecorder?.mimeType || 'audio/webm';
        const ext = mimeType.includes('mp4') ? 'm4a' : (mimeType.includes('wav') ? 'wav' : 'webm');
        const blob = new Blob(facRecChunks, { type: mimeType });
        const recordedFile = new File([blob], `lecture_recording_${Date.now()}.${ext}`, { type: mimeType });
        const finalDur = formatShortDuration(Math.max(1, facRecSeconds));
        handleFacSelectedFile(recordedFile, finalDur);
      };
      facMediaRecorder.start(250);
    }

    // Optional live browser SpeechRecognition to assist transcript accuracy
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        facRecSpeechRecognition = new SpeechRecognition();
        facRecSpeechRecognition.continuous = true;
        facRecSpeechRecognition.interimResults = true;
        facRecSpeechRecognition.lang = 'en-US';
        let finalSpeech = '';
        facRecSpeechRecognition.onresult = ev => {
          let interim = '';
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const txt = ev.results[i][0].transcript;
            if (ev.results[i].isFinal) finalSpeech += txt + ' ';
            else interim += txt;
          }
          facLiveSpeechTranscript = (finalSpeech + interim).trim();
        };
        facRecSpeechRecognition.onerror = () => {};
        facRecSpeechRecognition.start();
      } catch (e) {
        facRecSpeechRecognition = null;
      }
    }

    if (facTimerEl) facTimerEl.textContent = '00:00:00';
    clearInterval(facRecTimerInterval);
    facRecTimerInterval = setInterval(() => {
      facRecSeconds++;
      if (facTimerEl) facTimerEl.textContent = formatTimerClock(facRecSeconds);
    }, 1000);

    if (facMicBtn) facMicBtn.classList.add('recording');
    if (facRecordMsg) facRecordMsg.textContent = 'Recording Live Classroom Audio...';
    if (facRecordStatus) facRecordStatus.textContent = 'Speak clearly into your microphone. Click "Stop Recording" when finished.';
    if (facStartRecBtn) {
      facStartRecBtn.disabled = true;
      facStartRecBtn.classList.add('disabled');
    }
    if (facPauseRecBtn) {
      facPauseRecBtn.disabled = false;
      facPauseRecBtn.classList.remove('disabled');
      facPauseRecBtn.innerHTML = '<i data-lucide="pause"></i> Pause';
    }
    if (facStopRecBtn) {
      facStopRecBtn.disabled = false;
      facStopRecBtn.classList.remove('disabled');
    }

    startWaveformVisualization(stream);
    toast('Live lecture recording started.');
    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
  } catch (err) {
    toast('Microphone access denied or unavailable. Please check permissions.');
    if (facRecordStatus) {
      facRecordStatus.textContent = 'Microphone permission denied. Please allow microphone access or select a pre-recorded file.';
    }
  }
}

function stopFacultyLiveRecording() {
  if (!facIsRecording) return;
  facIsRecording = false;
  facIsPaused = false;
  clearInterval(facRecTimerInterval);

  if (facRecSpeechRecognition) {
    try { facRecSpeechRecognition.stop(); } catch (e) {}
    facRecSpeechRecognition = null;
  }
  if (facMediaRecorder && facMediaRecorder.state !== 'inactive') {
    try { facMediaRecorder.stop(); } catch (e) {}
  }
  if (facMediaStream) {
    try { facMediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
    facMediaStream = null;
  }

  stopWaveformVisualization();

  if (facMicBtn) facMicBtn.classList.remove('recording');
  if (facRecordMsg) facRecordMsg.textContent = 'Recording Captured — Ready to Save';
  if (facRecordStatus) facRecordStatus.textContent = 'Click "Save Recording & Process AI" below to generate transcript & summary.';
  if (facStartRecBtn) {
    facStartRecBtn.disabled = false;
    facStartRecBtn.classList.remove('disabled');
  }
  if (facPauseRecBtn) {
    facPauseRecBtn.disabled = true;
    facPauseRecBtn.classList.add('disabled');
    pauseBtnReset();
  }
  if (facStopRecBtn) {
    facStopRecBtn.disabled = true;
    facStopRecBtn.classList.add('disabled');
  }
  toast('Recording captured. Ready to save and process.');
  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
}

function resetFacultyLiveRecording() {
  if (facIsRecording) {
    stopFacultyLiveRecording();
  }
  clearInterval(facRecTimerInterval);
  facRecSeconds = 0;
  facRecChunks = [];
  facLiveSpeechTranscript = '';
  facIsPaused = false;

  stopWaveformVisualization();

  if (facTimerEl) facTimerEl.textContent = '00:00:00';
  if (facMicBtn) facMicBtn.classList.remove('recording');
  if (facRecordMsg) facRecordMsg.textContent = 'Start Recording Lecture';
  if (facRecordStatus) facRecordStatus.textContent = 'Click microphone or "Start Recording" to record live classroom audio';
  if (facStartRecBtn) {
    facStartRecBtn.disabled = false;
    facStartRecBtn.classList.remove('disabled');
  }
  if (facPauseRecBtn) {
    facPauseRecBtn.disabled = true;
    facPauseRecBtn.classList.add('disabled');
    pauseBtnReset();
  }
  if (facStopRecBtn) {
    facStopRecBtn.disabled = true;
    facStopRecBtn.classList.add('disabled');
  }
  clearFacSelectedFile();
  toast('Recorder reset.');
  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
}

if (facMicBtn) {
  facMicBtn.onclick = () => {
    if (facIsRecording) stopFacultyLiveRecording();
    else startFacultyLiveRecording();
  };
}
if (facStartRecBtn) {
  facStartRecBtn.onclick = () => startFacultyLiveRecording();
}
if (facPauseRecBtn) {
  facPauseRecBtn.onclick = () => toggleFacultyPauseRecording();
}
if (facStopRecBtn) {
  facStopRecBtn.onclick = () => stopFacultyLiveRecording();
}
if (facResetRecBtn) {
  facResetRecBtn.onclick = () => resetFacultyLiveRecording();
}

// Draw idle waveform baseline on load
setTimeout(drawIdleWaveform, 150);

function validateAudioFile(file) {
  if (!file) return { valid: false, error: 'Please select or record an audio file first.' };
  const maxBytes = 200 * 1024 * 1024; // 200 MB
  if (file.size > maxBytes) {
    return { valid: false, error: '❌ File is too large (max 200 MB). Please upload a smaller recording.' };
  }
  if (file.size === 0) {
    return { valid: false, error: '❌ The selected audio file is empty.' };
  }
  const allowedExts = ['.mp3', '.wav', '.m4a', '.mp4', '.webm', '.ogg', '.aac', '.flac'];
  const lowerName = (file.name || '').toLowerCase();
  const hasAllowedExt = allowedExts.some(ext => lowerName.endsWith(ext));
  const hasAudioMime = (file.type || '').startsWith('audio/') || (file.type || '').startsWith('video/mp4') || (file.type || '').startsWith('video/webm');
  if (!hasAllowedExt && !hasAudioMime) {
    return { valid: false, error: '❌ Unsupported file format. Please upload MP3, WAV, M4A, MP4, WEBM, AAC, or OGG.' };
  }
  return { valid: true };
}

function handleFacSelectedFile(file, presetDuration) {
  if (!file) return;
  hideUploadError();

  const validation = validateAudioFile(file);
  if (!validation.valid) {
    showUploadError(validation.error);
    return;
  }

  facSelectedFile = file;
  if (presetDuration) {
    facUploadedDuration = presetDuration;
  }

  const mb = (file.size / (1024 * 1024)).toFixed(2);
  const sizeText = file.size > 1024 * 1024 ? `${mb} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;

  if (facFileInfoBox && facFileInfoName && facFileInfoSize) {
    facFileInfoName.textContent = file.name;
    facFileInfoSize.textContent = `${sizeText} • Ready for AI Speech-to-Text & Summary`;
    facFileInfoBox.style.display = 'block';
  }

  const titleInput = document.getElementById('facTitleInput');
  if (titleInput && !titleInput.value.trim() && !file.name.startsWith('lecture_recording_')) {
    titleInput.value = file.name.replace(/\.[^/.]+$/, '');
  }

  if (facUploadAudioPreview) {
    try {
      facUploadAudioPreview.src = URL.createObjectURL(file);
      facUploadAudioPreview.style.display = 'block';
    } catch (e) {}
  }

  try {
    const tempAudio = document.createElement('audio');
    const objUrl = URL.createObjectURL(file);
    tempAudio.preload = 'metadata';
    tempAudio.onloadedmetadata = () => {
      URL.revokeObjectURL(objUrl);
      if (isFinite(tempAudio.duration) && tempAudio.duration > 0) {
        const totalSec = Math.round(tempAudio.duration);
        const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const s = String(totalSec % 60).padStart(2, '0');
        facUploadedDuration = `${m}:${s}`;
      }
    };
    tempAudio.src = objUrl;
  } catch (e) {}

  toast(`🎙️ Audio ready: ${file.name}`);
}

function clearFacSelectedFile() {
  facSelectedFile = null;
  facUploadedDuration = '00:00';
  if (facFileInfoBox) facFileInfoBox.style.display = 'none';
  if (facUploadAudioPreview) {
    try { facUploadAudioPreview.pause(); } catch (e) {}
    facUploadAudioPreview.src = '';
    facUploadAudioPreview.style.display = 'none';
  }
}

// Removed file upload input listener as audio file upload feature is disabled.

// Removed file-remove button listener as audio file upload feature is disabled.

// Removed dropzone listeners.

function setPipelineStep(activeStep) {
  const steps = ['upload', 'stt', 'summary', 'ready'];
  const badge = document.getElementById('facPipelineStateBadge');
  const idx = steps.indexOf(activeStep);

  document.querySelectorAll('#facPipelineSteps .pipeline-step').forEach(el => {
    const s = el.getAttribute('data-step');
    const sIdx = steps.indexOf(s);
    el.classList.remove('active', 'done');
    if (activeStep === 'done' || sIdx < idx) {
      el.classList.add('done');
    } else if (sIdx === idx) {
      el.classList.add('active');
    }
  });

  if (badge) {
    badge.style.background = '';
    badge.style.color = '';
    if (activeStep === 'uploading') badge.textContent = '📤 UPLOADING AUDIO...';
    else if (activeStep === 'upload') badge.textContent = '✅ UPLOAD SUCCESS — Starting Processing...';
    else if (activeStep === 'stt') badge.textContent = '📝 GENERATING TRANSCRIPT...';
    else if (activeStep === 'summary') badge.textContent = '📄 GENERATING SUMMARY...';
    else if (activeStep === 'ready' || activeStep === 'done') badge.textContent = '👁️ READY FOR REVIEW';
    else badge.textContent = 'Ready to Upload';
  }
}

async function submitFacultyLecture(initialStatus = 'READY') {
  if (!isFacultyRole()) {
    toast('❌ ACCESS DENIED: Only Faculty members can upload or record lectures.');
    return;
  }

  if (facIsRecording) {
    stopFacultyLiveRecording();
    await new Promise(r => setTimeout(r, 300));
  }

  lastAttemptedStatus = initialStatus;
  hideUploadError();

  const title = (document.getElementById('facTitleInput')?.value || '').trim();
  const storageBoxId = (document.getElementById('facStorageBoxSelect')?.value || '').trim();
  let subject = (document.getElementById('facSubjectInput')?.value || '').trim();
  const branch = (document.getElementById('facBranchInput')?.value || 'Computer Engineering').trim();
  const year = (document.getElementById('facYearInput')?.value || 'Second Year (SE)').trim();
  const sem = (document.getElementById('facSemInput')?.value || 'Semester 3').trim();
  const div = (document.getElementById('facDivInput')?.value || 'Division A').trim();
  const classCourse = `${branch} • ${year} • ${sem} • ${div}`;
  const lectureDate = (document.getElementById('facDateInput')?.value || new Date().toISOString().slice(0, 10)).trim();
  const description = (document.getElementById('facDescInput')?.value || '').trim();
  const professorName = localStorage.getItem('vaani_user_name') || 'Dr. Ananya Sharma';

  if (!subject && storageBoxId) {
    const box = storageBoxes.find(b => String(b.id) === String(storageBoxId));
    if (box) subject = box.name;
  }
  if (!subject) {
    subject = title || 'General Lecture';
  }

  if (!title) {
    showUploadError('❌ Please enter a Lecture Title.');
    document.getElementById('facTitleInput')?.focus();
    return;
  }

  if (!facSelectedFile) {
    showUploadError('❌ Please select an audio file to upload or record a live lecture first.');
    return;
  }

  const fileCheck = validateAudioFile(facSelectedFile);
  if (!fileCheck.valid) {
    showUploadError(fileCheck.error);
    return;
  }

  const submitBtn = document.getElementById('facSubmitUploadBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '📤 Uploading & Processing...';
  }

  setPipelineStep('uploading');
  await new Promise(r => setTimeout(r, 250));
  setPipelineStep('upload');
  const sttTimer = setTimeout(() => setPipelineStep('stt'), 450);
  const summaryTimer = setTimeout(() => setPipelineStep('summary'), 1200);

  const formData = new FormData();
  formData.append('file', facSelectedFile);
  formData.append('title', title);
  if (storageBoxId) {
    formData.append('storageBoxId', storageBoxId);
  }
  formData.append('subject', subject);
  formData.append('lectureName', subject);
  formData.append('professorName', professorName);
  formData.append('classCourse', classCourse);
  formData.append('lectureDate', lectureDate);
  formData.append('description', description);
  formData.append('duration', facUploadedDuration && facUploadedDuration !== '00:00' ? facUploadedDuration : '00:10');
  const summaryMode = localStorage.getItem('vaani_summary_mode') || 'Medium';
  formData.append('mode', summaryMode);
  if (facLiveSpeechTranscript && facLiveSpeechTranscript.trim().length > 5) {
    formData.append('liveSpeechTranscript', facLiveSpeechTranscript.trim());
  }
  formData.append('isFacultyLecture', 'true');
  formData.append('facultyStatus', initialStatus);
  formData.append('allowedAccess', JSON.stringify([classCourse, subject]));

  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
    clearTimeout(sttTimer);
    clearTimeout(summaryTimer);

    if (handleAuthError(res)) return;
    if (!res.ok) {
      let errData = {};
      try { errData = await res.json(); } catch {}
      throw new Error(errData.error || '❌ Audio transcription or processing failed. Please try again.');
    }

    const saved = await res.json();
    setPipelineStep('done');
    toast(initialStatus === 'DRAFT' ? '📝 Lecture saved as Draft!' : '✅ TRANSCRIPT READY & SUMMARY READY — Open for Review!');

    // Reset upload form & recorder
    if (document.getElementById('facTitleInput')) document.getElementById('facTitleInput').value = '';
    if (document.getElementById('facSubjectInput')) document.getElementById('facSubjectInput').value = '';
    if (document.getElementById('facDescInput')) document.getElementById('facDescInput').value = '';
    facLiveSpeechTranscript = '';
    clearFacSelectedFile();
    if (facTimerEl) facTimerEl.textContent = '00:00:00';
    if (facRecordMsg) facRecordMsg.textContent = '🎙️ Start Recording Lecture';

    await fetchStorageBoxes();
    await loadRecordings();
    setTimeout(() => {
      openFacultyReview(saved.id, false);
    }, 300);
  } catch (e) {
    clearTimeout(sttTimer);
    clearTimeout(summaryTimer);

    if (!backendAvailable) {
      // Offline mode fallback: only proceed if live browser speech recognition captured real words
      if (!facLiveSpeechTranscript || facLiveSpeechTranscript.trim().split(/\s+/).length < 3) {
        showUploadError('❌ Backend transcription server is unreachable and no live browser speech was recognized. Please reconnect or speak clearly into your microphone.');
        return;
      }
      try {
        const dataUrl = await fileToDataUrl(facSelectedFile);
        const localId = Date.now();
        const transcript = facLiveSpeechTranscript.trim();
        const summary = buildExtractiveSummaryFromTranscript(transcript);
        const boxObj = storageBoxId ? storageBoxes.find(b => String(b.id) === String(storageBoxId)) : null;
        const localRec = {
          id: localId,
          storageBoxId: storageBoxId ? Number(storageBoxId) : null,
          storageBoxName: boxObj ? boxObj.name : null,
          title,
          subject,
          lectureName: subject,
          professorName,
          classCourse,
          lectureDate,
          description,
          duration: facUploadedDuration && facUploadedDuration !== '00:00' ? facUploadedDuration : '00:10',
          createdAt: formatLocalDisplayDate(new Date()),
          createdAtIso: new Date().toISOString(),
          status: 'Completed',
          facultyStatus: initialStatus,
          published: initialStatus === 'PUBLISHED',
          isFacultyLecture: true,
          allowedAccess: [classCourse, subject],
          studentsAccessed: 0,
          playsCount: 1,
          avgListeningTime: '00m 00s',
          transcript,
          summary,
          hasAudio: true,
          audioDataUrl: dataUrl,
        };
        recordings = [localRec, ...recordings];
        saveLocalRecordings(recordings);
        setPipelineStep('done');
        clearFacSelectedFile();
        renderFacultyViews();
        openFacultyReview(localId, false);
        toast('✅ Lecture processed from live speech and ready for Faculty Review!');
      } catch (readErr) {
        showUploadError('❌ Audio processing failed. Please record the lecture again.');
      }
    } else {
      showUploadError(e?.message || '❌ Upload failed. Please try again.');
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '💾 Save Recording & Process AI';
    }
  }
}

if (facultyUploadForm) {
  facultyUploadForm.addEventListener('submit', e => {
    e.preventDefault();
    submitFacultyLecture('READY');
  });
}

if (facSaveDraftBtn) {
  facSaveDraftBtn.addEventListener('click', () => {
    submitFacultyLecture('DRAFT');
  });
}

// ── Faculty Review, Edit Transcript/Summary, Regenerate, Publish & Access Control ──
async function openFacultyReview(id, startInEditMode = false) {
  if (!isFacultyRole()) {
    openDetail(id);
    return;
  }

  await fetchStorageBoxes();

  let rec = recordings.find(r => String(r.id) === String(id));
  if (backendAvailable) {
    try {
      const res = await fetch(`${API_BASE}/${id}`, { headers: authHeaders() });
      if (res.ok) rec = await res.json();
    } catch (e) {}
  }
  if (!rec) return;

  rec = sanitizeRecording(rec);
  currentReviewRecording = rec;

  const titleEl = document.getElementById('facReviewTitle');
  const metaEl = document.getElementById('facReviewMeta');
  const badgeEl = document.getElementById('facReviewStatusBadge');
  const durEl = document.getElementById('facReviewDurationLabel');

  if (titleEl) titleEl.textContent = rec.title;
  if (metaEl) {
    const boxTag = rec.storageBoxName ? `📦 ${rec.storageBoxName}` : (rec.subject || rec.lectureName || 'General');
    metaEl.textContent = `${boxTag}  •  ${rec.classCourse || 'SE Computer Engineering'}  •  ${rec.lectureDate || formatLocalDisplayDate(rec.createdAtIso || rec.createdAt)}`;
  }
  if (badgeEl) {
    const st = rec.facultyStatus || (rec.published !== false ? 'PUBLISHED' : 'READY');
    badgeEl.className = 'badge ' + (
      st === 'PUBLISHED' ? 'badge-published' :
      st === 'DRAFT' ? 'badge-draft' :
      st === 'PROCESSING' ? 'badge-processing' : 'badge-ready'
    );
    badgeEl.textContent = st === 'PUBLISHED' ? '🚀 PUBLISHED' : st === 'DRAFT' ? '📝 DRAFT' : st === 'PROCESSING' ? '⏳ PROCESSING' : '👁️ READY FOR REVIEW';
  }
  if (durEl) durEl.textContent = `Duration: ${rec.duration || '00:00'}`;

  // Populate metadata inputs
  const tIn = document.getElementById('facReviewTitleInput');
  const bIn = document.getElementById('facReviewStorageBoxSelect');
  const sIn = document.getElementById('facReviewSubjectInput');
  const cIn = document.getElementById('facReviewCourseInput');
  const dIn = document.getElementById('facReviewDateInput');
  if (tIn) tIn.value = rec.title || '';
  if (bIn) bIn.value = rec.storageBoxId ? String(rec.storageBoxId) : '';
  if (sIn) sIn.value = rec.subject || rec.lectureName || '';
  if (cIn) cIn.value = rec.classCourse || 'SE Computer Engineering';
  if (dIn) dIn.value = rec.lectureDate || new Date().toISOString().slice(0, 10);

  // Audio player
  const player = document.getElementById('facReviewAudioPlayer');
  if (player) {
    if (rec.hasAudio) {
      player.src = rec.audioDataUrl ? rec.audioDataUrl : `${API_BASE}/${rec.id}/audio`;
    } else {
      player.src = '';
    }
  }

  // Transcript & Summary Views + Editors
  const trView = document.getElementById('facTranscriptView');
  const trEdit = document.getElementById('facTranscriptEditor');
  const smView = document.getElementById('facSummaryView');
  const smEdit = document.getElementById('facSummaryEditor');

  if (trView) trView.innerHTML = escapeHtml(rec.transcript || '').replace(/\n/g, '<br>');
  if (trEdit) trEdit.value = rec.transcript || '';
  if (smView) smView.textContent = rec.summary || '';
  if (smEdit) smEdit.value = rec.summary || '';

  // Toggle edit state
  setTranscriptEditMode(startInEditMode);
  setSummaryEditMode(startInEditMode);

  // Populate Student Access Control checkboxes
  const allowed = Array.isArray(rec.allowedAccess) ? rec.allowedAccess : ['SE Computer Engineering', 'Data Structures'];
  document.querySelectorAll('#facAccessCheckboxes input[type="checkbox"]').forEach(cb => {
    cb.checked = allowed.includes(cb.value) || cb.value === rec.classCourse || cb.value === rec.subject;
  });

  page('facultyReview');
}

function setTranscriptEditMode(editing) {
  const trView = document.getElementById('facTranscriptView');
  const trEdit = document.getElementById('facTranscriptEditor');
  const editBtn = document.getElementById('facEditTranscriptBtn');
  const saveBtn = document.getElementById('facSaveTranscriptBtn');

  if (trView) trView.classList.toggle('hidden', editing);
  if (trEdit) trEdit.classList.toggle('hidden', !editing);
  if (editBtn) editBtn.classList.toggle('hidden', editing);
  if (saveBtn) saveBtn.classList.toggle('hidden', !editing);
}

function setSummaryEditMode(editing) {
  const smView = document.getElementById('facSummaryView');
  const smEdit = document.getElementById('facSummaryEditor');
  const editBtn = document.getElementById('facEditSummaryBtn');
  const saveBtn = document.getElementById('facSaveSummaryBtn');

  if (smView) smView.classList.toggle('hidden', editing);
  if (smEdit) smEdit.classList.toggle('hidden', !editing);
  if (editBtn) editBtn.classList.toggle('hidden', editing);
  if (saveBtn) saveBtn.classList.toggle('hidden', !editing);
}

async function saveFacultyReviewUpdates(partialPayload, successToastMsg) {
  if (!currentReviewRecording) return;
  const id = currentReviewRecording.id;

  const title = (document.getElementById('facReviewTitleInput')?.value || currentReviewRecording.title).trim();
  const rawBoxId = document.getElementById('facReviewStorageBoxSelect')?.value;
  const storageBoxId = rawBoxId ? Number(rawBoxId) : null;
  const subject = (document.getElementById('facReviewSubjectInput')?.value || currentReviewRecording.subject || '').trim();
  const classCourse = (document.getElementById('facReviewCourseInput')?.value || currentReviewRecording.classCourse || '').trim();
  const lectureDate = (document.getElementById('facReviewDateInput')?.value || currentReviewRecording.lectureDate || '').trim();

  const body = {
    title,
    storageBoxId,
    subject,
    lectureName: subject,
    classCourse,
    lectureDate,
    ...partialPayload,
  };

  try {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const updated = await res.json();
      currentReviewRecording = sanitizeRecording(updated);
    } else {
      Object.assign(currentReviewRecording, body);
    }
  } catch (e) {
    Object.assign(currentReviewRecording, body);
  }

  const idx = recordings.findIndex(r => String(r.id) === String(id));
  if (idx !== -1) recordings[idx] = currentReviewRecording;
  saveLocalRecordings(recordings);

  // Refresh review display
  const trView = document.getElementById('facTranscriptView');
  const smView = document.getElementById('facSummaryView');
  const titleEl = document.getElementById('facReviewTitle');
  const metaEl = document.getElementById('facReviewMeta');
  if (trView) trView.innerHTML = escapeHtml(currentReviewRecording.transcript || '').replace(/\n/g, '<br>');
  if (smView) smView.textContent = currentReviewRecording.summary || '';
  if (titleEl) titleEl.textContent = currentReviewRecording.title;
  if (metaEl) {
    const boxTag = currentReviewRecording.storageBoxName ? `📦 ${currentReviewRecording.storageBoxName}` : (currentReviewRecording.subject || 'General');
    metaEl.textContent = `${boxTag}  •  ${currentReviewRecording.classCourse || 'SE Computer Engineering'}  •  ${currentReviewRecording.lectureDate || ''}`;
  }

  await fetchStorageBoxes();
  renderFacultyViews();
  renderRecordings();
  if (successToastMsg) toast(successToastMsg);
}

const facSaveMetaBtn = document.getElementById('facSaveMetaBtn');
if (facSaveMetaBtn) {
  facSaveMetaBtn.onclick = async () => {
    await saveFacultyReviewUpdates({}, '✅ Lecture details updated!');
  };
}

const facEditTranscriptBtn = document.getElementById('facEditTranscriptBtn');
const facSaveTranscriptBtn = document.getElementById('facSaveTranscriptBtn');
const facEditSummaryBtn = document.getElementById('facEditSummaryBtn');
const facSaveSummaryBtn = document.getElementById('facSaveSummaryBtn');
const facRegenTranscriptBtn = document.getElementById('facRegenTranscriptBtn');
const facRegenSummaryBtn = document.getElementById('facRegenSummaryBtn');

if (facEditTranscriptBtn) {
  facEditTranscriptBtn.onclick = () => setTranscriptEditMode(true);
}
if (facSaveTranscriptBtn) {
  facSaveTranscriptBtn.onclick = async () => {
    const newTranscript = (document.getElementById('facTranscriptEditor')?.value || '').trim();
    if (!newTranscript) {
      toast('❌ Transcript cannot be empty.');
      return;
    }
    await saveFacultyReviewUpdates({ transcript: newTranscript }, '📝 Transcript updated! Regenerating summary from updated transcript...');
    setTranscriptEditMode(false);
    await regenerateLectureAi('summary');
  };
}

if (facEditSummaryBtn) {
  facEditSummaryBtn.onclick = () => setSummaryEditMode(true);
}
if (facSaveSummaryBtn) {
  facSaveSummaryBtn.onclick = async () => {
    const newSummary = (document.getElementById('facSummaryEditor')?.value || '').trim();
    await saveFacultyReviewUpdates({ summary: newSummary }, '📄 AI Summary updated & saved!');
    setSummaryEditMode(false);
  };
}

async function regenerateLectureAi(target) {
  if (!currentReviewRecording) return;
  const id = currentReviewRecording.id;
  const btn = target === 'transcript' ? facRegenTranscriptBtn : facRegenSummaryBtn;
  const origText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Generating...';
  }

  try {
    const mode = localStorage.getItem('vaani_summary_mode') || 'Medium';
    const res = await fetch(`${API_BASE}/${id}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ target, mode }),
    });
    if (res.ok) {
      const updated = sanitizeRecording(await res.json());
      currentReviewRecording = updated;
      const idx = recordings.findIndex(r => String(r.id) === String(id));
      if (idx !== -1) recordings[idx] = updated;
      saveLocalRecordings(recordings);

      const trView = document.getElementById('facTranscriptView');
      const trEdit = document.getElementById('facTranscriptEditor');
      const smView = document.getElementById('facSummaryView');
      const smEdit = document.getElementById('facSummaryEditor');
      if (trView) trView.innerHTML = escapeHtml(updated.transcript || '').replace(/\n/g, '<br>');
      if (trEdit) trEdit.value = updated.transcript || '';
      if (smView) smView.textContent = updated.summary || '';
      if (smEdit) smEdit.value = updated.summary || '';

      toast(target === 'transcript' ? '✅ Transcript & dependent Summary regenerated from audio!' : '✅ AI Summary regenerated from transcript!');
    } else {
      let errData = {};
      try { errData = await res.json(); } catch {}
      throw new Error(errData.error || 'Regeneration failed');
    }
  } catch (e) {
    toast(`❌ ${e?.message || (target === 'transcript' ? 'Transcript generation failed.' : 'Summary generation failed.')}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}

if (facRegenTranscriptBtn) {
  facRegenTranscriptBtn.onclick = () => regenerateLectureAi('transcript');
}
if (facRegenSummaryBtn) {
  facRegenSummaryBtn.onclick = () => regenerateLectureAi('summary');
}

// Publish / Unpublish handlers
async function toggleLecturePublish(id, shouldPublish) {
  if (!isFacultyRole()) {
    toast('❌ ACCESS DENIED: Only Faculty can publish or unpublish lectures.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/${id}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        publish: shouldPublish,
        status: shouldPublish ? 'PUBLISHED' : 'READY',
      }),
    });
    if (res.ok) {
      const updated = await res.json();
      const idx = recordings.findIndex(r => String(r.id) === String(id));
      if (idx !== -1) recordings[idx] = sanitizeRecording(updated);
      if (currentReviewRecording && String(currentReviewRecording.id) === String(id)) {
        currentReviewRecording = sanitizeRecording(updated);
      }
    }
  } catch (e) {
    const target = recordings.find(r => String(r.id) === String(id));
    if (target) {
      target.published = shouldPublish;
      target.facultyStatus = shouldPublish ? 'PUBLISHED' : 'READY';
    }
  }

  saveLocalRecordings(recordings);
  await fetchStorageBoxes();
  await loadRecordings();

  if (currentActiveBoxId) {
    const boxRecs = recordings.filter(r => Number(r.storageBoxId) === Number(currentActiveBoxId));
    renderBoxRecordings(boxRecs);
  }

  if (currentReviewRecording && String(currentReviewRecording.id) === String(id)) {
    const badgeEl = document.getElementById('facReviewStatusBadge');
    if (badgeEl) {
      badgeEl.className = 'badge ' + (shouldPublish ? 'badge-published' : 'badge-ready');
      badgeEl.textContent = shouldPublish ? '🚀 PUBLISHED' : '👁️ READY FOR REVIEW';
    }
  }

  toast(shouldPublish
    ? '🚀 Lecture PUBLISHED! Students can now access and study this lecture.'
    : '🔒 Lecture UNPUBLISHED. Hidden from Student Dashboard.');
}

const facPublishBtn = document.getElementById('facPublishBtn');
const facUnpublishBtn = document.getElementById('facUnpublishBtn');

if (facPublishBtn) {
  facPublishBtn.onclick = async () => {
    if (!currentReviewRecording) return;
    const trEdit = document.getElementById('facTranscriptEditor');
    const smEdit = document.getElementById('facSummaryEditor');
    const updates = {};
    if (trEdit && !trEdit.classList.contains('hidden')) {
      updates.transcript = trEdit.value.trim();
      setTranscriptEditMode(false);
    }
    if (smEdit && !smEdit.classList.contains('hidden')) {
      updates.summary = smEdit.value.trim();
      setSummaryEditMode(false);
    }
    await saveFacultyReviewUpdates(updates, null);
    await toggleLecturePublish(currentReviewRecording.id, true);
  };
}

if (facUnpublishBtn) {
  facUnpublishBtn.onclick = async () => {
    if (!currentReviewRecording) return;
    await toggleLecturePublish(currentReviewRecording.id, false);
  };
}

// Student Access Control Apply Button
const facApplyAccessBtn = document.getElementById('facApplyAccessBtn');
if (facApplyAccessBtn) {
  facApplyAccessBtn.onclick = async () => {
    if (!currentReviewRecording) return;
    const selected = [];
    document.querySelectorAll('#facAccessCheckboxes input[type="checkbox"]:checked').forEach(cb => {
      selected.push(cb.value);
    });
    if (selected.length === 0) {
      toast('Please select at least one Class, Course, or Subject batch.');
      return;
    }

    try {
      await fetch(`${API_BASE}/${currentReviewRecording.id}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ allowedAccess: selected }),
      });
    } catch (e) {}

    currentReviewRecording.allowedAccess = selected;
    toast(`✅ Access applied for: ${selected.join(', ')}`);
  };
}

// Replace Audio in Faculty Review
const facReplaceAudioInput = document.getElementById('facReplaceAudioInput');
if (facReplaceAudioInput) {
  facReplaceAudioInput.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file || !currentReviewRecording) return;

    const validation = validateAudioFile(file);
    if (!validation.valid) {
      toast(validation.error);
      facReplaceAudioInput.value = '';
      return;
    }

    toast('🔄 Replacing lecture audio and updating AI transcript & summary...');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('regenerateAi', 'true');

    try {
      const res = await fetch(`${API_BASE}/${currentReviewRecording.id}/replace-audio`, {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      });
      if (res.ok) {
        const updated = await res.json();
        currentReviewRecording = sanitizeRecording(updated);
        await loadRecordings();
        openFacultyReview(currentReviewRecording.id, false);
        toast('✅ Lecture audio replaced & AI content refreshed!');
      } else {
        let errData = {};
        try { errData = await res.json(); } catch {}
        toast(`❌ ${errData.error || 'Failed to replace audio. Please try again.'}`);
      }
    } catch (err) {
      toast('❌ Error replacing lecture audio.');
    } finally {
      facReplaceAudioInput.value = '';
    }
  });
}

// ── Faculty Profile Management ─────────────────────────────────────────────
const facSaveProfileBtn = document.getElementById('facSaveProfileBtn');
const facTogglePassBtn = document.getElementById('facTogglePassBtn');
const facPasswordBox = document.getElementById('facPasswordBox');
const facAvatarFileInput = document.getElementById('facAvatarFileInput');

if (facTogglePassBtn && facPasswordBox) {
  facTogglePassBtn.onclick = () => {
    facPasswordBox.classList.toggle('hidden');
  };
}

if (facAvatarFileInput) {
  facAvatarFileInput.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      localStorage.setItem('vaani_faculty_avatar', dataUrl);
      setUserInfo();
      toast('📷 Profile photo updated!');
    } catch (err) {
      toast('Could not load image.');
    }
  });
}

if (facSaveProfileBtn) {
  facSaveProfileBtn.onclick = async () => {
    const name = (document.getElementById('facProfNameInput')?.value || '').trim();
    const facultyId = (document.getElementById('facProfIdInput')?.value || '').trim();
    const email = (document.getElementById('facProfEmailInput')?.value || '').trim();
    const department = (document.getElementById('facProfDeptInput')?.value || '').trim();
    const currentPassword = document.getElementById('facCurrentPassInput')?.value || '';
    const newPassword = document.getElementById('facNewPassInput')?.value || '';
    const avatarUrl = localStorage.getItem('vaani_faculty_avatar') || '';

    if (!name || !email) {
      toast('Name and Faculty Email are required.');
      return;
    }

    try {
      const res = await fetch('/api/faculty/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          name,
          facultyId,
          email,
          department,
          avatarUrl,
          currentPassword: currentPassword || undefined,
          newPassword: newPassword || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Could not update profile.');
        return;
      }
    } catch (e) {}

    localStorage.setItem('vaani_user_name', name);
    localStorage.setItem('vaani_user_email', email);
    localStorage.setItem('vaani_faculty_id', facultyId);
    localStorage.setItem('vaani_faculty_dept', department);
    if (document.getElementById('facCurrentPassInput')) document.getElementById('facCurrentPassInput').value = '';
    if (document.getElementById('facNewPassInput')) document.getElementById('facNewPassInput').value = '';
    if (facPasswordBox) facPasswordBox.classList.add('hidden');

    setUserInfo();
    toast('✅ Faculty Profile saved successfully!');
  };
}

// ── 📦 Recording Storage Box System (Client Logic) ───────────────────────────
let storageBoxes = [];
let currentActiveBoxId = null;
let storageBoxSearchTerm = '';
let boxRecordingsSearchTerm = '';

async function fetchStorageBoxes() {
  try {
    const res = await fetch('/api/boxes', { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      storageBoxes = Array.isArray(data) ? data : [];
    }
  } catch (e) {
    if (storageBoxes.length === 0) {
      storageBoxes = [
        {
          id: 1,
          name: 'Artificial Intelligence & ML',
          description: 'Foundations of AI, machine learning algorithms, deep neural nets, and practical applications.',
          createdBy: 'Dr. Ananya Sharma',
          recordingCount: 2,
          publishedRecordingCount: 1,
          updatedAt: new Date().toISOString(),
        },
        {
          id: 2,
          name: 'Data Structures & Algorithms',
          description: 'Hierarchical tree structures, graph traversal algorithms, balancing heuristics, and complexity bounds.',
          createdBy: 'Prof. Verma',
          recordingCount: 1,
          publishedRecordingCount: 1,
          updatedAt: new Date().toISOString(),
        },
        {
          id: 3,
          name: 'Innovation & Research Lab',
          description: 'Interactive brainstorming sessions, audio synthesis systems, and rapid prototype reviews.',
          createdBy: 'Dr. Nair',
          recordingCount: 1,
          publishedRecordingCount: 1,
          updatedAt: new Date().toISOString(),
        }
      ];
    }
  }
  populateStorageBoxDropdowns();
  syncStudentSubjectFilter();
  renderStorageBoxesGrid();
}

function populateStorageBoxDropdowns() {
  const selects = [
    document.getElementById('facStorageBoxSelect'),
    document.getElementById('facReviewStorageBoxSelect'),
  ];
  selects.forEach(sel => {
    if (!sel) return;
    const prevVal = sel.value;
    const defaultOption = sel.id === 'facReviewStorageBoxSelect'
      ? '<option value="">-- No Box --</option>'
      : '<option value="">-- No Box (Independent Lecture) --</option>';

    const opts = [defaultOption];
    storageBoxes.forEach(box => {
      opts.push(`<option value="${box.id}">📦 ${escapeHtml(box.name)}</option>`);
    });
    sel.innerHTML = opts.join('');
    if (prevVal && Array.from(sel.options).some(o => o.value === prevVal)) {
      sel.value = prevVal;
    }
  });
}

function getBoxCountForRole(box, isFaculty) {
  if (isFaculty) {
    return box.recordingCount ?? box.recordingsCount ?? 0;
  }
  return box.publishedRecordingCount ?? box.publishedRecordingsCount ?? box.recordingCount ?? box.recordingsCount ?? 0;
}

function renderStorageBoxesGrid() {
  const grid = document.getElementById('storageBoxesGrid');
  const emptyState = document.getElementById('storageBoxesEmptyState');
  const countLabel = document.getElementById('storageBoxesCountLabel');
  const isFaculty = isFacultyRole();

  // Hide or show the create button in header & empty state based on role
  const createBtn = document.getElementById('createNewBoxBtn');
  const emptyCreateBtn = document.getElementById('emptyCreateBoxBtn');
  if (createBtn) createBtn.style.display = isFaculty ? 'inline-block' : 'none';
  if (emptyCreateBtn) emptyCreateBtn.style.display = isFaculty ? 'inline-block' : 'none';

  if (!grid) return;

  const query = (storageBoxSearchTerm || '').toLowerCase().trim();
  const filtered = storageBoxes.filter(box => {
    if (!query) return true;
    return (
      (box.name && box.name.toLowerCase().includes(query)) ||
      (box.description && box.description.toLowerCase().includes(query)) ||
      (box.createdBy && box.createdBy.toLowerCase().includes(query))
    );
  });

  if (countLabel) {
    countLabel.textContent = `${filtered.length} storage box${filtered.length === 1 ? '' : 'es'}`;
  }

  if (filtered.length === 0) {
    grid.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  grid.innerHTML = filtered.map(box => {
    const count = getBoxCountForRole(box, isFaculty);
    const countText = `${count} Recording${count === 1 ? '' : 's'}`;
    const updatedText = formatLocalDisplayDate(box.updatedAt || box.createdAt);
    const creatorText = box.createdBy || 'Faculty';
    const descText = box.description ? escapeHtml(box.description) : '<em style="color:var(--muted)">No description provided</em>';

    const facultyBtns = isFaculty ? `
      <button type="button" class="outline act-btn edit-box-btn" data-box-id="${box.id}" title="Rename / Edit Description"><i data-lucide="edit-3"></i> Edit</button>
      <button type="button" class="outline act-btn add-rec-to-box-btn" data-box-id="${box.id}" title="Add Recording to this Box"><i data-lucide="plus"></i> Add Lecture</button>
      <button type="button" class="outline act-btn delete-box-btn" data-box-id="${box.id}" style="color:var(--danger);border-color:var(--danger-border);" title="Delete Storage Box"><i data-lucide="trash-2"></i> Delete</button>
    ` : '';

    return `
      <div class="box-card" data-box-id="${box.id}">
        <div class="box-card-top">
          <div class="box-icon-title">
            <div class="box-icon-wrap"><i data-lucide="archive"></i></div>
            <div style="min-width:0;">
              <h3 class="box-card-name" title="${escapeHtml(box.name)}">${escapeHtml(box.name)}</h3>
              <span class="badge" style="background:var(--pale);color:var(--p);font-size:11.5px;font-weight:700;"><i data-lucide="layers" style="width:11px;height:11px;"></i> ${countText}</span>
            </div>
          </div>
        </div>

        <p class="box-card-desc">${descText}</p>

        <div class="box-card-meta">
          <div class="box-card-meta-row">
            <span><i data-lucide="user" style="width:13px;height:13px;color:var(--muted);vertical-align:-2px;"></i> <b>${escapeHtml(creatorText)}</b></span>
            <span><i data-lucide="calendar" style="width:13px;height:13px;color:var(--muted);vertical-align:-2px;"></i> <b>${escapeHtml(updatedText)}</b></span>
          </div>
        </div>

        <div class="box-card-actions">
          <button type="button" class="primary act-btn open-box-btn" data-box-id="${box.id}" style="padding:7px 14px;font-weight:700;"><i data-lucide="folder-open"></i> Open Box</button>
          ${facultyBtns}
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
}

async function openStorageBoxDetail(boxId) {
  currentActiveBoxId = Number(boxId);
  let boxData = null;
  let boxRecordings = [];

  try {
    const res = await fetch(`/api/boxes/${boxId}`, { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      boxData = data.box;
      boxRecordings = Array.isArray(data.recordings) ? data.recordings.map(sanitizeRecording) : [];
    }
  } catch (e) {}

  if (!boxData) {
    boxData = storageBoxes.find(b => Number(b.id) === Number(boxId)) || {
      id: boxId,
      name: 'Storage Box',
      description: '',
      createdBy: 'Faculty',
      recordingCount: 0,
      publishedRecordingCount: 0,
      updatedAt: new Date().toISOString(),
    };
    boxRecordings = recordings.filter(r => Number(r.storageBoxId) === Number(boxId));
  }

  // Populate Banner
  const nameEl = document.getElementById('boxDetailName');
  const countEl = document.getElementById('boxDetailCountBadge');
  const descEl = document.getElementById('boxDetailDesc');
  const creatorEl = document.getElementById('boxDetailCreator');
  const updatedEl = document.getElementById('boxDetailUpdated');
  const crumbName = document.getElementById('boxDetailCrumbName');
  const facultyActions = document.getElementById('boxDetailFacultyActions');
  const boxEmptyAddRecBtn = document.getElementById('boxEmptyAddRecBtn');

  const isFaculty = isFacultyRole();
  if (nameEl) nameEl.textContent = boxData.name;
  if (crumbName) crumbName.textContent = boxData.name;
  if (countEl) {
    const count = getBoxCountForRole(boxData, isFaculty) || boxRecordings.length;
    countEl.innerHTML = `<i data-lucide="archive"></i> ${count} Recording${count === 1 ? '' : 's'}`;
  }
  if (descEl) descEl.textContent = boxData.description || 'No description provided for this storage box.';
  if (creatorEl) creatorEl.textContent = boxData.createdBy || 'Faculty';
  if (updatedEl) updatedEl.textContent = formatLocalDisplayDate(boxData.updatedAt || boxData.createdAt);

  if (facultyActions) {
    facultyActions.style.display = isFaculty ? 'flex' : 'none';
  }
  if (boxEmptyAddRecBtn) {
    boxEmptyAddRecBtn.style.display = isFaculty ? 'inline-block' : 'none';
  }

  // Render recordings inside this box
  renderBoxRecordings(boxRecordings);

  page('storageBoxDetail');
}

function renderBoxRecordings(list) {
  const tbody = document.getElementById('boxRecordingsRows');
  const emptyEl = document.getElementById('boxRecordingsEmpty');
  if (!tbody) return;

  const isFaculty = isFacultyRole();
  const query = (boxRecordingsSearchTerm || '').toLowerCase().trim();

  const filtered = list.filter(r => {
    if (!isFaculty && r.published === false && r.facultyStatus !== 'PUBLISHED') return false;
    if (!query) return true;
    return (
      (r.title && r.title.toLowerCase().includes(query)) ||
      (r.subject && r.subject.toLowerCase().includes(query)) ||
      (r.lectureName && r.lectureName.toLowerCase().includes(query)) ||
      (r.professorName && r.professorName.toLowerCase().includes(query))
    );
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');

  tbody.innerHTML = filtered.map(r => {
    const audioSrc = r.audioDataUrl ? r.audioDataUrl : `${API_BASE}/${r.id}/audio`;
    const audioPlayerHtml = r.hasAudio
      ? `<audio controls src="${audioSrc}" style="width:170px;height:30px;vertical-align:middle;border-radius:6px;"></audio>`
      : '<small class="muted">No Audio</small>';
    const displayDate = formatLocalDisplayDate(r.createdAtIso || r.createdAt);

    let statusBadge = '<span class="badge badge-published"><i data-lucide="check-circle-2"></i> Published</span>';
    if (r.facultyStatus === 'DRAFT') statusBadge = '<span class="badge badge-draft"><i data-lucide="file-edit"></i> Draft</span>';
    else if (r.facultyStatus === 'READY') statusBadge = '<span class="badge badge-ready"><i data-lucide="eye"></i> Ready</span>';
    else if (r.facultyStatus === 'PROCESSING') statusBadge = '<span class="badge badge-processing"><i data-lucide="loader-2"></i> Processing</span>';

    let actionButtons = '';
    if (isFaculty) {
      actionButtons = `
        <button type="button" class="primary act-btn fac-review-btn" data-id="${r.id}" title="Review AI transcript and summary"><i data-lucide="eye"></i> Review</button>
        <button type="button" class="outline act-btn fac-review-btn" data-id="${r.id}" data-edit="1" title="Edit lecture content"><i data-lucide="edit-3"></i> Edit</button>
        <button type="button" class="outline act-btn fac-pub-toggle" data-id="${r.id}" data-publish="${r.published ? '0' : '1'}">
          ${r.published ? '<i data-lucide="lock"></i> Unpublish' : '<i data-lucide="send"></i> Publish'}
        </button>
        <button type="button" class="outline act-btn delete-rec" data-id="${r.id}" style="color:var(--danger);border-color:var(--danger-border);" title="Delete lecture"><i data-lucide="trash-2"></i></button>
      `;
    } else {
      actionButtons = `
        <button type="button" class="primary act-btn view" data-id="${r.id}"><i data-lucide="headphones"></i> Listen &amp; Read</button>
        <button type="button" class="outline act-btn" onclick="openDetail('${r.id}'); setTimeout(()=>document.querySelector('[data-detail=summary]')?.click(), 50);"><i data-lucide="sparkles"></i> Summary</button>
      `;
    }

    return `
      <tr>
        <td><b>${escapeHtml(r.title)}</b></td>
        <td>${escapeHtml(displayDate)}</td>
        <td>${escapeHtml(r.duration || '00:00')}</td>
        <td>${statusBadge}</td>
        <td>${audioPlayerHtml}</td>
        <td><div style="display:flex;gap:4px;flex-wrap:wrap;">${actionButtons}</div></td>
      </tr>
    `;
  }).join('');

  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
}

// ── Storage Box Modal Functions ──────────────────────────────────────────────
function openCreateBoxModal(presetName = '', presetDesc = '') {
  if (!isFacultyRole()) {
    toast('Access denied. Only Faculty can create storage boxes.');
    return;
  }
  const modal = document.getElementById('boxModal');
  const titleEl = document.getElementById('boxModalTitle');
  const idIn = document.getElementById('boxModalId');
  const nameIn = document.getElementById('boxModalName');
  const descIn = document.getElementById('boxModalDesc');
  const subBtn = document.getElementById('boxModalSubmitBtn');

  if (titleEl) titleEl.innerHTML = '<i data-lucide="archive"></i> Create Storage Box';
  if (idIn) idIn.value = '';
  if (nameIn) nameIn.value = presetName;
  if (descIn) descIn.value = presetDesc;
  if (subBtn) subBtn.innerHTML = '<i data-lucide="plus"></i> Create Box';

  if (modal) modal.classList.remove('hidden');
  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
  setTimeout(() => nameIn?.focus(), 50);
}

function openEditBoxModal(boxId) {
  if (!isFacultyRole()) {
    toast('Access denied. Only Faculty can edit storage boxes.');
    return;
  }
  const box = storageBoxes.find(b => Number(b.id) === Number(boxId));
  if (!box) return;

  const modal = document.getElementById('boxModal');
  const titleEl = document.getElementById('boxModalTitle');
  const idIn = document.getElementById('boxModalId');
  const nameIn = document.getElementById('boxModalName');
  const descIn = document.getElementById('boxModalDesc');
  const subBtn = document.getElementById('boxModalSubmitBtn');

  if (titleEl) titleEl.innerHTML = '<i data-lucide="edit-3"></i> Edit Storage Box';
  if (idIn) idIn.value = String(box.id);
  if (nameIn) nameIn.value = box.name || '';
  if (descIn) descIn.value = box.description || '';
  if (subBtn) subBtn.innerHTML = '<i data-lucide="check"></i> Save Changes';

  if (modal) modal.classList.remove('hidden');
  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
  setTimeout(() => nameIn?.focus(), 50);
}

function closeBoxModal() {
  const modal = document.getElementById('boxModal');
  if (modal) modal.classList.add('hidden');
}

async function handleBoxModalSubmit(e) {
  e.preventDefault();
  if (!isFacultyRole()) {
    toast('❌ ACCESS DENIED: Only Faculty can manage storage boxes.');
    return;
  }
  const idIn = document.getElementById('boxModalId');
  const nameIn = document.getElementById('boxModalName');
  const descIn = document.getElementById('boxModalDesc');

  const id = idIn?.value;
  const name = (nameIn?.value || '').trim();
  const description = (descIn?.value || '').trim();

  if (!name) {
    toast('Please enter a box name.');
    return;
  }

  const isEditing = Boolean(id);
  try {
    const url = isEditing ? `/api/boxes/${id}` : '/api/boxes';
    const method = isEditing ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name, description }),
    });

    if (res.ok) {
      const savedBox = await res.json();
      closeBoxModal();
      await fetchStorageBoxes();
      toast(isEditing ? `✏ Storage box "${name}" updated!` : `📦 Storage box "${name}" created!`);

      const facBoxSelect = document.getElementById('facStorageBoxSelect');
      if (facBoxSelect) {
        facBoxSelect.value = String(savedBox.id);
      }
      const subInput = document.getElementById('facSubjectInput');
      if (subInput && !subInput.value.trim()) {
        subInput.value = savedBox.name;
      }

      if (currentActiveBoxId && Number(currentActiveBoxId) === Number(savedBox.id)) {
        openStorageBoxDetail(savedBox.id);
      }
      return;
    }
  } catch (err) {}

  // Local fallback
  if (isEditing) {
    const box = storageBoxes.find(b => String(b.id) === String(id));
    if (box) {
      box.name = name;
      box.description = description;
      box.updatedAt = new Date().toISOString();
    }
    toast(`✏ Storage box "${name}" updated!`);
  } else {
    const newBox = {
      id: Date.now(),
      name,
      description,
      createdBy: localStorage.getItem('vaani_user_name') || 'Faculty',
      recordingCount: 0,
      publishedRecordingCount: 0,
      updatedAt: new Date().toISOString(),
    };
    storageBoxes.unshift(newBox);
    toast(`📦 Storage box "${name}" created!`);
  }

  closeBoxModal();
  populateStorageBoxDropdowns();
  renderStorageBoxesGrid();
}

async function deleteStorageBox(boxId) {
  if (!isFacultyRole()) {
    toast('❌ ACCESS DENIED: Only Faculty can delete storage boxes.');
    return;
  }
  const box = storageBoxes.find(b => Number(b.id) === Number(boxId));
  const boxName = box ? box.name : 'this storage box';

  try {
    await fetch(`/api/boxes/${boxId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
  } catch (e) {}

  storageBoxes = storageBoxes.filter(b => Number(b.id) !== Number(boxId));
  toast(`🗑 Storage box "${boxName}" deleted.`);

  populateStorageBoxDropdowns();
  renderStorageBoxesGrid();

  if (currentActiveBoxId && Number(currentActiveBoxId) === Number(boxId)) {
    page('storageBoxes');
  }
}

// Attach Storage Box event listeners
document.addEventListener('click', e => {
  const openBoxBtn = e.target.closest('.open-box-btn');
  if (openBoxBtn) {
    openStorageBoxDetail(openBoxBtn.dataset.boxId);
    return;
  }

  const editBoxBtn = e.target.closest('.edit-box-btn');
  if (editBoxBtn) {
    openEditBoxModal(editBoxBtn.dataset.boxId);
    return;
  }

  const delBoxBtn = e.target.closest('.delete-box-btn');
  if (delBoxBtn) {
    deleteStorageBox(delBoxBtn.dataset.boxId);
    return;
  }

  const addRecBtn = e.target.closest('.add-rec-to-box-btn');
  if (addRecBtn) {
    const boxId = addRecBtn.dataset.boxId;
    const box = storageBoxes.find(b => Number(b.id) === Number(boxId));
    page('facultyUpload');
    const sel = document.getElementById('facStorageBoxSelect');
    if (sel) sel.value = String(boxId);
    const subIn = document.getElementById('facSubjectInput');
    if (subIn && box) subIn.value = box.name;
    return;
  }
});

// Create box buttons
const createNewBoxBtn = document.getElementById('createNewBoxBtn');
if (createNewBoxBtn) createNewBoxBtn.onclick = () => openCreateBoxModal();

const emptyCreateBoxBtn = document.getElementById('emptyCreateBoxBtn');
if (emptyCreateBoxBtn) emptyCreateBoxBtn.onclick = () => openCreateBoxModal();

const facQuickNewBoxBtn = document.getElementById('facQuickNewBoxBtn');
if (facQuickNewBoxBtn) facQuickNewBoxBtn.onclick = () => openCreateBoxModal();

// Box Detail Buttons
const boxDetailBackCrumb = document.getElementById('boxDetailBackCrumb');
if (boxDetailBackCrumb) {
  boxDetailBackCrumb.onclick = e => {
    e.preventDefault();
    page('storageBoxes');
  };
}

const boxAddRecordingBtn = document.getElementById('boxAddRecordingBtn');
if (boxAddRecordingBtn) {
  boxAddRecordingBtn.onclick = () => {
    if (!currentActiveBoxId) return;
    const box = storageBoxes.find(b => Number(b.id) === Number(currentActiveBoxId));
    page('facultyUpload');
    const sel = document.getElementById('facStorageBoxSelect');
    if (sel) sel.value = String(currentActiveBoxId);
    const subIn = document.getElementById('facSubjectInput');
    if (subIn && box) subIn.value = box.name;
  };
}

const boxEmptyAddRecBtn = document.getElementById('boxEmptyAddRecBtn');
if (boxEmptyAddRecBtn) {
  boxEmptyAddRecBtn.onclick = () => {
    if (boxAddRecordingBtn) boxAddRecordingBtn.click();
  };
}

const boxEditDetailsBtn = document.getElementById('boxEditDetailsBtn');
if (boxEditDetailsBtn) {
  boxEditDetailsBtn.onclick = () => {
    if (currentActiveBoxId) openEditBoxModal(currentActiveBoxId);
  };
}

const boxDeleteBtn = document.getElementById('boxDeleteBtn');
if (boxDeleteBtn) {
  boxDeleteBtn.onclick = () => {
    if (currentActiveBoxId) deleteStorageBox(currentActiveBoxId);
  };
}

// Box Modal form & close buttons
const boxModalForm = document.getElementById('boxModalForm');
if (boxModalForm) boxModalForm.onsubmit = handleBoxModalSubmit;

const boxModalCloseBtn = document.getElementById('boxModalCloseBtn');
if (boxModalCloseBtn) boxModalCloseBtn.onclick = closeBoxModal;

const boxModalCancelBtn = document.getElementById('boxModalCancelBtn');
if (boxModalCancelBtn) boxModalCancelBtn.onclick = closeBoxModal;

const boxModalBackdrop = document.getElementById('boxModal');
if (boxModalBackdrop) {
  boxModalBackdrop.onclick = e => {
    if (e.target === boxModalBackdrop) closeBoxModal();
  };
}

// Search filters
const storageBoxSearchInput = document.getElementById('storageBoxSearchInput');
if (storageBoxSearchInput) {
  storageBoxSearchInput.addEventListener('input', e => {
    storageBoxSearchTerm = e.target.value;
    renderStorageBoxesGrid();
  });
}

const boxRecordingsSearchInput = document.getElementById('boxRecordingsSearchInput');
if (boxRecordingsSearchInput) {
  boxRecordingsSearchInput.addEventListener('input', e => {
    boxRecordingsSearchTerm = e.target.value;
    if (currentActiveBoxId) {
      const boxRecs = recordings.filter(r => Number(r.storageBoxId) === Number(currentActiveBoxId));
      renderBoxRecordings(boxRecs);
    }
  });
}

// ── Init & Role Landing ───────────────────────────────────
fetchStorageBoxes();
loadGeminiConfig();
if (isFacultyRole()) {
  page('facultyDashboard');
} else {
  loadRecordings();
}
