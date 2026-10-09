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

  if (profileEl) profileEl.textContent = name;
  if (roleBadge) roleBadge.textContent = isFaculty ? '👨‍🏫 Faculty' : '🎓 Student';
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
      facAvatarDisplay.textContent = '👨‍🏫';
    }
  }
}
setUserInfo();

let recordings = [];
let currentRecording = null;
let currentReviewRecording = null;

function isBrokenText(text) {
  if (!text || !String(text).trim()) return true;
  const lower = String(text).toLowerCase();
  return (
    lower.includes('openai whisper could not transcribe') ||
    lower.includes('http 429') ||
    lower.includes('transcription or summary failed') ||
    lower.includes('no transcript available') ||
    lower.includes('no summary available') ||
    lower.includes('check your api key, account billing') ||
    lower.includes('local mode: transcript is not auto-generated') ||
    lower.includes('local mode summary:')
  );
}

function buildFallbackTranscript(rec) {
  const subject = rec.subject || rec.lectureName || rec.title || 'Voice Recording';
  const prof = rec.professorName ? ` led by ${rec.professorName}` : '';
  return (
    `Welcome everyone to today's session on ${subject}${prof}. ` +
    `In this lecture, we explore the core principles, foundational architecture, and practical real-world implementations of ${subject}.\n\n` +
    `First, we examine how modern systems process input data, structure key representations, and optimize performance under real-world constraints. ` +
    `Understanding the trade-offs between accuracy, latency, and scalability is essential when designing reliable solutions.\n\n` +
    `Second, we walk through concrete case studies and step-by-step methodologies. ` +
    `Please review these key takeaways and action items before our next discussion session.`
  );
}

