/* ============================================================
 * 天问闯关 · 游戏引擎
 * 依赖：questions-a.js / questions-b.js / facts.js（纯数据）
 * ============================================================ */
'use strict';

/* ---------- 数据准备 ---------- */
const LEVELS = BANK_A.concat(BANK_B);
const TOTAL_STARS = LEVELS.length * 3;
const QMAP = {}; // qid -> {lv, q}
LEVELS.forEach(lv => lv.questions.forEach(q => { QMAP[q.id] = { lv, q }; }));

const ACH_DEFS = [
  { id: 'deep1',   icon: '🛰️', t: '深空启程',    d: '通过第 1 关' },
  { id: 'calc5',   icon: '🧮', t: '引力计算师',  d: '单局连续答对 5 题' },
  { id: 'calc8',   icon: '📐', t: '轨道大师',    d: '单局连续答对 8 题' },
  { id: 'perfect', icon: '🎯', t: '深空精准',    d: '任意关卡三星通过' },
  { id: 'tristar', icon: '🌠', t: '深空三连',    d: '累计 3 个关卡获得三星' },
  { id: 'retry',   icon: '💡', t: '永不言败',    d: '失败后重试并成功通关' },
  { id: 'cards12', icon: '📚', t: '深空学者',    d: '收集 12 张知识卡' },
  { id: 'cards24', icon: '🗂️', t: '深空档案员', d: '集齐全部 24 张知识卡' },
  { id: 'wrong0',  icon: '🔍', t: '谜题猎手',    d: '把错题本清空一次' },
  { id: 'half',    icon: '🌌', t: '星系漫游者',  d: '通过第 6 关' },
  { id: 'all',     icon: '👑', t: '少年宇宙学家', d: '通过全部 12 关' },
  { id: 'endless', icon: '🚀', t: '深空船长',    d: '无尽深空得分 ≥ 1500' }
];

const RANKS = [
  [0, '新晋深空学徒'], [2, '轨道骑士'], [5, '星族侦探'], [9, '星系引擎师'],
  [14, '时空领航员'], [20, '宇宙测绘师'], [27, '深空老兵'], [33, '少年宇宙学家']
];

const SAVE_KEY = 'twcg_save_v2';

/* ---------- 存档 ---------- */
let S = null;
function defaultState() {
  return {
    prog: {},                     // 关卡id -> 星数(1-3)
    cards: [],                    // 已拥有的知识卡下标
    wrong: {},                    // 题id -> 累计答错次数
    ach: [],                      // 已解锁成就id
    best: { endless: 0 },
    sound: true,
    retryPending: {},             // 关卡id -> 上次失败待重试
    stats: { answered: 0, correct: 0, bestStreak: 0 }
  };
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const d = Object.assign(defaultState(), JSON.parse(raw));
      // 过滤掉题库更新后已不存在的错题
      Object.keys(d.wrong).forEach(id => { if (!QMAP[id]) delete d.wrong[id]; });
      return d;
    }
  } catch (e) { /* 忽略损坏存档 */ }
  return defaultState();
}
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* 存储不可用时静默 */ }
}

/* ---------- 工具 ---------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function totalStars() {
  return Object.values(S.prog).reduce((s, v) => s + v, 0);
}
function rankName() {
  const t = totalStars();
  let name = RANKS[0][1];
  RANKS.forEach(([min, n]) => { if (t >= min) name = n; });
  return name;
}
function passedCount() { return Object.keys(S.prog).length; }

/* ---------- 音效（WebAudio 合成，无外部资源） ---------- */
const Sfx = {
  ctx: null,
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(f, t0, dur, type, gain) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.12, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  },
  play(name) {
    if (!S || !S.sound) return;
    this.ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (name === 'ok') { this.tone(660, t, 0.1); this.tone(880, t + 0.09, 0.13); }
    else if (name === 'no') { this.tone(200, t, 0.2, 'square', 0.05); this.tone(150, t + 0.1, 0.22, 'square', 0.05); }
    else if (name === 'click') { this.tone(520, t, 0.05, 'sine', 0.05); }
    else if (name === 'star') { [523, 659, 784].forEach((f, i) => this.tone(f, t + i * 0.09, 0.13)); }
    else if (name === 'unlock') { [523, 784, 1046].forEach((f, i) => this.tone(f, t + i * 0.1, 0.15)); }
  }
};

