"use strict";

const test = require("node:test");
const { loadBalanceEngine } = require("./balance-simulation-helpers");

function summarizeMenus(api, { stake, mode, reduceLossTurns = 0, safeBoost = false, samples = 2500, seed }) {
  api.setSeed(seed);
  const totals = { meanOptionEV: 0, randomPickEV: 0, bestEV: 0, lowestRiskEV: 0, highRiskShare: 0 };
  let optionCount = 0;
  for (let i = 0; i < samples; i++) {
    const choices = api.generateChoices(null, mode, safeBoost, stake, stake, reduceLossTurns);
    const ranked = choices.map(choice => ({
      ev: api.estimateChoiceValue(choice, stake, stake, reduceLossTurns, mode),
      risk: api.getChoiceRiskProfile(choice, stake, stake, reduceLossTurns, mode)
    }));
    if (!ranked.length) continue;
    for (const item of ranked) {
      totals.meanOptionEV += item.ev;
      optionCount++;
    }
    totals.randomPickEV += ranked.reduce((sum, item) => sum + item.ev, 0) / ranked.length;
    totals.bestEV += Math.max(...ranked.map(item => item.ev));
    totals.lowestRiskEV += ranked.reduce((a, b) => b.risk.riskScore < a.risk.riskScore ? b : a).ev;
    totals.highRiskShare += ranked.filter(item => item.risk.tier === 2).length / ranked.length;
  }
  return {
    stake, mode, reduceLossTurns, safeBoost, samples,
    meanOptionEV: totals.meanOptionEV / Math.max(1, optionCount),
    randomPickEV: totals.randomPickEV / samples,
    bestEV: totals.bestEV / samples,
    lowestRiskEV: totals.lowestRiskEV / samples,
    highRiskShare: totals.highRiskShare / samples
  };
}

test("safe-positive weight sweep: mode-specific future value by generation strategy", { timeout: 180000 }, () => {
  const multipliers = [1.5, 3, 5, 8, 12, 20, 35];
  const rows = [];
  for (const multiplier of multipliers) {
    const api = loadBalanceEngine(0x6a09e667, { safeBoostMultiplier: multiplier });
    for (const mode of [2, 3]) {
      const base = summarizeMenus(api, {
        stake: 10000, mode, safeBoost: false, samples: 500,
        seed: 0x43210000 + mode
      });
      const boosted = summarizeMenus(api, {
        stake: 10000, mode, safeBoost: true, samples: 500,
        seed: 0x43210000 + mode
      });
      rows.push({
        multiplier, mode,
        randomLift: boosted.randomPickEV - base.randomPickEV,
        bestStrategyLift: boosted.bestEV - base.bestEV,
        lowestRiskLift: boosted.lowestRiskEV - base.lowestRiskEV,
        tenTurnRandomValue: (boosted.randomPickEV - base.randomPickEV) * 10,
        highRiskShareBase: base.highRiskShare,
        highRiskShareBoosted: boosted.highRiskShare
      });
    }
  }
  console.log("SAFE_POSITIVE_MULTIPLIER_SWEEP_JSON=" + JSON.stringify(rows));
});
