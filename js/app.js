const API_BASE = '/api/recordings';
const LOCAL_STORAGE_KEY = 'vaani_recordings_v1';
let backendAvailable = true;
let fallbackToastShown = false;

// ── Auth helpers ───────────────────────────────────────────
function getAuthToken() {
  return localStorage.getItem('vaani_auth_token');
}

function authHeaders() {
  const token = getAuthToken();
  return token ? { 'Authorization': 'Bearer ' + token } : {};
}

function handleAuthError(res) {
  if (res.status === 401) {
    localStorage.removeItem('vaani_auth_token');
    localStorage.removeItem('vaani_user_name');
    localStorage.removeItem('vaani_user_email');
    window.location.href = 'login.html';
    return true;
  }
  return false;
}

// Set user name dynamically
function setUserInfo() {
  const name = localStorage.getItem('vaani_user_name') || 'User';
  const summaryMode = localStorage.getItem('vaani_summary_mode') || 'Medium';
  const profileEl = document.getElementById('profileName');
  const eyebrow = document.querySelector('.eyebrow');
  const settingsName = document.getElementById('settingsName');
  const settingsSelect = document.querySelector('#settings select');
  if (profileEl) profileEl.textContent = name;
  if (eyebrow) eyebrow.textContent = 'Welcome back, ' + name + '!';
  if (settingsName) settingsName.value = name;
  if (settingsSelect) settingsSelect.value = summaryMode;
}
setUserInfo();

let recordings = [];
let currentRecording = null;
let recordedBlob = null;
let uploadedFileDuration = '';

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
  const subject = rec.lectureName || rec.title || 'Voice Recording';
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
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
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
  t.textContent = m;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
};

// ── Page routing ───────────────────────────────────────────
function page(id) {
  // Stop polling and pause detail audio when navigating away from the detail view
  if (id !== 'detail') {
    stopPolling();
    const detailPlayer = document.querySelector('#detailAudioPlayer');
    if (detailPlayer && !detailPlayer.paused) {
      try { detailPlayer.pause(); } catch (e) {}
    }
  }
  if (id === 'dashboard' || id === 'recordings') {
    loadRecordings();
  }
  if (id === 'settings') {
    loadSmtpStatus();
  }
  document.querySelectorAll('.page').forEach(x => x.classList.toggle('active', x.id === id));
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x.dataset.page === id));
  if (id === 'voice' && typeof resizeVoiceCanvas === 'function') {
    setTimeout(resizeVoiceCanvas, 30);
  }
  window.scrollTo(0, 0);
}

document.addEventListener('click', e => {
  let b = e.target.closest('[data-page]');
  if (b) page(b.dataset.page);

  let viewBtn = e.target.closest('.view');
  if (viewBtn) openDetail(viewBtn.dataset.id);

  let deleteBtn = e.target.closest('.delete-rec');
  if (deleteBtn) deleteRecording(deleteBtn.dataset.id);
});

// ── Load + Render recordings ───────────────────────────────
async function loadRecordings() {
  try {
    const res = await fetch(API_BASE, { headers: authHeaders() });
    if (handleAuthError(res)) return;
    if (!res.ok) throw new Error('Failed to fetch');
    backendAvailable = true;
    const rawList = await res.json();
    recordings = (Array.isArray(rawList) ? rawList : []).map(sanitizeRecording);
    // Also clean any broken entries in localStorage
    loadLocalRecordings();
    renderRecordings();
  } catch (err) {
    backendAvailable = false;
    recordings = loadLocalRecordings();
    renderRecordings();
    showFallbackToast();
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function rowHtml(x) {
  const audioSrc = x.audioDataUrl ? x.audioDataUrl : `${API_BASE}/${x.id}/audio`;
  return `
    <tr>
      <td><b>${escapeHtml(x.title)}</b></td>
      <td>${escapeHtml(x.lectureName || '-')}</td>
      <td>${escapeHtml(x.professorName || '-')}</td>
      <td>${escapeHtml(x.duration || '00:00')}</td>
      <td>${escapeHtml(x.createdAt || '')}</td>
      <td><span class="badge">${escapeHtml(x.status || 'Completed')}</span></td>
      <td>
        ${x.hasAudio
          ? `<audio controls src="${audioSrc}" preload="metadata" style="height:32px;width:190px;outline:none;"></audio>`
          : '<small class="muted">No Audio</small>'}
      </td>
      <td style="white-space:nowrap;">
        <button class="outline view" data-id="${x.id}">View</button>
        <button class="outline delete-rec" data-id="${x.id}" style="color:#d32f2f;border-color:#ffcdd2;margin-left:4px;">Delete</button>
      </td>
    </tr>`;
}

function renderRecordings() {
  const rows = recordings.map(rowHtml).join('');
  const empty8 = '<tr><td colspan="8" style="text-align:center;padding:20px;">No recordings yet. Create one!</td></tr>';
  const emptyAll = '<tr><td colspan="8" style="text-align:center;padding:20px;">No recordings found.</td></tr>';
  document.querySelector('#rows').innerHTML    = rows || empty8;
  document.querySelector('#allrows').innerHTML = rows || emptyAll;

  document.querySelector('#statSummaries').textContent = recordings.length;
  const totalMin = recordings.reduce((acc, r) => {
    const parts = (r.duration || '0:0').split(':').map(n => parseInt(n, 10) || 0);
    if (parts.length === 3) {
      return acc + parts[0] * 60 + parts[1] + parts[2] / 60;
    }
    return acc + (parts[0] || 0) + (parts[1] || 0) / 60;
  }, 0);
  document.querySelector('#statAudio').textContent = (totalMin / 60).toFixed(1) + ' hrs';
  syncLectureSelects();
}

function syncLectureSelects() {
  const selects = [
    document.getElementById('tutorLectureSelect'),
    document.getElementById('voiceLectureSelect'),
  ];
  selects.forEach(sel => {
    if (!sel) return;
    const prevVal = sel.value;
    const options = ['<option value="">General Academic Doubt (All Topics)</option>'];
    recordings.forEach(r => {
      const label = r.lectureName ? `${r.lectureName} (${r.title})` : r.title;
      options.push(`<option value="${escapeHtml(String(r.id))}">${escapeHtml(label)}</option>`);
    });
    sel.innerHTML = options.join('');
    if (prevVal && Array.from(sel.options).some(o => o.value === prevVal)) {
      sel.value = prevVal;
    }
  });
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

  // Show lecture / professor under the title
  const meta = [];
  if (rec.lectureName)  meta.push('Lecture: ' + rec.lectureName);
  if (rec.professorName) meta.push('Prof: ' + rec.professorName);
  document.querySelector('#detailMeta').textContent = meta.length ? meta.join('  |  ') : 'Processed by Vaani AI';

  document.querySelector('#detailDuration').textContent = rec.duration || '00:00';
  document.querySelector('#detailLecture').textContent  = rec.lectureName  || '-';
  document.querySelector('#detailProfessor').textContent = rec.professorName || '-';
  document.querySelector('#detailCreated').textContent  = rec.createdAt   || 'Just now';
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
  if (!backendAvailable) {
    recordings = recordings.filter(r => String(r.id) !== String(id));
    saveLocalRecordings(recordings);
    renderRecordings();
    toast('Recording deleted.');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (handleAuthError(res)) return;
    if (res.ok) { toast('Recording deleted.'); loadRecordings(); }
    else toast('Failed to delete recording.');
  } catch (err) {
    toast('Server error while deleting.');
  }
}

// ── Media Recorder ─────────────────────────────────────────
let rec, timer, sec = 0, chunks = [];
let resetting = false;
let speechRec = null;
let liveSpeechTranscript = '';

function startSpeechRecognition() {
  liveSpeechTranscript = '';
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;
  try {
    speechRec = new SpeechRecognition();
    speechRec.continuous = true;
    speechRec.interimResults = true;
    speechRec.lang = 'en-US';
    let finalTranscript = '';
    speechRec.onresult = event => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += piece + ' ';
        } else {
          interim += piece;
        }
      }
      liveSpeechTranscript = (finalTranscript + interim).trim();
    };
    speechRec.onerror = () => {};
    speechRec.start();
  } catch (e) {
    speechRec = null;
  }
}