/* ---------- 屏幕路由 ---------- */
function showScreen(id) {
  $$('.screen').forEach(el => el.classList.remove('active'));
  $('#screen-' + id).classList.add('active');
  window.scrollTo(0, 0);
}

/* ---------- 浮泡 & 弹层 ---------- */
function toast(msg, cls) {
  const el = document.createElement('div');
  el.className = 'toast' + (cls ? ' ' + cls : '');
  el.innerHTML = msg;
  $('#toast-wrap').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; }, 2300);
  setTimeout(() => el.remove(), 2800);
}
function modal(html, btns) {
  $('#modal-body').innerHTML = html;
  const box = $('#modal-btns');
  box.innerHTML = '';
  btns.forEach(b => {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.cls || 'btn-ghost');
    el.textContent = b.t;
    el.onclick = () => { closeModal(); if (b.fn) b.fn(); };
    box.appendChild(el);
  });
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }

/* ---------- 成就 ---------- */
function unlockAch(id) {
  if (S.ach.includes(id)) return;
  const def = ACH_DEFS.find(a => a.id === id);
  if (!def) return;
  S.ach.push(id);
  save();
  Sfx.play('unlock');
  toast(`🏅 成就解锁：<b>${def.icon} ${def.t}</b>`, 'ach');
}

/* ---------- 首页 ---------- */
function renderHome() {
  $('#stat-rank').textContent = rankName();
  $('#stat-stars').innerHTML = totalStars() + '<span class="stat-m">/' + TOTAL_STARS + '</span>';
  $('#stat-cards').innerHTML = S.cards.length + '<span class="stat-m">/' + FACTS.length + '</span>';
  $('#stat-wrong').textContent = Object.keys(S.wrong).length;
  $('#btn-sound').textContent = S.sound ? '🔊 音效：开' : '🔇 音效：关';
}

/* ---------- 星图 ---------- */
function renderMap() {
  $('#map-stars').textContent = `⭐ ${totalStars()}/${TOTAL_STARS}`;
  $('#map-rank').textContent = `「 ${rankName()} 」`;

  const wrap = $('#levels');
  wrap.innerHTML = '';
  let currentSet = false;
  LEVELS.forEach((lv, i) => {
    const stars = S.prog[lv.id];
    const unlocked = i === 0 || !!S.prog[LEVELS[i - 1].id];
    const node = document.createElement('div');
    node.className = 'level-node' + (unlocked ? '' : ' locked') + (unlocked && !stars && !currentSet ? ' current' : '');
    if (unlocked && !stars) currentSet = true;
    const starHtml = [1, 2, 3].map(n =>
      `<span class="${stars >= n ? 'on' : 'off'}">★</span>`).join('');
    node.innerHTML = `
      <div class="level-ico" style="--dot:${stars ? 'var(--gold)' : 'var(--violet)'}">${unlocked ? lv.icon : '🔒'}</div>
      <div class="level-info">
        <div class="level-name">第 ${i + 1} 站 · ${lv.name}</div>
        <div class="level-sub">${lv.sub} · ${lv.questions.length} 题</div>
      </div>
      <div class="level-stars">${stars ? starHtml : (unlocked ? '' : '')}</div>`;
    node.onclick = () => {
      if (!unlocked) { toast('先通过前面的关卡，才能飞得更远 🚀'); return; }
      Sfx.play('click');
      startLevel(i);
    };
    wrap.appendChild(node);
  });

  // 无尽模式
  const cleared = passedCount();
  const endlessOk = cleared >= 3;
  $('#endless-lock').classList.toggle('hidden', endlessOk);
  $('#btn-endless').classList.toggle('hidden', !endlessOk);
  $('#endless-best').textContent = S.best.endless;
}

/* ---------- 答题会话 ---------- */
let Q = null; // 当前会话

