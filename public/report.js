// Shared by the recording page and the admin dashboard: helpers + report view.
const $ = (id) => document.getElementById(id);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

const ICONS = {
  print: '<path d="M7 9V4h10v5M7 17H4.5v-7A1 1 0 0 1 5.5 9h13a1 1 0 0 1 1 1v7H17M7 14h10v6H7z" />',
  file: '<path d="M13 4H7v16h10.5V8.5zM13 4v4.5h4.5" />',
  redo: '<path d="M4.5 5v5h5M5 10a7.5 7.5 0 1 1-.4 4.5" />',
  plus: '<path d="M12 5v14M5 12h14" />',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const SPEECH_LANGUAGES = { en: 'English', english: 'English', bn: 'Bangla', bengali: 'Bangla' };

const VERDICTS = { MATCHED: 'Matched', PARTIALLY_MATCHED: 'Partly matched', NOT_MATCHED: 'Not matched' };

/** Server error body → one readable line. */
const errorText = (body, fallback) => (Array.isArray(body?.message) ? body.message.join(', ') : body?.message || fallback);

/** Where a recording stands in line, in words. */
function queueLabel(queue) {
  if (!queue?.ahead) return 'Starting the check…';
  const min = Math.ceil((queue.waitSec ?? 0) / 60);
  return `${queue.ahead} ahead in the queue.${queue.waitSec ? ` Its turn is in about ${min} minute${min === 1 ? '' : 's'}.` : ''}`;
}

const statusLabel = (rec) =>
  ({
    queued: queueLabel(rec.queue),
    extracting_audio: 'Getting the audio and 3 snapshots from the video…',
    transcribing: 'Turning the audio into English or Bangla text…',
    checking_snapshots: 'The AI is checking attire and body language in 3 snapshots…',
    analyzing: 'The AI is comparing the text with the script…',
    done: 'Done',
    failed: 'This recording could not be checked.',
  })[rec.status] || rec.status;

// ---------- report ----------
function renderDiff(diff) {
  return diff
    .map((c) => {
      if (c.type === 'match') return `<span class="match">${esc(c.expected)}</span>`;
      if (c.type === 'missing') return `<del title="Not said">${esc(c.expected)}</del>`;
      if (c.type === 'extra') return `<ins title="Said, but not in the script">${esc(c.spoken)}</ins>`;
      return `<del title="In the script">${esc(c.expected)}</del> <ins title="Said instead">${esc(c.spoken)}</ins>`;
    })
    .join(' ');
}

/** A titled list, or nothing at all when there is nothing to list. */
const listSection = (title, items) =>
  items?.length ? `<section class="rp-list"><h3>${title}</h3><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul></section>` : '';

const ASPECTS = { attire: 'Attire', expression: 'Facial expression', bodyLanguage: 'Body language' };
const RATINGS = { good: 'Good', fair: 'Fair', poor: 'Poor' };

/** The 3 snapshots and what Gemini saw in them. */
function appearanceSection(id, a) {
  if (!a) return '';
  const shots = (a.snapshots || [])
    .map((s) => `<figure><img src="${API}/${esc(id)}/snapshots/${Number(s.n)}" alt="Snapshot ${Number(s.n)}" loading="lazy" /><figcaption>At ${fmtTime(s.atSec)}</figcaption></figure>`)
    .join('');
  const head = (score) => `<div class="rp-look-head"><h3>Attire and body language</h3>${score}</div>`;
  const body = a.error
    ? `<p class="warning">${esc(a.error)}</p>`
    : `<p class="rp-summary">${esc(a.summary)}</p>
      <dl class="rp-aspects">${Object.entries(ASPECTS)
        .filter(([k]) => a.aspects?.[k])
        .map(([k, label]) => `<div><dt>${label}</dt><dd><span class="rating ${esc(a.aspects[k].rating)}">${RATINGS[a.aspects[k].rating] || ''}</span> ${esc(a.aspects[k].note)}</dd></div>`)
        .join('')}</dl>
      <div class="rp-lists rp-lists-look">${listSection('Did well', (a.strengths || []).map(esc))}${listSection('To improve', (a.improvements || []).map(esc))}</div>`;
  return `<section class="rp-look">${head(a.error ? '' : `<p class="rp-look-score"><b>${Number(a.score)}</b>/100</p>`)}<div class="shots">${shots}</div>${body}</section>`;
}

/** Fills #report (admin dashboard only). window.reprocess is in admin.js. */
function showReport(rec) {
  const el = $('report');
  el.classList.remove('hidden');

  const head = (actions) => `
    <div class="rp-head">
      <div>
        <h2>${esc(rec.title || 'Untitled')}</h2>
        <p class="rp-by">${rec.speaker ? esc(rec.speaker) + ', ' : ''}${fmtDate(rec.createdAt)}</p>
      </div>
      <div class="rp-actions">${actions}</div>
    </div>`;
  const rerun = `<button class="btn" onclick="reprocess('${rec.id}')">${icon('redo')}Re-run</button>`;

  if (rec.status === 'failed') {
    el.innerHTML = `${head(rerun)}<div class="error"><b>This recording could not be checked.</b> ${esc(rec.error)}</div>${rec.needsRetake ? '<p class="rp-next">The brand promoter was asked to record again.</p>' : ''}`;
    el.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  const r = rec.report;
  const s = r.stats;
  const segs = rec.transcript?.segments || [];
  const stat = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const lists =
    listSection('Missing', r.missingParts.map(esc)) +
    listSection('Added', r.addedParts.map(esc)) +
    listSection('Changed', r.changedParts.map((c) => `<del>${esc(c.expected)}</del> <ins>${esc(c.spoken)}</ins>${c.note ? `<small>${esc(c.note)}</small>` : ''}`)) +
    listSection('Advice for the brand promoter', r.suggestions.map(esc));

  el.innerHTML = `
    ${head(`<button class="btn" onclick="window.print()">${icon('print')}Print or save PDF</button>
      <a class="btn" href="${API}/${rec.id}/report" target="_blank">${icon('file')}JSON</a>${rerun}`)}

    <div class="rp-result ${r.verdict}">
      <p class="rp-score"><b>${r.overallScore}</b><span>/100</span></p>
      <div>
        <p class="rp-verdict">${VERDICTS[r.verdict] || esc(r.verdict)}</p>
        <p class="rp-summary">${esc(r.summary)}</p>
      </div>
      <div class="meter" aria-hidden="true"><i style="width:${Number(r.overallScore) || 0}%"></i></div>
    </div>
    ${r.warning ? `<div class="warning">${esc(r.warning)}</div>` : ''}

    <dl class="rp-stats">
      ${stat('Word accuracy', r.wordAccuracy + '%')}
      ${stat('Script words said', `${s.matchedWords} of ${s.scriptWords}`)}
      ${stat('Missing or changed', s.missingWords + s.changedWords)}
      ${stat('Extra words', s.extraWords)}
      ${rec.transcript?.language ? stat('Language', esc(SPEECH_LANGUAGES[rec.transcript.language] || rec.transcript.language)) : ''}
      ${rec.transcript?.durationSec ? stat('Length', fmtTime(rec.transcript.durationSec)) : ''}
    </dl>

    <section class="rp-script">
      <div class="rp-script-head">
        <h3>Script against speech</h3>
        <p class="legend"><del>not said</del> <ins>added or said instead</ins></p>
      </div>
      <div class="diff">${renderDiff(r.diff)}</div>
    </section>

    ${lists ? `<div class="rp-lists">${lists}</div>` : ''}

    ${appearanceSection(rec.id, r.appearance)}

    <div class="rp-media">
      <section>
        <h3>Recording</h3>
        <video id="report-video" src="${esc(rec.videoUrl)}" controls preload="metadata"></video>
      </section>
      <section>
        <h3>Transcript</h3>
        ${segs.length
          ? `<ol class="segments">${segs.map((g) => `<li><button onclick="seek(${Number(g.start)})" title="Play from here">${fmtTime(g.start)}</button><span>${esc(g.text)}</span></li>`).join('')}</ol>`
          : `<p>${esc(rec.transcript?.text || 'No speech detected.')}</p>`}
      </section>
    </div>

    <p class="rp-foot">${r.generatedBy === 'ai+local' ? `Scored by AI (${esc(r.analysisModel)})` : 'Word-by-word comparison only'}. Speech to text: ${esc(rec.transcript?.model)}.</p>
  `;
  el.scrollIntoView({ behavior: 'smooth' });
}

window.seek = (t) => {
  const v = $('report-video');
  v.currentTime = t;
  v.play();
};
