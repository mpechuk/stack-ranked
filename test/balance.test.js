/* Balance regression tests — assert the Monte-Carlo harness's design invariants
 * instead of eyeballing its printed tables. Drives the REAL engine (game.js) via
 * the exported `runCell` from stack_ranked_montecarlo.js.
 *
 * The harness is seeded (mulberry32 over Math.random), so for a fixed
 * (ruleset, N, seed) every metric is exactly reproducible run-to-run. The
 * thresholds below are ranges with margin: they encode the current design
 * intent (well-balanced, burnout-taxed, comeback-friendly, always ends via a
 * real CEO promotion) and are wide enough to tolerate benign card/AI tweaks
 * while still catching a genuine balance regression.
 *
 * Full human-facing sweep (all 6 rulesets + player-count sanity, big N):
 *   node stack_ranked_montecarlo.js 3000        (or: npm run sim:balance)
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const mc = require('../stack_ranked_montecarlo.js');

const VARIANT = 'race-to-ceo';
const N = 400; // ~0.4s/ruleset; stable & deterministic at this size

// Run the DISTINCT (5 archetypes) + MIRROR (all-balanced) cells for a ruleset,
// exactly as the CLI does, and fold into a flat metrics object.
async function cells(rulesKey) {
  const rules = mc.RULESETS[rulesKey];
  const d = await mc.runCell(mc.distinctFactory, rules, VARIANT, N, mc.SEEDS.distinct);
  const m = await mc.runCell(mc.mirrorFactory, rules, VARIANT, N, mc.SEEDS.mirror);
  const bs = mc.balanceStats(d.winsByArch, d.nGames);
  return {
    balSD: +bs.sdPct,
    ceoDistinct: d.pctCeo,
    ceoMirror: m.pctCeo,
    avgRounds: d.avgRounds,
    crisesPerGame: d.crisesPerGame,
    endBurnAvg: d.endBurnAvg,
    selfcarePerGame: d.selfcarePerGame,
    comebackBottomHalf: m.pctWinnerBottomHalf,
    runaway: m.pctMidLeaderWon
  };
}

test('recommended ruleset stays well-balanced', { timeout: 60000 }, async () => {
  const r = await cells('recommended');
  // Hard invariant: every race-to-CEO game ends via a real CEO promotion.
  assert.strictEqual(r.ceoDistinct, 100, 'distinct cell must be 100% CEO endings');
  assert.strictEqual(r.ceoMirror, 100, 'mirror cell must be 100% CEO endings');
  // Archetype balance: post-burnout the field is flat (~3.6pp here). Well under
  // the pre-burnout ~8.6pp — reverting per-Project burnout would spike this.
  assert.ok(r.balSD < 5.5, `balSD too high (${r.balSD}pp) — archetype balance regressed`);
  // Pacing sanity.
  assert.ok(r.avgRounds >= 25 && r.avgRounds <= 42, `avgRounds out of band (${r.avgRounds.toFixed(1)})`);
});

test('recommended ruleset keeps Burnout a live constraint', { timeout: 60000 }, async () => {
  const r = await cells('recommended');
  // Every Project inflicts Burnout on completion — that roughly doubled Crises
  // (~2.4 -> ~5/game) and Self-Care. If per-Project burnout were removed these
  // collapse back toward the baseline and these assertions fail.
  assert.ok(r.crisesPerGame > 3.5, `too few Burnout Crises (${r.crisesPerGame.toFixed(2)}/game) — is per-Project burnout still applied?`);
  assert.ok(r.endBurnAvg > 3.5, `avg end Burnout too low (${r.endBurnAvg.toFixed(2)})`);
  assert.ok(r.selfcarePerGame > 45, `Self-Care usage too low (${r.selfcarePerGame.toFixed(1)}/game)`);
});

test('recommended ruleset stays comeback-friendly (not a runaway game)', { timeout: 60000 }, async () => {
  const r = await cells('recommended');
  // Mirror (all-balanced) games: leads are pure luck, so these isolate rubber-banding.
  assert.ok(r.comebackBottomHalf > 25, `comeback too low (${r.comebackBottomHalf.toFixed(1)}%)`);
  assert.ok(r.runaway < 40, `runaway-leader rate too high (${r.runaway.toFixed(1)}%)`);
});

test('base game (both variant rules off) is healthy', { timeout: 60000 }, async () => {
  const r = await cells('baseline');
  assert.strictEqual(r.ceoDistinct, 100, 'distinct cell must be 100% CEO endings');
  assert.ok(r.balSD < 5.5, `balSD too high (${r.balSD}pp)`);
  // Per-Project burnout is core (not a variant), so Crises stay elevated even
  // with the Feedback/Collaboration variants disabled.
  assert.ok(r.crisesPerGame > 3.5, `too few Burnout Crises (${r.crisesPerGame.toFixed(2)}/game) with variants off`);
});
