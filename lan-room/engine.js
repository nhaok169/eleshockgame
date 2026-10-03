'use strict';

const MAX_SHOCK = 15;
const TOTAL_HOURS = 720;
const SLEEP_CAP = 8;

function mkAgent(name) {
  return {
    name,
    shocks: 0,
    consec: 0,
    todaySleep: 0,
    totalSleep: 0,
    sleepCount: 0,
    inSleep: false,
    T: 6,
  };
}

function createGame() {
  return {
    hour: 0,
    over: false,
    winner: null,
    resultText: '',
    a: mkAgent('A'),
    b: mkAgent('B'),
    dayEvents: [],
    archive: [],
  };
}

function checkForced(agent, h) {
  if (agent.todaySleep >= SLEEP_CAP) return false;
  return (24 - h) + agent.todaySleep === agent.T;
}

function computeT(yesterdaySleep) {
  if (yesterdaySleep === null || yesterdaySleep === undefined) return 6;
  return yesterdaySleep <= 6 ? 8 : 6;
}

function p2(n) {
  return String(n).padStart(2, '0');
}

function actLabel(a) {
  return a === 'sleep' ? '睡' : a === 'scout' ? '探' : a === 'idle' ? '呆' : '—';
}

function pad(s, n) {
  return String(s).padEnd(n, ' ');
}

function agentOf(game, seat) {
  return seat === 'A' ? game.a : game.b;
}

function resolveAct(agent, intent, h) {
  const forced = checkForced(agent, h);
  let act = forced ? 'sleep' : intent;
  let usedForced = forced;
  if (act === 'sleep' && agent.todaySleep >= SLEEP_CAP) {
    act = 'idle';
    usedForced = false;
  }
  return { act, forced: usedForced };
}

function settleSleep(agent, act, interrupted) {
  let gained = 0;
  if (act === 'sleep') {
    if (!interrupted) {
      agent.todaySleep++;
      agent.totalSleep++;
      gained = 1;
      if (!agent.inSleep) {
        agent.sleepCount++;
        agent.inSleep = true;
      }
    } else {
      agent.inSleep = false;
    }
  } else {
    agent.inSleep = false;
  }
  return gained;
}

function tick(game, aIntent, bIntent) {
  if (game.over) return null;

  const h = game.hour % 24;
  const a = game.a;
  const b = game.b;

  const aRes = resolveAct(a, aIntent, h);
  const bRes = resolveAct(b, bIntent, h);
  let aAct = aRes.act;
  let bAct = bRes.act;

  const ev = {
    h,
    aIntent,
    bIntent,
    aAct: null,
    bAct: null,
    aForced: aRes.forced,
    bForced: bRes.forced,
    aInterrupted: false,
    bInterrupted: false,
    aShock: 0,
    bShock: 0,
    aSleep: 0,
    bSleep: 0,
    revealed: false,
  };

  ev.revealed = aAct === 'scout' || bAct === 'scout';

  if (aAct === 'scout' && bAct === 'scout') {
    /* 双方探查，无事 */
  } else if (bAct === 'scout' && aAct === 'sleep') {
    a.shocks++; ev.aShock = 1; ev.aInterrupted = true;
  } else if (bAct === 'scout' && aAct === 'idle') {
    b.shocks++; ev.bShock = 1;
  } else if (aAct === 'scout' && bAct === 'sleep') {
    b.shocks++; ev.bShock = 1; ev.bInterrupted = true;
  } else if (aAct === 'scout' && bAct === 'idle') {
    a.shocks++; ev.aShock = 1;
  }

  a.consec = ev.aShock ? a.consec + 1 : 0;
  b.consec = ev.bShock ? b.consec + 1 : 0;

  ev.aSleep = settleSleep(a, aAct, ev.aInterrupted);
  ev.bSleep = settleSleep(b, bAct, ev.bInterrupted);

  ev.aAct = aAct;
  ev.bAct = bAct;
  game.dayEvents.push(ev);

  game.hour++;

  let dayRecap = null;
  if (a.shocks >= MAX_SHOCK || b.shocks >= MAX_SHOCK) {
    game.over = true;
    if (a.shocks >= MAX_SHOCK && b.shocks >= MAX_SHOCK) {
      game.winner = 'draw';
      game.resultText = '双方同时被电满 15 次 —— 平局。';
    } else if (a.shocks >= MAX_SHOCK) {
      game.winner = 'B';
      game.resultText = 'A 累计被电满 15 次。B 获胜。';
    } else {
      game.winner = 'A';
      game.resultText = 'B 累计被电满 15 次。A 获胜。';
    }
  } else if (game.hour >= TOTAL_HOURS) {
    game.over = true;
    if (game.hour % 24 === 0) dayRecap = snapshotDay(game);
    if (a.shocks < b.shocks) {
      game.winner = 'A';
      game.resultText = `720 小时结束。A 被电 ${a.shocks} 次，B 被电 ${b.shocks} 次 —— A 获胜。`;
    } else if (b.shocks < a.shocks) {
      game.winner = 'B';
      game.resultText = `720 小时结束。A 被电 ${a.shocks} 次，B 被电 ${b.shocks} 次 —— B 获胜。`;
    } else {
      game.winner = 'draw';
      game.resultText = `720 小时结束。双方各被电 ${a.shocks} 次 —— 平局。`;
    }
  } else if (game.hour % 24 === 0) {
    dayRecap = snapshotDay(game);
    endDay(game);
  }

  return { event: ev, dayRecap, over: game.over, winner: game.winner, resultText: game.resultText };
}