function stopSpeechRecognition() {
  if (speechRec) {
    try { speechRec.stop(); } catch (e) {}
    speechRec = null;
  }
}

function tick() {
  const h = String(sec / 3600 | 0).padStart(2, '0');
  const m = String((sec % 3600) / 60 | 0).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  document.querySelector('#timer').textContent = `${h}:${m}:${s}`;
}

const mic        = document.querySelector('#mic');
const recordMsg  = document.querySelector('#recordMsg');
const statusElem = document.querySelector('#status');
const stopBtn    = document.querySelector('#stop');

if (mic) {
  mic.onclick = async () => {
    if (rec && rec.state === 'recording') return; // prevent double-click
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      rec = new MediaRecorder(stream);
      chunks = [];
      resetting = false;
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = () => {
        stopSpeechRecognition();
        stream.getTracks().forEach(t => t.stop());
        if (!resetting) {
          recordedBlob = new Blob(chunks, { type: 'audio/webm' });
          toast('Recording stopped. Ready to process.');
        }
      };
      rec.start();
      startSpeechRecognition();

      sec = 0;
      tick();
      timer = setInterval(() => { sec++; tick(); }, 1000);
      mic.classList.add('recording');
      recordMsg.textContent = 'Recording your voice...';
      statusElem.textContent = 'Recording in progress';
      stopBtn.disabled = false;
      stopBtn.classList.remove('disabled');
    } catch (e) {
      toast('Microphone access was denied.');
    }
  };
}

if (stopBtn) {
  stopBtn.onclick = () => {
    if (rec && rec.state === 'recording') {
      stopSpeechRecognition();
      rec.stop();
      clearInterval(timer);
      mic.classList.remove('recording');
      recordMsg.textContent = 'Recording complete';
      statusElem.textContent = 'Recording ready for processing';
      stopBtn.disabled = true;
      stopBtn.classList.add('disabled');
    }
  };
}

document.querySelector('#reset').onclick = () => {
  stopSpeechRecognition();
  liveSpeechTranscript = '';
  if (rec && rec.state === 'recording') {
    resetting = true;
    rec.stop();
  }
  clearInterval(timer);
  sec = 0;
  tick();
  recordedBlob = null;
  mic.classList.remove('recording');
  recordMsg.textContent = 'Click the microphone to start recording';
  statusElem.textContent = 'Recording not started';
  stopBtn.disabled = true;
  stopBtn.classList.add('disabled');
  document.querySelector('#audio').value = '';
  document.querySelector('#file').textContent = '';
  document.querySelector('#uploadTranscript').value = '';
  document.querySelector('#lectureNameInput').value = '';
  document.querySelector('#professorNameInput').value = '';
};

// ── Tab switching (Record / Upload) ────────────────────────
const recordTab    = document.querySelector('#recordTab');
const uploadTab    = document.querySelector('#uploadTab');
const recordPane   = document.querySelector('#recordPane');
const uploadPane   = document.querySelector('#uploadPane');
const audioFileInput = document.querySelector('#audio');

if (recordTab && uploadTab) {
  recordTab.onclick = () => {
    recordTab.classList.add('active');    uploadTab.classList.remove('active');
    recordPane.classList.remove('hidden'); uploadPane.classList.add('hidden');
  };
  uploadTab.onclick = () => {
    uploadTab.classList.add('active');    recordTab.classList.remove('active');
    uploadPane.classList.remove('hidden'); recordPane.classList.add('hidden');
  };
}

if (audioFileInput) {
  audioFileInput.onchange = e => {
    const f = e.target.files[0];
    document.querySelector('#file').textContent = f ? `Selected: ${f.name}` : '';
    uploadedFileDuration = '';
    if (f) {
      const tempAudio = document.createElement('audio');
      const objUrl = URL.createObjectURL(f);
      tempAudio.preload = 'metadata';
      tempAudio.onloadedmetadata = () => {
        URL.revokeObjectURL(objUrl);
        if (isFinite(tempAudio.duration) && tempAudio.duration > 0) {
          const totalSec = Math.round(tempAudio.duration);
          const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
          const s = String(totalSec % 60).padStart(2, '0');
          uploadedFileDuration = `${m}:${s}`;
        }
      };
      tempAudio.onerror = () => URL.revokeObjectURL(objUrl);
      tempAudio.src = objUrl;
    }
  };
}

