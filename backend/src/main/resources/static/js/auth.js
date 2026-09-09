// ── Auth Page Logic ────────────────────────────────────────
const API_AUTH = '/api/auth';

// If already logged in, redirect to dashboard
const existingToken = localStorage.getItem('vaani_auth_token');
if (existingToken) {
  // Quick check if token is still valid
  fetch(API_AUTH + '/me', {
    headers: { 'Authorization': 'Bearer ' + existingToken }
  }).then(res => {
    if (res.ok) window.location.href = 'index.html';
  }).catch(() => {});
}

// ── DOM Elements ──────────────────────────────────────────
const loginForm   = document.getElementById('loginForm');
const signupForm  = document.getElementById('signupForm');
const otpSection  = document.getElementById('otpSection');
const showSignup  = document.getElementById('showSignup');
const showLogin   = document.getElementById('showLogin');
const authError   = document.getElementById('authError');
const authSuccess = document.getElementById('authSuccess');

// Signup state
let signupEmail = '';
let signupName  = '';
let signupPassword = '';

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

function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
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
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Login failed.');
      setLoading(btn, false);
      return;
    }

    // Save token and user info
    localStorage.setItem('vaani_auth_token', data.token);
    localStorage.setItem('vaani_user_name', data.name);
    localStorage.setItem('vaani_user_email', data.email);

    showSuccessMsg('Login successful! Redirecting...');
    setTimeout(() => { window.location.href = 'index.html'; }, 500);
  } catch (err) {
    showError('Could not connect to server. Please try again.');
    setLoading(btn, false);
  }
});

// ── Signup ────────────────────────────────────────────────
signupForm.addEventListener('submit', async e => {
  e.preventDefault();
  hideMessages();

  signupName     = document.getElementById('signupName').value.trim();
  signupEmail    = document.getElementById('signupEmail').value.trim().toLowerCase();
  signupPassword = document.getElementById('signupPassword').value;
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
      body: JSON.stringify({ name: signupName, email: signupEmail, password: signupPassword })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Signup failed.');
      setLoading(btn, false);
      return;
    }

    // Show OTP section
    document.getElementById('otpEmailDisplay').textContent = signupEmail;
    showForm(otpSection);
    showSuccessMsg(data.message || 'Verification code sent! Check your email.');
  } catch (err) {
    showError('Could not connect to server. Please try again.');
    setLoading(btn, false);
  }
});

// ── OTP Verification ──────────────────────────────────────
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
      body: JSON.stringify({ email: signupEmail, code })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Verification failed.');
      setLoading(btn, false);
      return;
    }

    // Save token and user info
    localStorage.setItem('vaani_auth_token', data.token);
    localStorage.setItem('vaani_user_name', data.name);
    localStorage.setItem('vaani_user_email', data.email);

    showSuccessMsg('Account verified! Redirecting...');
    setTimeout(() => { window.location.href = 'index.html'; }, 500);
  } catch (err) {
    showError('Could not connect to server. Please try again.');
    setLoading(btn, false);
  }
});

// ── Resend OTP ────────────────────────────────────────────
document.getElementById('resendOtp').addEventListener('click', async e => {
  e.preventDefault();
  hideMessages();

  if (!signupEmail || !signupPassword) {
    showError('Session expired. Please sign up again.');
    showForm(signupForm);
    return;
  }

  try {
    const res = await fetch(API_AUTH + '/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: signupName, email: signupEmail, password: signupPassword })
    });

    const data = await res.json();
    if (res.ok) {
      showSuccessMsg('New verification code sent! Check your email.');
    } else {
      showError(data.error || 'Failed to resend code.');
    }
  } catch (err) {
    showError('Could not connect to server.');
  }
});
