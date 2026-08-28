/* ════════════════════════════════════════════════════════════
   assets/quiz-engine.js — moteur partagé des quiz Eneko
   Attend, définis AVANT ce script par la page :
     - les données : OBJECTIVES, IDK, QUESTIONS, MAX_SCORE, PROFILES
     - window.QUIZ : { endpoint, pendingKey, welcome:{badge,titleHtml,desc},
       extraPayload?, getProfile?, gaugePct?, resultNote? }
   Tout correctif du moteur se fait ICI, une seule fois pour les deux quiz.
   ════════════════════════════════════════════════════════════ */

const QUIZ = window.QUIZ;

/* ════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════ */

const S = {
  step: 'welcome',         // welcome | profile | objectives | quiz | results
  q: 0,                    // current question index 0-13
  user: { firstName: '', lastName: '', email: '', company: '' },
  objectives: [],          // selected objective indices
  answers: QUESTIONS.map(q => q.type === 'multiselect' ? new Set() : null),
  sending: false
};

/* ════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════ */

function getScore(qi, ans) {
  const q = QUESTIONS[qi];
  if (q.type === 'multiselect') {
    const sel = ans instanceof Set ? ans : new Set();
    if (sel.size === 0) return 0;
    if ([...sel].some(i => q.options[i].score === 2)) return 2;
    if ([...sel].some(i => q.options[i].score === 1)) return 1;
    return 0;
  }
  if (ans === null || ans === undefined) return 0;
  return q.options[ans].score;
}

function totalScore() {
  return S.answers.reduce((sum, ans, i) => sum + getScore(i, ans), 0);
}

function getProfile(score) {
  if (QUIZ.getProfile) return QUIZ.getProfile(score);
  return PROFILES.find(p => score <= p.threshold);
}

function isAnswered(qi) {
  if (QUESTIONS[qi].type === 'multiselect') return true; // valid even with 0 selections
  return S.answers[qi] !== null;
}

function answerLabel(qi) {
  const q = QUESTIONS[qi];
  const ans = S.answers[qi];
  if (q.type === 'multiselect') {
    if (!(ans instanceof Set) || ans.size === 0) return 'Aucun outil sélectionné';
    return [...ans].map(i => q.options[i].label).join(', ');
  }
  if (ans === null || ans === undefined) return 'Sans réponse';
  return q.options[ans].label;
}

function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  setTimeout(() => { el.className = 'toast'; }, 3000);
}

const SVG = {
  star:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  arrow:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
  check:  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
  down:   '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>',
  dl:     '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 15V3"/><path d="M8 11l4 4 4-4"/><path d="M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17"/></svg>',
  send:   '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
  user:   '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
  target: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>'
};

/* ════════════════════════════════════════════════
   RENDER
════════════════════════════════════════════════ */

function render() {
  const app = document.getElementById('app');
  app.innerHTML = renderHeader() + renderBody();
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (S.step === 'quiz' && QUESTIONS[S.q].type === 'single') startCountdown();
  else clearCountdown();
}

function renderHeader() {
  if (S.step === 'quiz') {
    const pct = Math.round(((S.q + 1) / QUESTIONS.length) * 100);
    return `<div class="header header--quiz">
      <div class="header-top">
        <div class="logo"><a href="https://eneko.ai/" target="_blank" rel="noopener"><img src="/assets/logo-eneko.svg" alt="Eneko"></a></div>
        <span class="header-meta">Q${S.q + 1} / ${QUESTIONS.length}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>`;
  }
  const meta = S.step === 'results'
    ? `<span class="header-meta">${totalScore()} / ${MAX_SCORE} pts</span>`
    : '';
  return `<div class="header"><div class="logo"><a href="https://eneko.ai/" target="_blank" rel="noopener"><img src="/assets/logo-eneko.svg" alt="Eneko"></a></div>${meta}</div>`;
}

function renderBody() {
  switch (S.step) {
    case 'welcome':    return renderWelcome();
    case 'profile':    return renderProfile();
    case 'objectives': return renderObjectives();
    case 'quiz':       return renderQuiz();
    case 'results':    return renderResults();
  }
  return '';
}