function startLevel(li) {
  const lv = LEVELS[li];
  Q = {
    mode: 'level', li, backTo: 'map', title: lv.name,
    qs: lv.questions.slice(),
    qi: 0, hearts: 3, maxHearts: 3, correct: 0, wrong: 0, streak: 0, score: 0,
    answered: false, newCards: []
  };
  showScreen('quiz');
  renderQ();
}

function startReview() {
  const ids = Object.keys(S.wrong);
  const qs = ids.map(id => QMAP[id] && QMAP[id].q).filter(Boolean);
  if (!qs.length) { toast('错题本是空的，太棒了！🎉'); return; }
  Q = {
    mode: 'review', backTo: 'wrong', title: '错题复习',
    qs: shuffle(qs), qi: 0, hearts: 3, maxHearts: 3,
    correct: 0, wrong: 0, streak: 0, score: 0, answered: false, newCards: []
  };
  showScreen('quiz');
  renderQ();
}

function startEndless() {
  let pool = [];
  LEVELS.forEach(lv => { if (S.prog[lv.id]) pool = pool.concat(lv.questions); });
  if (pool.length < 15) {
    const next = LEVELS.find(lv => !S.prog[lv.id]);
    if (next) pool = pool.concat(next.questions);
  }
  Q = {
    mode: 'endless', backTo: 'map', title: '无尽深空',
    qs: shuffle(pool.slice()).slice(0, 15),
    qi: 0, hearts: 3, maxHearts: 3, correct: 0, wrong: 0, streak: 0, score: 0,
    answered: false, newCards: []
  };
  showScreen('quiz');
  renderQ();
}

function heartsHtml() {
  let h = '';
  for (let i = 0; i < Q.maxHearts; i++) {
    h += i < Q.hearts ? '❤️' : '<span class="lost">❤️</span>';
  }
  return h;
}

function renderQ() {
  const q = Q.qs[Q.qi];
  Q.answered = false;

  $('#q-progress').style.width = (Q.qi / Q.qs.length * 100) + '%';
  $('#hearts').innerHTML = Q.mode === 'review' ? '📖 复习' : heartsHtml();
  $('#q-tag').textContent = q.tag;
  $('#q-diff').textContent = '●'.repeat(q.diff) + '○'.repeat(3 - q.diff);
  $('#q-count').textContent = `${Q.qi + 1}/${Q.qs.length}`;
  $('#q-streak').textContent = Q.streak >= 2 ? `🔥 连对 ${Q.streak}` : '';
  $('#q-title').textContent = q.q;
  $('#quiz-score').classList.toggle('hidden', Q.mode === 'review');
  $('#quiz-score').textContent = Q.mode === 'endless'
    ? `得分 ${Q.score}`
    : `得分 ${Q.score}`;

  const ex = $('#explain');
  ex.classList.add('hidden');

  const opts = $('#opts');
  opts.innerHTML = '';
  opts.classList.remove('locked');
  q.opts.forEach((o, i) => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.innerHTML = `<span class="opt-key">${'ABCD'[i]}</span><span>${o}</span>`;
    b.onclick = () => answer(i);
    opts.appendChild(b);
  });
}