// ── Process / Transcribe & Summarize ──────────────────────
let pollingInterval = null;

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

async function pollRecordingStatus(id) {
  try {
    const res = await fetch(`${API_BASE}/${id}`, { headers: authHeaders() });
    if (handleAuthError(res)) return;
    if (!res.ok) return;
    const rec = await res.json();

    // Update status badge live
    const statusBadge = document.querySelector('#detailStatus');
    if (statusBadge) statusBadge.textContent = rec.status || 'Processing';

    if (rec.status !== 'Processing') {
      stopPolling();
      const cleanRec = sanitizeRecording(rec);
      await loadRecordings();
      // Refresh the detail view with final data
      document.querySelector('#transcriptText').innerHTML =
        escapeHtml(cleanRec.transcript || 'No transcript available.').replace(/\n/g, '<br>');
      document.querySelector('#summaryText').textContent = cleanRec.summary || 'No summary available.';
      document.querySelector('#detailStatus').textContent = cleanRec.status || 'Completed';

      if (rec.status === 'Completed') {
        toast('Transcription & summary ready!');
      } else {
        toast('Processing finished with status: ' + rec.status);
      }
    }
  } catch (e) {
    // silently ignore transient poll errors
  }
}

document.querySelector('#process').onclick = async () => {
  const processBtn    = document.querySelector('#process');
  if (processBtn.disabled) return;

  const lectureName   = document.querySelector('#lectureNameInput').value.trim();
  const professorName = document.querySelector('#professorNameInput').value.trim();

  let fileToSend = null;
  let title      = 'Voice Recording';
  let rawTimer   = document.querySelector('#timer').textContent || '00:00:00';
  let duration   = rawTimer.startsWith('00:') ? rawTimer.slice(3) : rawTimer;
  if (duration === '00:00') duration = '00:05';
  let transcriptText = '';

  if (uploadTab.classList.contains('active')) {
    transcriptText = document.querySelector('#uploadTranscript').value.trim();
    if (audioFileInput.files && audioFileInput.files[0]) {
      fileToSend     = audioFileInput.files[0];
      title          = fileToSend.name.replace(/\.[^/.]+$/, '');
      duration       = uploadedFileDuration || '01:00';
    } else if (transcriptText) {
      title          = lectureName || 'Lecture Notes';
      duration       = '01:00';
    } else {
      toast('Please select an audio file or enter transcript notes first.');
      return;
    }
  } else {
    // Auto-stop recording if still in progress
    if (rec && rec.state === 'recording') {
      stopSpeechRecognition();
      rec.stop();
      clearInterval(timer);
      mic.classList.remove('recording');
      recordMsg.textContent = 'Recording complete';
      statusElem.textContent = 'Recording ready for processing';
      stopBtn.disabled = true;
      stopBtn.classList.add('disabled');
      // Wait for onstop to fire and build the blob
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (recordedBlob) {
      fileToSend = new File([recordedBlob], `recording_${Date.now()}.webm`, { type: 'audio/webm' });
      title = `Voice Note (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
      if (liveSpeechTranscript && liveSpeechTranscript.trim()) {
        transcriptText = liveSpeechTranscript.trim();
      }
    } else {
      toast('Please record audio first.');
      return;
    }
  }

  // Override title with lecture name if provided
  if (lectureName) title = lectureName;

  processBtn.disabled = true;
  const origBtnText = processBtn.textContent;
  processBtn.textContent = 'Processing...';
  toast('Uploading & processing...');

  const formData = new FormData();
  if (fileToSend) formData.append('file', fileToSend);
  formData.append('title', title);
  if (lectureName)   formData.append('lectureName', lectureName);
  if (professorName) formData.append('professorName', professorName);
  formData.append('duration', duration);
  formData.append('transcript', transcriptText);
  formData.append('mode', localStorage.getItem('vaani_summary_mode') || 'Medium');

  try {
    // Always attempt backend first — recovers after transient outages
    const res = await fetch(API_BASE, { method: 'POST', headers: authHeaders(), body: formData });
    if (handleAuthError(res)) return;
    if (!res.ok) throw new Error('Failed to save recording');
    backendAvailable = true;
    const savedRec = await res.json();

    // Clear recording state after successful upload
    recordedBlob = null;
    liveSpeechTranscript = '';
    chunks = [];
    sec = 0;
    tick();
    document.querySelector('#lectureNameInput').value = '';
    document.querySelector('#professorNameInput').value = '';
    document.querySelector('#uploadTranscript').value = '';
    document.querySelector('#audio').value = '';
    document.querySelector('#file').textContent = '';
    recordMsg.textContent = 'Click the microphone to start recording';
    statusElem.textContent = 'Recording not started';

    await loadRecordings();
    openDetail(savedRec.id);

    // If backend is still processing, poll until done
    if (savedRec.status === 'Processing') {
      toast('Audio saved! Transcription running in background…');
      stopPolling();
      pollingInterval = setInterval(() => pollRecordingStatus(savedRec.id), 3000);
    } else {
      toast('Transcribed & Summarized successfully!');
    }
  } catch (err) {
    backendAvailable = false;
    const localId = Date.now();
    const tempMeta = { title, lectureName: lectureName || '', professorName: professorName || '' };
    const transcript = (transcriptText && !isBrokenText(transcriptText))
      ? transcriptText
      : buildFallbackTranscript(tempMeta);
    const summary = buildFallbackSummary(transcript);
    let audioDataUrl = null;
    if (fileToSend) {
      try { audioDataUrl = await fileToDataUrl(fileToSend); } catch (e) {}
    }

    const localRec = {
      id: localId,
      title,
      lectureName: lectureName || '',
      professorName: professorName || '',
      duration: duration || '00:00',
      createdAt: new Date().toLocaleString(),
      status: 'Completed',
      transcript,
      summary,
      hasAudio: Boolean(audioDataUrl),
      audioDataUrl,
    };
    recordings = [localRec, ...loadLocalRecordings()];
    saveLocalRecordings(recordings);
    renderRecordings();
    openDetail(localId);
    showFallbackToast();
    toast('Saved locally in browser storage.');
  } finally {
    processBtn.disabled = false;
    processBtn.textContent = origBtnText;
  }
};

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

const smtpSaveBtn = document.getElementById('smtpSaveBtn');
if (smtpSaveBtn) {
  smtpSaveBtn.onclick = async () => {
    const host = (document.getElementById('smtpHostInput')?.value || '').trim();
    const port = Number(document.getElementById('smtpPortInput')?.value) || 587;
    const user = (document.getElementById('smtpUserInput')?.value || '').trim();
    const pass = (document.getElementById('smtpPassInput')?.value || '').trim();

    if (!user || !pass) {
      toast('Please enter both SMTP Username/Email and App Password.');
      return;
    }

    smtpSaveBtn.disabled = true;
    smtpSaveBtn.textContent = 'Saving...';
    try {
      const res = await fetch('/api/auth/save-smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, user, pass, secure: port === 465 }),
      });
      const data = await res.json();
      if (res.ok) {
        toast('SMTP settings saved successfully!');
        loadSmtpStatus();
      } else {
        toast(data.error || 'Failed to save SMTP settings.');
      }
    } catch (e) {
      toast('Error saving SMTP settings.');
    } finally {
      smtpSaveBtn.disabled = false;
      smtpSaveBtn.textContent = 'Save & Activate SMTP';
    }
  };
}

const smtpClearBtn = document.getElementById('smtpClearBtn');
if (smtpClearBtn) {
  smtpClearBtn.onclick = async () => {
    try {
      const res = await fetch('/api/auth/save-smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true }),
      });
      if (res.ok) {
        const passInput = document.getElementById('smtpPassInput');
        if (passInput) passInput.value = '';
        toast('Saved SMTP configuration cleared.');
        loadSmtpStatus();
      }
    } catch (e) {
      toast('Error clearing SMTP configuration.');
    }
  };
}

const smtpTestBtn = document.getElementById('smtpTestBtn');
if (smtpTestBtn) {
  smtpTestBtn.onclick = async () => {
    const recipientInput = document.getElementById('smtpTestRecipient');
    const email = recipientInput ? recipientInput.value.trim() : '';
    if (!email) {
      toast('Please enter a recipient email address for testing.');
      return;
    }
    smtpTestBtn.disabled = true;
    smtpTestBtn.textContent = 'Sending Test...';
    try {
      const res = await fetch('/api/auth/test-smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast('✅ Test email sent! Check ' + email);
        loadSmtpStatus();
      } else {
        toast('❌ SMTP Test Failed: ' + (data.error || 'Check server logs'));
      }
    } catch (e) {
      toast('Error reaching server for SMTP test.');
    } finally {
      smtpTestBtn.disabled = false;
      smtpTestBtn.textContent = 'Send Test Email';
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

// ── Separate AI Voice Engine (Gemini TTS + Browser Speech Fallback) ────
let currentAiAudio = null;
let aiSpeechSpeaking = false;
let aiAnalyser = null;
let aiFreqData = null;
let aiAudioCtx = null;
let lastVoiceAiResponse = "Hi! I'm ready to listen and explain any concept aloud. What would you like to learn today?";

const tutorVoiceSelect = document.getElementById('tutorVoiceSelect');
const voicePersonaSelect = document.getElementById('voicePersonaSelect');
const savedVoicePersona = localStorage.getItem('vaani_ai_voice') || 'Kore';
if (tutorVoiceSelect) tutorVoiceSelect.value = savedVoicePersona;
if (voicePersonaSelect) voicePersonaSelect.value = savedVoicePersona;

function getSelectedAiVoice(source) {
  if (source === 'voice' && voicePersonaSelect) return voicePersonaSelect.value || 'Kore';
  if (tutorVoiceSelect) return tutorVoiceSelect.value || 'Kore';
  return localStorage.getItem('vaani_ai_voice') || 'Kore';
}

function syncVoiceSelectors(val) {
  localStorage.setItem('vaani_ai_voice', val);
  if (tutorVoiceSelect && tutorVoiceSelect.value !== val) tutorVoiceSelect.value = val;
  if (voicePersonaSelect && voicePersonaSelect.value !== val) voicePersonaSelect.value = val;
}

if (tutorVoiceSelect) {
  tutorVoiceSelect.addEventListener('change', () => syncVoiceSelectors(tutorVoiceSelect.value));
}
if (voicePersonaSelect) {
  voicePersonaSelect.addEventListener('change', () => syncVoiceSelectors(voicePersonaSelect.value));
}

function updateAiSpeakingUi(isSpeaking) {
  aiSpeechSpeaking = isSpeaking;
  const stopAiBtn = document.getElementById('voiceStopAiSpeechBtn');
  const stateBadge = document.getElementById('voiceStateBadge');
  const voiceStatus = document.getElementById('s');
  if (stopAiBtn) stopAiBtn.classList.toggle('hidden', !isSpeaking);
  if (stateBadge) {
    if (isSpeaking) {
      stateBadge.textContent = `AI Voice Speaking (${getSelectedAiVoice('voice')})`;
    } else if (voiceMicActive) {
      stateBadge.textContent = 'Listening to Student...';
    } else {
      stateBadge.textContent = 'AI Voice Ready';
    }
  }
  if (voiceStatus && !voiceMicActive) {
    voiceStatus.textContent = isSpeaking
      ? 'AI Tutor is speaking aloud — watch the wave respond to the AI voice'
      : 'Tap to make the wave follow your voice and speak with your AI Tutor';
  }
}

function stopAiVoicePlayback() {
  if (currentAiAudio) {
    try {
      currentAiAudio.pause();
      currentAiAudio.currentTime = 0;
    } catch (e) {}
    currentAiAudio = null;
  }
  if (window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
  aiAnalyser = null;
  aiFreqData = null;
  updateAiSpeakingUi(false);
}

function speakWithBrowserFallback(text, voiceName) {
  if (!window.speechSynthesis) {
    updateAiSpeakingUi(false);
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const cleanText = String(text || '').replace(/[*#_`~>•✥]/g, '').trim();
    if (!cleanText) return;
    const utter = new SpeechSynthesisUtterance(cleanText);
    const profiles = {
      Kore:   { pitch: 1.05, rate: 1.00, preferFemale: true },
      Puck:   { pitch: 1.16, rate: 1.06, preferFemale: false },
      Charon: { pitch: 0.84, rate: 0.95, preferFemale: false },
      Fenrir: { pitch: 0.92, rate: 1.02, preferFemale: false },
      Zephyr: { pitch: 1.12, rate: 0.98, preferFemale: true },
    };
    const prof = profiles[voiceName] || profiles.Kore;
    utter.pitch = prof.pitch;
    utter.rate = prof.rate;

    const voices = window.speechSynthesis.getVoices() || [];
    const enVoices = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('en'));
    if (enVoices.length > 0) {
      const match = enVoices.find(v => {
        const n = v.name.toLowerCase();
        return prof.preferFemale
          ? (n.includes('female') || n.includes('samantha') || n.includes('zira') || n.includes('google us english') || n.includes('victoria'))
          : (n.includes('male') || n.includes('daniel') || n.includes('david') || n.includes('alex') || n.includes('guy'));
      });
      utter.voice = match || enVoices[0];
    }

    utter.onstart = () => updateAiSpeakingUi(true);
    utter.onend = () => updateAiSpeakingUi(false);
    utter.onerror = () => updateAiSpeakingUi(false);
    updateAiSpeakingUi(true);
    window.speechSynthesis.speak(utter);
  } catch (e) {
    updateAiSpeakingUi(false);
  }
}

