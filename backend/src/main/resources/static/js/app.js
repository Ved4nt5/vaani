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
(function setUserInfo() {
  const name = localStorage.getItem('vaani_user_name') || 'User';
  const profileEl = document.getElementById('profileName');
  const eyebrow = document.querySelector('.eyebrow');
  const settingsName = document.getElementById('settingsName');
  if (profileEl) profileEl.textContent = name;
  if (eyebrow) eyebrow.textContent = 'Welcome back, ' + name + '!';
  if (settingsName) settingsName.value = name;
})();

let recordings = [];
let currentRecording = null;
let recordedBlob = null;

function loadLocalRecordings() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data : [];
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
  // Stop polling when navigating away from the detail view
  if (id !== 'detail') stopPolling();
  document.querySelectorAll('.page').forEach(x => x.classList.toggle('active', x.id === id));
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x.dataset.page === id));
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
    recordings = await res.json();
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
    const parts = (r.duration || '0:0').split(':');
    return acc + (parseInt(parts[0]) || 0) + (parseInt(parts[1]) || 0) / 60;
  }, 0);
  document.querySelector('#statAudio').textContent = (totalMin / 60).toFixed(1) + ' hrs';
}

// ── Detail view ────────────────────────────────────────────
async function openDetail(id) {
  let rec = recordings.find(r => String(r.id) === String(id));
  if (!rec && backendAvailable) {
    try {
      const res = await fetch(`${API_BASE}/${id}`, { headers: authHeaders() });
      if (handleAuthError(res)) return;
      if (res.ok) rec = await res.json();
    } catch (e) {}
  }
  if (!rec) return;

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
    : (rec.transcript || 'No transcript available.').replace(/\n/g, '<br>');
  document.querySelector('#summaryText').textContent = isProcessing
    ? '⏳ Summary will appear once transcription is complete.'
    : (rec.summary || 'No summary available.');

  const audioPlayer = document.querySelector('#detailAudioPlayer');
  if (rec.hasAudio) {
    audioPlayer.src = rec.audioDataUrl ? rec.audioDataUrl : `${API_BASE}/${rec.id}/audio`;
    audioPlayer.style.display = 'block';
  } else {
    audioPlayer.src = '';
    audioPlayer.style.display = 'none';
  }

  // Reset detail tabs to Transcript
  document.querySelectorAll('[data-detail]').forEach(b => b.classList.toggle('active', b.dataset.detail === 'transcript'));
  document.querySelector('#transcript').classList.remove('hidden');
  document.querySelector('#summary').classList.add('hidden');
  document.querySelector('#details').classList.add('hidden');

  page('detail');
}

// ── Delete ─────────────────────────────────────────────────
async function deleteRecording(id) {
  if (!confirm('Are you sure you want to delete this recording?')) return;
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
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        recordedBlob = new Blob(chunks, { type: 'audio/webm' });
        toast('Recording stopped. Ready to process.');
      };
      rec.start();

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
  if (rec && rec.state === 'recording') rec.stop();
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
      await loadRecordings();
      // Refresh the detail view with final data
      document.querySelector('#transcriptText').innerHTML =
        (rec.transcript || 'No transcript available.').replace(/\n/g, '<br>');
      document.querySelector('#summaryText').textContent = rec.summary || 'No summary available.';
      document.querySelector('#detailStatus').textContent = rec.status || 'Completed';

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
  const lectureName   = document.querySelector('#lectureNameInput').value.trim();
  const professorName = document.querySelector('#professorNameInput').value.trim();

  let fileToSend = null;
  let title      = 'Voice Recording';
  let duration   = document.querySelector('#timer').textContent || '00:00';
  let transcriptText = '';

  if (uploadTab.classList.contains('active')) {
    if (audioFileInput.files && audioFileInput.files[0]) {
      fileToSend     = audioFileInput.files[0];
      title          = fileToSend.name.replace(/\.[^/.]+$/, '');
      transcriptText = document.querySelector('#uploadTranscript').value.trim();
    } else {
      toast('Please select an audio file first.');
      return;
    }
  } else {
    if (recordedBlob) {
      fileToSend = new File([recordedBlob], `recording_${Date.now()}.webm`, { type: 'audio/webm' });
      title = `Voice Note (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
    } else {
      toast('Please record audio first.');
      return;
    }
  }

  // Override title with lecture name if provided
  if (lectureName) title = lectureName;

  toast('Uploading & processing...');

  const formData = new FormData();
  if (fileToSend) formData.append('file', fileToSend);
  formData.append('title', title);
  if (lectureName)   formData.append('lectureName', lectureName);
  if (professorName) formData.append('professorName', professorName);
  formData.append('duration', duration);
  formData.append('transcript', transcriptText);

  try {
    if (backendAvailable) {
      const res = await fetch(API_BASE, { method: 'POST', headers: authHeaders(), body: formData });
      if (handleAuthError(res)) return;
      if (!res.ok) throw new Error('Failed to save recording');
      const savedRec = await res.json();

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
      return;
    }
    throw new Error('Backend unavailable');
  } catch (err) {
    backendAvailable = false;
    const localId = Date.now();
    const transcript = transcriptText || 'Local mode: transcript is not auto-generated without backend AI services.';
    const summary = transcriptText
      ? 'Local mode summary: transcript notes were saved successfully.'
      : 'Local mode summary: recording saved in browser storage.';
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

document.querySelector('#copy').onclick = () => {
  const text = document.querySelector('#summaryText').textContent;
  navigator.clipboard?.writeText(text).then(() => toast('Summary copied to clipboard!'));
};

document.querySelector('#download').onclick = () => {
  if (currentRecording && currentRecording.hasAudio) {
    const a = document.createElement('a');
    a.href = currentRecording.audioDataUrl ? currentRecording.audioDataUrl : `${API_BASE}/${currentRecording.id}/audio`;
    a.download = `${currentRecording.title}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast('Audio download started!');
  } else {
    toast('No audio available for download.');
  }
};

document.querySelector('#save').onclick   = () => toast('Settings saved successfully.');
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

// ── Init ──────────────────────────────────────────────────
loadRecordings();
