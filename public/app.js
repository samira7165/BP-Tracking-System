// Recording page: a brand promoter reads one of the admin's scripts, records and sends it.
// Results are only shown in the admin dashboard. Helpers come from report.js.
const API = '/api/recordings';

let stream = null;
let recorder = null;
let chunks = [];
let videoBlob = null;
let videoName = 'recording.webm';
let timerId = null;
let scripts = [];
let recording = false;
let countdownId = null;
let sent = true; // false while there is a take that has not been uploaded
let peak = 0;
let busy = false;

// ---------- helpers ----------
function pickMimeType() {
  const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
}

const currentScript = () => scripts.find((s) => s.id === $('script-select').value);

const HINTS = {
  off: '',
  ready: 'Press the red button. Recording starts after a 3 second countdown.',
  countdown: 'Get ready. Press stop to cancel.',
  recording: 'Recording. Press stop when you finish.',
  review: 'Play it back, then send it or record again.',
  sent: 'Sent to the admin.',
  busy: '',
};

/** The stage shows only the controls for its current state (see style.css). */
function updateStage(script) {
  const state = recording ? 'recording' : countdownId ? 'countdown' : busy ? 'busy' : videoBlob ? 'review' : stream ? 'ready' : 'off';
  $('stage').dataset.state = state;
  $('hint').textContent = !script && (state === 'ready' || state === 'review') ? 'There is no script to record yet.' : HINTS[state === 'review' && sent ? 'sent' : state];
  $('submit-label').textContent = busy ? 'Uploading…' : sent && videoBlob ? 'Sent' : 'Send recording';
  $('retake-label').textContent = sent && videoBlob ? 'Record another' : 'Record again';
  updateGuide(!!script);
}

/** Ticks off the steps and highlights the next one. */
function updateGuide(hasScript) {
  const done = { details: hasScript && !!$('speaker').value.trim(), record: !!videoBlob, check: !!videoBlob && sent };
  const next = Object.keys(done).find((k) => !done[k]);
  for (const k of Object.keys(done)) {
    $('guide-' + k).className = done[k] ? 'done' : k === next ? 'next' : '';
  }
}

// ---------- your name (remembered on this device) ----------
try {
  $('speaker').value = localStorage.getItem('sc_speaker') || '';
} catch {}

$('speaker').oninput = () => {
  const name = $('speaker').value.trim();
  try {
    localStorage.setItem('sc_speaker', name);
  } catch {}
  if (name) showNameError('');
  updateGuide(!!currentScript());
};

function showNameError(message) {
  $('speaker-error').textContent = message;
  $('speaker-error').classList.toggle('hidden', !message);
  $('speaker').setAttribute('aria-invalid', message ? 'true' : 'false');
}

// Leaving now would lose a take that has not been sent
window.addEventListener('beforeunload', (e) => {
  if (recording || (videoBlob && !sent)) e.preventDefault();
});

function updateButtons() {
  const script = currentScript();
  $('btn-record').disabled = !(stream && script) || recording || !!countdownId || !!videoBlob;
  $('btn-retake').disabled = !videoBlob || recording || busy;
  $('btn-stop').disabled = !(recording || countdownId);
  $('btn-submit').disabled = !(videoBlob && script) || sent || recording || busy;
  $('file-input').disabled = recording || !!countdownId || busy;
  // The take belongs to the selected script, so don't let it change mid-recording.
  $('script-select').disabled = recording || !!countdownId || busy || !scripts.length;
  updateStage(script);
}

// ---------- scripts (written by the admin) ----------
function showScript() {
  const script = currentScript();
  $('script-title').textContent = script ? script.title : 'Your script';
  $('script-text').textContent = script ? script.text : 'The script you should say will appear here.';
  const keywords = script?.keywords || [];
  $('script-keywords').classList.toggle('hidden', !keywords.length);
  $('keyword-list').innerHTML = keywords.map((k) => `<li>${esc(k)}</li>`).join('');
  $('script-scroll').scrollTop = 0;
  updateButtons();
}

