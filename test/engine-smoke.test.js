/* Engine smoke tests — a headless AI game completes cleanly and the core resource
 * invariants hold. Folds CLAUDE.md §7 rule #8's manual "headless AI game" check
 * into the suite. Also confirms game.js and net.js load as Node modules (the
 * `node --check` step, plus module-init).
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

// Deterministic PRNG so the smoke game is reproducible (same pattern the harnesses use).
let _s = 1;
function installSeed(v) {
  _s = v >>> 0;
  Math.random = function () {
    _s |= 0; _s = (_s + 0x6D2B79F5) | 0;
    let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SR = require('../game.js');

test('game.js and net.js load as Node modules', () => {
  assert.ok(SR && typeof SR.newGame === 'function' && typeof SR.play === 'function');
  const SRNet = require('../net.js');
  assert.ok(SRNet && typeof SRNet.serializeState === 'function', 'net.js pure pieces should load in Node');
});

test('a headless AI game completes with sane final state', { timeout: 30000 }, async () => {
  installSeed(20260716);
  const st = SR.newGame({
    variant: 'race-to-ceo',
    players: [
      { name: 'A', kind: 'ai', archetype: 'grinder' },
      { name: 'B', kind: 'ai', archetype: 'politician' },
      { name: 'C', kind: 'ai', archetype: 'balanced' },
      { name: 'D', kind: 'ai', archetype: 'workaholic' }
    ]
  });
  await SR.play(st, {}); // silent

  const winnerId = st.winnerId || (st.standings && st.standings[0] && st.standings[0].id);
  assert.ok(winnerId, 'game produced no winner');
  assert.ok(st.roundNumber > 0 && st.roundNumber <= 60, `round count out of bounds (${st.roundNumber})`);

  // Core resource invariants (spec §4 / §2 constants).
  st.players.forEach(p => {
    assert.ok(p.burnout >= 0 && p.burnout <= 10, `${p.name} burnout out of [0,10]: ${p.burnout}`);
    assert.ok(p.rung >= 0 && p.rung <= 6, `${p.name} rung out of [0,6]: ${p.rung}`);
    assert.ok(p.careerCapital >= 0, `${p.name} negative Career Capital: ${p.careerCapital}`);
    assert.ok(Array.isArray(p.backlog), `${p.name} backlog missing`);
  });
});

test('long-game variant also completes', { timeout: 30000 }, async () => {
  installSeed(1234567);
  const st = SR.newGame({
    variant: 'long-game',
    players: [
      { name: 'A', kind: 'ai', archetype: 'balanced' },
      { name: 'B', kind: 'ai', archetype: 'cautious' },
      { name: 'C', kind: 'ai', archetype: 'workaholic' }
    ]
  });
  await SR.play(st, {});
  assert.ok(st.standings && st.standings.length === 3, 'long-game should produce final standings');
});
