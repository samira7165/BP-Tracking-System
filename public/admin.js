// Admin dashboard: log in, manage scripts, review recordings.
// Helpers and showReport() come from report.js.
const API = '/api/admin/recordings';
const LANGUAGES = { en: 'English', bn: 'Bangla' };
let scripts = [];
let editingId = null;
let pollId = null;
let refreshId = null;
let signedIn = false;
let historyJson = '';
let recordings = [];
let settings = null;

// ---------- confirm + toast ----------
/** Resolves true when the admin confirms. */
function confirmAction(title, text, label = 'Delete') {
  const dialog = $('confirm');
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-yes').textContent = label;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true }));
}

let toastId = null;
function toast(message, isError = false) {
  clearTimeout(toastId);
  $('toast').textContent = message;
  $('toast').classList.toggle('toast-error', isError);
  $('toast').classList.add('show');
  toastId = setTimeout(() => $('toast').classList.remove('show'), isError ? 6000 : 2600);
}

// ---------- api + session ----------
async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) showLogin();
    throw new Error(errorText(data, res.statusText));
  }
  return data;
}

function showError(id, message) {
  $(id).textContent = message || '';
  $(id).classList.toggle('hidden', !message);
}

function showLogin() {
  signedIn = false;
  clearInterval(pollId);
  clearInterval(refreshId);
  $('editor').close();
  $('confirm').close();
  $('dashboard').classList.add('hidden');
  $('login').classList.remove('hidden');
}

function showDashboard() {
  signedIn = true;
  $('login').classList.add('hidden');
  $('dashboard').classList.remove('hidden');
  historyJson = '';
  loadScripts();
  loadHistory();
  loadSettings();
  route();
  // Keeps new recordings and their status up to date
  clearInterval(refreshId);
  refreshId = setInterval(loadHistory, 4000);
}

$('login-form').onsubmit = async (e) => {
  e.preventDefault();
  showError('login-error');
  try {
    await api('/api/admin/login', { method: 'POST', body: { password: $('password').value } });
    $('password').value = '';
    showDashboard();
  } catch (err) {
    showError('login-error', err.message);
  }
};

$('btn-logout').onclick = async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => undefined);
  location.reload();
};

