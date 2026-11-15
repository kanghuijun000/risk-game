"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBalanceEngine } = require("./balance-simulation-helpers");

function incomeTier(choice, money) {
  const gross = choice.amountEffect != null
    ? Number(choice.amountEffect) / Math.max(1, money) * 100
    : Number(choice.effect) || 0;
  if (gross <= 2) return 0;
  if (gross <= 10) return 1;
  return 2;
}

test("선택지 등장 분포: 판돈·모드별 위험도와 수익 규모의 실제 조합", { timeout: 180000 }, () => {
  const api = loadBalanceEngine(0x4d595df4);
  const rows = [];
  const stakes = [1000, 5000, 10000, 100000, 1000000];
  const samples = 300;

  for (const stake of stakes) {
    for (const mode of [2, 3]) {
      const riskCounts = [0, 0, 0];
      const incomeCounts = [0, 0, 0];
      const riskIncomeMatrix = Array.from({ length: 3 }, () => [0, 0, 0]);
      const menusByPosition = Array.from({ length: mode }, () => ({
        risk: [0, 0, 0], income: [0, 0, 0]
      }));
      const allIncomeTierMenus = [0, 0, 0, 0];
      const riskPairCounts = new Map();
      const menuRiskTierCounts = [0, 0, 0, 0];
      const choiceCounts = new Map();

      api.setSeed((0x31415926 + stake * 13 + mode * 65537) >>> 0);
      for (let n = 0; n < samples; n++) {
        const choices = api.generateChoices(null, mode, false, stake, stake, 0);
        const menuRisk = new Set();
        const menuIncome = new Set();
        const menuRiskList = [];
        for (let position = 0; position < choices.length; position++) {
          const choice = choices[position];
          const risk = api.getChoiceRiskProfile(choice, stake, stake, 0, mode).tier;
          const income = incomeTier(choice, stake);
          riskCounts[risk]++;
          incomeCounts[income]++;
          riskIncomeMatrix[risk][income]++;
          menusByPosition[position].risk[risk]++;
          menusByPosition[position].income[income]++;
          menuRisk.add(risk);
          menuRiskList.push(risk);
          menuIncome.add(income);
          choiceCounts.set(choice.id, (choiceCounts.get(choice.id) || 0) + 1);
        }
        allIncomeTierMenus[menuIncome.size]++;
        menuRiskTierCounts[menuRisk.size]++;
        const pairKey = menuRiskList.slice().sort((a,b)=>a-b).join("-");
        riskPairCounts.set(pairKey, (riskPairCounts.get(pairKey) || 0) + 1);
      }

      rows.push({
        stake, mode, menus: samples,
        riskTierSharePct: riskCounts.map(x => Number((x / (samples * mode) * 100).toFixed(1))),
        incomeTierSharePct: incomeCounts.map(x => Number((x / (samples * mode) * 100).toFixed(1))),
        riskIncomeMatrix: riskIncomeMatrix.map(row => row.map(x => Number((x / (samples * mode) * 100).toFixed(1)))),
        menusWithOneTwoThreeIncomeTiers: allIncomeTierMenus.slice(1).map(x => Number((x / samples * 100).toFixed(1))),
        menusWithOneTwoThreeRiskTiers: menuRiskTierCounts.slice(1).map(x => Number((x / samples * 100).toFixed(1))),
        riskTierPairSharePct: Object.fromEntries([...riskPairCounts.entries()].map(([k,v]) => [k, Number((v / samples * 100).toFixed(1))])),
        positions: menusByPosition.map(x => ({
          risk: x.risk.map(v => Number((v / samples * 100).toFixed(1))),
          income: x.income.map(v => Number((v / samples * 100).toFixed(1)))
        })),
        mostFrequentChoices: [...choiceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      });
    }
  }

  console.log("\\nCHOICE_DISTRIBUTION_JSON=" + JSON.stringify(rows));
  if (rows.length !== stakes.length * 2) throw new Error("incomplete distribution matrix");
  for (const row of rows.filter(item => item.mode === 2)) {
    for (const pair of ["0-1", "0-2", "1-2"]) {
      assert.ok(
        row.riskTierPairSharePct[pair] > 0,
        `two-choice mode must generate risk-tier pair ${pair} at stake ${row.stake}`
      );
    }
  }
});
