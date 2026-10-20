// ── Auth Page Logic ────────────────────────────────────────
const API_AUTH = '/api/auth';

// Selected role state ('student' | 'faculty')
let selectedRole = localStorage.getItem('vaani_user_role') === 'faculty' ? 'faculty' : 'student';

// If already logged in, redirect to dashboard
const existingToken = localStorage.getItem('vaani_auth_token');
if (existingToken) {
  fetch(API_AUTH + '/me', {
    headers: { 'Authorization': 'Bearer ' + existingToken }
  }).then(async res => {
    if (res.ok) {
      try {
        const data = await res.json();
        if (data.role) localStorage.setItem('vaani_user_role', data.role);
        if (data.name) localStorage.setItem('vaani_user_name', data.name);
        if (data.email) localStorage.setItem('vaani_user_email', data.email);
      } catch (e) {}
      window.location.href = 'index.html';
    }
  }).catch(() => {});
}

// ── DOM Elements ──────────────────────────────────────────
const loginForm      = document.getElementById('loginForm');
const signupForm     = document.getElementById('signupForm');
const otpSection     = document.getElementById('otpSection');
const showSignup     = document.getElementById('showSignup');
const showLogin      = document.getElementById('showLogin');
const authError      = document.getElementById('authError');
const authSuccess    = document.getElementById('authSuccess');
const roleFacultyBtn = document.getElementById('roleFacultyBtn');
const roleStudentBtn = document.getElementById('roleStudentBtn');

// Signup state
let signupEmail = '';
let signupName  = '';
let signupPassword = '';

// ── Role Selection Logic ──────────────────────────────────
function setRole(role) {
  selectedRole = role === 'faculty' ? 'faculty' : 'student';
  const isFaculty = selectedRole === 'faculty';

  if (roleFacultyBtn) roleFacultyBtn.classList.toggle('active', isFaculty);
  if (roleStudentBtn) roleStudentBtn.classList.toggle('active', !isFaculty);

  const loginHeading    = document.getElementById('loginHeading');
  const loginSubtitle   = document.getElementById('loginSubtitle');
  const loginEmailLabel = document.getElementById('loginEmailLabel');
  const loginEmailInput = document.getElementById('loginEmail');
  const loginBtn        = document.getElementById('loginBtn');

  if (loginHeading)    loginHeading.textContent    = isFaculty ? '👨‍🏫 Faculty Login' : '🎓 Student Login';
  if (loginSubtitle)   loginSubtitle.textContent   = isFaculty
    ? 'Sign in to upload, review, and publish lectures'
    : 'Enter your student credentials to continue';
  if (loginEmailLabel) loginEmailLabel.textContent = isFaculty ? 'Faculty Email' : 'Student Email';
  if (loginEmailInput) loginEmailInput.placeholder = isFaculty ? 'faculty@vaani.edu' : 'student@vaani.edu';
  if (loginBtn)        loginBtn.textContent        = isFaculty ? 'Login to Faculty Dashboard' : 'Login to Student Dashboard';

  const signupHeading    = document.getElementById('signupHeading');
  const signupEmailLabel = document.getElementById('signupEmailLabel');
  const signupDeptWrap   = document.getElementById('signupDeptWrap');
  const signupBtn        = document.getElementById('signupBtn');

  if (signupHeading)    signupHeading.textContent    = isFaculty ? 'Create Faculty Account' : 'Create Student Account';
  if (signupEmailLabel) signupEmailLabel.textContent = isFaculty ? 'Faculty Email' : 'Student Email';
  if (signupDeptWrap)   signupDeptWrap.style.display = isFaculty ? 'block' : 'none';
  if (signupBtn)        signupBtn.textContent        = isFaculty ? 'Sign Up as Faculty' : 'Sign Up as Student';

  hideMessages();
}

if (roleFacultyBtn) roleFacultyBtn.addEventListener('click', () => setRole('faculty'));
if (roleStudentBtn) roleStudentBtn.addEventListener('click', () => setRole('student'));

// Quick-fill demo credentials
const fillFacultyDemo = document.getElementById('fillFacultyDemo');
const fillStudentDemo = document.getElementById('fillStudentDemo');

if (fillFacultyDemo) {
  fillFacultyDemo.addEventListener('click', () => {
    setRole('faculty');
    const emailEl = document.getElementById('loginEmail');
    const passEl  = document.getElementById('loginPassword');
    if (emailEl) emailEl.value = 'faculty@vaani.edu';
    if (passEl)  passEl.value  = 'password123';
  });
}

if (fillStudentDemo) {
  fillStudentDemo.addEventListener('click', () => {
    setRole('student');
    const emailEl = document.getElementById('loginEmail');
    const passEl  = document.getElementById('loginPassword');
    if (emailEl) emailEl.value = 'student@vaani.edu';
    if (passEl)  passEl.value  = 'password123';
  });
}