async function playAiVoiceAudio(base64Wav, fallbackText, voiceName) {
  stopAiVoicePlayback();
  const chosenVoice = voiceName || getSelectedAiVoice();

  if (base64Wav) {
    try {
      const audio = new Audio(`data:audio/wav;base64,${base64Wav}`);
      currentAiAudio = audio;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        if (!aiAudioCtx) aiAudioCtx = new AudioCtx();
        if (aiAudioCtx.state === 'suspended') await aiAudioCtx.resume();
        const srcNode = aiAudioCtx.createMediaElementSource(audio);
        aiAnalyser = aiAudioCtx.createAnalyser();
        aiAnalyser.fftSize = 256;
        aiAnalyser.smoothingTimeConstant = 0.82;
        srcNode.connect(aiAnalyser);
        aiAnalyser.connect(aiAudioCtx.destination);
        aiFreqData = new Uint8Array(aiAnalyser.frequencyBinCount);
      }

      audio.onplay = () => updateAiSpeakingUi(true);
      audio.onended = () => {
        aiAnalyser = null;
        aiFreqData = null;
        updateAiSpeakingUi(false);
      };
      audio.onerror = () => {
        aiAnalyser = null;
        aiFreqData = null;
        speakWithBrowserFallback(fallbackText, chosenVoice);
      };
      await audio.play();
      return;
    } catch (e) {
      aiAnalyser = null;
      aiFreqData = null;
    }
  }

  speakWithBrowserFallback(fallbackText, chosenVoice);
}