function snapshotDay(game) {
  const dayNum = game.hour / 24;
  const rec = {
    day: dayNum,
    events: game.dayEvents.slice(),
    aSleep: game.a.todaySleep,
    bSleep: game.b.todaySleep,
    aT: game.a.T,
    bT: game.b.T,
    aShocks: game.a.shocks,
    bShocks: game.b.shocks,
    aConsec: game.a.consec,
    bConsec: game.b.consec,
    aSessions: game.a.sleepCount,
    bSessions: game.b.sleepCount,
    aTotal: game.a.totalSleep,
    bTotal: game.b.totalSleep,
  };
  game.archive.push(rec);
  return rec;
}

function endDay(game) {
  const newAT = computeT(game.a.todaySleep);
  const newBT = computeT(game.b.todaySleep);
  game.a.T = newAT;
  game.b.T = newBT;
  game.a.todaySleep = 0;
  game.b.todaySleep = 0;
  game.dayEvents = [];
}

function linesForSeat(ev, seat, game) {
  const me = seat === 'A' ? 'a' : 'b';
  const opp = seat === 'A' ? 'b' : 'a';
  const youAgent = game[me];
  const oppAgent = game[opp];
  const lines = [];

  const youLab = actLabel(ev[me + 'Act']) + (ev[me + 'Forced'] ? '[强制]' : '');
  const oppLab = ev.revealed
    ? actLabel(ev[opp + 'Act']) + (ev[opp + 'Forced'] ? '[强制]' : '')
    : '?';
  const kind = ev[me + 'Shock'] ? 'hurt' : ev[opp + 'Shock'] ? 'hit' : 'dim';
  lines.push({ text: `${p2(ev.h)}:00 · 你=${youLab}  对方=${oppLab}`, kind });

  if (ev[me + 'Shock']) {
    lines.push({ text: `   ⚡ 你被电 +1（累计 ${youAgent.shocks}/15）`, kind: 'hurt' });
  }
  if (ev[opp + 'Shock']) {
    lines.push({ text: `   ⚡ 对方被电 +1（累计 ${oppAgent.shocks}/15）`, kind: 'hit' });
  }
  if (ev[me + 'Interrupted']) {
    if (ev[me + 'Forced']) {
      lines.push({ text: '   ⚠ 强制睡眠被电醒，本小时 +0。下一整点不再满足 == T，系统放手。', kind: 'warn' });
    } else {
      lines.push({ text: `   ⚠ 你被电醒，本小时 +0，请在 ${p2((ev.h + 1) % 24)}:00 重新选择`, kind: 'hurt' });
    }
  }
  if (ev[opp + 'Interrupted'] && ev.revealed && ev[opp + 'Forced']) {
    lines.push({ text: '   ⚠ 对方的强制睡眠被打断', kind: 'warn' });
  }
  if (ev[me + 'Forced'] && !ev[me + 'Interrupted']) {
    lines.push({ text: '   ⚠ 死线强制：系统覆盖你的意图为睡眠', kind: 'warn' });
  }
  return lines;
}