function answer(i) {
  if (Q.answered) return;
  Q.answered = true;
  const q = Q.qs[Q.qi];
  const optsEl = $('#opts');
  optsEl.classList.add('locked');
  const btns = $$('#opts .opt');
  const right = i === q.ans;

  S.stats.answered++;

  if (right) {
    btns[i].classList.add('correct');
    Q.correct++;
    Q.streak++;
    if (Q.mode === 'review') delete S.wrong[q.id]; // 复习答对即清除
    const pts = 100 + Math.min(Q.streak - 1, 5) * 20;
    Q.score += pts;
    S.stats.correct++;
    if (Q.streak > S.stats.bestStreak) S.stats.bestStreak = Q.streak;
    if (Q.streak >= 5) unlockAch('calc5');
    if (Q.streak >= 8) unlockAch('calc8');
    Sfx.play('ok');
    $('#explain-head').textContent = `✅ 答对了！ +${pts} 分`;
    $('#explain-head').className = 'explain-head ok';
  } else {
    btns[i].classList.add('wrong');
    btns[q.ans].classList.add('correct');
    btns.forEach((b, k) => { if (k !== i && k !== q.ans) b.classList.add('dimmed'); });
    Q.wrong++;
    Q.streak = 0;
    S.wrong[q.id] = (S.wrong[q.id] || 0) + 1;
    if (Q.mode !== 'review') Q.hearts = Math.max(0, Q.hearts - 1);
    if (Q.mode !== 'review') $('#hearts').innerHTML = heartsHtml();
    Sfx.play('no');
    $('#explain-head').textContent = `❌ 正确答案是 ${'ABCD'[q.ans]}——记住它，下次就赢了`;
    $('#explain-head').className = 'explain-head no';
  }

  save();

  $('#explain-body').textContent = q.exp;
  $('#explain').classList.remove('hidden');
  $('#explain').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const nb = $('#btn-next');
  if (Q.mode !== 'review' && Q.hearts <= 0) {
    nb.textContent = '看看结果 ›';
  } else if (Q.qi === Q.qs.length - 1) {
    nb.textContent = Q.mode === 'review' ? '完成复习 ›' : '查看成绩 ›';
  } else {
    nb.textContent = '下一题 ›';
  }
}

function next() {
  // 中途心用尽：直接失败结算
  if (Q.mode !== 'review' && Q.hearts <= 0) { showFail(); return; }
  Q.qi++;
  if (Q.qi >= Q.qs.length) { finish(); return; }
  Sfx.play('click');
  renderQ();
}

/* ---------- 结算 ---------- */
function starSpans(n) {
  const box = $('#r-stars');
  box.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const s = document.createElement('span');
    s.textContent = i < n ? '⭐' : '☆';
    box.appendChild(s);
    setTimeout(() => s.classList.add('show'), 250 + i * 330);
  }
}

function resultBtns(list) {
  const box = $('#r-btns');
  box.innerHTML = '';
  list.forEach(b => {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.cls || 'btn-ghost');
    el.innerHTML = b.t;
    el.onclick = b.fn;
    box.appendChild(el);
  });
}

function showFail() {
  Sfx.play('no');
  $('#r-emoji').textContent = Q.mode === 'endless' ? '🌠' : '💫';
  $('#r-title').textContent = Q.mode === 'endless' ? '本次航行结束' : '差一点点！';
  $('#r-stars').innerHTML = '';
  $('#r-line').innerHTML = Q.mode === 'endless'
    ? `答对 ${Q.correct} / ${Q.qs.length} · 得分 <b style="color:var(--gold)">${Q.score}</b><br>无尽深空的最高分：${S.best.endless}`
    : `答对 ${Q.correct} 题 · 用完了 3 颗爱心<br>连天文学家也会犯错——宇宙不会怪你，再来一次！`;
  $('#r-cards').classList.add('hidden');
  if (Q.mode === 'endless' && Q.score > S.best.endless) {
    S.best.endless = Q.score; save();
    toast('🎊 新纪录！' + Q.score + ' 分');
  }
  if (Q.mode === 'level') { S.retryPending[LEVELS[Q.li].id] = true; save(); }
  resultBtns([
    { t: '💪 再试一次', cls: 'btn-primary', fn: () => Q.mode === 'level' ? startLevel(Q.li) : startEndless() },
    { t: '返回星图', fn: () => { renderMap(); showScreen('map'); } }
  ]);
  showScreen('result');
}

