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

  const context = { Math: seededMath, Intl, setSeed: value => { randomState = value >>> 0; } };
  vm.createContext(context);
  vm.runInContext(`
    const moneyFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
    function clampMoney(value) {
  const n = Number(value);
  if (Number.isNaN(n) || n <= 0) return 0;
  // Very large positive rewards (especially the 100x option) must saturate,
  // not be mistaken for a zero balance when multiplication overflows.
  if (n === Infinity) return Number.MAX_VALUE;
  if (!Number.isFinite(n)) return 0;
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
      clampMoney,
      generateChoices,
      getChoiceRiskProfile,
      getEffectivePenaltyDetails,
      getMoneyAfterChoiceEffect,
      getMoneyAfterPenalty,
      scaleCashChoice,
      estimateChoiceValue,
      TARGET_CHOICE_EV_PERCENT,
      getForcedColorEquivalentCost,
      getReduceLossReferenceExposure,
      prepareChoiceForGeneration,
      calculateBankPartialInterest,
      calculateBankAccrual,
      preserveLegacyForcedColorChoice,
      random: () => Math.random(),
      chooseForcedColor,
      setSeed
    };
  `, context);
  return context.balanceApi;
}




test("초대형 보상에서 양수 오버플로는 파산으로 바뀌지 않고 최대 잔액으로 포화된다", () => {
  const api = loadBalanceEngine(0x76543210);
  assert.equal(api.clampMoney(Infinity), Number.MAX_VALUE);
  assert.equal(api.clampMoney(-Infinity), 0);
  assert.equal(api.clampMoney(NaN), 0);
  assert.equal(
    api.getMoneyAfterChoiceEffect({ effect: 9900 }, Number.MAX_VALUE / 100),
    Number.MAX_VALUE
  );
  assert.equal(
    api.getMoneyAfterChoiceEffect({ effect: 9900 }, Number.MAX_VALUE),
    Number.MAX_VALUE
  );
});

test("은행 원금·금리 변경 직전의 부분 분 이자를 이전 조건으로 정산한다", () => {
  const api = loadBalanceEngine(0x10203040);
  assert.equal(api.calculateBankPartialInterest(10000, 1, 30000), 50);
  assert.equal(api.calculateBankPartialInterest(10000, 2, 30000), 100);
  assert.equal(api.calculateBankPartialInterest(15000, 1, 30000), 75);
  assert.equal(api.calculateBankPartialInterest(10000, 1, 0), 0);
  assert.equal(api.calculateBankPartialInterest(0, 10, 30000), 0);
  assert.equal(api.calculateBankPartialInterest(10000, 1, -1), 0);
});


test("은행 부분 정산을 여러 번 해도 소수 이자가 누적되어 1분 이자와 일치한다", () => {
  const api = loadBalanceEngine(0x55667788);
  const oneMinute = api.calculateBankAccrual(10000, 1, 60000, 0);
  assert.equal(oneMinute.whole, 100);
  assert.equal(oneMinute.remainder, 0);

  let total = 0;
  let remainder = 0;
  for (let i = 0; i < 60; i++) {
    const part = api.calculateBankAccrual(10000, 1, 1000, remainder);
    total += part.whole;
    remainder = part.remainder;
  }
  assert.equal(total, oneMinute.whole);
  assert.ok(Math.abs(remainder - oneMinute.remainder) < 1e-8);

  const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  assert.ok(source.includes("bankFractionalInterest: 0"));
  assert.ok(source.includes("raw.bankFractionalInterest"));
  assert.ok(source.includes("state.bankFractionalInterest = accrual.remainder"));
  assert.ok(source.includes("const withdrawableAmount = addMoney("));
  assert.ok(source.includes("moneyText(withdrawableAmount)"));

});

test("입금·출금·금리 업그레이드 모두 변경 전 부분 이자를 먼저 정산한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  const deposit = source.slice(source.indexOf('if (moneyModalMode === "deposit")'), source.indexOf('/* =========================\n   시급', source.indexOf('if (moneyModalMode === "deposit")')));
  const rate = source.slice(source.indexOf('$("buyBankRateButton").addEventListener'), source.indexOf('/* =========================\n   은행', source.indexOf('$("buyBankRateButton").addEventListener')));
  assert.ok(deposit.indexOf("settleBankPartialInterest();") < deposit.indexOf("state.bankPrincipal = addMoney(state.bankPrincipal, amount)"));
  assert.ok(deposit.indexOf("settleBankPartialInterest();") < deposit.indexOf("state.bankPrincipal = Math.max("));
  assert.ok(deposit.indexOf("pendingPartialInterest") < deposit.indexOf("if (amount > total)"));
  assert.ok(deposit.indexOf("settleBankPartialInterest();", deposit.indexOf("if (amount > total)")) > deposit.indexOf("if (amount > total)"));
  assert.ok(rate.includes("settleBankPartialInterest();"));
});

