"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
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

test("실측 보너스 가치와 가격: 손실 감소·안전 양수의 모드별 기대값", { timeout: 240000 }, () => {
  const api = loadBalanceEngine(0x6a09e667);
  const rows = [];
  for (const mode of [2, 3]) {
    const base = summarizeMenus(api, {
      stake: 10000, mode, reduceLossTurns: 0, safeBoost: false,
      samples: 2500, seed: 0x12340000 + mode
    });
    const lossBonus = summarizeMenus(api, {
      stake: 10000, mode, reduceLossTurns: 5, safeBoost: false,
      samples: 2500, seed: 0x12340000 + mode
    });
    const safeBase = summarizeMenus(api, {
      stake: 10000, mode, reduceLossTurns: 0, safeBoost: false,
      samples: 2500, seed: 0x43210000 + mode
    });
    const safeBoost = summarizeMenus(api, {
      stake: 10000, mode, reduceLossTurns: 0, safeBoost: true,
      samples: 2500, seed: 0x43210000 + mode
    });

    const lossChoice = api.SAFE_CHOICES.find(choice => choice.id === "safeBonus5");
    const safeChoice = api.SAFE_CHOICES.find(choice => choice.id === "safeBonus10");
    const preparedLoss = api.prepareChoiceForGeneration(lossChoice, 0, mode, 0);
    const preparedSafe = api.prepareChoiceForGeneration(safeChoice, 0, mode, 0);
    const lossBenefit = (lossBonus.randomPickEV - base.randomPickEV) * 5;
    const safeBenefit = (safeBoost.randomPickEV - safeBase.randomPickEV) * 10;
    const lossNet = lossBenefit + preparedLoss.effect;
    const safeNet = safeBenefit + preparedSafe.effect;

    rows.push({
      mode,
      lossBenefit, lossCost: -preparedLoss.effect, lossNet,
      safeBenefit, safeCost: -preparedSafe.effect, safeNet
    });
    assert.ok(Math.abs(lossNet - api.TARGET_CHOICE_EV_PERCENT) < 0.15,
      `reduce-loss bonus mode ${mode}: net=${lossNet}`);
    assert.ok(Math.abs(safeNet - api.TARGET_CHOICE_EV_PERCENT) < 0.03,
      `safe-positive bonus mode ${mode}: net=${safeNet}`);
    assert.ok(Math.abs(api.estimateChoiceValue(preparedLoss, 10000, 10000, 0, mode) -
      api.TARGET_CHOICE_EV_PERCENT) < 0.02);
    assert.ok(Math.abs(api.estimateChoiceValue(preparedSafe, 10000, 10000, 0, mode, 0) -
      api.TARGET_CHOICE_EV_PERCENT) < 0.02);
  }
  console.log("BONUS_VALUE_FINAL_AUDIT_JSON=" + JSON.stringify(rows));
});