function finish() {
  if (Q.mode === 'level') {
    const lv = LEVELS[Q.li];
    const stars = Q.wrong === 0 ? 3 : Q.wrong === 1 ? 2 : 1;
    const prev = S.prog[lv.id] || 0;
    S.prog[lv.id] = Math.max(prev, stars);
    Q.newCards = lv.cards.filter(c => !S.cards.includes(c));
    Q.newCards.forEach(c => S.cards.push(c));

    // 成就
    unlockAch('deep1');
    if (stars === 3) unlockAch('perfect');
    if (Object.values(S.prog).filter(v => v === 3).length >= 3) unlockAch('tristar');
    if (passedCount() >= 6) unlockAch('half');
    if (passedCount() >= LEVELS.length) unlockAch('all');
    if (S.cards.length >= 12) unlockAch('cards12');
    if (S.cards.length >= FACTS.length) unlockAch('cards24');
    if (S.retryPending[lv.id]) { delete S.retryPending[lv.id]; unlockAch('retry'); }
    save();

    const say = { 3: '完美！这一站的知识已经稳稳装进你的脑袋 🌟', 2: '很棒！只差一点点就满分啦，要不要冲三星？', 1: '通过！收好知识卡，休息一下再来刷新纪录吧' };
    $('#r-emoji').textContent = ['🌟', '🎉', '🏆'][stars - 1];
    $('#r-title').textContent = stars === prev && stars === 3 ? '依旧完美！' : '关卡通过！';
    starSpans(stars);
    Sfx.play('star');
    $('#r-line').innerHTML = `答对 ${Q.correct} / ${Q.qs.length} · 得分 ${Q.score}<br>${say[stars]}`;

    if (Q.newCards.length) {
      $('#r-cards').classList.remove('hidden');
      $('#r-cards-list').innerHTML = Q.newCards.map(c =>
        `<span class="mini-card">${FACTS[c].icon} ${FACTS[c].t}</span>`).join('');
    } else {
      $('#r-cards').classList.add('hidden');
    }

    const hasNext = Q.li < LEVELS.length - 1;
    resultBtns([
      ...(hasNext ? [{ t: `下一站：${LEVELS[Q.li + 1].name} ›`, cls: 'btn-primary', fn: () => startLevel(Q.li + 1) }] : []),
      { t: hasNext ? '重打本关冲三星' : '再玩一次本关', fn: () => startLevel(Q.li) },
      { t: '返回星图', fn: () => { renderMap(); showScreen('map'); } }
    ]);
    showScreen('result');
    renderHome();

  } else if (Q.mode === 'endless') {
    const isRecord = Q.score > S.best.endless;
    if (isRecord) S.best.endless = Q.score;
    if (Q.score >= 1500) unlockAch('endless');
    save();
    $('#r-emoji').textContent = '♾️';
    $('#r-title').textContent = isRecord ? '新纪录！' : '无尽深空 · 挑战完成';
    $('#r-stars').innerHTML = '';
    $('#r-line').innerHTML = `答对 ${Q.correct} / ${Q.qs.length} · 得分 <b style="color:var(--gold)">${Q.score}</b><br>历史最高：${S.best.endless}`;
    $('#r-cards').classList.add('hidden');
    Sfx.play('star');
    resultBtns([
      { t: '再来一局', cls: 'btn-primary', fn: startEndless },
      { t: '返回星图', fn: () => { renderMap(); showScreen('map'); } }
    ]);
    showScreen('result');

  } else { // review
    const cleared = Q.correct;
    const remain = Object.keys(S.wrong).length;
    if (remain === 0) unlockAch('wrong0');
    $('#r-emoji').textContent = remain === 0 ? '🧹' : '📖';
    $('#r-title').textContent = '复习完成';
    $('#r-stars').innerHTML = '';
    $('#r-line').innerHTML = `本次清除错题 <b style="color:var(--green)">${cleared}</b> 道<br>` +
      (remain === 0 ? '错题本已全部清空，太厉害了！' : `错题本还剩 ${remain} 道，继续加油！`);
    $('#r-cards').classList.add('hidden');
    resultBtns([
      ...(remain > 0 ? [{ t: '继续复习 ›', cls: 'btn-primary', fn: startReview }] : []),
      { t: '返回错题本', fn: () => { renderWrong(); showScreen('wrong'); } }
    ]);
    showScreen('result');
    renderHome();
  }
}

/* ---------- 图鉴 ---------- */
function renderCards() {
  $('#cards-count').textContent = `${S.cards.length}/${FACTS.length}`;
  const grid = $('#cards-grid');
  grid.innerHTML = '';
  FACTS.forEach((f, i) => {
    const owned = S.cards.includes(i);
    const el = document.createElement('div');
    el.className = 'kcard' + (owned ? '' : ' locked');
    el.innerHTML = owned
      ? `<div class="ki">${f.icon}</div><div class="kt">${f.t}</div>`
      : `<div class="ki">❓</div><div class="kt">通过第 ${Math.floor(i / 2) + 1} 关解锁</div>`;
    if (owned) {
      el.onclick = () => {
        Sfx.play('click');
        modal(`<div style="font-size:44px;text-align:center">${f.icon}</div>
               <div style="font-weight:800;font-size:18px;text-align:center;margin:10px 0">${f.t}</div>${f.d}`,
          [{ t: '收到！', cls: 'btn-primary' }]);
      };
    }
    grid.appendChild(el);
  });
}