// ---------- navigation: #scripts, #recordings, #recordings/<id>, #settings ----------
function route() {
  if (!signedIn) return;
  const [section, id] = location.hash.slice(1).split('/');
  const view = section === 'recordings' ? (id ? 'recording' : 'recordings') : section === 'settings' ? 'settings' : 'scripts';
  for (const v of ['scripts', 'recordings', 'recording', 'settings']) $('view-' + v).classList.toggle('hidden', v !== view);
  document.querySelectorAll('.side nav a').forEach((a) => {
    if (view.startsWith(a.dataset.view.slice(0, -1))) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  showSetup();
  clearInterval(pollId);
  if (view === 'recording') watchRecording(id);
  else {
    // Also stops a playing video
    $('report').innerHTML = '';
    $('report').classList.add('hidden');
  }
}
window.addEventListener('hashchange', route);

$('btn-copy').onclick = async () => {
  const link = location.origin + '/';
  try {
    await navigator.clipboard.writeText(link);
    toast('Link copied');
  } catch {
    toast('The link is ' + link);
  }
};

/** Checklist shown until promoters can record and results can be made. */
function showSetup() {
  if (!settings) return;
  const steps = [
    { done: !!settings.apiKey.source, text: 'Add your Gemini API key', action: '<a class="btn" href="#settings">Open Settings</a>' },
    { done: scripts.some((s) => s.active), text: 'Add a script for your brand promoters', action: '<button class="btn" onclick="openEditor(null)">New script</button>' },
  ];
  const hide = steps.every((s) => s.done) || /^#(settings|recordings\/)/.test(location.hash);
  $('setup-card').classList.toggle('hidden', hide);
  $('setup-steps').innerHTML = steps
    .map((s) => `<li class="${s.done ? 'done' : ''}"><span>${s.text}${s.done ? '<span class="sr"> (done)</span>' : ''}</span>${s.done ? '' : s.action}</li>`)
    .join('');
}

// ---------- scripts ----------
const payload = (s) => ({ title: s.title, text: s.text, language: s.language || '', active: s.active });

async function loadScripts() {
  try {
    scripts = await api('/api/admin/scripts');
  } catch (err) {
    $('scripts').innerHTML = `<p class="empty">Could not load scripts: ${esc(err.message)}</p>`;
    return;
  }
  $('count-scripts').textContent = scripts.length || '';
  showSetup();
  $('btn-new').classList.toggle('hidden', !scripts.length);
  const shown = scripts.filter((s) => s.active).length;
  $('scripts-summary').textContent = scripts.length ? `${shown} of ${scripts.length} shown on the recording page` : '';
  $('scripts').innerHTML = scripts.length
    ? `<table>
        <thead><tr><th>Script</th><th>Language</th><th>Recording page</th><th>Updated</th><th><span class="sr">Actions</span></th></tr></thead>
        <tbody>${scripts
          .map(
            (s) => `<tr>
              <td class="cell-main"><button class="row-title" onclick="editScript('${s.id}')">${esc(s.title)}</button><span class="excerpt">${esc(s.text.slice(0, 140))}</span></td>
              <td data-l="Language">${esc(LANGUAGES[s.language] || s.language || 'English or Bangla')}</td>
              <td data-l="Recording page"><span class="state ${s.active ? 'on' : ''}">${s.active ? 'Shown' : 'Hidden'}</span></td>
              <td data-l="Updated" class="num">${fmtDate(s.updatedAt)}</td>
              <td class="cell-actions">
                <button class="link" onclick="editScript('${s.id}')">Edit</button>
                <button class="link" onclick="toggleScript('${s.id}')">${s.active ? 'Hide' : 'Show'}</button>
                <button class="link link-danger" onclick="deleteScript('${s.id}')">Delete</button>
              </td>
            </tr>`,
          )
          .join('')}</tbody></table>`
    : `<div class="empty"><p><b>No scripts yet</b></p><p>Add one and it appears on the recording page.</p><button class="btn btn-ink" onclick="openEditor(null)">${icon('plus')}New script</button></div>`;
}

function openEditor(script) {
  editingId = script?.id ?? null;
  showError('form-error');
  $('script-form').reset();
  if (script) {
    $('title').value = script.title;
    $('text').value = script.text;
    $('language').value = script.language || '';
    $('active').checked = script.active;
  }
  $('form-title').textContent = script ? 'Edit script' : 'New script';
  $('btn-save').textContent = script ? 'Save changes' : 'Add script';
  updateCount();
  $('editor').showModal();
}

/** Word count and speaking time at an easy 130 words a minute. */
function updateCount() {
  const words = $('text').value.trim().split(/\s+/).filter(Boolean).length;
  const sec = Math.round((words / 130) * 60);
  const time = sec < 60 ? `${sec} sec` : `${Math.floor(sec / 60)} min${sec % 60 ? ` ${sec % 60} sec` : ''}`;
  $('text-count').textContent = words ? `${words} ${words === 1 ? 'word' : 'words'}, about ${time}` : '';
}
$('text').oninput = updateCount;
$('btn-new').onclick = () => openEditor(null);
$('btn-cancel').onclick = () => $('editor').close();
window.editScript = (id) => openEditor(scripts.find((x) => x.id === id));

$('script-form').onsubmit = async (e) => {
  e.preventDefault();
  showError('form-error');
  $('btn-save').disabled = true;
  const body = payload({ title: $('title').value, text: $('text').value, language: $('language').value, active: $('active').checked });
  try {
    if (editingId) await api(`/api/admin/scripts/${editingId}`, { method: 'PUT', body });
    else await api('/api/admin/scripts', { method: 'POST', body });
    toast(editingId ? 'Changes saved' : 'Script added');
    $('editor').close();
    await loadScripts();
  } catch (err) {
    showError('form-error', err.message);
  } finally {
    $('btn-save').disabled = false;
  }
};

window.toggleScript = async (id) => {
  const s = scripts.find((x) => x.id === id);
  try {
    await api(`/api/admin/scripts/${id}`, { method: 'PUT', body: payload({ ...s, active: !s.active }) });
    toast(s.active ? 'Hidden from the recording page' : 'Shown on the recording page');
    await loadScripts();
  } catch (err) {
    toast(err.message, true);
  }
};

window.deleteScript = async (id) => {
  const s = scripts.find((x) => x.id === id);
  if (!(await confirmAction(`Delete “${s.title}”?`, 'Recordings already made with it are kept.'))) return;
  try {
    await api(`/api/admin/scripts/${id}`, { method: 'DELETE' });
    toast('Script deleted');
    await loadScripts();
  } catch (err) {
    toast(err.message, true);
  }
};

// ---------- recordings ----------
function resultCell(r) {
  if (r.status === 'failed') return `<span class="result NOT_MATCHED">${r.needsRetake ? 'Must record again' : 'Failed'}</span>`;
  if (r.status === 'queued') return `<span class="result busy">${r.queue?.ahead ? `In line, ${r.queue.ahead} ahead` : 'Starting…'}</span>`;
  if (r.status !== 'done') return '<span class="result checking">Checking now…</span>';
  return `<span class="result ${r.verdict}"><b>${r.overallScore}</b> ${VERDICTS[r.verdict] || ''}<span class="mini"><i style="width:${Number(r.overallScore) || 0}%"></i></span></span>`;
}

async function loadHistory() {
  let items;
  try {
    items = await api(API);
  } catch (err) {
    historyJson = '';
    $('history').innerHTML = `<p class="empty">Could not load recordings: ${esc(err.message)}</p>`;
    return;
  }
  // Leave the table alone when nothing changed, so a refresh never steals focus
  const json = JSON.stringify(items);
  if (json === historyJson) return;
  historyJson = json;

  $('count-recordings').textContent = items.length || '';
  const scored = items.filter((r) => r.status === 'done');
  const average = Math.round(scored.reduce((sum, r) => sum + r.overallScore, 0) / scored.length);
  const inLine = items.filter((r) => r.status !== 'done' && r.status !== 'failed').length;
  $('recordings-summary').textContent = [
    scored.length ? `Average score ${average} across ${scored.length} checked ${scored.length === 1 ? 'recording' : 'recordings'}` : '',
    inLine ? `${inLine} in the queue` : '',
  ]
    .filter(Boolean)
    .join(', ');
  recordings = items;
  $('filters').classList.toggle('hidden', items.length < 2);
  renderHistory();
}

$('filter-text').oninput = $('filter-result').onchange = () => renderHistory();

function renderHistory() {
  const text = $('filter-text').value.trim().toLowerCase();
  const result = $('filter-result').value;
  const items = recordings.filter(
    (r) =>
      (!text || `${r.speaker || ''} ${r.title || ''}`.toLowerCase().includes(text)) &&
      (!result || r.verdict === result || r.status === result),
  );
  if (!items.length && recordings.length) {
    $('history').innerHTML = '<div class="empty"><p><b>No recordings match</b></p><p>Try another name or choose All results.</p></div>';
    return;
  }
  $('history').innerHTML = items.length
    ? `<table>
        <thead><tr><th>Brand promoter</th><th>Script</th><th>Result</th><th>Recorded</th><th><span class="sr">Actions</span></th></tr></thead>
        <tbody>${items
          .map(
            (r) => `<tr>
              <td class="cell-main"><a class="row-title" href="#recordings/${r.id}">${esc(r.speaker || 'No name given')}</a></td>
              <td data-l="Script">${esc(r.title || 'Untitled')}</td>
              <td data-l="Result">${resultCell(r)}</td>
              <td data-l="Recorded" class="num">${fmtDate(r.createdAt)}</td>
              <td class="cell-actions">
                <a class="link" href="#recordings/${r.id}">View</a>
                <button class="link link-danger" onclick="deleteRecording('${r.id}')">Delete</button>
              </td>
            </tr>`,
          )
          .join('')}</tbody></table>`
    : `<div class="empty"><p><b>No recordings yet</b></p><p>They appear here as soon as a brand promoter sends one.</p></div>`;
}

/** Shows progress until the recording is finished, then its report. */
function watchRecording(id) {
  clearInterval(pollId);
  $('report').classList.add('hidden');
  $('progress-text').textContent = 'Loading…';
  $('progress-text').classList.remove('hidden');
  let finished = false;
  const tick = async () => {
    try {
      const rec = await api(`${API}/${encodeURIComponent(id)}`);
      // The admin may have moved on, or an earlier tick already finished
      if (finished || location.hash !== `#recordings/${id}`) return;
      $('progress-text').textContent = statusLabel(rec);
      if (rec.status !== 'done' && rec.status !== 'failed') return;
      finished = true;
      clearInterval(timer);
      $('progress-text').classList.add('hidden');
      showReport(rec);
      loadHistory();
    } catch (err) {
      clearInterval(timer);
      $('progress-text').textContent = err.message;
    }
  };
  const timer = setInterval(tick, 2000);
  pollId = timer;
  tick();
}

window.reprocess = async (id) => {
  try {
    await api(`${API}/${id}/reprocess`, { method: 'POST' });
    watchRecording(id);
  } catch (err) {
    toast(err.message, true);
  }
};

window.deleteRecording = async (id) => {
  if (!(await confirmAction('Delete this recording?', 'Its video and report are deleted too. You cannot undo this.'))) return;
  try {
    await api(`${API}/${id}`, { method: 'DELETE' });
    toast('Recording deleted');
    loadHistory();
  } catch (err) {
    toast(err.message, true);
  }
};

// ---------- settings ----------
async function loadSettings() {
  try {
    showSettings(await api('/api/admin/settings'));
  } catch (err) {
    $('key-status').textContent = 'Could not load: ' + err.message;
  }
}

function showSettings(data) {
  const editing = promptChanged();
  settings = data;
  const { source, lastFour } = data.apiKey;
  $('key-status').textContent = source ? `Key ending in ${lastFour}${source === 'env' ? ', from the .env file' : ''}` : 'No key yet';
  $('key-status').classList.toggle('on', !!source);
  $('key-label').textContent = source ? 'Replace with a new key' : 'API key';
  $('btn-remove-key').classList.toggle('hidden', source !== 'dashboard');
  $('prompt-status').textContent = data.prompt.isDefault ? 'Default prompt' : 'Your own prompt';
  $('prompt-status').classList.toggle('on', !data.prompt.isDefault);
  // Never overwrite what the admin is typing
  if (!editing) $('prompt').value = data.prompt.text;
  updatePrompt();
  showSetup();
}

$('btn-show-key').onclick = () => {
  const show = $('api-key').type === 'password';
  $('api-key').type = show ? 'text' : 'password';
  $('btn-show-key').textContent = show ? 'Hide' : 'Show';
  $('btn-show-key').setAttribute('aria-pressed', String(show));
};

$('key-form').onsubmit = async (e) => {
  e.preventDefault();
  showError('key-error');
  $('btn-save-key').disabled = true;
  $('btn-save-key').textContent = 'Checking key…';
  try {
    const data = await api('/api/admin/settings/api-key', { method: 'PUT', body: { apiKey: $('api-key').value } });
    $('api-key').value = '';
    $('api-key').type = 'password';
    $('btn-show-key').textContent = 'Show';
    $('btn-show-key').setAttribute('aria-pressed', 'false');
    showSettings(data);
    if (data.warning) showError('key-error', 'The key is saved but could not be checked. ' + data.warning);
    else toast('Key saved. Google accepted it.');
  } catch (err) {
    showError('key-error', err.message);
  } finally {
    $('btn-save-key').disabled = false;
    $('btn-save-key').textContent = 'Save key';
  }
};

$('btn-remove-key').onclick = async () => {
  if (!(await confirmAction('Remove the API key?', 'New recordings cannot be checked until you add another key.', 'Remove'))) return;
  try {
    showSettings(await api('/api/admin/settings/api-key', { method: 'DELETE' }));
    showError('key-error');
    toast('Key removed');
  } catch (err) {
    toast(err.message, true);
  }
};

function promptChanged() {
  return !!settings && $('prompt').value.trim() !== settings.prompt.text;
}

function updatePrompt() {
  $('prompt-count').textContent = `${$('prompt').value.length} of 8000 characters`;
  $('btn-save-prompt').disabled = !promptChanged() || !$('prompt').value.trim();
  $('btn-default-prompt').disabled = !settings || $('prompt').value.trim() === settings.prompt.defaultText;
}
$('prompt').oninput = updatePrompt;

async function savePrompt(prompt, message) {
  showError('prompt-error');
  try {
    const data = await api('/api/admin/settings/prompt', { method: 'PUT', body: { prompt } });
    $('prompt').value = data.prompt.text;
    showSettings(data);
    toast(message);
  } catch (err) {
    showError('prompt-error', err.message);
  }
}

$('prompt-form').onsubmit = (e) => {
  e.preventDefault();
  savePrompt($('prompt').value, 'Prompt saved. New reports will use it.');
};

$('btn-default-prompt').onclick = async () => {
  if (await confirmAction('Restore the default prompt?', 'Your own prompt is deleted.', 'Restore')) savePrompt('', 'Default prompt restored');
};

window.addEventListener('beforeunload', (e) => {
  if (signedIn && promptChanged()) e.preventDefault();
});

// ---------- start ----------
api('/api/admin/session').then(showDashboard, showLogin);