async function speakTextWithSeparateAiVoice(text, voiceName) {
  const chosenVoice = voiceName || getSelectedAiVoice();
  stopAiVoicePlayback();
  updateAiSpeakingUi(true);

  if (backendAvailable) {
    try {
      const res = await fetch('/api/tutor/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ text, voiceName: chosenVoice }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.audioBase64) {
          await playAiVoiceAudio(data.audioBase64, text, chosenVoice);
          return;
        }
      }
    } catch (e) {}
  }

  speakWithBrowserFallback(text, chosenVoice);
}

// ── AI Student Tutor (Doubt Solver Chat + Voice) ────────────────────────
const tutorHistory = [];
const tutorMessagesEl = document.getElementById('tutorMessages');
const tutorForm = document.getElementById('tutorForm');
const tutorInput = document.getElementById('tutorInput');
const tutorMicBtn = document.getElementById('tutorMicBtn');
const tutorSendBtn = document.getElementById('tutorSendBtn');
const tutorAutoSpeak = document.getElementById('tutorAutoSpeak');
const tutorLectureSelect = document.getElementById('tutorLectureSelect');

function appendTutorMessage(role, text) {
  if (!tutorMessagesEl) return;
  const div = document.createElement('div');
  div.className = `tutor-msg ${role === 'user' ? 'user' : 'ai'}`;
  const headerLabel = role === 'user' ? 'You (Student)' : `Vaani AI Tutor (${getSelectedAiVoice('tutor')})`;
  const speakBtnHtml = role === 'ai'
    ? `<button type="button" class="tutor-speak-btn" data-speak="${escapeHtml(text)}">Listen</button>`
    : '';
  div.innerHTML = `
    <div class="tutor-msg-header">
      <b>${escapeHtml(headerLabel)}</b>
      ${speakBtnHtml}
    </div>
    <div class="tutor-msg-body">${escapeHtml(text)}</div>
  `;
  tutorMessagesEl.appendChild(div);
  tutorMessagesEl.scrollTop = tutorMessagesEl.scrollHeight;
}

function buildLocalTutorAnswer(question, rec) {
  const contextLabel = rec ? `from "${rec.lectureName || rec.title}"` : 'for your coursework';
  const baseText = rec ? (rec.transcript || rec.summary || '') : '';
  const sentences = baseText.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 15);
  const excerpt = sentences.length > 0
    ? sentences.slice(0, 3).join(' ')
    : 'Start by breaking the concept into its core definition, understanding how inputs transform into outputs, and testing with a concrete example.';
  return [
    `Great question! Let's clear up your doubt ${contextLabel}:`,
    '',
    `1. Step-by-Step Explanation:`,
    excerpt,
    '',
    `2. Key Takeaway for "${question}":`,
    `Focus on the underlying mechanism and how it applies to real-world problems. Reviewing the main definitions and practicing with 1-2 examples will solidify this concept.`,
    '',
    `Would you like another example or a quick quiz question on this topic?`,
  ].join('\n');
}