/* ---------- 错题本 ---------- */
function renderWrong() {
  const ids = Object.keys(S.wrong);
  $('#wrong-count').textContent = `${ids.length} 道`;
  const body = $('#wrong-body');
  if (!ids.length) {
    body.innerHTML = `<div class="wrong-empty">🎉<br>错题本空空如也<br>保持这份准确率，宇宙为你骄傲！</div>`;
    return;
  }
  let html = '<div class="wrong-list">';
  ids.slice(0, 10).forEach(id => {
    const m = QMAP[id];
    if (m) html += `<div class="wrong-item">${m.q.q}<br><small>出自：${m.lv.name} · 已错 ${S.wrong[id]} 次</small></div>`;
  });
  if (ids.length > 10) html += `<div class="wrong-item" style="text-align:center">…还有 ${ids.length - 10} 道</div>`;
  html += '</div>';
  html += `<button class="btn btn-primary" id="btn-review" style="width:100%">📖 开始复习（答对即清除）</button>`;
  body.innerHTML = html;
  $('#btn-review').onclick = startReview;
}

/* ---------- 成就墙 ---------- */
function renderAch() {
  $('#ach-count').textContent = `${S.ach.length}/${ACH_DEFS.length}`;
  $('#ach-list').innerHTML = ACH_DEFS.map(a => `
    <div class="ach ${S.ach.includes(a.id) ? '' : 'locked'}">
      <div class="ach-ico">${a.icon}</div>
      <div><div class="ach-t">${a.t}</div><div class="ach-d">${a.d}</div></div>
    </div>`).join('');
}

/* ---------- 玩法说明 ---------- */
function showHelp() {
  modal(
`<b>🛰️ 深空远征 · 第二阶段</b>
这是「天问闯关」的第二阶段，建议先完成第一阶段再出发！
① 沿 12 站深空航线闯关：轨道力学、相对论、粒子、恒星解剖、星系引擎、精确宇宙学……
② 每人 3 颗 ❤️，答错扣 1 颗并立刻给出讲解——读懂讲解就是进步；
③ 0 错＝3★、1 错＝2★、2 错以上＝1★，拿到星星就解锁下一站；
④ 通关掉落「深空知识卡」，去图鉴里收集全部 24 张吧；
⑤ 答错的题会进入「错题本」，复习答对即可清除；
⑥ 通过 3 关后解锁「无尽深空」：随机 15 题、3 颗心、冲最高分！

<b>💡 小提示</b>
这一阶段的题目已经逼近天文学的前沿，还藏着一些"动手算一算"的题——
拿张草稿纸再出发，是真正的科学家习惯。电脑上可以用键盘：A/B/C/D 或 1/2/3/4 选择，回车进入下一题。`,
    [{ t: '出发！', cls: 'btn-primary' }]
  );
}

