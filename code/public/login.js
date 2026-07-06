const $ = (sel) => document.querySelector(sel);
const THEME_KEY = 'aegis-theme';

function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  localStorage.setItem(THEME_KEY, theme);
}

function toggleTheme() {
  applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

$('#themeToggle')?.addEventListener('click', toggleTheme);

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

const SWITCH_GITHUB_KEY = 'aegis-github-switch';

async function clearAegisSession() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch { /* continue */ }
}

function showSwitchBanner() {
  $('#switchAccountBanner')?.classList.remove('hidden');
  $('#switchAccountPanel')?.classList.add('hidden');
  toast('Signed out of GitHub — click Continue with GitHub to pick an account');
}

async function signOutOfGithub() {
  await clearAegisSession();
  localStorage.setItem(SWITCH_GITHUB_KEY, '1');
  window.location.href = 'https://github.com/logout';
}

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await res.json();
    if (data.connected) {
      window.location.href = '/app/';
    }
  } catch { /* stay on login */ }
}

async function connectWithPat() {
  const token = $('#patInput').value.trim();
  if (!token) return toast('Enter a personal access token');

  try {
    const res = await fetch('/api/auth/pat', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Connection failed');
    window.location.href = '/app/';
  } catch (e) {
    toast(e.message);
  }
}

async function setupOAuth() {
  try {
    const health = await fetch('/api/health').then((r) => r.json());
    const btn = $('#githubBtn');
    if (!health.github?.oauth) {
      btn.classList.add('disabled');
      btn.setAttribute('aria-disabled', 'true');
      btn.title = 'OAuth not configured — use a personal access token below';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        $('#patPanel').classList.remove('hidden');
        toast('OAuth not configured — connect with a token instead');
      });
    }
    if (health.production) {
      const trustCard = document.querySelector('.login-right .trust-card');
      const title = trustCard?.querySelector('h3');
      const copy = trustCard?.querySelector('p');
      if (title) title.textContent = 'Select accessible repos · Start scanning';
      if (copy) copy.textContent = 'Choose which repositories Aegis Loop can scan, then run your first repository or PR scan.';
    }
  } catch { /* ignore */ }
}

$('#togglePat').addEventListener('click', () => {
  $('#patPanel').classList.toggle('hidden');
});

$('#switchAccountBtn')?.addEventListener('click', () => {
  $('#switchAccountPanel')?.classList.remove('hidden');
  $('#switchAccountBtn')?.classList.add('hidden');
});

$('#cancelSwitchAccount')?.addEventListener('click', () => {
  $('#switchAccountPanel')?.classList.add('hidden');
  $('#switchAccountBtn')?.classList.remove('hidden');
});

$('#confirmGithubLogout')?.addEventListener('click', signOutOfGithub);

$('#patSubmit').addEventListener('click', connectWithPat);
$('#patInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connectWithPat();
});

checkAuth();
setupOAuth();

if (localStorage.getItem(SWITCH_GITHUB_KEY)) {
  localStorage.removeItem(SWITCH_GITHUB_KEY);
  showSwitchBanner();
}

const loginParams = new URLSearchParams(window.location.search);
if (loginParams.get('auth') === 'failed') {
  toast('GitHub sign-in failed — try again or use a personal access token');
  history.replaceState(null, '', '/login');
}
