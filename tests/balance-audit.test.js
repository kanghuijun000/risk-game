"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadBalanceEngine(seed = 0x5eed1234) {
  const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  const arrayStart = source.indexOf("const SAFE_CHOICES =");
  const arrayEnd = source.indexOf("function randomItem(", arrayStart);
  const helperStart = source.indexOf("const CASH_REWARD_REFERENCE_STAKE");
  const helperEnd = source.indexOf("function findChoice(", helperStart);

  assert.ok(arrayStart >= 0 && arrayEnd > arrayStart, "choice arrays must exist");
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "balance helpers must exist");

  const choiceArrays = source.slice(arrayStart, arrayEnd);
  const balanceHelpers = source.slice(helperStart, helperEnd);

  let randomState = seed >>> 0;
  const seededMath = Object.create(Math);
  seededMath.random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };

  const context = { Math: seededMath, Intl };
  vm.createContext(context);
  vm.runInContext(`
    const moneyFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
    function clampMoney(value) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return Math.floor(n);
    }
    function samePair(a, b) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      return a.map(x => x && x.id).sort().join("|") ===
        b.map(x => x && x.id).sort().join("|");
    }
    ${choiceArrays}
    ${balanceHelpers}
    globalThis.balanceApi = {
      SAFE_CHOICES,
      RISKY_CHOICES,
      generateChoices,
      getChoiceRiskProfile,
      getEffectivePenaltyDetails,
      getMoneyAfterChoiceEffect,
      getMoneyAfterPenalty,
      scaleCashChoice,
      estimateChoiceValue,
      TARGET_CHOICE_EV_PERCENT
    };
  `, context);
  return context.balanceApi;
}

test("각 실제 금액 패널티 선택지의 확률은 목표 기대손익과 일치한다", () => {
  const api = loadBalanceEngine();
  const stakes = [1000, 5000, 10000, 100000, 1000000];
  let checked = 0;

  for (const stake of stakes) {
    for (const raw of [...api.SAFE_CHOICES, ...api.RISKY_CHOICES]) {
      for (const reduceTurns of [0, 5]) {
        const choice = api.scaleCashChoice(raw, stake);
        if (choice.bonusType) continue;
        const details = api.getEffectivePenaltyDetails(choice, stake, stake, reduceTurns);
        if (!["loss10", "loss25", "loss50", "totalLoss"].includes(details.penaltyType)) continue;

        const after = api.getMoneyAfterChoiceEffect(choice, stake);
        const penaltyAfter = api.getMoneyAfterPenalty(after, details.penaltyType);
        const chance = details.chance / 100;
        const expectedFinal = after * (1 - chance) + penaltyAfter * chance;
        const actualPercent = (expectedFinal / stake - 1) * 100;

        assert.ok(
          Math.abs(actualPercent - api.TARGET_CHOICE_EV_PERCENT) <= 0.12,
          `${choice.id} at ${stake} won: expected ${api.TARGET_CHOICE_EV_PERCENT}%, got ${actualPercent}%`
        );
        checked++;
      }
    }
  }
  assert.ok(checked >= 100, `expected broad coverage, checked only ${checked} cases`);
});

test("정상 판돈에서 2개·3개 선택지는 위험 등급 조건을 지킨다", () => {
  const api = loadBalanceEngine(0x13579bdf);
  for (const stake of [1000, 5000, 10000, 100000, 1000000]) {
    for (const count of [2, 3]) {
      for (let i = 0; i < 400; i++) {
        const choices = api.generateChoices(null, count, false, stake, stake, i % 6);
        assert.equal(choices.length, count, `${stake} won / ${count} choices returned wrong count`);
        const tiers = choices.map(choice =>
          api.getChoiceRiskProfile(choice, stake, stake, i % 6).tier
        );
        if (count === 2) {
          assert.ok(tiers.includes(0), `2-choice set at ${stake} lacks low risk`);
          assert.ok(new Set(tiers).size >= 2, `2-choice set at ${stake} lacks risk diversity`);
        } else {
          assert.deepEqual([...tiers].sort(), [0, 1, 2]);
        }
        const labels = choices.map(choice => `${choice.title}|${choice.penalty || "패널티: 없음"}`);
        assert.equal(new Set(labels).size, labels.length, "duplicate display choices were generated");
      }
    }
  }
});

test("색상 위치별 위험 등급 출현률에 구조적 편향이 없다", () => {
  const api = loadBalanceEngine(0x2468ace0);
  for (const count of [2, 3]) {
    const colors = Array.from({ length: count }, () => [0, 0, 0]);
    const samples = 4000;
    for (let i = 0; i < samples; i++) {
      const choices = api.generateChoices(null, count, false, 10000, 10000, 0);
      choices.forEach((choice, index) => {
        const tier = api.getChoiceRiskProfile(choice, 10000, 10000, 0).tier;
        colors[index][tier]++;
      });
    }
    for (let tier = 0; tier < 3; tier++) {
      const rates = colors.map(row => row[tier] / samples);
      assert.ok(
        Math.max(...rates) - Math.min(...rates) < 0.04,
        `${count}-choice color bias for risk tier ${tier}: ${rates.join(", ")}`
      );
    }
  }
});

test("극저잔액 예외에서도 생성기가 멈추거나 비정상 값을 내지 않는다", () => {
  const api = loadBalanceEngine(0xabcdef01);
  for (const stake of [1, 2, 10, 100, 500, 999]) {
    for (const count of [2, 3]) {
      for (let i = 0; i < 100; i++) {
        const choices = api.generateChoices(null, count, false, stake, stake, 0);
        assert.ok(choices.length > 0 && choices.length <= count);
        for (const choice of choices) {
          assert.ok(Number.isFinite(api.estimateChoiceValue(choice, stake, stake, 0)));
        }
      }
    }
  }
});