/* ---------- 星空背景 ---------- */
(function starfield() {
  const c = document.getElementById('sky');
  const x = c.getContext('2d');
  let W, H, stars = [], meteor = null;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function make() {
    stars = Array.from({ length: 150 }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.3 + 0.3,
      p: Math.random() * Math.PI * 2,
      s: 0.4 + Math.random() * 1.6,
      hue: Math.random() < 0.12 ? '#ffd9a0' : (Math.random() < 0.5 ? '#cfe4ff' : '#ffffff')
    }));
  }
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    c.width = W * dpr; c.height = H * dpr;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    make();
    if (reduced) drawStatic();
  }
  function drawStatic() {
    x.clearRect(0, 0, W, H);
    stars.forEach(st => {
      x.globalAlpha = 0.7; x.fillStyle = st.hue;
      x.beginPath(); x.arc(st.x, st.y, st.r, 0, 7); x.fill();
    });
    x.globalAlpha = 1;
  }
  function step(t) {
    x.clearRect(0, 0, W, H);
    stars.forEach(st => {
      const a = 0.3 + 0.7 * Math.abs(Math.sin(st.p + t * 0.001 * st.s));
      x.globalAlpha = a; x.fillStyle = st.hue;
      x.beginPath(); x.arc(st.x, st.y, st.r, 0, 7); x.fill();
    });
    if (!meteor && Math.random() < 0.004) {
      meteor = { x: Math.random() * W * 0.8 + W * 0.1, y: Math.random() * H * 0.3, vx: -(4 + Math.random() * 4), vy: 2 + Math.random() * 2, life: 1 };
    }
    if (meteor) {
      x.globalAlpha = Math.min(1, meteor.life);
      x.strokeStyle = '#fff'; x.lineWidth = 1.4;
      x.beginPath();
      x.moveTo(meteor.x, meteor.y);
      x.lineTo(meteor.x - meteor.vx * 7, meteor.y - meteor.vy * 7);
      x.stroke();
      meteor.x += meteor.vx; meteor.y += meteor.vy; meteor.life -= 0.02;
      if (meteor.life <= 0 || meteor.x < -60 || meteor.y > H + 60) meteor = null;
    }
    x.globalAlpha = 1;
    requestAnimationFrame(step);
  }
  window.addEventListener('resize', resize);
  resize();
  if (!reduced) requestAnimationFrame(step);
})();

/* ---------- 事件绑定 ---------- */
function bind() {
  $('#btn-start').onclick = () => { Sfx.play('click'); renderMap(); showScreen('map'); };
  $('#btn-cards').onclick = () => { Sfx.play('click'); renderCards(); showScreen('cards'); };
  $('#btn-wrong').onclick = () => { Sfx.play('click'); renderWrong(); showScreen('wrong'); };
  $('#btn-ach').onclick = () => { Sfx.play('click'); renderAch(); showScreen('ach'); };
  $('#btn-help').onclick = () => { Sfx.play('click'); showHelp(); };
  $('#btn-endless').onclick = () => { Sfx.play('click'); startEndless(); };

  $$('.btn-back[data-to]').forEach(b => {
    b.onclick = () => {
      Sfx.play('click');
      const to = b.dataset.to;
      if (to === 'home') renderHome();
      showScreen(to);
    };
  });

  $('#btn-sound').onclick = () => {
    S.sound = !S.sound;
    save();
    renderHome();
    if (S.sound) Sfx.play('ok');
  };

  $('#btn-reset').onclick = () => {
    modal('确定要清空全部闯关进度吗？<br>星星、知识卡、成就都会重新开始，此操作无法恢复。',
      [
        { t: '取消' },
        { t: '清空重来', cls: 'btn-danger', fn: () => { S = defaultState(); save(); renderHome(); toast('已重置，新的远征开始！🚀'); } }
      ]);
  };

  $('#btn-quit').onclick = () => {
    modal('确定退出本次挑战吗？<br>本关进度不会保存。', [
      { t: '继续答题', cls: 'btn-primary' },
      {
        t: '退出', fn: () => {
          if (Q && Q.mode === 'level') { renderMap(); showScreen('map'); }
          else if (Q && Q.mode === 'review') { renderWrong(); showScreen('wrong'); }
          else { renderMap(); showScreen('map'); }
        }
      }
    ]);
  };

  $('#btn-next').onclick = next;

  // 桌面键盘支持：A-D / 1-4 选择，回车下一题
  document.addEventListener('keydown', e => {
    if (!$('#screen-quiz').classList.contains('active')) return;
    if (e.key === 'Enter' || e.key === 'ArrowRight') { if (Q && Q.answered) next(); return; }
    const map = { a: 0, b: 1, c: 2, d: 3, '1': 0, '2': 1, '3': 2, '4': 3 };
    const k = map[e.key.toLowerCase()];
    if (k !== undefined && Q && !Q.answered) answer(k);
  });
}

/* ---------- 启动 ---------- */
S = load();
renderHome();
bind();