/* ── Welcome ── */
function renderWelcome() {
  return `
    <div class="screen">
      <div class="badge">${SVG.star} ${QUIZ.welcome.badge}</div>
      <h1 class="welcome-title">${QUIZ.welcome.titleHtml}</h1>
      <p class="welcome-desc">
        ${QUESTIONS.length} questions concrètes. 5 minutes. ${QUIZ.welcome.desc}
      </p>
      <div class="stats-row">
        <div class="stat"><div class="stat-n">${QUESTIONS.length}</div><div class="stat-l">Questions</div></div>
        <div class="stat"><div class="stat-n">5'</div><div class="stat-l">En moyenne</div></div>
        <div class="stat"><div class="stat-n">${PROFILES.length}</div><div class="stat-l">Profils</div></div>
      </div>
      <button class="btn btn-primary btn-full" onclick="goto('profile')">
        Démarrer ${SVG.arrow}
      </button>
    </div>`;
}

/* ── Profile form ── */
function renderProfile() {
  const u = S.user;
  return `
    <div class="screen">
      <div class="section-tag">${SVG.user} Étape 1 sur 2</div>
      <h2 class="screen-title">Parlez-nous de vous</h2>
      <p class="screen-sub">Ces informations personnalisent votre résultat et permettent de vous envoyer vos recommandations.</p>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Prénom <span class="req">*</span></label>
          <input class="form-input" id="f-fn" type="text" placeholder="Marie" value="${esc(u.firstName)}" autocomplete="given-name">
          <div class="form-err" id="e-fn">Ce champ est requis</div>
        </div>
        <div class="form-group">
          <label class="form-label">Nom <span class="req">*</span></label>
          <input class="form-input" id="f-ln" type="text" placeholder="Dupont" value="${esc(u.lastName)}" autocomplete="family-name">
          <div class="form-err" id="e-ln">Ce champ est requis</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Email professionnel <span class="req">*</span></label>
        <input class="form-input" id="f-em" type="email" placeholder="marie.dupont@entreprise.fr" value="${esc(u.email)}" autocomplete="email">
        <div class="form-err" id="e-em">Entrez un email valide</div>
      </div>
      <div class="form-group">
        <label class="form-label">Entreprise (optionnel)</label>
        <input class="form-input" id="f-co" type="text" placeholder="Nom de votre structure" value="${esc(u.company)}" autocomplete="organization">
      </div>

      <div class="nav-row">
        <button class="btn btn-ghost" onclick="goto('welcome')">← Retour</button>
        <button class="btn btn-primary" onclick="submitProfile()">Continuer ${SVG.arrow}</button>
      </div>
    </div>`;
}

/* ── Objectives ── */
function renderObjectives() {
  const count = S.objectives.length;
  const items = OBJECTIVES.map((txt, i) => {
    const sel = S.objectives.includes(i);
    const locked = !sel && count >= 3;
    return `
      <button class="obj-item${sel ? ' selected' : ''}${locked ? ' locked' : ''}"
              onclick="toggleObj(${i})">
        <div class="obj-box">${sel ? SVG.check : ''}</div>
        <span>${txt}</span>
      </button>`;
  }).join('');

  return `
    <div class="screen">
      <div class="section-tag">${SVG.target} Étape 2 sur 2</div>
      <h2 class="screen-title">Vos objectifs prioritaires</h2>
      <p class="screen-sub">Sélectionnez jusqu'à <strong>3 objectifs</strong> qui correspondent le mieux à ce que vous recherchez.</p>
      <div class="obj-counter">
        <strong id="obj-cnt">${count}</strong> / 3 sélectionné${count > 1 ? 's' : ''}
      </div>
      <div class="obj-grid" id="obj-grid">${items}</div>
      <div class="nav-row">
        <button class="btn btn-ghost" onclick="goto('profile')">← Retour</button>
        <button class="btn btn-primary" id="btn-obj" onclick="submitObjectives()" ${count === 0 ? 'disabled' : ''}>
          Démarrer le quiz ${SVG.arrow}
        </button>
      </div>
    </div>`;
}