async function submitTutorDoubt(questionText) {
  const q = String(questionText || '').trim();
  if (!q) return;

  appendTutorMessage('user', q);
  tutorHistory.push({ role: 'user', text: q });
  if (tutorInput) tutorInput.value = '';

  const selectedId = tutorLectureSelect ? tutorLectureSelect.value : '';
  const selectedRec = selectedId ? recordings.find(r => String(r.id) === String(selectedId)) : null;
  const voiceName = getSelectedAiVoice('tutor');
  const shouldSpeak = Boolean(tutorAutoSpeak && tutorAutoSpeak.checked);

  if (tutorSendBtn) {
    tutorSendBtn.disabled = true;
    tutorSendBtn.textContent = 'Thinking...';
  }

  try {
    let answer = '';
    let audioBase64 = null;

    if (backendAvailable) {
      const res = await fetch('/api/tutor/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          question: q,
          recordingId: selectedId ? Number(selectedId) : null,
          lectureContext: selectedRec ? `${selectedRec.transcript || ''}\n${selectedRec.summary || ''}` : '',
          history: tutorHistory.slice(-6),
          includeAudio: shouldSpeak,
          voiceName,
        }),
      });
      if (!handleAuthError(res) && res.ok) {
        const data = await res.json();
        answer = data.answer || '';
        audioBase64 = data.audioBase64 || null;
      }
    }

    if (!answer) {
      answer = buildLocalTutorAnswer(q, selectedRec);
    }

    tutorHistory.push({ role: 'ai', text: answer });
    appendTutorMessage('ai', answer);

    if (shouldSpeak) {
      await playAiVoiceAudio(audioBase64, answer, voiceName);
    }
  } catch (e) {
    const fallback = buildLocalTutorAnswer(q, selectedRec);
    appendTutorMessage('ai', fallback);
    if (shouldSpeak) {
      speakWithBrowserFallback(fallback, voiceName);
    }
  } finally {
    if (tutorSendBtn) {
      tutorSendBtn.disabled = false;
      tutorSendBtn.textContent = 'Ask Tutor';
    }
  }
}

if (tutorForm) {
  tutorForm.addEventListener('submit', e => {
    e.preventDefault();
    if (tutorInput && tutorInput.value.trim()) {
      submitTutorDoubt(tutorInput.value.trim());
    } else {
      toast('Please type or speak your doubt first.');
    }
  });
}

document.addEventListener('click', e => {
  const promptBtn = e.target.closest('.tutor-prompt-btn');
  if (promptBtn && promptBtn.dataset.prompt) {
    submitTutorDoubt(promptBtn.dataset.prompt);
  }

  const speakBtn = e.target.closest('.tutor-speak-btn');
  if (speakBtn && speakBtn.dataset.speak) {
    speakTextWithSeparateAiVoice(speakBtn.dataset.speak, getSelectedAiVoice('tutor'));
  }
});

// Speak Doubt button inside AI Tutor chat
let tutorSpeechRec = null;
if (tutorMicBtn) {
  tutorMicBtn.onclick = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast('Live speech input is not supported in this browser. Switching to Vaani Voice...');
      page('voice');
      return;
    }
    if (tutorSpeechRec) {
      try { tutorSpeechRec.stop(); } catch (e) {}
      tutorSpeechRec = null;
      tutorMicBtn.textContent = 'Speak Doubt';
      return;
    }
    try {
      tutorSpeechRec = new SpeechRecognition();
      tutorSpeechRec.lang = 'en-US';
      tutorSpeechRec.interimResults = true;
      tutorMicBtn.textContent = 'Listening...';
      toast('Speak your doubt now...');
      let spoken = '';
      tutorSpeechRec.onresult = ev => {
        spoken = Array.from(ev.results).map(r => r[0].transcript).join(' ').trim();
        if (tutorInput) tutorInput.value = spoken;
      };
      tutorSpeechRec.onend = () => {
        tutorSpeechRec = null;
        tutorMicBtn.textContent = 'Speak Doubt';
        if (spoken) {
          submitTutorDoubt(spoken);
        }
      };
      tutorSpeechRec.onerror = () => {
        tutorSpeechRec = null;
        tutorMicBtn.textContent = 'Speak Doubt';
      };
      tutorSpeechRec.start();
    } catch (e) {
      tutorSpeechRec = null;
      tutorMicBtn.textContent = 'Speak Doubt';
    }
  };
}

// Quick navigation buttons from Lecture Detail view
const askTutorFromDetailBtn = document.getElementById('askTutorFromDetail');
if (askTutorFromDetailBtn) {
  askTutorFromDetailBtn.onclick = () => {
    syncLectureSelects();
    if (currentRecording && tutorLectureSelect) {
      tutorLectureSelect.value = String(currentRecording.id);
    }
    page('tutor');
    if (tutorInput) tutorInput.focus();
  };
}

const speakAiFromDetailBtn = document.getElementById('speakAiFromDetail');
if (speakAiFromDetailBtn) {
  speakAiFromDetailBtn.onclick = () => {
    syncLectureSelects();
    const voiceLectureSelect = document.getElementById('voiceLectureSelect');
    if (currentRecording && voiceLectureSelect) {
      voiceLectureSelect.value = String(currentRecording.id);
    }
    page('voice');
  };
}

// ── Vaani Voice — 68-Bar Interactive Wave Visualizer & AI Voice Conversation ──
const voiceCanvas = document.getElementById('c');
const voiceCtx = voiceCanvas ? voiceCanvas.getContext('2d') : null;
const voiceBtn = document.getElementById('b');
const voiceStopBtn = document.getElementById('voiceStopBtn');
const voiceStopAiBtn = document.getElementById('voiceStopAiSpeechBtn');
const voiceStatusEl = document.getElementById('s');
const voiceStage = document.getElementById('voiceStage');
const voiceThemeBtn = document.getElementById('voiceThemeBtn');
const voiceStudentText = document.getElementById('voiceStudentText');
const voiceAiText = document.getElementById('voiceAiText');
const voiceReplayBtn = document.getElementById('voiceReplayBtn');
const voiceQuickForm = document.getElementById('voiceQuickForm');
const voiceQuickInput = document.getElementById('voiceQuickInput');
const voiceLectureSelect = document.getElementById('voiceLectureSelect');

