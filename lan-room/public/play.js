(function () {
  const params = new URLSearchParams(location.search);
  const seat = params.get('seat') === 'A' ? 'A' : params.get('seat') === 'B' ? 'B' : null;
  const errEl = document.getElementById('err');
  const statusEl = document.getElementById('waitStatus');

  if (!seat) {
    location.replace('/');
    return;
  }

  document.body.classList.add('seat-' + seat);
  document.getElementById('title').textContent = '智能体 ' + seat + '（你）';
  document.title = '作息博弈 · ' + seat;

  const storageKey = 'sleep-gambit-seat-' + seat;
  let token = localStorage.getItem(storageKey) || '';
  let lastSeq = -1;
  let busy = false;

  function p2(n) { return String(n).padStart(2, '0'); }
  function actLabel(a) {
    return a === 'sleep' ? '睡' : a === 'scout' ? '探' : a === 'idle' ? '呆' : '未知';
  }

  function setErr(msg) { errEl.textContent = msg || ''; }

  async function join() {
    const res = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seat, token }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '加入失败');
    token = data.token;
    localStorage.setItem(storageKey, token);
  }

  async function lock(action) {
    if (busy) return;
    busy = true;
    setErr('');
    try {
      const hours = parseInt(document.getElementById('sleepDur').value, 10);
      const res = await fetch('/api/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seat, token, action, hours }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '锁定失败');
      await pull();
    } catch (e) {
      setErr(e.message);
    } finally {
      busy = false;
    }
  }

  function fillPips(el, n) {
    el.innerHTML = '';
    for (let i = 0; i < 15; i++) {
      const d = document.createElement('i');
      if (i < n) d.className = 'on';
      el.appendChild(d);
    }
  }

  function paintTimeline(events, hour, over) {
    const root = document.getElementById('timeline');
    const byH = Array(24).fill(null);
    for (const ev of events || []) byH[ev.h] = ev;
    const h = hour % 24;
    root.innerHTML = '';
    for (let i = 0; i < 24; i++) {
      const cell = document.createElement('div');
      cell.className = 'slot';
      if (i === h && !over) cell.classList.add('now');
      const ev = byH[i];
      if (ev && ev.act) {
        cell.classList.add('act-' + ev.act);
        if (ev.forced) cell.classList.add('forced');
        if (ev.shock) cell.classList.add('shocked');
      }
      cell.innerHTML = `<span>${p2(i)}</span><span class="dot"></span>`;
      root.appendChild(cell);
    }
  }

  function renderLog(logs) {
    const box = document.getElementById('log');
    box.innerHTML = '';
    for (const line of logs || []) {
      const el = document.createElement('div');
      el.className = 'logline ' + (line.kind || '');
      el.textContent = line.text;
      box.appendChild(el);
    }
    box.scrollTop = box.scrollHeight;
  }

  function render(view) {
    document.getElementById('day').textContent = 'DAY ' + p2(view.day);
    document.getElementById('clock').textContent = view.clock;
    document.getElementById('progress').textContent = view.hour + ' / 720 h';

    paintTimeline(view.timeline, view.hour, view.over);
    document.getElementById('you-shocks').textContent = view.you.shocks;
    fillPips(document.getElementById('you-pips'), view.you.shocks);
    document.getElementById('you-T').textContent = view.you.T + 'h';
    document.getElementById('you-total').textContent = view.you.totalSleep + 'h';
    document.getElementById('you-sessions').textContent = view.you.sleepCount;
    document.getElementById('you-consec').textContent = view.you.consec;
    document.getElementById('foe-shocks').textContent = view.foe.shocks + ' / 15';

    const st = document.getElementById('you-status');
    if (view.you.forcedNext) { st.textContent = '强制昏睡'; st.className = 'v bad'; }
    else if (view.you.todaySleep >= view.you.T) { st.textContent = '已达标'; st.className = 'v ok'; }
    else if (view.you.todaySleep > 0) { st.textContent = '进行中'; st.className = 'v warn'; }
    else { st.textContent = '正常'; st.className = 'v ok'; }

    const pct = Math.min(view.you.todaySleep / Math.max(view.you.T, 1) * 100, 100);
    document.getElementById('you-fill').style.width = pct + '%';
    document.getElementById('you-sleeptext').textContent =
      `今日睡眠 ${view.you.todaySleep}h / T=${view.you.T}h（上限 8h）`;
    document.getElementById('foe-act').textContent = view.foe.lastRevealed
      ? actLabel(view.foe.lastRevealed)
      : '未知';

    const hint = document.getElementById('forceHint');
    hint.textContent = view.you.forcedNext
      ? '下一整点满足死线公式，系统将覆盖你的意图为睡眠。'
      : '';

    let status = '';
    let cls = 'status';
    if (view.over) {
      status = view.resultText || '本局已结束';
      cls += view.winner === seat ? ' ok' : ' bad';
    } else if (view.autoSleepYou) {
      status = '系统强制睡眠中，等待对方锁定。';
    } else if (view.standingYou > 0) {
      status = `睡眠站立指令剩余 ${view.standingYou}h，等待对方。`;
    } else if (view.waitingYou) {
      status = view.foeLocked
        ? '对方已锁定。请选择你的动作（看不到对方选了什么）。'
        : '等待你锁定本小时意图。';
    } else {
      status = view.waitingFoe ? '已锁定，等待对方锁定。' : '结算中…';
      cls += ' ok';
    }
    statusEl.className = cls;
    statusEl.textContent = status;

    const disabled = view.over || !view.waitingYou;
    document.querySelectorAll('#controls button, #controls select').forEach((el) => {
      el.disabled = disabled;
    });

    renderLog(view.logs);
  }

  async function pull() {
    const res = await fetch('/api/view?seat=' + seat + '&token=' + encodeURIComponent(token));
    const data = await res.json();
    if (res.status === 401) {
      localStorage.removeItem(storageKey);
      token = '';
      await join();
      return pull();
    }
    if (!res.ok) throw new Error(data.error || '同步失败');
    if (data.seq !== lastSeq) {
      lastSeq = data.seq;
      render(data.view);
    }
  }

  document.getElementById('btnSleep').onclick = () => lock('sleep');
  document.getElementById('btnIdle').onclick = () => lock('idle');
  document.getElementById('btnScout').onclick = () => lock('scout');

  (async function start() {
    try {
      await join();
      await pull();
      setInterval(() => pull().catch((e) => setErr(e.message)), 700);
    } catch (e) {
      statusEl.className = 'status bad';
      statusEl.textContent = e.message;
      setErr(e.message);
    }
  })();
})();