test("각 실제 금액 패널티 선택지의 확률은 목표 기대손익과 일치한다", () => {
  const api = loadBalanceEngine();
  const stakes = [1000, 5000, 10000, 100000, 1000000];
  let checked = 0;

  for (const stake of stakes) {
    for (const raw of [...api.SAFE_CHOICES, ...api.RISKY_CHOICES]) {
      for (const reduceTurns of [0]) {
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

test("보상 범위는 +0.1% 미세 보상부터 +900% 희귀 보상과 100배까지 포함한다", () => {
  const api = loadBalanceEngine(0x10101010);
  const micro = api.SAFE_CHOICES.find(choice => choice.id === "micro01");
  const jackpot = api.RISKY_CHOICES.find(choice => choice.id === "rare900");
  const ultra = api.RISKY_CHOICES.find(choice => choice.id === "ultra100x");

  assert.ok(micro);
  assert.equal(micro.effect, 0.1);
  assert.ok(Math.abs(
    api.estimateChoiceValue(micro, 10000, 10000, 0, 2) -
    api.TARGET_CHOICE_EV_PERCENT
  ) < 0.02);
  assert.ok(jackpot);
  assert.equal(jackpot.effect, 900);
  assert.ok(ultra);
  assert.equal(ultra.effect, 9900);
});

test("손실 감소 보너스는 부분 손실에만 정확히 20% 적용된다", () => {
  const api = loadBalanceEngine(0x10293847);
  const choices = [...api.SAFE_CHOICES, ...api.RISKY_CHOICES];
  for (const stake of [1000, 10000, 100000, 1000000]) {
    for (const raw of choices) {
      const choice = api.scaleCashChoice(raw, stake);
      const base = api.getEffectivePenaltyDetails(choice, stake, stake, 0);
      const boosted = api.getEffectivePenaltyDetails(choice, stake, stake, 5);
      for (const count of [2, 3]) {
        const baseProfile = api.getChoiceRiskProfile(choice, stake, stake, 0, count);
        const boostedProfile = api.getChoiceRiskProfile(choice, stake, stake, 5, count);
        assert.equal(boostedProfile.tier, baseProfile.tier, `${choice.id} changed intrinsic tier under bonus`);
      }
      if (["loss10", "loss25", "loss50"].includes(base.penaltyType)) {
        assert.equal(boosted.reductionApplies, true, choice.id);
        assert.ok(Math.abs(boosted.chance - base.chance * 0.8) <= 0.0001, choice.id);
      } else {
        assert.equal(boosted.chance, base.chance, `${choice.id} must not receive partial-loss reduction`);
        assert.equal(boosted.reductionApplies, false, choice.id);
      }
    }
  }
});

test("강제 색상 패널티는 2개·3개 모드별 기회비용을 반영해 목표 기대값을 유지한다", () => {
  const api = loadBalanceEngine(0x31415926);
  const forced = [...api.SAFE_CHOICES, ...api.RISKY_CHOICES]
    .filter(choice =>
      ["forceBlue", "forceRed", "forceGreen", "forceRandom"].includes(choice.penaltyType) &&
      choice.id !== "safeForceGreen"
    );
  assert.equal(api.getForcedColorEquivalentCost(2), 0.0035);
  assert.ok(Math.abs(api.getForcedColorEquivalentCost(3) - 0.005425) < 1e-10);
  for (const stake of [1000, 10000, 100000, 1000000]) {
    for (const choice of forced) {
      for (const count of [2, 3]) {
        if (count === 2 && ["forceGreen", "forceRandom"].includes(choice.penaltyType)) continue;
        const details = api.getEffectivePenaltyDetails(choice, stake, stake, 0, count);
        const after = api.getMoneyAfterChoiceEffect(choice, stake);
        const expectedFinal = after * (
          1 - details.chance / 100 * api.getForcedColorEquivalentCost(count)
        );
        const actualPercent = (expectedFinal / stake - 1) * 100;
        assert.ok(
          Math.abs(actualPercent - api.TARGET_CHOICE_EV_PERCENT) <= 0.01,
          `${choice.id} / ${count} choices: ${actualPercent}%`
        );
        const profile = api.getChoiceRiskProfile(choice, stake, stake, 0, count);
        assert.equal(profile.chance, details.chance, "risk profile and displayed penalty must agree");
      }
      if (choice.penaltyType !== "forceRandom") {
        const two = api.getEffectivePenaltyDetails(choice, stake, stake, 0, 2);
        const three = api.getEffectivePenaltyDetails(choice, stake, stake, 0, 3);
        assert.ok(Math.abs(three.chance * 1.55 - two.chance) <= 0.001);
      }
    }
  }
});

test("손실 감소 보너스 가격은 모드별 실측 기준과 기대값이 일치한다", () => {
  const api = loadBalanceEngine(0x27182818);
  const bonus = api.SAFE_CHOICES.find(choice => choice.id === "safeBonus5");
  for (const count of [2, 3]) {
    const prepared = api.prepareChoiceForGeneration(bonus, 0, count);
    const expectedCost = count === 2 ? 9.02 : 10.56;
    assert.ok(Math.abs(prepared.effect + expectedCost) < 0.000001);
    const value = api.estimateChoiceValue(prepared, 10000, 10000, 0, count);
    const fallbackValue = api.estimateChoiceValue(prepared, null, null, 0, count);
    assert.ok(Math.abs(value - api.TARGET_CHOICE_EV_PERCENT) < 0.000001);
    assert.ok(Number.isFinite(fallbackValue));
    assert.ok(Math.abs(fallbackValue - api.TARGET_CHOICE_EV_PERCENT) < 0.02);
    assert.equal(
      api.getReduceLossReferenceExposure(count),
      count === 2 ? 0.0897 : 0.1051
    );
  }
});

test("정상 판돈에서 2개·3개 선택지는 위험 등급 조건을 지킨다", () => {
  const api = loadBalanceEngine(0x13579bdf);
  for (const stake of [1000, 5000, 10000, 100000, 1000000]) {
    for (const count of [2, 3]) {
      for (let i = 0; i < 150; i++) {
        const choices = api.generateChoices(null, count, false, stake, stake, i % 6);
        assert.equal(choices.length, count, `${stake} won / ${count} choices returned wrong count`);
        assert.ok(choices.some(choice => !choice.bonusType), "a choice set must retain at least one ordinary reward option");
        const tiers = choices.map(choice =>
          api.getChoiceRiskProfile(choice, stake, stake, i % 6, count).tier
        );
        if (count === 2) {
          assert.ok(
            new Set(tiers).size >= 2,
            `2-choice set at ${stake} lacks risk diversity`
          );
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
    const samples = 2000;
    for (let i = 0; i < samples; i++) {
      const choices = api.generateChoices(null, count, false, 10000, 10000, 0);
      choices.forEach((choice, index) => {
        const tier = api.getChoiceRiskProfile(choice, 10000, 10000, 0, count).tier;
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


test("무작위 색상 강제는 3개 모드에서 세 색을 동등하게 선택하고 2개 모드에서는 녹색을 고르지 않는다", () => {
  const api = loadBalanceEngine(0x55aa33cc);
  const expected = {
    2: [["blue", 0.01], ["red", 0.51]],
    3: [["blue", 0.01], ["red", 0.34], ["green", 0.67]]
  };
  for (const [modeText, cases] of Object.entries(expected)) {
    const mode = Number(modeText);
    for (const [color, roll] of cases) {
      assert.equal(api.chooseForcedColor(mode, roll), color);
    }
  }
  const counts = { blue: 0, red: 0, green: 0 };
  api.setSeed(0x1a2b3c4d);
  for (let i = 0; i < 30000; i++) counts[api.chooseForcedColor(3, api.random())]++;
  for (const color of Object.keys(counts)) {
    assert.ok(Math.abs(counts[color] / 30000 - 1 / 3) < 0.01, `${color} forced-color share was biased`);
  }
});


test("새 선택지 생성은 무작위 강제 색상만 사용하고 레거시 초록 강제 옵션은 활성 게임 복원용으로만 남긴다", () => {
  const api = loadBalanceEngine(0x10293847);
  for (let i = 0; i < 1000; i++) {
    const two = api.generateChoices(null, 2, false, 10000, 10000, 0);
    const three = api.generateChoices(null, 3, false, 10000, 10000, 0);
    assert.ok(!two.some(choice => ["safeForceGreen", "safeForceRandom"].includes(choice.id)));
    assert.ok(!three.some(choice => choice.id === "safeForceGreen"));
  }
  assert.ok(api.SAFE_CHOICES.some(choice => choice.id === "safeForceGreen" && choice.penaltyType === "forceGreen"));
  assert.ok(api.SAFE_CHOICES.some(choice => choice.id === "safeForceRandom" && choice.penaltyType === "forceRandom"));
});


test("기존 저장 게임의 색상 강제 선택지는 과거 확률과 효과를 보존한다", () => {
  const api = loadBalanceEngine(0xabc12345);
  const legacy = [
    { id: "safe15", effect: 2.72, penaltyChance: 45, penaltyType: "forceRed" },
    { id: "safeMinus10", effect: 0.86, penaltyChance: 15, penaltyType: "forceBlue" },
    { id: "safeForceGreen", effect: 1.04, penaltyChance: 18, penaltyType: "forceGreen" }
  ];
  const expected = [45, 15, 18];
  legacy.forEach((choice, index) => {
    for (const mode of [2, 3]) {
      const details = api.getEffectivePenaltyDetails(choice, 10000, 10000, 0, mode);
      assert.equal(details.chance, expected[index], `${choice.id} legacy chance changed in mode ${mode}`);
    }
  });
  const green = api.SAFE_CHOICES.find(choice => choice.id === "safeForceGreen");
  assert.equal(green.effect, 1.04);
  assert.equal(green.penaltyChance, 18);
  assert.equal(green.penaltyType, "forceGreen");
});


test("저장된 기존 색상 강제 선택지는 재생성된 기본 정의가 아닌 저장 당시 규칙으로 복원한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  const normalizeStart = source.indexOf("function normalizeChoice(");
  const normalizeEnd = source.indexOf("/* =========================" + String.fromCharCode(10) + "   저장과 복구", normalizeStart);
  assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart);
  assert.ok(source.slice(normalizeStart, normalizeEnd).includes("preserveLegacyForcedColorChoice({ ...known }, raw)"));

  const api = loadBalanceEngine(0x98765432);
  const cases = [
    { id: "safe15", penaltyType: "forceRed", penaltyChance: 45, penalty: "old red" },
    { id: "safeMinus10", penaltyType: "forceBlue", penaltyChance: 15, penalty: "old blue" },
    { id: "safeForceGreen", penaltyType: "forceGreen", penaltyChance: 18, penalty: "old green" }
  ];
  for (const raw of cases) {
    const restored = api.preserveLegacyForcedColorChoice({ id: raw.id, penaltyType: "loss10", penaltyChance: 9 }, raw);
    assert.equal(restored.penaltyType, raw.penaltyType);
    assert.equal(restored.penaltyChance, raw.penaltyChance);
    assert.equal(restored.penalty, raw.penalty);
  }
  const unrelated = { id: "safe15", penaltyType: "loss25", penaltyChance: 10 };
  assert.equal(api.preserveLegacyForcedColorChoice({ ...unrelated }, unrelated).penaltyType, "loss25");
});


test("손실 감소 보너스의 메뉴 평가가 실제 추가 적용 턴 수와 일치한다", () => {
  const api = loadBalanceEngine(0x13572468);
  const base = api.SAFE_CHOICES.find(choice => choice.id === "safeBonus5");
  for (const mode of [2, 3]) {
    for (const remaining of [0, 1, 2, 4, 5]) {
      const prepared = api.prepareChoiceForGeneration(base, remaining, mode);
      const expectedAdded = Math.max(0, 5 - Math.max(0, remaining - 1));
      assert.equal(prepared.bonusAddedTurns, expectedAdded);
      const value = api.estimateChoiceValue(prepared, 10000, 10000, 0, mode);
      assert.ok(
        Math.abs(value - api.TARGET_CHOICE_EV_PERCENT) < 0.02,
        `mode=${mode}, remaining=${remaining}, value=${value}`
      );
    }
    assert.equal(api.prepareChoiceForGeneration(base, 6, mode), null);
  }
});
