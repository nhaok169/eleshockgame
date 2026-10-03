'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { URL } = require('url');
const engine = require('./engine');

const PORT = Number(process.env.PORT) || 8766;
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function lanIPs() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      const family = n.family === 'IPv4' || n.family === 4;
      if (family && !n.internal) out.push(n.address);
    }
  }
  return out;
}

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function token() {
  return crypto.randomBytes(12).toString('hex');
}

function bootLogs() {
  return [
    { text: '════ 系统启动 · 双人房 ════', kind: 'day' },
    { text: '第 1 天 00:00 · 你的死线 T = 6h（第 1 天无前日数据）', kind: 'dim' },
    { text: '规则：昨天睡眠 ≤ 6h → 今天 T = 8h；否则 T = 6h。每日上限 8h。', kind: 'dim' },
    { text: '双方先锁定本小时意图，收齐后同时结算。对方未探查动作显示 ?。', kind: 'dim' },
    { text: '睡眠可一次锁定 1–8h，被电醒或满 8h 后重新选择。', kind: 'dim' },
    { text: '', kind: '' },
  ];
}

function newRoom() {
  return {
    game: engine.createGame(),
    seq: 1,
    seats: {
      A: { token: null, seen: 0 },
      B: { token: null, seen: 0 },
    },
    pending: { A: null, B: null },
    standing: { A: 0, B: 0 },
    logs: { A: bootLogs(), B: bootLogs() },
  };
}

let room = newRoom();

function bump() {
  room.seq++;
}

function appendLogs(seat, lines) {
  if (!lines || !lines.length) return;
  room.logs[seat].push(...lines);
}

function intentOf(seat) {
  if (room.game.over) return 'idle';
  const agent = engine.agentOf(room.game, seat);
  const h = room.game.hour % 24;
  if (room.standing[seat] > 0) return 'sleep';
  if (engine.checkForced(agent, h)) return 'sleep';
  if (room.pending[seat]) return room.pending[seat].action;
  return null;
}

function waiting(seat) {
  if (room.game.over) return false;
  return intentOf(seat) === null;
}

function tryResolve() {
  if (room.game.over) return;
  let guard = 0;
  while (!room.game.over && guard++ < 48) {
    const aIntent = intentOf('A');
    const bIntent = intentOf('B');
    if (!aIntent || !bIntent) break;

    const result = engine.tick(room.game, aIntent, bIntent);
    if (!result) break;

    for (const seat of ['A', 'B']) {
      const ev = result.event;
      const interrupted = seat === 'A' ? ev.aInterrupted : ev.bInterrupted;
      const act = seat === 'A' ? ev.aAct : ev.bAct;
      if (room.standing[seat] > 0) {
        if (interrupted || act !== 'sleep') room.standing[seat] = 0;
        else room.standing[seat]--;
      }
      room.pending[seat] = null;
      appendLogs(seat, engine.linesForSeat(ev, seat, room.game));
      if (result.dayRecap) {
        appendLogs(seat, engine.recapLinesForSeat(result.dayRecap, seat, room.game));
      }
      if (result.over && result.resultText) {
        appendLogs(seat, [
          { text: '', kind: '' },
          { text: result.resultText, kind: result.winner === seat ? 'hit' : result.winner === 'draw' ? 'dim' : 'hurt' },
        ]);
      }
    }
    bump();
  }
}

function extrasFor(seat) {
  const agent = engine.agentOf(room.game, seat);
  const h = room.game.hour % 24;
  const autoSleep = !room.game.over && room.standing[seat] === 0 && !room.pending[seat] && engine.checkForced(agent, h);
  return {
    waitingYou: waiting(seat),
    waitingFoe: waiting(seat === 'A' ? 'B' : 'A'),
    youLocked: !waiting(seat) && !room.game.over,
    foeLocked: !waiting(seat === 'A' ? 'B' : 'A') && !room.game.over,
    standingYou: room.standing[seat],
    autoSleepYou: autoSleep,
    logs: room.logs[seat],
  };
}

function online(seat) {
  return Date.now() - room.seats[seat].seen < 8000 && !!room.seats[seat].token;
}

function hostPayload() {
  return engine.godView(room.game, {
    pending: {
      A: room.pending.A,
      B: room.pending.B,
    },
    standing: { ...room.standing },
    seatsOnline: { A: online('A'), B: online('B') },
  });
}

function authSeat(seat, tok) {
  if (seat !== 'A' && seat !== 'B') return false;
  return room.seats[seat].token && room.seats[seat].token === tok;
}