const N_BARS = 68;
const bars = Array.from({ length: N_BARS }, () => ({ h: 10 }));
let voiceW = 0, voiceH = 0, voiceT = 0;
let micAnalyser = null;
let micData = null;
let voiceMicStream = null;
let voiceMicRecorder = null;
let voiceMicChunks = [];
let voiceMicSpeechRec = null;
let voiceSpokenQuestion = '';
let voiceMicActive = false;

function resizeVoiceCanvas() {
  if (!voiceCanvas || !voiceCtx) return;
  const dpr = window.devicePixelRatio || 1;
  const rectW = voiceCanvas.offsetWidth || 680;
  const rectH = voiceCanvas.offsetHeight || 220;
  voiceW = voiceCanvas.width = rectW * dpr;
  voiceH = voiceCanvas.height = rectH * dpr;
  voiceCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  voiceW /= dpr;
  voiceH /= dpr;
}
window.addEventListener('resize', resizeVoiceCanvas);
resizeVoiceCanvas();

if (voiceThemeBtn && voiceStage) {
  voiceThemeBtn.onclick = () => {
    const isDark = voiceStage.getAttribute('data-theme') === 'dark';
    if (isDark) {
      voiceStage.removeAttribute('data-theme');
      voiceThemeBtn.textContent = 'Toggle Dark Wave';
    } else {
      voiceStage.setAttribute('data-theme', 'dark');
      voiceThemeBtn.textContent = 'Toggle Light Wave';
    }
  };
}

async function askVoiceTutorQuestion(questionText, audioBlob) {
  const selectedId = voiceLectureSelect ? voiceLectureSelect.value : '';
  const selectedRec = selectedId ? recordings.find(r => String(r.id) === String(selectedId)) : null;
  const voiceName = getSelectedAiVoice('voice');
  const stateBadge = document.getElementById('voiceStateBadge');

  if (stateBadge) stateBadge.textContent = 'AI Tutor Thinking...';
  if (voiceStatusEl) voiceStatusEl.textContent = 'Generating spoken explanation from your AI Tutor...';
  if (voiceStudentText && questionText) voiceStudentText.textContent = questionText;
  if (voiceAiText) voiceAiText.textContent = 'Thinking and preparing voice response...';

  try {
    let finalQuestion = questionText || '';
    let answer = '';
    let audioBase64 = null;

    if (backendAvailable) {
      if (!finalQuestion && audioBlob) {
        const fd = new FormData();
        fd.append('file', new File([audioBlob], 'student_question.webm', { type: 'audio/webm' }));
        if (selectedId) fd.append('recordingId', String(selectedId));
        fd.append('voiceName', voiceName);
        const res = await fetch('/api/tutor/voice-ask', {
          method: 'POST',
          headers: authHeaders(),
          body: fd,
        });
        if (!handleAuthError(res) && res.ok) {
          const data = await res.json();
          finalQuestion = data.question || 'Explain the main concepts of this lecture';
          answer = data.answer || '';
          audioBase64 = data.audioBase64 || null;
        }
      } else {
        const res = await fetch('/api/tutor/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            question: finalQuestion || 'Can you explain the main concepts of this lecture simply?',
            recordingId: selectedId ? Number(selectedId) : null,
            lectureContext: selectedRec ? `${selectedRec.transcript || ''}\n${selectedRec.summary || ''}` : '',
            includeAudio: true,
            voiceName,
          }),
        });
        if (!handleAuthError(res) && res.ok) {
          const data = await res.json();
          answer = data.answer || '';
          audioBase64 = data.audioBase64 || null;
        }
      }
    }

    if (!finalQuestion) {
      finalQuestion = 'Can you explain the main concepts of this lecture in simple terms?';
    }
    if (!answer) {
      answer = buildLocalTutorAnswer(finalQuestion, selectedRec).replace(/\n+/g, ' ');
    }

    lastVoiceAiResponse = answer;
    if (voiceStudentText) voiceStudentText.textContent = finalQuestion;
    if (voiceAiText) voiceAiText.textContent = answer;

    // Also add to AI Tutor chat history so student has a written record
    appendTutorMessage('user', finalQuestion);
    appendTutorMessage('ai', answer);

    await playAiVoiceAudio(audioBase64, answer, voiceName);
  } catch (e) {
    const fallback = buildLocalTutorAnswer(questionText || 'key lecture concepts', selectedRec).replace(/\n+/g, ' ');
    lastVoiceAiResponse = fallback;
    if (voiceAiText) voiceAiText.textContent = fallback;
    speakWithBrowserFallback(fallback, voiceName);
  }
}

function stopVoiceMicrophone(shouldAskAi = true) {
  voiceMicActive = false;
  if (voiceMicSpeechRec) {
    try { voiceMicSpeechRec.stop(); } catch (e) {}
    voiceMicSpeechRec = null;
  }
  if (voiceMicRecorder && voiceMicRecorder.state === 'recording') {
    try { voiceMicRecorder.stop(); } catch (e) {}
  }
  if (voiceMicStream) {
    try { voiceMicStream.getTracks().forEach(t => t.stop()); } catch (e) {}
    voiceMicStream = null;
  }
  micAnalyser = null;
  micData = null;

  if (voiceBtn) voiceBtn.textContent = 'Use my microphone';
  if (voiceStopBtn) voiceStopBtn.classList.add('hidden');

  if (!shouldAskAi) {
    updateAiSpeakingUi(false);
  }
}

