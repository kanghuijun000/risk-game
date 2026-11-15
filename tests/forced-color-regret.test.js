"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBalanceEngine } = require("./balance-simulation-helpers");

function chooseByStrategy(ranked, strategy, api) {
  if (strategy === "random") {
    return ranked[Math.floor(api.random() * ranked.length)];
  }
  if (strategy === "lowestRisk") {
    return ranked.reduce((a, b) => b.profile.riskScore < a.profile.riskScore ? b : a);
  }
  if (strategy === "mediumRisk") {
    return ranked.reduce((a, b) => {
      const da = Math.abs(a.profile.tier - 1);
      const db = Math.abs(b.profile.tier - 1);
      return db < da || (db === da && b.ev > a.ev) ? b : a;
    });
  }
  return ranked.reduce((a, b) => b.ev > a.ev ? b : a);
}

test("강제 색상 패널티의 실제 메뉴 선택권 손실을 모드·판돈·보너스별 측정한다", { timeout: 300000 }, () => {
  const api = loadBalanceEngine(0x71c0ffee);
  const stakes = [10000, 100000];
  const modes = [2, 3];
  const bonusStates = [0, 5];
  const strategies = ["random", "lowestRisk", "mediumRisk", "highestEV"];
  const samples = 400;
  const rows = [];

  for (const stake of stakes) {
    for (const mode of modes) {
      for (const reduceLossTurns of bonusStates) {
        const accumulators = Object.fromEntries(strategies.map(strategy => [
          strategy, { regrets: [], unrestrictedEV: 0, forcedEV: 0 }
        ]));
        api.setSeed((0x13572468 + stake * 19 + mode * 1009 + reduceLossTurns * 65537) >>> 0);

        for (let i = 0; i < samples; i++) {
          const choices = api.generateChoices(
            null, mode, false, stake, stake, reduceLossTurns
          );
          const ranked = choices.map((choice, index) => ({
            choice,
            index,
            ev: api.estimateChoiceValue(
              choice, stake, stake, reduceLossTurns, mode
            ),
            profile: api.getChoiceRiskProfile(
              choice, stake, stake, reduceLossTurns, mode
            )
          }));
          const forcedIndex = Math.floor(api.random() * ranked.length);
          const forcedPick = ranked[forcedIndex];

          for (const strategy of strategies) {
            const unrestrictedPick = chooseByStrategy(ranked, strategy, api);
            const item = accumulators[strategy];
            item.regrets.push(unrestrictedPick.ev - forcedPick.ev);
            item.unrestrictedEV += unrestrictedPick.ev;
            item.forcedEV += forcedPick.ev;
          }
        }

        for (const strategy of strategies) {
          const item = accumulators[strategy];
          const sorted = item.regrets.slice().sort((a, b) => a - b);
          const mean = sorted.reduce((sum, value) => sum + value, 0) / samples;
          const positiveMean = sorted.reduce((sum, value) => sum + Math.max(0, value), 0) / samples;
          rows.push({
            stake, mode, reduceLossTurns, strategy, n: samples,
            meanOpportunityCostPct: Number(mean.toFixed(4)),
            meanPositiveOpportunityCostPct: Number(positiveMean.toFixed(4)),
            medianPct: Number(sorted[Math.floor(samples * 0.5)].toFixed(4)),
            p95Pct: Number(sorted[Math.floor(samples * 0.95)].toFixed(4)),
            unrestrictedMeanEV: Number((item.unrestrictedEV / samples).toFixed(4)),
            forcedColorMeanEV: Number((item.forcedEV / samples).toFixed(4)),
            configuredEquivalentCostPct: Number((api.getForcedColorEquivalentCost(mode) * 100).toFixed(4))
          });
        }
      }
    }
  }

  console.log("\\nFORCED_COLOR_OPPORTUNITY_COST_JSON=" + JSON.stringify(rows));
  assert.equal(rows.length, stakes.length * modes.length * bonusStates.length * strategies.length);
  assert.ok(rows.every(row =>
    Number.isFinite(row.meanOpportunityCostPct) &&
    Number.isFinite(row.p95Pct)
  ));
});
