/* Request-a-Transfer catch-up test, as an assertion. Runs the two paired-seed
 * arms (transfers OFF vs ON) from stack_ranked_manager_switch_test.js and asserts
 * the causal verdict — being able to switch away from a punishing early boss must
 * materially lift the stuck cohort's win share and final rung.
 *
 * Full human-facing printout:
 *   node stack_ranked_manager_switch_test.js 1000   (or: npm run sim:transfer)
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const ms = require('../stack_ranked_manager_switch_test.js');

const VARIANT = 'race-to-ceo';
const G = 400; // games per arm; paired seeds => the only difference is the mechanic

test('Request-a-Transfer lets a badly-managed cohort catch up', { timeout: 90000 }, async () => {
  const A = await ms.runArm(true, G, VARIANT, ms.BASE_SEED);   // transfers DISABLED
  const B = await ms.runArm(false, G, VARIANT, ms.BASE_SEED);  // transfers ON (same seeds)
  const v = ms.verdict(A, B);

  assert.ok(v.lift > 0.05,
    `switching barely moved the bad cohort's win share (lift ${(100 * v.lift).toFixed(1)}pp)`);
  assert.ok(v.relInc >= 1.4,
    `bad-cohort win share should rise >=1.4x with transfers on (got ${v.relInc.toFixed(2)}x)`);
  assert.ok(v.rungLift > 0.3,
    `bad-cohort avg final rung barely improved (lift ${v.rungLift.toFixed(2)})`);
  assert.ok(v.causal, 'causal catch-up verdict failed — inspect `node stack_ranked_manager_switch_test.js`');
});