function recapLinesForSeat(recap, seat, gameAfterReset) {
  const me = seat === 'A' ? 'a' : 'b';
  const opp = seat === 'A' ? 'b' : 'a';
  const lines = [];
  const dayNum = recap.day;
  lines.push({ text: '', kind: '' });
  lines.push({ text: `━━━ 第 ${dayNum} 天 · 复盘 ━━━`, kind: 'day' });
  lines.push({ text: '时间    你     对方   结算', kind: 'dim' });
  lines.push({ text: '─────────────────────────────────────────', kind: 'hr' });

  for (const ev of recap.events) {
    const youMark = actLabel(ev[me + 'Act']) + (ev[me + 'Forced'] ? '*' : '');
    const oppMark = ev.revealed
      ? actLabel(ev[opp + 'Act']) + (ev[opp + 'Forced'] ? '*' : '')
      : '?';
    const result = [];
    if (ev[me + 'Shock']) result.push('你被电+1');
    if (ev[opp + 'Shock']) result.push('对方被电+1');
    if (!result.length) result.push('—');
    lines.push({
      text: `${p2(ev.h)}:00   ${pad(youMark, 6)} ${pad(oppMark, 6)} ${result.join('，')}`,
      kind: 'dim',
    });
  }

  lines.push({ text: '（* = 死线强制；对方列 ? = 未被探查揭示）', kind: 'dim' });
  lines.push({ text: '', kind: '' });

  const youSleep = recap[me + 'Sleep'];
  const youShockDay = recap.events.reduce((s, e) => s + e[me + 'Shock'], 0);
  const oppShockDay = recap.events.reduce((s, e) => s + e[opp + 'Shock'], 0);
  const youShocks = recap[me + 'Shocks'];
  const oppShocks = recap[opp + 'Shocks'];
  const newT = computeT(youSleep);

  lines.push({ text: `▸ 你今日睡眠 ${youSleep}h，被电 ${youShockDay} 次，累计 ${youShocks}/15`, kind: 'dim' });
  lines.push({ text: `▸ 对方今日被电 ${oppShockDay} 次，累计 ${oppShocks}/15（对方睡眠不对你公开）`, kind: 'dim' });
  lines.push({
    text: `▸ 你昨日睡眠 ${youSleep}h → 新一天 T = ${newT}h${youSleep <= 6 ? '（≤6h，需补觉）' : ''}`,
    kind: 'dim',
  });
  lines.push({ text: `━━━ 第 ${dayNum + 1} 天 · 开始 ━━━`, kind: 'day' });
  lines.push({ text: '', kind: '' });
  return lines;
}

function lastRevealedOpp(game, seat) {
  const opp = seat === 'A' ? 'b' : 'a';
  for (let i = game.dayEvents.length - 1; i >= 0; i--) {
    const ev = game.dayEvents[i];
    if (ev.revealed) return ev[opp + 'Act'];
  }
  return null;
}

function playerView(game, seat, extras) {
  const me = seat === 'A' ? 'a' : 'b';
  const opp = seat === 'A' ? 'b' : 'a';
  const you = game[me];
  const foe = game[opp];
  const h = game.hour % 24;
  const day = Math.floor(game.hour / 24) + 1;
  const dayShow = game.hour >= TOTAL_HOURS ? 30 : Math.min(day, 30);
  const forcedNext = !game.over && checkForced(you, h);

  const timeline = game.dayEvents.map((ev) => ({
    h: ev.h,
    act: ev[me + 'Act'],
    forced: ev[me + 'Forced'],
    shock: ev[me + 'Shock'],
    sleep: ev[me + 'Sleep'],
  }));

  return {
    seat,
    hour: game.hour,
    clock: `${p2(h)}:00`,
    day: dayShow,
    over: game.over,
    winner: game.winner,
    resultText: game.resultText,
    you: {
      shocks: you.shocks,
      T: you.T,
      todaySleep: you.todaySleep,
      totalSleep: you.totalSleep,
      sleepCount: you.sleepCount,
      consec: you.consec,
      forcedNext,
    },
    foe: {
      shocks: foe.shocks,
      lastRevealed: lastRevealedOpp(game, seat),
    },
    timeline,
    waitingYou: extras.waitingYou,
    waitingFoe: extras.waitingFoe,
    youLocked: extras.youLocked,
    foeLocked: extras.foeLocked,
    standingYou: extras.standingYou,
    autoSleepYou: extras.autoSleepYou,
    logs: extras.logs,
  };
}

function godView(game, extras) {
  const h = game.hour % 24;
  const day = Math.floor(game.hour / 24) + 1;
  return {
    hour: game.hour,
    clock: `${p2(h)}:00`,
    day: Math.min(day, 30),
    over: game.over,
    winner: game.winner,
    resultText: game.resultText,
    a: { ...game.a },
    b: { ...game.b },
    events: game.dayEvents,
    archive: game.archive,
    pending: extras.pending,
    standing: extras.standing,
    seatsOnline: extras.seatsOnline,
  };
}

module.exports = {
  MAX_SHOCK,
  TOTAL_HOURS,
  SLEEP_CAP,
  createGame,
  checkForced,
  computeT,
  tick,
  agentOf,
  playerView,
  godView,
  linesForSeat,
  recapLinesForSeat,
  p2,
  actLabel,
};
