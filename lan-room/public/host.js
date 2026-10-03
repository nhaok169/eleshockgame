(function () {
  const urlsEl = document.getElementById('urls');
  const hint = document.getElementById('copyHint');
  let links = { A: '', B: '' };

  function p2(n) { return String(n).padStart(2, '0'); }
  function actLabel(a) {
    return a === 'sleep' ? '睡' : a === 'scout' ? '探' : a === 'idle' ? '呆' : '—';
  }

  function originFrom(ip, port) {
    return 'http://' + ip + ':' + port;
  }

  async function loadHello() {
    const res = await fetch('/api/hello');
    const data = await res.json();
    const host = location.hostname;
    const port = data.port;
    const ips = (data.ips && data.ips.length) ? data.ips : (host !== 'localhost' && host !== '127.0.0.1' ? [host] : []);
    const blocks = [];
    const use = ips.length ? ips : ['请看电脑终端里的局域网 IP'];
    for (const ip of use) {
      const base = ip.indexOf('请看') === 0 ? '' : originFrom(ip, port);
      if (base) {
        links.A = base + '/play.html?seat=A';
        links.B = base + '/play.html?seat=B';
        blocks.push(
          `<div class="urlbox">A　${links.A}</div>` +
          `<div class="urlbox">B　${links.B}</div>`
        );
      } else {
        blocks.push(`<div class="urlbox">${ip}</div>`);
      }
    }
    urlsEl.innerHTML = blocks.join('') || '<div class="urlbox">未能探测局域网 IP，请看运行 node 的终端。</div>';
  }

  async function copy(which) {
    const url = links[which];
    if (!url) { hint.textContent = '还没有可用链接'; return; }
    try {
      await navigator.clipboard.writeText(url);
      hint.textContent = '已复制座位 ' + which + ' 链接';
    } catch (e) {
      hint.textContent = url;
    }
  }

  function paintTimeline(root, events, who, hour, over) {
    const byH = Array(24).fill(null);
    for (const ev of events || []) byH[ev.h] = ev;
    const h = hour % 24;
    root.innerHTML = '';
    for (let i = 0; i < 24; i++) {
      const cell = document.createElement('div');
      cell.className = 'slot';
      if (i === h && !over) cell.classList.add('now');
      const ev = byH[i];
      const act = ev && ev[who + 'Act'];
      if (act) {
        cell.classList.add('act-' + act);
        if (ev[who + 'Forced']) cell.classList.add('forced');
        if (ev[who + 'Shock']) cell.classList.add('shocked');
      }
      cell.innerHTML = `<span>${p2(i)}</span><span class="dot"></span>`;
      root.appendChild(cell);
    }
  }

  function lockText(seat, view) {
    if (view.over) return '已结束';
    const st = view.standing[seat];
    const pe = view.pending[seat];
    if (st > 0) return '睡眠中 · 剩余 ' + st + 'h';
    if (pe) return '已锁定（' + actLabel(pe.action) + (pe.action === 'sleep' ? ' ' + pe.hours + 'h' : '') + '）';
    const agent = seat === 'A' ? view.a : view.b;
    const h = view.hour % 24;
    if (agent.todaySleep < 8 && (24 - h) + agent.todaySleep === agent.T) return '强制睡眠（自动）';
    return '等待锁定';
  }

  function render(view) {
    document.getElementById('day').textContent = 'DAY ' + p2(view.day);
    document.getElementById('clock').textContent = view.clock;
    document.getElementById('progress').textContent = view.hour + ' / 720 h';

    document.getElementById('onlineA').innerHTML = (view.seatsOnline.A ? '<i class="dot-on"></i>在线' : '<i class="dot-off"></i>离线');
    document.getElementById('onlineB').innerHTML = (view.seatsOnline.B ? '<i class="dot-on"></i>在线' : '<i class="dot-off"></i>离线');
    document.getElementById('lockA').textContent = lockText('A', view);
    document.getElementById('lockB').textContent = lockText('B', view);

    document.getElementById('godStats').innerHTML = `
      <div class="gstat"><div class="gk">A 死线 T</div><div class="gv">${view.a.T}h</div></div>
      <div class="gstat"><div class="gk">A 今日睡眠</div><div class="gv">${view.a.todaySleep}h / 8h</div></div>
      <div class="gstat"><div class="gk">B 死线 T</div><div class="gv">${view.b.T}h</div></div>
      <div class="gstat"><div class="gk">B 今日睡眠</div><div class="gv">${view.b.todaySleep}h / 8h</div></div>
      <div class="gstat"><div class="gk">A 累计被电</div><div class="gv">${view.a.shocks}/15</div></div>
      <div class="gstat"><div class="gk">B 累计被电</div><div class="gv">${view.b.shocks}/15</div></div>
      <div class="gstat"><div class="gk">A 连续被电</div><div class="gv">${view.a.consec}</div></div>
      <div class="gstat"><div class="gk">B 连续被电</div><div class="gv">${view.b.consec}</div></div>
    `;

    paintTimeline(document.getElementById('tlB'), view.events, 'b', view.hour, view.over);
    paintTimeline(document.getElementById('tlA'), view.events, 'a', view.hour, view.over);

    const rows = [`<thead><tr>
      <th>整点</th><th>A 意图</th><th>A 实际</th><th>A 睡眠</th>
      <th>B 意图</th><th>B 实际</th><th>B 睡眠</th>
      <th>揭示</th><th>电击</th>
    </tr></thead><tbody>`];
    const byH = Array(24).fill(null);
    for (const ev of view.events || []) byH[ev.h] = ev;
    const h = view.hour % 24;
    for (let i = 0; i < 24; i++) {
      const ev = byH[i];
      if (!ev) {
        if (i === h && !view.over) {
          rows.push(`<tr><td>${p2(i)}:00</td><td colspan="8">等待结算</td></tr>`);
        }
        continue;
      }
      const shock = [ev.aShock ? 'A+1' : '', ev.bShock ? 'B+1' : ''].filter(Boolean).join(' ') || '—';
      rows.push(`<tr class="${(ev.aShock || ev.bShock) ? 'shock' : ''}">
        <td>${p2(ev.h)}:00</td>
        <td>${actLabel(ev.aIntent)}</td>
        <td>${actLabel(ev.aAct)}${ev.aForced ? '*' : ''}</td>
        <td>${ev.aSleep ? '+1' : (ev.aAct === 'sleep' ? '+0' : '—')}</td>
        <td>${actLabel(ev.bIntent)}</td>
        <td>${actLabel(ev.bAct)}${ev.bForced ? '*' : ''}</td>
        <td>${ev.bSleep ? '+1' : (ev.bAct === 'sleep' ? '+0' : '—')}</td>
        <td>${ev.revealed ? '是' : '否'}</td>
        <td>${shock}</td>
      </tr>`);
    }
    rows.push('</tbody>');
    document.getElementById('godTable').innerHTML = rows.join('');
  }

  async function pull() {
    const res = await fetch('/api/host');
    const data = await res.json();
    render(data.view);
  }

  document.getElementById('btnCopyA').onclick = () => copy('A');
  document.getElementById('btnCopyB').onclick = () => copy('B');
  document.getElementById('btnReset').onclick = async () => {
    if (!confirm('重置本局并清空双方日志？')) return;
    await fetch('/api/reset', { method: 'POST' });
    await pull();
  };
  document.getElementById('btnKickA').onclick = async () => {
    await fetch('/api/kick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seat: 'A' }) });
    await pull();
  };
  document.getElementById('btnKickB').onclick = async () => {
    await fetch('/api/kick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seat: 'B' }) });
    await pull();
  };

  loadHello().catch((e) => { hint.textContent = e.message; });
  pull().catch((e) => { hint.textContent = e.message; });
  setInterval(() => pull().catch(() => {}), 700);
})();