// Initialize role UI
setRole(selectedRole);

// ── Form Switching ────────────────────────────────────────
function showForm(form) {
  [loginForm, signupForm, otpSection].forEach(f => f.classList.remove('active'));
  form.classList.add('active');
  hideMessages();
}

showSignup.addEventListener('click', e => { e.preventDefault(); showForm(signupForm); });
showLogin.addEventListener('click', e => { e.preventDefault(); showForm(loginForm); });

// ── Message Helpers ───────────────────────────────────────
function showError(msg) {
  authError.textContent = msg;
  authError.classList.add('show');
  authSuccess.classList.remove('show');
}

function showSuccessMsg(msg) {
  authSuccess.textContent = msg;
  authSuccess.classList.add('show');
  authError.classList.remove('show');
}

function hideMessages() {
  authError.classList.remove('show');
  authSuccess.classList.remove('show');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

function saveSessionAndRedirect(data, customMsg) {
  const role = data.role || selectedRole || 'student';
  localStorage.setItem('vaani_auth_token', data.token);
  localStorage.setItem('vaani_user_name', data.name || (role === 'faculty' ? 'Dr. Ananya Sharma' : 'Student'));
  localStorage.setItem('vaani_user_email', data.email || '');
  localStorage.setItem('vaani_user_role', role);
  if (data.facultyId) localStorage.setItem('vaani_faculty_id', data.facultyId);
  if (data.department) localStorage.setItem('vaani_faculty_dept', data.department);
  if (data.avatarUrl !== undefined) localStorage.setItem('vaani_faculty_avatar', data.avatarUrl || '');

  showSuccessMsg(customMsg || (role === 'faculty'
    ? 'Login successful! Redirecting to Faculty Dashboard...'
    : 'Login successful! Redirecting to Student Dashboard...'));
  setTimeout(() => { window.location.href = 'index.html'; }, 450);
}

// ── Login ─────────────────────────────────────────────────
loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  hideMessages();

  const email    = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;
  const btn      = document.getElementById('loginBtn');

  if (!email || !password) { showError('Please fill in all fields.'); return; }

  setLoading(btn, true);

  try {
    const res = await fetch(API_AUTH + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role: selectedRole })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Login failed.');
      setLoading(btn, false);
      return;
    }

    setLoading(btn, false);
    saveSessionAndRedirect(data);
  } catch (err) {
    setLoading(btn, false);
    showError('Unable to connect to authentication server. Please check your network and try again.');
  }
});

// ── Signup ────────────────────────────────────────────────
signupForm.addEventListener('submit', async e => {
  e.preventDefault();
  hideMessages();

  signupName     = document.getElementById('signupName').value.trim();
  signupEmail    = document.getElementById('signupEmail').value.trim().toLowerCase();
  signupPassword = document.getElementById('signupPassword').value;
  const signupDept = document.getElementById('signupDepartment')?.value.trim() || '';
  const btn      = document.getElementById('signupBtn');

  if (!signupName || !signupEmail || !signupPassword) {
    showError('Please fill in all fields.'); return;
  }
  if (signupPassword.length < 6) {
    showError('Password must be at least 6 characters.'); return;
  }

  setLoading(btn, true);

  try {
    const res = await fetch(API_AUTH + '/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: signupName,
        email: signupEmail,
        password: signupPassword,
        role: selectedRole,
        department: signupDept || undefined,
      })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Signup failed.');
      setLoading(btn, false);
      return;
    }

    setLoading(btn, false);
    // Show OTP section
    document.getElementById('otpEmailDisplay').textContent = signupEmail;
    const otpInput = document.getElementById('otpCode');
    if (otpInput) {
      otpInput.value = data.demoCode || '';
      setTimeout(() => otpInput.focus(), 150);
    }
    showForm(otpSection);
    const badge = document.getElementById('otpSmtpBadge');
    if (badge) {
      badge.style.display = 'block';
      badge.innerHTML = data.demoCode
        ? `✉️ Verification code for <b>${escapeHtml(signupEmail)}</b>: <b>${escapeHtml(data.demoCode)}</b> (auto-filled below).`
        : `✉️ Verification email sent to <b>${escapeHtml(signupEmail)}</b>. Please check your inbox and enter the 6-digit code below.`;
    }
    showSuccessMsg('Verification code sent to ' + signupEmail + '!');
  } catch (err) {
    showError('Could not connect to server. Please try again.');
    setLoading(btn, false);
  }
});

// ── OTP Verification ──────────────────────────────────────
document.getElementById('otpCode').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('verifyOtpBtn').click();
  }
});