/* ── Quiz question ── */
function renderQuiz() {
  const q = QUESTIONS[S.q];
  const ans = S.answers[S.q];
  const isLast = S.q === QUESTIONS.length - 1;
  const answered = isAnswered(S.q);
  const opts = q.options.map((opt, i) => {
    const sel = q.type === 'multiselect'
      ? (ans instanceof Set && ans.has(i))
      : ans === i;
    const letter = String.fromCharCode(65 + i);
    const isIdk = opt.idk === true;
    const separator = isIdk ? '<div class="idk-separator">ou</div>' : '';
    const marker = isIdk ? '?' : (sel ? (q.type === 'multiselect' ? '✓' : letter) : letter);
    return `${separator}
      <button class="opt${q.type === 'multiselect' ? ' multi' : ''}${sel ? ' selected' : ''}${isIdk ? ' idk-opt' : ''}"
              onclick="pick(${i})">
        <div class="opt-marker">${marker}</div>
        <span>${opt.label}</span>
      </button>`;
  }).join('');

  return `
    <div class="screen">
      <div class="q-theme">${q.theme}</div>
      <h2 class="q-text">${q.question}</h2>
      ${q.type === 'multiselect' ? '<p class="q-hint">Sélectionnez tout ce qui s\'applique</p>' : ''}
      <div class="options">${opts}</div>
      <div class="nav-row">
        <button class="btn btn-ghost" onclick="prev()">← Préc.</button>
        <button class="btn btn-primary" id="btn-nxt" onclick="${isLast ? 'finish()' : 'next()'}" ${!answered ? 'disabled' : ''}>
          ${isLast ? 'Voir mes résultats 🎯' : 'Suivant ' + SVG.arrow}
        </button>
      </div>
    </div>`;
}

/* ── Results ── */
function renderResults() {
  const score = totalScore();
  const profile = getProfile(score);

  const profileParas = profile.paras.map(p => `<p class="profile-text">${p}</p>`).join('');

  const corrections = QUESTIONS.map((q, i) => {
    const sc = getScore(i, S.answers[i]);
    const badgeCls = sc === 2 ? 'sb-full' : sc === 1 ? 'sb-partial' : 'sb-zero';
    return `
      <div class="corr-card" id="cc-${i}">
        <div class="corr-head" onclick="toggleCorr(${i})">
          <div class="score-badge ${badgeCls}">${sc}/2</div>
          <div class="corr-q">${q.question}</div>
          <span class="chevron">${SVG.down}</span>
        </div>
        <div class="corr-body" id="cb-${i}">
          <div class="corr-your">Votre réponse : <strong>${answerLabel(i)}</strong></div>
          <div class="corr-expl">💡 ${q.correction}</div>
        </div>
      </div>`;
  }).join('');

  const activeIdx = PROFILES.indexOf(profile);
  const rawPct = Math.min(100, Math.round((score / MAX_SCORE) * 100));
  const pct = QUIZ.gaugePct ? QUIZ.gaugePct(score, profile, rawPct) : rawPct;
  const dividers = PROFILES.slice(0, -1).map(p =>
    `<div class="gauge-div" style="left:${Math.round((p.threshold / MAX_SCORE) * 100)}%"></div>`
  ).join('');
  const levelCards = PROFILES.map((p, i) => {
    const from = i === 0 ? 0 : PROFILES[i-1].threshold + 1;
    const to   = p.threshold === Infinity ? MAX_SCORE : p.threshold;
    return `<div class="gauge-level ${i === activeIdx ? 'active' : ''}">
      <span class="gauge-level-emoji">${p.emoji}</span>
      <span class="gauge-level-name">${p.name}</span>
      <span class="gauge-level-range">${from}–${to} pts</span>
    </div>`;
  }).join('');
  const gauge = `<div class="level-gauge">
    <div class="gauge-wrap">
      <div class="gauge-track"><div class="gauge-fill" style="--gauge-w:${pct}%"></div></div>
      ${dividers}
      <div class="gauge-dot" style="left:${pct}%"></div>
    </div>
    <div class="gauge-levels">${levelCards}</div>
  </div>`;

  return `
    <div class="screen">
      <div class="result-hero">
        <div class="result-emoji">${profile.emoji}</div>
        <div class="result-name">${profile.label}</div>
        <div class="score-pill">
          <span class="score-n">${score}</span>
          <span class="score-max">/ ${MAX_SCORE} points</span>
        </div>
      </div>

      ${gauge}

      ${QUIZ.resultNote ? QUIZ.resultNote(score) : ''}

      <div class="card">${profileParas}</div>

      <div class="corrections-title" style="margin-top:28px">📚 Correction détaillée</div>
      ${corrections}
      <div style="height:40px"></div>
    </div>`;
}