async function loadScripts() {
  const selected = $('script-select').value;
  try {
    const res = await fetch('/api/scripts');
    if (!res.ok) throw new Error(res.statusText);
    scripts = await res.json();
    $('script-note').textContent = scripts.length ? '' : 'No scripts are available yet. Ask your admin to add one, then reload this page.';
  } catch (e) {
    $('script-note').textContent = 'Could not load the scripts. Reload the page to try again.';
  }
  $('script-select').innerHTML = scripts.map((s) => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('');
  if (scripts.some((s) => s.id === selected)) $('script-select').value = selected;
  showScript();
}
$('script-select').onchange = showScript;
loadScripts();

// ---------- camera + recording ----------
function cameraProblem(e) {
  if (!navigator.mediaDevices) return 'The camera only works on http://localhost or https:// addresses.';
  const known = {
    NotAllowedError: 'Camera access is blocked. Allow the camera and microphone for this site in your browser, then try again.',
    NotFoundError: 'No camera or microphone was found. Connect one and try again.',
    NotReadableError: 'Another app is using your camera or microphone. Close it and try again.',
  };
  return known[e.name] || 'Could not open the camera: ' + e.message;
}

$('btn-camera').onclick = async () => {
  $('camera-error').classList.add('hidden');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
    const v = $('preview');
    v.srcObject = stream;
    v.muted = true;
    v.controls = false;
    $('btn-camera').disabled = true;
    watchMic();
    updateButtons();
  } catch (e) {
    $('camera-error').textContent = cameraProblem(e);
    $('camera-error').classList.remove('hidden');
  }
};

/** Moves the level bar so the speaker can see the microphone works. */
function watchMic() {
  try {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let level = 0;
      for (const x of data) level = Math.max(level, Math.abs(x));
      peak = Math.max(peak, level);
      // Square root so normal speech fills a visible part of the bar
      $('mic-level').style.transform = `scaleX(${Math.min(1, Math.sqrt(level)).toFixed(2)})`;
    }, 100);
  } catch {
    document.querySelector('.mic').classList.add('hidden');
    peak = 1; // cannot measure, so never warn about silence
  }
}

$('btn-record').onclick = () => {
  let left = 3;
  const show = () => ($('countdown').textContent = left);
  show();
  $('countdown').classList.remove('hidden');
  countdownId = setInterval(() => {
    left -= 1;
    if (left) return show();
    endCountdown();
    startRecording();
  }, 1000);
  updateButtons();
  // A report opening mid-recording would be distracting
  watching = null;
  $('progress').classList.add('hidden');
  $('btn-stop').focus();
};

function endCountdown() {
  clearInterval(countdownId);
  countdownId = null;
  $('countdown').classList.add('hidden');
}

function startRecording() {
  chunks = [];
  peak = 0;
  const mimeType = pickMimeType();
  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    // Drop ";codecs=vp9,opus": the comma makes the server's upload parser reject the file.
    const type = (recorder.mimeType || 'video/webm').split(';')[0];
    videoBlob = new Blob(chunks, { type });
    videoName = type.includes('mp4') ? 'recording.mp4' : 'recording.webm';
    const v = $('preview');
    v.srcObject = null;
    v.src = URL.createObjectURL(videoBlob);
    v.muted = false;
    v.controls = true;
    recording = false;
    sent = false;
    updateButtons();
  };
  recorder.start(1000);
  recording = true;

  const started = Date.now();
  $('timer').textContent = '00:00';
  $('rec-badge').classList.remove('hidden');
  timerId = setInterval(() => {
    const sec = (Date.now() - started) / 1000;
    $('timer').textContent = fmtTime(sec);
    if (sec > 4) $('hint').textContent = peak < 0.01 ? 'We cannot hear you. Check your microphone.' : HINTS.recording;
  }, 500);

  updateButtons();
}

$('btn-stop').onclick = () => {
  if (countdownId) {
    endCountdown();
    updateButtons();
    return;
  }
  recorder?.stop();
  clearInterval(timerId);
  $('rec-badge').classList.add('hidden');
};

$('btn-retake').onclick = () => {
  videoBlob = null;
  sent = true;
  const v = $('preview');
  v.removeAttribute('src');
  v.controls = false;
  v.muted = true;
  v.srcObject = stream;
  $('file-input').value = '';
  $('progress').classList.add('hidden');
  watching = null;
  updateButtons();
};

$('file-input').onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  videoBlob = f;
  videoName = f.name;
  sent = false;
  const v = $('preview');
  v.srcObject = null;
  v.src = URL.createObjectURL(f);
  v.muted = false;
  v.controls = true;
  updateButtons();
};