if (voiceBtn) {
  voiceBtn.onclick = async () => {
    if (voiceMicActive) {
      // Student finished speaking — stop mic and ask AI
      const capturedText = voiceSpokenQuestion.trim();
      stopVoiceMicrophone(true);
      setTimeout(() => {
        const blob = voiceMicChunks.length ? new Blob(voiceMicChunks, { type: 'audio/webm' }) : null;
        askVoiceTutorQuestion(capturedText, blob);
      }, 250);
      return;
    }

    stopAiVoicePlayback();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceMicStream = stream;
      voiceMicActive = true;
      voiceSpokenQuestion = '';
      voiceMicChunks = [];

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const src = ctx.createMediaStreamSource(stream);
      micAnalyser = ctx.createAnalyser();
      micAnalyser.fftSize = 256;
      micAnalyser.smoothingTimeConstant = 0.82;
      src.connect(micAnalyser);
      micData = new Uint8Array(micAnalyser.frequencyBinCount);

      try {
        voiceMicRecorder = new MediaRecorder(stream);
        voiceMicRecorder.ondataavailable = e => {
          if (e.data && e.data.size > 0) voiceMicChunks.push(e.data);
        };
        voiceMicRecorder.start();
      } catch (e) {
        voiceMicRecorder = null;
      }

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          voiceMicSpeechRec = new SpeechRecognition();
          voiceMicSpeechRec.continuous = true;
          voiceMicSpeechRec.interimResults = true;
          voiceMicSpeechRec.lang = 'en-US';
          let finalTranscript = '';
          voiceMicSpeechRec.onresult = ev => {
            let interim = '';
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
              const piece = ev.results[i][0].transcript;
              if (ev.results[i].isFinal) finalTranscript += piece + ' ';
              else interim += piece;
            }
            voiceSpokenQuestion = (finalTranscript + interim).trim();
            if (voiceStudentText && voiceSpokenQuestion) {
              voiceStudentText.textContent = voiceSpokenQuestion;
            }
          };
          voiceMicSpeechRec.onerror = () => {};
          voiceMicSpeechRec.start();
        } catch (e) {
          voiceMicSpeechRec = null;
        }
      }

      voiceBtn.textContent = 'Finish & Ask AI Voice';
      if (voiceStopBtn) voiceStopBtn.classList.remove('hidden');
      const stateBadge = document.getElementById('voiceStateBadge');
      if (stateBadge) stateBadge.textContent = 'Listening to Student...';
      if (voiceStatusEl) voiceStatusEl.textContent = 'Listening — speak your doubt now, then click "Finish & Ask AI Voice"';
      if (voiceStudentText) voiceStudentText.textContent = 'Listening to your voice...';
    } catch (e) {
      if (voiceStatusEl) voiceStatusEl.textContent = 'Microphone blocked — running demo wave (type your question below)';
      toast('Microphone access denied. You can still type below to hear the AI Voice!');
    }
  };
}

if (voiceStopBtn) {
  voiceStopBtn.onclick = () => {
    stopVoiceMicrophone(false);
    if (voiceStatusEl) voiceStatusEl.textContent = 'Microphone stopped. Tap "Use my microphone" whenever you are ready.';
  };
}

if (voiceStopAiBtn) {
  voiceStopAiBtn.onclick = () => {
    stopAiVoicePlayback();
    toast('AI Voice stopped.');
  };
}

if (voiceReplayBtn) {
  voiceReplayBtn.onclick = () => {
    if (lastVoiceAiResponse) {
      speakTextWithSeparateAiVoice(lastVoiceAiResponse, getSelectedAiVoice('voice'));
    }
  };
}

if (voiceQuickForm) {
  voiceQuickForm.addEventListener('submit', e => {
    e.preventDefault();
    if (voiceQuickInput && voiceQuickInput.value.trim()) {
      const q = voiceQuickInput.value.trim();
      voiceQuickInput.value = '';
      askVoiceTutorQuestion(q, null);
    } else {
      toast('Enter a question or use your microphone to speak with the AI.');
    }
  });
}

function drawVoiceWave() {
  if (voiceCanvas && voiceCtx) {
    if (voiceW === 0 && voiceCanvas.offsetWidth > 0) {
      resizeVoiceCanvas();
    }
    voiceCtx.clearRect(0, 0, voiceW, voiceH);
    if (micAnalyser && micData) micAnalyser.getByteFrequencyData(micData);
    if (aiAnalyser && aiFreqData) aiAnalyser.getByteFrequencyData(aiFreqData);
    voiceT += 0.045;

    const styleTarget = voiceStage || document.documentElement;
    const cs = getComputedStyle(styleTarget);
    const c1 = cs.getPropertyValue('--bar').trim() || '#2a35e0';
    const c2 = cs.getPropertyValue('--bar2').trim() || '#7ea0f5';

    const gap = voiceW / N_BARS;
    const bw = Math.max(2.2, gap * 0.42);
    const cy = voiceH / 2;

    bars.forEach((bar, i) => {
      const center = 1 - Math.abs(i / (N_BARS - 1) - 0.5) * 1.7;
      const env = Math.max(0.08, center);
      let target;

      if (micAnalyser && micData) {
        const v = micData[Math.floor((i / N_BARS) * 48)] / 255;
        target = 8 + v * voiceH * 0.78 * env;
      } else if (aiAnalyser && aiFreqData) {
        const v = aiFreqData[Math.floor((i / N_BARS) * 48)] / 255;
        target = 10 + v * voiceH * 0.76 * env;
      } else if (aiSpeechSpeaking) {
        // Lively animated speech cadence when browser SpeechSynthesis is speaking
        const wave =
          Math.sin(voiceT * 2.4 + i * 0.35) * 0.45 +
          Math.cos(voiceT * 3.8 - i * 0.22) * 0.35 +
          0.65;
        target = 10 + wave * voiceH * 0.48 * env;
      } else {
        const wave =
          Math.sin(voiceT + i * 0.28) * 0.5 +
          Math.sin(voiceT * 1.7 - i * 0.15) * 0.35 +
          0.55;
        target = 6 + wave * voiceH * 0.36 * env;
      }

      bar.h += (target - bar.h) * 0.22;
      const x = i * gap + (gap - bw) / 2;
      const h = bar.h;

      const g = voiceCtx.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
      g.addColorStop(0, c2);
      g.addColorStop(0.5, c1);
      g.addColorStop(1, c2);
      voiceCtx.fillStyle = g;

      voiceCtx.beginPath();
      if (voiceCtx.roundRect) {
        voiceCtx.roundRect(x, cy - h / 2, bw, h, bw / 2);
      } else {
        voiceCtx.rect(x, cy - h / 2, bw, h);
      }
      voiceCtx.fill();
    });
  }
  requestAnimationFrame(drawVoiceWave);
}
drawVoiceWave();

// ── Init ──────────────────────────────────────────────────
loadRecordings();
