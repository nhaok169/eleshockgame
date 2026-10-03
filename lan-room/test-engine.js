'use strict';
const e = require('./engine');
const g = e.createGame();
let r;

r = e.tick(g, 'idle', 'idle');
if (g.hour !== 1 || r.event.revealed) throw new Error('idle idle');

g.hour = 3;
r = e.tick(g, 'sleep', 'scout');
if (g.a.todaySleep !== 0 || !r.event.aInterrupted || g.a.shocks !== 1) throw new Error('A sleep B scout');

const g2 = e.createGame();
g2.hour = 3;
e.tick(g2, 'idle', 'sleep');
e.tick(g2, 'scout', 'sleep');
if (g2.b.todaySleep !== 1 || g2.hour !== 5) throw new Error('4:00 shock +1');

const g3 = e.createGame();
g3.a.todaySleep = 0; g3.a.T = 6; g3.hour = 18;
g3.b.todaySleep = 6;
r = e.tick(g3, 'idle', 'scout');
if (!r.event.aForced || !r.event.aInterrupted || e.checkForced(g3.a, 19)) throw new Error('force let go');

const g4 = e.createGame();
g4.a.todaySleep = 8;
r = e.tick(g4, 'sleep', 'idle');
if (r.event.aAct !== 'idle') throw new Error('cap');

if (e.computeT(6) !== 8 || e.computeT(7) !== 6) throw new Error('T');

const v = e.playerView(g2, 'A', {
  waitingYou: true, waitingFoe: false, youLocked: false, foeLocked: true,
  standingYou: 0, autoSleepYou: false, logs: [],
});
if (v.you.shocks !== 0) throw new Error('view seat');
if (v.foe.lastRevealed !== 'sleep') throw new Error('revealed last');

console.log('engine ok');
