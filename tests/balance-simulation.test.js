"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBalanceEngine } = require("./balance-simulation-helpers");

function wilsonInterval(successes, n) {
  const z = 1.96;
  const p = successes / n;
  const d = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / d;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

function simulateSession(api, { stake, choiceCount, strategy, maxTurns, seed }) {
  api.setSeed(seed);
  let money = stake;
  let reduceLossTurns = 0;
  let safePositiveTurns = 0;
  let forcedColor = null;
  let choices = api.generateChoices(null, choiceCount, false, money, stake, reduceLossTurns);
  let turns = 0;
  let maxBalance = money;
  let maxDrawdown = 0;
  let rerolls = 5;
  let rerollsUsed = 0;

  const colors = ["blue", "red", "green"];
  while (turns < maxTurns && money > 0 && choices.length) {
    let available = choices
      .map((choice, index) => ({ choice, index, color: colors[index] }))
      .filter(item => !forcedColor || item.color === forcedColor);
    if (!available.length) break;

    const rank = item => ({
      ...item,
      profile: api.getChoiceRiskProfile(
        item.choice, money, stake, reduceLossTurns, choiceCount
      ),
      ev: api.estimateChoiceValue(
        item.choice, money, stake, reduceLossTurns, choiceCount
      ),
      gross: item.choice.amountEffect != null
        ? Number(item.choice.amountEffect) / Math.max(1, money) * 100
        : Number(item.choice.effect) || 0
    });

    let ranked = available.map(rank);
    if (strategy === "rerollAware" && rerolls > 0) {
      const bestScore = Math.max(...ranked.map(item => item.ev));
      if (bestScore < -0.04) {
        const oldChoices = choices;
        const newChoices = api.generateChoices(
          choices, choiceCount, safePositiveTurns > 0, money, stake, reduceLossTurns
        );
        if (newChoices.length === choiceCount &&
            newChoices.some(item => !oldChoices.some(old => old.id === item.id))) {
          choices = newChoices;
          rerolls--;
          rerollsUsed++;
          available = choices
            .map((choice, index) => ({ choice, index, color: colors[index] }))
            .filter(item => !forcedColor || item.color === forcedColor);
          ranked = available.map(rank);
        }
      }
    }

    let picked;
    if (strategy === "random") {
      picked = ranked[Math.floor(api.random() * ranked.length)];
    } else if (strategy === "lowestRisk") {
      picked = ranked.reduce((a, b) => b.profile.riskScore < a.profile.riskScore ? b : a);
    } else if (strategy === "highestReward") {
      picked = ranked.reduce((a, b) => b.gross > a.gross ? b : a);
    } else {
      picked = ranked.reduce((a, b) => b.ev > a.ev ? b : a);
    }

    const choice = picked.choice;
    const before = money;
    forcedColor = null;
    turns++;

    money = api.getMoneyAfterChoiceEffect(choice, money);
    if (money <= 0) break;

    const details = api.getEffectivePenaltyDetails(
      choice, before, stake, reduceLossTurns, choiceCount
    );
    if (api.random() * 100 < details.chance) {
      if (["loss10", "loss25", "loss50", "totalLoss"].includes(details.penaltyType)) {
        money = api.getMoneyAfterPenalty(money, details.penaltyType);
      } else if (["forceBlue", "forceRed", "forceGreen"].includes(details.penaltyType)) {
        forcedColor = details.penaltyType.slice(5).toLowerCase();
      }
    }
    if (money <= 0) break;

    if (reduceLossTurns > 0) reduceLossTurns--;
    if (safePositiveTurns > 0) safePositiveTurns--;
    if (choice.bonusType === "reduceLoss") {
      reduceLossTurns = Math.min(10, Math.max(reduceLossTurns, choice.bonusTurns || 5));
    }
    if (choice.bonusType === "safePositive") {
      safePositiveTurns = Math.min(10, Math.max(safePositiveTurns, choice.bonusTurns || 10));
    }

    maxBalance = Math.max(maxBalance, money);
    maxDrawdown = Math.max(maxDrawdown, (maxBalance - money) / Math.max(1, maxBalance));
    choices = api.generateChoices(
      choices, choiceCount, safePositiveTurns > 0, money, stake, reduceLossTurns
    );
  }

  return {
    final: money,
    turns,
    ruin: money <= 0,
    returnPct: (money / stake - 1) * 100,
    maxDrawdown,
    rerollsUsed
  };
}

test("stateful Monte Carlo: 판돈·선택 모드·전략별 20턴 결과", { timeout: 240000 }, () => {
  const api = loadBalanceEngine(0x7a11ce55);
  const stakes = [1000, 5000, 10000, 100000, 1000000];
  const modes = [2, 3];
  const strategies = ["random", "lowestRisk", "highestEV", "rerollAware"];
  const sessionsPerCell = 250;
  const rows = [];

  for (const stake of stakes) {
    for (const choiceCount of modes) {
      for (const strategy of strategies) {
        const results = [];
        for (let i = 0; i < sessionsPerCell; i++) {
          const seed = (
            0x9e3779b9 + stake * 17 + choiceCount * 100003 +
            strategies.indexOf(strategy) * 10000019 + i * 7919
          ) >>> 0;
          results.push(simulateSession(api, {
            stake, choiceCount, strategy, maxTurns: 20, seed
          }));
        }

        const returns = results.map(item => item.returnPct).sort((a, b) => a - b);
        const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
        const sd = Math.sqrt(
          returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
          Math.max(1, returns.length - 1)
        );
        const ruinCount = results.filter(item => item.ruin).length;
        const meanTurns = results.reduce((sum, item) => sum + item.turns, 0) / results.length;
        const avgDrawdown = results.reduce((sum, item) => sum + item.maxDrawdown, 0) / results.length;
        const q = p => returns[Math.floor((returns.length - 1) * p)];
        rows.push({
          stake, mode: choiceCount, strategy, n: sessionsPerCell,
          meanReturnPct: Number(mean.toFixed(2)),
          meanSE: Number((sd / Math.sqrt(sessionsPerCell)).toFixed(2)),
          medianReturnPct: Number(q(0.5).toFixed(2)),
          p10ReturnPct: Number(q(0.1).toFixed(2)),
          p90ReturnPct: Number(q(0.9).toFixed(2)),
          ruinPct: Number((ruinCount / sessionsPerCell * 100).toFixed(1)),
          ruinCI95: wilsonInterval(ruinCount, sessionsPerCell).map(v => Number((v * 100).toFixed(1))),
          avgTurns: Number(meanTurns.toFixed(2)),
          avgMaxDrawdownPct: Number((avgDrawdown * 100).toFixed(1)),
          avgRerolls: Number((results.reduce((sum, item) => sum + item.rerollsUsed, 0) / results.length).toFixed(2))
        });
      }
    }
  }

  console.log("\\nSTATEFUL_BALANCE_MONTE_CARLO_JSON=" + JSON.stringify(rows));
  assert.equal(rows.length, stakes.length * modes.length * strategies.length);
  assert.ok(rows.every(row => Number.isFinite(row.meanReturnPct)));
});