async function handleApi(req, res, url) {
  const route = url.pathname;

  if (req.method === 'GET' && route === '/api/hello') {
    const ips = lanIPs();
    return json(res, 200, {
      port: PORT,
      ips,
      seq: room.seq,
      over: room.game.over,
    });
  }

  if (req.method === 'POST' && route === '/api/join') {
    const body = await readBody(req);
    const seat = body.seat === 'A' ? 'A' : body.seat === 'B' ? 'B' : null;
    if (!seat) return json(res, 400, { error: '座位必须是 A 或 B' });
    const existing = room.seats[seat];
    if (body.token && existing.token === body.token) {
      existing.seen = Date.now();
      return json(res, 200, { token: existing.token, seat, seq: room.seq });
    }
    const stale = !existing.token || Date.now() - existing.seen > 20000;
    if (existing.token && !stale) {
      return json(res, 409, { error: `座位 ${seat} 已有人。让对方退出，或在裁判席踢人。` });
    }
    existing.token = token();
    existing.seen = Date.now();
    bump();
    return json(res, 200, { token: existing.token, seat, seq: room.seq });
  }

  if (req.method === 'GET' && route === '/api/view') {
    const seat = url.searchParams.get('seat');
    const tok = url.searchParams.get('token') || '';
    if (!authSeat(seat, tok)) return json(res, 401, { error: '座位凭证无效，请重新加入。' });
    room.seats[seat].seen = Date.now();
    tryResolve();
    return json(res, 200, {
      seq: room.seq,
      view: engine.playerView(room.game, seat, extrasFor(seat)),
    });
  }

  if (req.method === 'POST' && route === '/api/lock') {
    const body = await readBody(req);
    const seat = body.seat;
    if (!authSeat(seat, body.token)) return json(res, 401, { error: '座位凭证无效。' });
    if (room.game.over) return json(res, 400, { error: '本局已结束。' });
    if (!waiting(seat)) {
      tryResolve();
      return json(res, 200, { ok: true, seq: room.seq, skipped: true });
    }
    const action = body.action;
    if (action !== 'sleep' && action !== 'idle' && action !== 'scout') {
      return json(res, 400, { error: '动作只能是 sleep / idle / scout' });
    }
    let hours = 1;
    if (action === 'sleep') {
      hours = parseInt(body.hours, 10);
      if (!(hours >= 1 && hours <= 8)) hours = 1;
      room.standing[seat] = hours;
    } else {
      room.standing[seat] = 0;
    }
    room.pending[seat] = { action, hours };
    room.seats[seat].seen = Date.now();
    bump();
    tryResolve();
    return json(res, 200, { ok: true, seq: room.seq });
  }

  if (req.method === 'GET' && route === '/api/host') {
    tryResolve();
    return json(res, 200, { seq: room.seq, view: hostPayload() });
  }

  if (req.method === 'POST' && route === '/api/reset') {
    room = newRoom();
    return json(res, 200, { ok: true, seq: room.seq });
  }

  if (req.method === 'POST' && route === '/api/kick') {
    const body = await readBody(req);
    const seat = body.seat === 'A' ? 'A' : body.seat === 'B' ? 'B' : null;
    if (!seat) return json(res, 400, { error: '座位必须是 A 或 B' });
    room.seats[seat] = { token: null, seen: 0 };
    room.pending[seat] = null;
    room.standing[seat] = 0;
    bump();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'not found' });
}

function serveStatic(req, res, url) {
  let file = url.pathname;
  if (file === '/') file = '/index.html';
  const abs = path.normalize(path.join(PUBLIC, file));
  if (!abs.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('未找到页面');
    }
    const ext = path.extname(abs);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    json(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanIPs();
  console.log('');
  console.log('  局域网双人房已启动（手机不用装 App，用浏览器打开即可）');
  console.log('');
  console.log('  裁判席（建议电脑打开）');
  console.log(`    http://127.0.0.1:${PORT}/host.html`);
  console.log('');
  if (!ips.length) {
    console.log('  未检测到局域网 IP。确认 Wi‑Fi 已连接后再重启。');
  } else {
    for (const ip of ips) {
      console.log(`  大厅     http://${ip}:${PORT}/`);
      console.log(`  手机 A   http://${ip}:${PORT}/play.html?seat=A`);
      console.log(`  手机 B   http://${ip}:${PORT}/play.html?seat=B`);
      console.log('');
    }
  }
  console.log('  电脑不要休眠。防火墙若弹出，允许局域网访问。');
  console.log('  按 Ctrl+C 结束。');
  console.log('');
});