document.getElementById('verifyOtpBtn').addEventListener('click', async () => {
  hideMessages();

  const code = document.getElementById('otpCode').value.trim();
  const btn  = document.getElementById('verifyOtpBtn');

  if (!code || code.length !== 6) {
    showError('Please enter the 6-digit verification code.'); return;
  }

  setLoading(btn, true);

  try {
    const res = await fetch(API_AUTH + '/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: signupEmail, code, role: selectedRole })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Verification failed.');
      setLoading(btn, false);
      return;
    }

    setLoading(btn, false);
    saveSessionAndRedirect(data, 'Account verified! Redirecting...');
  } catch (err) {
    showError('Could not connect to server. Please try again.');
    setLoading(btn, false);
  }
});

// ── Resend OTP ────────────────────────────────────────────
document.getElementById('resendOtp').addEventListener('click', async e => {
  e.preventDefault();
  hideMessages();

  if (!signupEmail) {
    showError('Session expired. Please sign up again.');
    showForm(signupForm);
    return;
  }

  try {
    const res = await fetch(API_AUTH + '/resend-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: signupEmail })
    });

    const data = await res.json();
    if (res.ok) {
      const otpInput = document.getElementById('otpCode');
      if (otpInput) {
        otpInput.value = data.demoCode || '';
        setTimeout(() => otpInput.focus(), 150);
      }
      const badge = document.getElementById('otpSmtpBadge');
      if (badge) {
        badge.style.display = 'block';
        badge.innerHTML = data.demoCode
          ? `✉️ Fresh verification code for <b>${escapeHtml(signupEmail)}</b>: <b>${escapeHtml(data.demoCode)}</b>`
          : `✉️ Fresh verification email sent to <b>${escapeHtml(signupEmail)}</b>. Please check your inbox and enter the 6-digit code below.`;
      }
      showSuccessMsg('New verification code sent to ' + signupEmail + '!');
    } else {
      showError(data.error || 'Failed to resend code.');
    }
  } catch (err) {
    showError('Could not connect to server.');
  }
});

// ── Google Auth ("goauth") Logic ─────────────────────────
const googleAuthModal = document.getElementById('googleAuthModal');
const googleModalCloseBtn = document.getElementById('googleModalCloseBtn');
const loginGoogleBtn = document.getElementById('loginGoogleBtn');
const signupGoogleBtn = document.getElementById('signupGoogleBtn');
const googleQuickAccountBtn = document.getElementById('googleQuickAccountBtn');
const googleCustomSubmitBtn = document.getElementById('googleCustomSubmitBtn');
const googleCustomEmail = document.getElementById('googleCustomEmail');
const googleQuickEmailDisplay = document.getElementById('googleQuickEmailDisplay');

let configuredSmtpEmail = 'programmmariojs8@gmail.com';

// Fetch SMTP status to show active configured Google email in Google account selector
fetch(API_AUTH + '/smtp-status')
  .then(res => res.json())
  .then(data => {
    if (data.user) {
      // If user is masked like pr***@gmail.com, keep default Mario address or unmasked
      if (googleQuickEmailDisplay) {
        googleQuickEmailDisplay.textContent = configuredSmtpEmail;
      }
    }
  })
  .catch(() => {});

function openGoogleModal() {
  hideMessages();
  if (googleAuthModal) googleAuthModal.classList.remove('hidden');
  if (googleCustomEmail) googleCustomEmail.value = '';
}

function closeGoogleModal() {
  if (googleAuthModal) googleAuthModal.classList.add('hidden');
}

if (loginGoogleBtn) loginGoogleBtn.onclick = openGoogleModal;
if (signupGoogleBtn) signupGoogleBtn.onclick = openGoogleModal;
if (googleModalCloseBtn) googleModalCloseBtn.onclick = closeGoogleModal;

if (googleAuthModal) {
  googleAuthModal.onclick = e => {
    if (e.target === googleAuthModal) closeGoogleModal();
  };
}

async function performGoogleLogin(email, name) {
  hideMessages();
  closeGoogleModal();
  showSuccessMsg('Connecting to Google authentication...');

  try {
    const res = await fetch(API_AUTH + '/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        name: name || email.split('@')[0],
        role: selectedRole,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      showError(data.error || 'Google authentication failed.');
      return;
    }

    saveSessionAndRedirect(data, `Signed in as ${data.email} via Google! Redirecting...`);
  } catch (err) {
    showError('Unable to authenticate with Google. Please check your connection.');
  }
}

if (googleQuickAccountBtn) {
  googleQuickAccountBtn.onclick = () => {
    performGoogleLogin(configuredSmtpEmail, 'Mario');
  };
}

if (googleCustomSubmitBtn) {
  googleCustomSubmitBtn.onclick = () => {
    const email = (googleCustomEmail?.value || '').trim();
    if (!email || !email.includes('@')) {
      showError('Please enter a valid Google email address.');
      return;
    }
    performGoogleLogin(email);
  };
}

if (googleCustomEmail) {
  googleCustomEmail.onkeydown = e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (googleCustomSubmitBtn) googleCustomSubmitBtn.click();
    }
  };
}