// ---------- upload ----------
/** kind: '' while uploading, 'ok' or 'bad' afterwards. */
function showProgress(text, kind = '', percent = 100) {
  $('progress').className = `progress ${kind}`;
  $('progress-text').textContent = text;
  $('upload-fill').style.width = percent + '%';
}

$('btn-submit').onclick = () => {
  if (!$('speaker').value.trim()) {
    showNameError('Enter your name before you send this recording.');
    $('speaker').focus();
    return;
  }
  const form = new FormData();
  const script = currentScript();
  form.append('scriptId', script.id);
  form.append('scriptVersion', script.updatedAt);
  form.append('speaker', $('speaker').value.trim());
  form.append('video', videoBlob, videoName);

  showProgress('Sending…', '', 0);
  $('progress').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  watching = null;
  busy = true;
  updateButtons();

  const failed = (message) => {
    showProgress(message, 'bad');
    busy = false;
    updateButtons();
  };

  // XHR so we can show upload %
  const xhr = new XMLHttpRequest();
  xhr.open('POST', API);
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const percent = Math.round((e.loaded / e.total) * 100);
    showProgress(`Sending… ${percent}%`, '', percent);
  };
  xhr.onload = () => {
    let body = {};
    try { body = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status >= 300) {
      failed(xhr.status === 413 ? 'This video is too big to send. Record a shorter one.' : errorText(body, 'Sending did not work. Try again.'));
      // Script edited or withdrawn by the admin: load the current version, keep the recording.
      if (xhr.status === 404 || xhr.status === 409) loadScripts();
      return;
    }
    sent = true;
    busy = false;
    updateButtons();
    saveTakes([body.id, ...takes]);
    takeRecs[body.id] = body;
    watching = body.id;
    showProgress('Sent. The admin will review your recording.', 'ok');
    refreshTakes();
  };
  xhr.onerror = () => failed('Sending did not work. Check your internet connection, then press Send recording again.');
  xhr.send(form);
};

// ---------- your recordings: did they arrive, remembered on this device ----------
// The server only tells: checking, received, or retake (with the reason)
const isFinished = (rec) => !!rec && rec.status !== 'checking';
let takes = []; // recording ids, newest first
const takeRecs = {}; // id -> latest known recording
let watching = null; // the recording shown in the progress panel
let refreshing = false;
let refreshId = null;

try {
  const saved = JSON.parse(localStorage.getItem('sc_takes') || '[]');
  if (Array.isArray(saved)) takes = saved.filter((id) => typeof id === 'string');
} catch {}

function saveTakes(ids) {
  // Keep the latest 10, and everything that is not settled yet
  takes = ids.filter((id, n) => n < 10 || !isFinished(takeRecs[id]));
  try {
    localStorage.setItem('sc_takes', JSON.stringify(takes));
  } catch {}
}

/** Asks the server about every unsettled recording, until all are settled. */
async function refreshTakes() {
  if (refreshing) return;
  refreshing = true;
  clearTimeout(refreshId);
  for (const id of [...takes]) {
    if (isFinished(takeRecs[id])) continue;
    try {
      const res = await fetch(`${API}/${encodeURIComponent(id)}`);
      if (res.status === 404) saveTakes(takes.filter((x) => x !== id));
      else if (res.ok) takeRecs[id] = await res.json();
    } catch {
      break; // offline: try again on the next round
    }
  }
  refreshing = false;
  renderTakes();
  if (takeRecs[watching]?.status === 'retake') {
    showProgress(takeRecs[watching].message, 'bad');
    watching = null;
  }
  if (takes.some((id) => !isFinished(takeRecs[id]))) refreshId = setTimeout(refreshTakes, 4000);
}

let takesHtml = '';
function renderTakes() {
  const known = takes.map((id) => takeRecs[id]).filter(Boolean);
  $('takes').classList.toggle('hidden', !known.length);
  const html = known
    .map(
      (rec) => `<li>
        <div class="take-name"><b>${esc(rec.title || 'Untitled')}</b><span>${fmtDate(rec.createdAt)}</span></div>
        ${rec.status === 'retake' ? `<span class="take-bad">${esc(rec.message)}</span>` : '<span class="take-ok">Sent</span>'}
      </li>`,
    )
    .join('');
  // Leave the list alone when nothing changed
  if (html !== takesHtml) $('takes-list').innerHTML = takesHtml = html;
}

$('btn-clear-takes').onclick = () => {
  saveTakes([]);
  renderTakes();
};

refreshTakes();