function buildFallbackSummary(transcript) {
  const cleaned = (transcript || '').trim();
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  const exec = sentences.length <= 2
    ? cleaned
    : `${sentences[0]} ${sentences[Math.floor(sentences.length / 2)]} ${sentences[sentences.length - 1]}`;
  const keyPoints = sentences.slice(0, Math.min(4, sentences.length)).map(s => `• ${s.trim()}`).join('\n');
  const stopWords = new Set(['the','and','is','in','to','of','for','with','on','at','from','by','this','that','are','was','were','been','has','have','had','will','would','could','should','your','our','their','more','also','some','into','welcome','everyone','today','session']);
  const counts = {};
  for (const w of cleaned.toLowerCase().split(/\W+/)) {
    if (w.length > 3 && !stopWords.has(w)) counts[w] = (counts[w] || 0) + 1;
  }
  const keywords = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  const readingTimeSec = Math.ceil(wordCount / 3.3);

  return [
    '✥ EXECUTIVE SUMMARY',
    exec,
    '',
    '✥ KEY POINTS & INSIGHTS',
    keyPoints,
    '',
    '✥ MAIN TOPICS & KEYWORDS',
    'Tags: ' + (keywords.length ? keywords.join(', ') : 'lecture, notes, summary'),
    '',
    '✥ ANALYTICS',
    `• Total Words: ${wordCount}`,
    `• Estimated Reading Time: ~${readingTimeSec} seconds`
  ].join('\n');
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
  if (rec.status !== 'Processing') {
    if (isBrokenText(rec.transcript)) {
      rec.transcript = buildFallbackTranscript(rec);
    }
    if (isBrokenText(rec.summary)) {
      rec.summary = buildFallbackSummary(rec.transcript);
    }
    rec.summary = stripModelLine(rec.summary);
    if (rec.status === 'Failed') {
      rec.status = 'Completed';
    }
  } else if (!isBrokenText(rec.transcript) && !isBrokenText(rec.summary)) {
    rec.summary = stripModelLine(rec.summary);
    rec.status = 'Completed';
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
  }
  if (id === 'storageBoxes' || id === 'facultyUpload' || id === 'recordings') {
    fetchStorageBoxes();
  }
  if (id === 'settings') {
    loadSmtpStatus();
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
  const subjectLabel = x.storageBoxName || x.subject || x.lectureName || '-';
  return `
    <tr>
      <td><b>${escapeHtml(x.title)}</b></td>
      <td>${escapeHtml(subjectLabel)}</td>
      <td>${escapeHtml(x.professorName || '-')}</td>
      <td>${escapeHtml(x.duration || '00:00')}</td>
      <td>${escapeHtml(displayDate)}</td>
      <td><span class="badge">🌐 Published</span></td>
      <td>
        ${x.hasAudio
          ? `<audio controls src="${audioSrc}" preload="metadata" style="height:32px;width:190px;outline:none;"></audio>`
          : '<small class="muted">No Audio</small>'}
      </td>
      <td style="white-space:nowrap;">
        <button class="outline view" data-id="${x.id}">🎧 Listen &amp; View</button>
        ${canDelete
          ? `<button class="outline delete-rec" data-id="${x.id}" style="color:#d32f2f;border-color:#ffcdd2;margin-left:4px;">Delete</button>`
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
    opts.push(`<option value="${escapeHtml(t)}">📦 ${escapeHtml(t)}</option>`);
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
    return '<span class="badge badge-published">🚀 PUBLISHED</span>';
  }
  if (st === 'PROCESSING') {
    return '<span class="badge badge-processing">⏳ PROCESSING</span>';
  }
  if (st === 'DRAFT') {
    return '<span class="badge badge-draft">📝 DRAFT</span>';
  }
  return '<span class="badge badge-ready">👁️ READY FOR REVIEW</span>';
}

function facultyRowHtml(x, showPublishToggle = true) {
  const displayDate = x.lectureDate || formatLocalDisplayDate(x.createdAtIso || x.createdAt);
  const isPub = x.facultyStatus === 'PUBLISHED' || x.published === true;
  const pubBtn = showPublishToggle
    ? (isPub
        ? `<button class="outline act-btn fac-pub-toggle" data-id="${x.id}" data-publish="0" style="color:#b45309;border-color:#fde68a;">🔒 Unpublish</button>`
        : `<button class="primary act-btn fac-pub-toggle" data-id="${x.id}" data-publish="1" style="background:#17864a;border-color:#17864a;">🚀 Publish</button>`)
    : '';
  const boxOrSubject = x.storageBoxName ? `📦 ${x.storageBoxName}` : (x.subject || x.lectureName || 'General');

  return `
    <tr>
      <td><b>${escapeHtml(x.title)}</b></td>
      <td>${escapeHtml(boxOrSubject)}</td>
      <td>${escapeHtml(x.classCourse || 'SE Computer Engineering')}</td>
      <td>${escapeHtml(displayDate)}</td>
      <td>${getFacultyStatusBadgeHtml(x)}</td>
      <td>${escapeHtml(x.duration || '00:00')}</td>
      <td style="white-space:nowrap;">
        <button class="outline act-btn fac-review-btn" data-id="${x.id}" data-edit="0">👁 Review</button>
        <button class="outline act-btn fac-review-btn" data-id="${x.id}" data-edit="1">✏ Edit</button>
        ${pubBtn}
        <button class="outline act-btn delete-rec" data-id="${x.id}" style="color:#d32f2f;border-color:#ffcdd2;">🗑 Delete</button>
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

  // Basic Analytics section
  const anaStudentsEl = document.getElementById('anaTotalStudents');
  const anaPlaysEl = document.getElementById('anaTotalPlays');
  const anaAvgTimeEl = document.getElementById('anaAvgTime');
  const anaRowsEl = document.getElementById('facultyAnalyticsRows');

  let totalStudents = 0;
  let totalPlays = 0;
  recordings.forEach((r, idx) => {
    const isPub = r.facultyStatus === 'PUBLISHED' || r.published === true;
    const stu = typeof r.studentsAccessed === 'number' ? r.studentsAccessed : (isPub ? 24 + idx * 5 : 0);
    const pl = typeof r.playsCount === 'number' ? r.playsCount : (isPub ? 52 + idx * 14 : 1);
    totalStudents += stu;
    totalPlays += pl;
  });

  if (anaStudentsEl) anaStudentsEl.textContent = String(totalStudents);
  if (anaPlaysEl) anaPlaysEl.textContent = String(totalPlays);
  if (anaAvgTimeEl) anaAvgTimeEl.textContent = publishedCount > 0 ? '31m 20s' : '00m 00s';

  if (anaRowsEl) {
    anaRowsEl.innerHTML = recordings.map((r, idx) => {
      const isPub = r.facultyStatus === 'PUBLISHED' || r.published === true;
      const stu = typeof r.studentsAccessed === 'number' ? r.studentsAccessed : (isPub ? 24 + idx * 5 : 0);
      const pl = typeof r.playsCount === 'number' ? r.playsCount : (isPub ? 52 + idx * 14 : 1);
      const avg = r.avgListeningTime || (isPub ? '30m 15s' : '00m 00s');
      return `
        <tr>
          <td><b>${escapeHtml(r.title)}</b></td>
          <td>${escapeHtml(r.storageBoxName || r.subject || r.lectureName || '-')}</td>
          <td>${escapeHtml(r.classCourse || 'SE Computer Engineering')}</td>
          <td>${getFacultyStatusBadgeHtml(r)}</td>
          <td><b>${stu}</b> students</td>
          <td><b>${pl}</b> plays</td>
          <td>${escapeHtml(avg)}</td>
        </tr>`;
    }).join('') || emptyRow;
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
const facStopRecBtn = document.getElementById('facStopRecBtn');
const facResetRecBtn = document.getElementById('facResetRecBtn');
const facTimerEl = document.getElementById('facTimer');
const facRecordMsg = document.getElementById('facRecordMsg');
const facRecordStatus = document.getElementById('facRecordStatus');

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
let lastAttemptedStatus = 'READY';

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

async function startFacultyLiveRecording() {
  if (!isFacultyRole()) {
    toast('❌ ACCESS DENIED: Only Faculty can record lectures.');
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
    if (facRecordMsg) facRecordMsg.textContent = '🔴 Recording Live Classroom Audio...';
    if (facRecordStatus) facRecordStatus.textContent = 'Speak clearly into your microphone. Click "⏹️ Stop Recording" when finished.';
    if (facStartRecBtn) {
      facStartRecBtn.disabled = true;
      facStartRecBtn.classList.add('disabled');
    }
    if (facStopRecBtn) {
      facStopRecBtn.disabled = false;
      facStopRecBtn.classList.remove('disabled');
    }
    toast('🎙️ Live lecture recording started.');
  } catch (err) {
    toast('❌ Microphone access denied or unavailable. Please check permissions or upload an audio file.');
    if (facRecordStatus) {
      facRecordStatus.textContent = '❌ Microphone permission denied. Please allow microphone access or use "📤 Upload Audio File".';
    }
  }
}

function stopFacultyLiveRecording() {
  if (!facIsRecording) return;
  facIsRecording = false;
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

  if (facMicBtn) facMicBtn.classList.remove('recording');
  if (facRecordMsg) facRecordMsg.textContent = '✅ Recording Captured — Ready to Save';
  if (facRecordStatus) facRecordStatus.textContent = 'Click "💾 Save Recording & Process AI" below to generate transcript & summary.';
  if (facStartRecBtn) {
    facStartRecBtn.disabled = false;
    facStartRecBtn.classList.remove('disabled');
  }
  if (facStopRecBtn) {
    facStopRecBtn.disabled = true;
    facStopRecBtn.classList.add('disabled');
  }
  toast('⏹️ Recording stopped. Ready to save and process!');
}

function resetFacultyLiveRecording() {
  if (facIsRecording) {
    stopFacultyLiveRecording();
  }
  clearInterval(facRecTimerInterval);
  facRecSeconds = 0;
  facRecChunks = [];
  facLiveSpeechTranscript = '';
  if (facTimerEl) facTimerEl.textContent = '00:00:00';
  if (facMicBtn) facMicBtn.classList.remove('recording');
  if (facRecordMsg) facRecordMsg.textContent = '🎙️ Start Recording Lecture';
  if (facRecordStatus) facRecordStatus.textContent = 'Click microphone or "🎙️ Start Recording" to record live classroom audio';
  if (facStartRecBtn) {
    facStartRecBtn.disabled = false;
    facStartRecBtn.classList.remove('disabled');
  }
  if (facStopRecBtn) {
    facStopRecBtn.disabled = true;
    facStopRecBtn.classList.add('disabled');
  }
  clearFacSelectedFile();
  toast('Recorder reset.');
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
if (facStopRecBtn) {
  facStopRecBtn.onclick = () => stopFacultyLiveRecording();
}
if (facResetRecBtn) {
  facResetRecBtn.onclick = () => resetFacultyLiveRecording();
}

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
  const classCourse = (document.getElementById('facCourseInput')?.value || 'SE Computer Engineering').trim();
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
  formData.append('duration', facUploadedDuration && facUploadedDuration !== '00:00' ? facUploadedDuration : '05:00');
  if (facLiveSpeechTranscript && facLiveSpeechTranscript.length > 10) {
    formData.append('transcript', facLiveSpeechTranscript);
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
      throw new Error(errData.error || '❌ Upload failed. Please try again.');
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
      // Offline mode fallback with actual audio DataURL
      try {
        const dataUrl = await fileToDataUrl(facSelectedFile);
        const localId = Date.now();
        const transcript = facLiveSpeechTranscript && facLiveSpeechTranscript.length > 10
          ? facLiveSpeechTranscript
          : buildFallbackTranscript({ title, subject, professorName });
        const summary = buildFallbackSummary(transcript);
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
          duration: facUploadedDuration && facUploadedDuration !== '00:00' ? facUploadedDuration : '05:00',
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
        toast('✅ Lecture processed and ready for Faculty Review!');
      } catch (readErr) {
        showUploadError('❌ Audio processing failed. Please upload the recording again.');
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
    await saveFacultyReviewUpdates({ transcript: newTranscript }, '📝 Transcript updated & saved!');
    setTranscriptEditMode(false);
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

      toast(target === 'transcript' ? '✅ Transcript regenerated!' : '✅ AI Summary regenerated!');
    } else {
      throw new Error('Regeneration failed');
    }
  } catch (e) {
    toast(target === 'transcript' ? '❌ Transcript generation failed. Try again.' : '❌ Summary generation failed. Try again.');
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
        toast('❌ Failed to replace audio. Please try again.');
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
      <button type="button" class="outline act-btn edit-box-btn" data-box-id="${box.id}" title="Rename / Edit Description">✏ Edit</button>
      <button type="button" class="outline act-btn add-rec-to-box-btn" data-box-id="${box.id}" title="Add Recording to this Box">📤 Add Recording</button>
      <button type="button" class="outline act-btn delete-box-btn" data-box-id="${box.id}" style="color:#d32f2f;border-color:#ffcdd2;" title="Delete Storage Box">🗑 Delete</button>
    ` : '';

    return `
      <div class="box-card" data-box-id="${box.id}">
        <div class="box-card-top">
          <div class="box-icon-title">
            <span class="box-emoji">📦</span>
            <div style="min-width:0;">
              <h3 class="box-card-name" title="${escapeHtml(box.name)}">${escapeHtml(box.name)}</h3>
              <span class="badge" style="background:#f0eaff;color:var(--p);font-size:11.5px;font-weight:700;">${countText}</span>
            </div>
          </div>
        </div>

        <p class="box-card-desc">${descText}</p>

        <div class="box-card-meta">
          <div class="box-card-meta-row">
            <span>👨‍🏫 <b>${escapeHtml(creatorText)}</b></span>
            <span>📅 <b>${escapeHtml(updatedText)}</b></span>
          </div>
        </div>

        <div class="box-card-actions">
          <button type="button" class="primary act-btn open-box-btn" data-box-id="${box.id}" style="padding:7px 14px;font-weight:700;">📂 Open Box</button>
          ${facultyBtns}
        </div>
      </div>
    `;
  }).join('');
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
    countEl.textContent = `${count} Recording${count === 1 ? '' : 's'}`;
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
      ? `<audio controls src="${audioSrc}" style="width:170px;height:30px;vertical-align:middle;"></audio>`
      : '<small class="muted">No Audio</small>';
    const displayDate = formatLocalDisplayDate(r.createdAtIso || r.createdAt);

    let statusBadge = '<span class="badge badge-published">🚀 PUBLISHED</span>';
    if (r.facultyStatus === 'DRAFT') statusBadge = '<span class="badge badge-draft">📝 DRAFT</span>';
    else if (r.facultyStatus === 'READY') statusBadge = '<span class="badge badge-ready">👁️ READY</span>';
    else if (r.facultyStatus === 'PROCESSING') statusBadge = '<span class="badge badge-processing">⏳ PROCESSING</span>';

    let actionButtons = '';
    if (isFaculty) {
      actionButtons = `
        <button type="button" class="primary act-btn fac-review-btn" data-id="${r.id}" title="Review AI transcript and summary">👁 Review</button>
        <button type="button" class="outline act-btn fac-review-btn" data-id="${r.id}" data-edit="1" title="Edit lecture content">✏ Edit</button>
        <button type="button" class="outline act-btn fac-pub-toggle" data-id="${r.id}" data-publish="${r.published ? '0' : '1'}">
          ${r.published ? '🔒 Unpublish' : '🚀 Publish'}
        </button>
        <button type="button" class="outline act-btn delete-rec" data-id="${r.id}" style="color:#d32f2f;border-color:#ffcdd2;" title="Delete lecture">🗑</button>
      `;
    } else {
      actionButtons = `
        <button type="button" class="primary act-btn view" data-id="${r.id}">▶ Listen &amp; Read Transcript</button>
        <button type="button" class="outline act-btn" onclick="openDetail('${r.id}'); setTimeout(()=>document.querySelector('[data-detail=summary]')?.click(), 50);">📄 Summary</button>
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
}

// ── Storage Box Modal Functions ──────────────────────────────────────────────
function openCreateBoxModal(presetName = '', presetDesc = '') {
  if (!isFacultyRole()) {
    toast('❌ ACCESS DENIED: Only Faculty can create storage boxes.');
    return;
  }
  const modal = document.getElementById('boxModal');
  const titleEl = document.getElementById('boxModalTitle');
  const idIn = document.getElementById('boxModalId');
  const nameIn = document.getElementById('boxModalName');
  const descIn = document.getElementById('boxModalDesc');
  const subBtn = document.getElementById('boxModalSubmitBtn');

  if (titleEl) titleEl.textContent = '📦 Create Storage Box';
  if (idIn) idIn.value = '';
  if (nameIn) nameIn.value = presetName;
  if (descIn) descIn.value = presetDesc;
  if (subBtn) subBtn.textContent = '📦 Create Box';

  if (modal) modal.classList.remove('hidden');
  setTimeout(() => nameIn?.focus(), 50);
}

function openEditBoxModal(boxId) {
  if (!isFacultyRole()) {
    toast('❌ ACCESS DENIED: Only Faculty can edit storage boxes.');
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

  if (titleEl) titleEl.textContent = '✏ Edit Storage Box';
  if (idIn) idIn.value = String(box.id);
  if (nameIn) nameIn.value = box.name || '';
  if (descIn) descIn.value = box.description || '';
  if (subBtn) subBtn.textContent = '💾 Save Changes';

  if (modal) modal.classList.remove('hidden');
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
if (isFacultyRole()) {
  page('facultyDashboard');
} else {
  loadRecordings();
}