/* ════════════════════════════════════════════════
   ACTIONS
════════════════════════════════════════════════ */

function goto(step) { S.step = step; render(); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function submitProfile() {
  const fn = v('f-fn'), ln = v('f-ln'), em = v('f-em'), co = v('f-co');
  let ok = true;
  ok = require('f-fn','e-fn', fn.length > 0) && ok;
  ok = require('f-ln','e-ln', ln.length > 0) && ok;
  ok = require('f-em','e-em', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) && ok;
  if (!ok) return;
  S.user = { firstName: fn, lastName: ln, email: em, company: co };
  goto('objectives');
}

function v(id) { return document.getElementById(id).value.trim(); }
function require(inputId, errId, cond) {
  const inp = document.getElementById(inputId);
  const err = document.getElementById(errId);
  if (!cond) { inp.classList.add('err'); err.classList.add('show'); return false; }
  inp.classList.remove('err'); err.classList.remove('show'); return true;
}

function toggleObj(i) {
  const sel = S.objectives.includes(i);
  if (sel) {
    S.objectives = S.objectives.filter(x => x !== i);
  } else {
    if (S.objectives.length >= 3) return;
    S.objectives.push(i);
  }
  updateObjUI();
}

function updateObjUI() {
  const count = S.objectives.length;
  const cnt = document.getElementById('obj-cnt');
  if (cnt) cnt.textContent = count;
  document.querySelectorAll('.obj-item').forEach((el, i) => {
    const sel = S.objectives.includes(i);
    const locked = !sel && count >= 3;
    el.classList.toggle('selected', sel);
    el.classList.toggle('locked', locked);
    const box = el.querySelector('.obj-box');
    box.innerHTML = sel ? SVG.check : '';
  });
  const btn = document.getElementById('btn-obj');
  if (btn) btn.disabled = count === 0;
}

function submitObjectives() {
  if (S.objectives.length === 0) return;
  S.step = 'quiz'; S.q = 0; render();
}

function pick(i) {
  const q = QUESTIONS[S.q];
  if (q.type === 'multiselect') {
    const set = S.answers[S.q] instanceof Set ? S.answers[S.q] : new Set();
    S.answers[S.q] = set;
    set.has(i) ? set.delete(i) : set.add(i);
    updateQuizUI();
  } else {
    clearCountdown();
    clearAutoAdvance();
    S.answers[S.q] = i;
    updateQuizUI();
    const isLast = S.q === QUESTIONS.length - 1;
    // Timer mémorisé : un clic sur « Suivant » pendant les 380 ms doit
    // l'annuler, sinon on avance deux fois (question sautée / double envoi).
    _advTimer = setTimeout(() => { _advTimer = null; isLast ? finish() : next(); }, 380);
  }
}

/* ── Auto-avance ── */
let _advTimer = null;
function clearAutoAdvance() {
  if (_advTimer) { clearTimeout(_advTimer); _advTimer = null; }
}

function updateQuizUI() {
  const q = QUESTIONS[S.q];
  const ans = S.answers[S.q];
  document.querySelectorAll('.opt').forEach((el, i) => {
    const sel = q.type === 'multiselect'
      ? (ans instanceof Set && ans.has(i))
      : ans === i;
    el.classList.toggle('selected', sel);
    const marker = el.querySelector('.opt-marker');
    const isIdk = q.options[i] && q.options[i].idk === true;
    const letter = String.fromCharCode(65 + i);
    marker.textContent = isIdk ? '?' : (sel ? (q.type === 'multiselect' ? '✓' : letter) : letter);
  });
  const btn = document.getElementById('btn-nxt');
  if (btn) btn.disabled = !isAnswered(S.q);
}

/* ── COUNTDOWN ── */
let _cdTimer = null;
const CD_SECS = 30;

function startCountdown() {
  clearCountdown();
  const isLast = S.q === QUESTIONS.length - 1;
  let secs = CD_SECS;

  function tick() {
    const btn = document.getElementById('btn-nxt');
    if (!btn) { clearCountdown(); return; }

    // Onglet masqué (email, autre fenêtre…) : on suspend le compte à
    // rebours au lieu d'imposer « Je ne sais pas » en absence.
    if (document.hidden) return;

    if (secs <= 0) {
      clearCountdown();
      const idkIdx = QUESTIONS[S.q].options.findIndex(o => o.idk === true);
      if (idkIdx !== -1) S.answers[S.q] = idkIdx;
      if (isLast) { S.step = 'results'; render(); submitResults(); }
      else        { S.q++; render(); }
      return;
    }

    const urgent = secs <= 5;
    const label  = isLast ? 'Voir mes résultats 🎯' : 'Suivant';
    btn.innerHTML = `${label} <span class="cd-secs${urgent ? ' urgent' : ''}">· ${secs}s</span>`;
    btn.classList.toggle('btn-cd', true);
    btn.classList.toggle('cd-urgent', urgent);
    btn.style.backgroundSize = `${Math.round((secs / CD_SECS) * 100)}% 100%`;
    secs--;
  }

  tick();
  _cdTimer = setInterval(tick, 1000);
}

function clearCountdown() {
  if (_cdTimer) { clearInterval(_cdTimer); _cdTimer = null; }
}

function next() {
  clearCountdown();
  clearAutoAdvance();
  if (!isAnswered(S.q)) return;
  S.q++;
  render();
}

function prev() {
  clearCountdown();
  clearAutoAdvance();
  if (S.q === 0) { goto('objectives'); return; }
  S.q--;
  render();
}

function finish() {
  clearCountdown();
  clearAutoAdvance();
  if (!isAnswered(S.q)) return;
  S.step = 'results';
  render();
  submitResults();
}

async function submitResults() {
  // Anti double-envoi (clic + auto-avance simultanés).
  if (S.submitted) return;
  S.submitted = true;

  const score   = totalScore();
  const profile = getProfile(score);
  const payload = {
    ...(QUIZ.extraPayload || {}),
    firstName:  S.user.firstName,
    lastName:   S.user.lastName,
    email:      S.user.email,
    company:    S.user.company,
    role:       S.user.role || '',
    score,
    maxScore:   MAX_SCORE,
    profile:    profile.name,
    objectives: S.objectives.map(i => OBJECTIVES[i]),
    answers:    QUESTIONS.map((q, i) => ({
      id:       q.id,
      theme:    q.theme,
      question: q.question,
      answer:   answerLabel(i),
      score:    getScore(i, S.answers[i]),
      maxScore: Math.max(...q.options.map(o => o.score)),
    })),
  };

  // 3 tentatives avec pause croissante ; avant, un échec était silencieux
  // et les résultats du stagiaire étaient perdus sans que personne le sache.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(QUIZ.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        try { localStorage.removeItem(QUIZ.pendingKey); } catch (_) {}
        return;
      }
    } catch (_) { /* réseau : on retente */ }
    if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
  }

  try { localStorage.setItem(QUIZ.pendingKey, JSON.stringify(payload)); } catch (_) {}
  S.submitted = false;
  showToast("L'envoi de tes résultats a échoué — vérifie ta connexion et préviens ton formateur.", 'fail');
}

function toggleCorr(i) {
  const card = document.getElementById('cc-' + i);
  const body = document.getElementById('cb-' + i);
  card.classList.toggle('open');
  body.style.display = card.classList.contains('open') ? 'block' : 'none';
}

/* ════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════ */

render();
