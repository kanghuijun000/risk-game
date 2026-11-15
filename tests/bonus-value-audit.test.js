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

test("focused bonus valuation audit: active loss-reduction and safe-positive menu effects", { timeout: 180000 }, () => {
  const api = loadBalanceEngine(0x6a09e667);
  const rows = [];
  for (const mode of [2, 3]) {
    const base = summarizeMenus(api, { stake: 10000, mode, samples: 2500, seed: 0x12340000 + mode });
    const lossBonus = summarizeMenus(api, { stake: 10000, mode, reduceLossTurns: 5, samples: 2500, seed: 0x12340000 + mode });
    const safeBase = summarizeMenus(api, { stake: 10000, mode, safeBoost: false, samples: 2500, seed: 0x43210000 + mode });
    const safeBoost = summarizeMenus(api, { stake: 10000, mode, safeBoost: true, samples: 2500, seed: 0x43210000 + mode });
    rows.push({
      mode, base, lossBonus,
      lossBonusLiftRandom: lossBonus.randomPickEV - base.randomPickEV,
      lossBonusLiftBest: lossBonus.bestEV - base.bestEV,
      safeBase, safeBoost,
      safePositiveLiftPerTurnRandom: safeBoost.randomPickEV - safeBase.randomPickEV,
      safePositiveTenTurnGrossValue: (safeBoost.randomPickEV - safeBase.randomPickEV) * 10
    });
  }
  console.log("FOCUSED_BONUS_AUDIT_JSON=" + JSON.stringify(rows));
});
