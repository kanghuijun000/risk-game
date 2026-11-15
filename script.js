"use strict";

const STORAGE_KEY = "risk-game-state-v6";
const PROFILE_STORAGE_KEY = "risk-game-profile-v1";
const LEGACY_KEYS = [
  "risk-game-state-v5",
  "risk-game-state-v4",
  "risk-game-state-v3",
  "riskGameState",
  "risk-game",
  "riskGame",
  "gameState"
];

const MAX_MONEY = Number.MAX_VALUE;
const BANK_MINUTE_MS = 60000;
const INITIAL_BANK_RATE = 1;
const WAGE_AMOUNT = 10000;
const REROLL_PURCHASE_COST = 5000;
const WAGE_COOLDOWN_MS = 3600000;

const $ = id => document.getElementById(id);

// 테스트용 1회 진입점: ?start=account-choice 로 열면 이 기기에서만 로그아웃 화면을 표시합니다.
// 서버 계정과 클라우드 게임 데이터는 삭제하거나 다른 기기로 이전하지 않습니다.
const FORCE_LOCAL_LOGOUT_KEY = "risk-game-force-local-logout-v1";
if (new URLSearchParams(window.location.search).get("start") === "account-choice") {
  localStorage.removeItem("risk-game-recovery-enabled-v1");
  localStorage.setItem("risk-game-account-displaced-v1", "true");
  localStorage.setItem(FORCE_LOCAL_LOGOUT_KEY, "true");
  const url = new URL(window.location.href);
  url.searchParams.delete("start");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}
const moneyFormat = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 0
});

function clampMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function addMoney(a, b) {
  const sum = clampMoney(a) + clampMoney(b);
  return Number.isFinite(sum) ? Math.floor(sum) : Number.MAX_VALUE;
}

function moneyText(value) {
  const n = clampMoney(value);

  if (n < 1000000000000) {
    return moneyFormat.format(n) + "원";
  }

  const units = [
    [1000000000000, "조"],
    [100000000, "억"],
    [10000, "만"]
  ];

  let remaining = n;
  const parts = [];

  for (const [unitValue, unitName] of units) {
    const amount = Math.floor(remaining / unitValue);

    if (amount > 0) {
      parts.push(moneyFormat.format(amount) + unitName);
      remaining -= amount * unitValue;
    }
  }

  if (remaining > 0) {
    parts.push(moneyFormat.format(remaining) + "원");
  }

  return parts.join(" ") || "0원";
}

function clockText(seconds) {
  const n = Math.max(0, Math.ceil(seconds));

  return String(Math.floor(n / 60)).padStart(2, "0") + ":" +
    String(n % 60).padStart(2, "0");
}

/* =========================
   선택지
========================= */

const SAFE_CHOICES = [
  {
    id: "micro03",
    effect: 0.3,
    title: "+0.3%",
    penalty: "패널티: 3.5% 확률로 10% 손실",
    penaltyChance: 3.5,
    penaltyType: "loss10"
  },
  {
    id: "micro05",
    effect: 0.5,
    title: "+0.5%",
    penalty: "패널티: 5.5% 확률로 10% 손실",
    penaltyChance: 5.5,
    penaltyType: "loss10"
  },
  {
    id: "safe10",
    effect: 2,
    title: "+2%",
    penalty: "패널티: 20.1% 확률로 10% 손실",
    penaltyChance: 20.1,
    penaltyType: "loss10"
  },
  {
    id: "safe15",
    effect: 2.72,
    title: "+2.7%",
    penalty: "패널티: 45% 확률로 다음 턴 빨강 강제",
    penaltyChance: 45,
    penaltyType: "forceRed"
  },
  {
    id: "safe20",
    effect: 4,
    title: "+4%",
    penalty: "패널티: 38.9% 확률로 10% 손실",
    penaltyChance: 38.9,
    penaltyType: "loss10"
  },
  {
    id: "safe25",
    effect: 5,
    title: "+5%",
    penalty: "패널티: 19.2% 확률로 25% 손실",
    penaltyChance: 19.2,
    penaltyType: "loss25"
  },
  {
    id: "safeMinus10",
    effect: 0.86,
    title: "+0.9%",
    penalty: "패널티: 15% 확률로 다음 턴 파랑 강제",
    penaltyChance: 15,
    penaltyType: "forceBlue"
  },
  {
    id: "safeNoPenalty",
    effect: 0,
    title: "0%",
    penalty: "패널티: 없음",
    penaltyChance: 0,
    penaltyType: "none"
  },
  {
    id: "safeForceGreen",
    effect: 1.04,
    title: "+1.0%",
    penalty: "패널티: 18% 확률로 다음 턴 초록 강제",
    penaltyChance: 18,
    penaltyType: "forceGreen"
  },
  {
    id: "safeBonus5",
    effect: -6.1,
    title: "−6.1%",
    penalty: "보너스: 다음 5턴 부분 손실 패널티 확률 20% 감소",
    penaltyChance: 0,
    penaltyType: "none",
    bonusType: "reduceLoss",
    bonusTurns: 5
  },
  {
    id: "safeBonus10",
    effect: -0.2,
    title: "−0.2%",
    penalty: "보너스: 다음 10턴 안전한 양수 선택지 확률 증가",
    penaltyChance: 0,
    penaltyType: "none",
    bonusType: "safePositive",
    bonusTurns: 10
  }
];

const RISKY_CHOICES = [
  {
    id: "risk40",
    effect: 5,
    title: "+5%",
    penalty: "패널티: 19.2% 확률로 25% 손실",
    penaltyChance: 19.2,
    penaltyType: "loss25"
  },
  {
    id: "risk50",
    effect: 6,
    title: "+6%",
    penalty: "패널티: 22.8% 확률로 25% 손실",
    penaltyChance: 22.8,
    penaltyType: "loss25"
  },
  {
    id: "risk75",
    effect: 8,
    title: "+8%",
    penalty: "패널티: 29.8% 확률로 25% 손실",
    penaltyChance: 29.8,
    penaltyType: "loss25"
  },
  {
    id: "risk100",
    effect: 9,
    title: "+9%",
    penalty: "패널티: 16.6% 확률로 50% 손실",
    penaltyChance: 16.6,
    penaltyType: "loss50"
  },
  {
    id: "risk110",
    effect: 10,
    title: "+10%",
    penalty: "패널티: 36.5% 확률로 25% 손실",
    penaltyChance: 36.5,
    penaltyType: "loss25"
  },
  {
    id: "risk130",
    effect: 13,
    title: "+13%",
    penalty: "패널티: 46.2% 확률로 25% 손실",
    penaltyChance: 46.2,
    penaltyType: "loss25"
  },
  {
    id: "risk160",
    effect: 16,
    title: "+16%",
    penalty: "패널티: 55.3% 확률로 25% 손실",
    penaltyChance: 55.3,
    penaltyType: "loss25"
  },
  {
    id: "risk200",
    effect: 14,
    title: "+14%",
    penalty: "패널티: 24.6% 확률로 50% 손실",
    penaltyChance: 24.6,
    penaltyType: "loss50"
  },
  {
    id: "risk1000",
    effect: 5,
    title: "+5%",
    penalty: "패널티: 4.8% 확률로 전액 손실",
    penaltyChance: 4.8,
    penaltyType: "totalLoss"
  },
  {
    id: "riskMinus25",
    effect: 7,
    title: "+7%",
    penalty: "패널티: 26.4% 확률로 25% 손실",
    penaltyChance: 26.4,
    penaltyType: "loss25"
  },
  {
    id: "riskMinus50",
    effect: 12,
    title: "+12%",
    penalty: "패널티: 21.5% 확률로 50% 손실",
    penaltyChance: 21.5,
    penaltyType: "loss50"
  },
  {
    id: "riskMinus15Bonus",
    effect: -6.1,
    title: "−6.1%",
    penalty: "보너스: 다음 5턴 부분 손실 패널티 확률 20% 감소",
    penaltyChance: 0,
    penaltyType: "none",
    bonusType: "reduceLoss",
    bonusTurns: 5
  },
  {
    id: "cash1000",
    effect: 0,
    amountEffect: 1000,
    title: "+1,000원",
    penalty: "패널티: 잔액에 따라 손실 종류와 확률 조정",
    penaltyChance: 0,
    penaltyType: "cashRisk"
  },
  {
    id: "cash2000",
    effect: 0,
    amountEffect: 2000,
    title: "+2,000원",
    penalty: "패널티: 잔액에 따라 손실 종류와 확률 조정",
    penaltyChance: 0,
    penaltyType: "cashRisk"
  },
  {
    id: "cash3500",
    effect: 0,
    amountEffect: 3500,
    title: "+3,500원",
    penalty: "패널티: 잔액에 따라 손실 종류와 확률 조정",
    penaltyChance: 0,
    penaltyType: "cashRisk"
  },
  {
    id: "cash5000",
    effect: 0,
    amountEffect: 5000,
    title: "+5,000원",
    penalty: "패널티: 잔액에 따라 손실 종류와 확률 조정",
    penaltyChance: 0,
    penaltyType: "cashRisk",
    rarityWeight: 0.3
  },
  {
    id: "cash7500",
    effect: 0,
    amountEffect: 7500,
    title: "+7,500원",
    penalty: "패널티: 잔액에 따라 손실 종류와 확률 조정",
    penaltyChance: 0,
    penaltyType: "cashRisk",
    rarityWeight: 0.15
  },
  {
    id: "cash10000",
    effect: 0,
    amountEffect: 10000,
    title: "+10,000원",
    penalty: "패널티: 잔액에 따라 손실 종류와 확률 조정",
    penaltyChance: 0,
    penaltyType: "cashRisk",
    rarityWeight: 0.08
  },
  {
    id: "rare25",
    effect: 25,
    title: "+25%",
    penalty: "패널티: 20% 확률로 전액 손실",
    penaltyChance: 20,
    penaltyType: "totalLoss",
    rarityWeight: 0.05
  },
  {
    id: "rare50",
    effect: 50,
    title: "+50%",
    penalty: "패널티: 33.3% 확률로 전액 손실",
    penaltyChance: 33.3,
    penaltyType: "totalLoss",
    rarityWeight: 0.05
  },
  {
    id: "rare100",
    effect: 100,
    title: "+100%",
    penalty: "패널티: 50% 확률로 전액 손실",
    penaltyChance: 50,
    penaltyType: "totalLoss",
    rarityWeight: 0.05
  },
  {
    id: "rare900",
    effect: 900,
    title: "+900%",
    penalty: "초희귀 잭팟: 90% 확률로 전액 손실",
    penaltyChance: 90,
    penaltyType: "totalLoss",
    rarityWeight: 0.01
  },
  {
    id: "ultra100x",
    effect: 9900,
    title: "×100배",
    penalty: "초고위험: 99% 확률로 전액 손실",
    penaltyChance: 99,
    penaltyType: "totalLoss",
    rarityWeight: 0.002
  }
];

function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function shuffledPair(a, b) {
  return Math.random() < 0.5 ? [a, b] : [b, a];
}

function samePair(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }

  const aIds = a.map(x => x && x.id).sort().join("|");
  const bIds = b.map(x => x && x.id).sort().join("|");

  return aIds === bIds;
}

// 고정 금액 선택지는 현재 잔액에 비례시켜 판돈과 누적 턴에 관계없이
// 같은 보상 비율을 유지합니다. 기준 잔액 10,000원에서 원래 금액을 그대로 적용합니다.
const CASH_REWARD_REFERENCE_STAKE = 10000;
const TARGET_CHOICE_EV_PERCENT = -0.05;
const LOSS_CHANCE_REDUCTION_FACTOR = 0.8;
const REDUCE_LOSS_REFERENCE_EXPOSURE_BY_MODE = { 2: 0.0897, 3: 0.1051 };

function getReduceLossReferenceExposure(choiceCount = 2) {
  return REDUCE_LOSS_REFERENCE_EXPOSURE_BY_MODE[choiceCount === 3 ? 3 : 2];
}
const FORCED_COLOR_EQUIVALENT_COST = 0.06;

// 3개 모드는 2개 모드보다 선택권을 잃었을 때의 평균 위험조정 기회비용이 약 2배였습니다.
// 4,000개 조합 표본에서 위험회피 기준(max utility - mean utility)이 약 6.3 대 12.6으로 측정됐습니다.
function getForcedColorEquivalentCost(choiceCount = 2) {
  return FORCED_COLOR_EQUIVALENT_COST * (choiceCount === 3 ? 2 : 1);
}

function getCashRewardScale(currentMoney) {
  const money = Number(currentMoney);
  if (!Number.isFinite(money) || money <= 0) return 1;
  return money / CASH_REWARD_REFERENCE_STAKE;
}

function scaleCashChoice(choice, currentMoney) {
  if (!choice || choice.amountEffect == null) return choice ? { ...choice } : choice;
  const rawAmount = Number(choice.amountEffect) * getCashRewardScale(currentMoney);
  // 실제 게임의 최소 판돈이 1,000원이므로 1원 단위 반올림으로 비율 오차를 최소화합니다.
  const amount = Math.max(1, Math.round(rawAmount));
  return {
    ...choice,
    amountEffect: Number.isFinite(amount) ? amount : Number.MAX_SAFE_INTEGER,
    title: `+${moneyFormat.format(Number.isFinite(amount) ? amount : Number.MAX_SAFE_INTEGER)}원`
  };
}

function getCashRisk(choice, currentMoney, startAmount = null) {
  const money = Math.max(0, Number(currentMoney) || 0);
  const amount = Math.max(0, Number(choice.amountEffect) || 0);
  const after = clampMoney(Math.round(money + amount));
  const gain = Math.max(0, after - money);

  if (gain <= 0 || after <= 0) {
    return { penaltyType: "totalLoss", chance: 0, lossFraction: 1 };
  }

  // 보상 대비 손실 규모를 잔액 비율로 판정하므로 판돈이 달라도 같은 위험 구조를 유지합니다.
  const gainRatio = gain / Math.max(1, money);
  let penaltyType;
  let lossFraction;

  if (gainRatio < 0.10) {
    penaltyType = "loss10";
    lossFraction = 0.10;
  } else if (gainRatio < 0.25) {
    penaltyType = "loss25";
    lossFraction = 0.25;
  } else if (gainRatio < 0.50) {
    penaltyType = "loss50";
    lossFraction = 0.50;
  } else {
    penaltyType = "totalLoss";
    lossFraction = 1;
  }

  // 실제 정수 반올림 후의 패널티 결과를 기준으로 목표 턴당 기대 손익(-0.05%) 확률을 계산합니다.
  const penaltyAfter = penaltyType === "totalLoss" || after <= 1
    ? 0
    : clampMoney(Math.round(after * (1 - lossFraction)));
  const targetFinal = money * (1 + TARGET_CHOICE_EV_PERCENT / 100);
  const lossAmount = after - penaltyAfter;
  const chance = lossAmount > 0
    ? ((after - targetFinal) / lossAmount) * 100
    : 0;

  return {
    penaltyType,
    chance: Math.max(0, Math.min(100, chance)),
    lossFraction
  };
}

function getAdaptivePenaltyChance(choice, currentMoney, startAmount = null) {
  // 저장된 기본 확률은 잔액 정보가 없는 레거시 호출의 대체값으로만 사용합니다.
  return Math.max(0, Math.min(100, Number(choice.penaltyChance) || 0));
}

function getMoneyAfterChoiceEffect(choice, money) {
  if (choice.amountEffect != null) {
    return clampMoney(Math.round(money + Number(choice.amountEffect || 0)));
  }
  if (choice.effect < 0) {
    return money <= 1
      ? 0
      : clampMoney(Math.round(money * (1 - Math.abs(choice.effect) / 100)));
  }
  return clampMoney(Math.round(money * (1 + Number(choice.effect || 0) / 100)));
}

function getMoneyAfterPenalty(money, penaltyType) {
  const lossFraction = {
    loss10: 0.10,
    loss25: 0.25,
    loss50: 0.50,
    totalLoss: 1
  }[penaltyType];
  if (lossFraction == null) return money;
  if (penaltyType === "totalLoss" || money <= 1) return 0;
  return clampMoney(Math.round(money * (1 - lossFraction)));
}

function getBalancedBasePenaltyChance(choice, penaltyType, currentMoney, fallbackChance, choiceCount = 2) {
  const money = Number(currentMoney);
  if (!Number.isFinite(money) || money <= 0) return fallbackChance;

  const after = getMoneyAfterChoiceEffect(choice, money);
  if (after <= 0) return 0;
  const targetFinal = money * (1 + TARGET_CHOICE_EV_PERCENT / 100);

  if (["loss10", "loss25", "loss50", "totalLoss"].includes(penaltyType)) {
    const penaltyAfter = getMoneyAfterPenalty(after, penaltyType);
    const lossAmount = after - penaltyAfter;
    return lossAmount > 0
      ? Math.max(0, Math.min(100, (after - targetFinal) / lossAmount * 100))
      : 0;
  }

  if (["forceBlue", "forceRed", "forceGreen"].includes(penaltyType)) {
    return Math.max(0, Math.min(
      100,
      (1 - targetFinal / after) / getForcedColorEquivalentCost(choiceCount) * 100
    ));
  }

  return fallbackChance;
}

function isReducibleLossPenalty(penaltyType) {
  // 보너스는 부분 손실 패널티에만 적용합니다. 전액 손실 잭팟의 확률은 보존합니다.
  return ["loss10", "loss25", "loss50"].includes(penaltyType);
}

function getAddedReduceLossTurns(reduceLossTurns, bonusTurns = 5) {
  const remainingAfterCurrent = Math.max(
    0, Math.floor(Number(reduceLossTurns) || 0) - 1
  );
  const targetTurns = Math.max(0, Math.floor(Number(bonusTurns) || 5));
  return Math.max(0, targetTurns - remainingAfterCurrent);
}

function prepareChoiceForGeneration(choice, reduceLossTurns = 0, choiceCount = 2) {
  if (!choice || choice.bonusType !== "reduceLoss") return choice;
  const addedTurns = getAddedReduceLossTurns(
    reduceLossTurns, choice.bonusTurns
  );
  if (addedTurns <= 0) return null;

  // 이미 활성화된 턴과 겹치지 않는 추가 턴만큼만 보험료를 부과합니다.
  const cost = Math.round(
    addedTurns * getReduceLossReferenceExposure(choiceCount) *
    (1 - LOSS_CHANCE_REDUCTION_FACTOR) * 10000 +
    Math.abs(TARGET_CHOICE_EV_PERCENT) * 100
  ) / 100;
  const costText = cost.toFixed(2).replace(/\.?0+$/, "");
  return {
    ...choice,
    effect: -cost,
    title: `−${costText}%`
  };
}

function getEffectivePenaltyDetails(choice, currentMoney, startAmount = null, reduceLossTurns = 0, choiceCount = 2) {
  const cashRisk = choice.penaltyType === "cashRisk"
    ? getCashRisk(choice, currentMoney, startAmount)
    : null;
  const penaltyType = cashRisk ? cashRisk.penaltyType : choice.penaltyType;
  const fallbackChance = getAdaptivePenaltyChance(
    choice, currentMoney, startAmount
  );
  const baseChance = cashRisk
    ? cashRisk.chance
    : getBalancedBasePenaltyChance(
        choice, penaltyType, currentMoney, fallbackChance, choiceCount
      );
  const reductionApplies =
    isReducibleLossPenalty(penaltyType) && Number(reduceLossTurns) > 0;
  const chance = Math.max(0, Math.min(100, Math.round(
    baseChance * (reductionApplies ? LOSS_CHANCE_REDUCTION_FACTOR : 1) * 10000
  ) / 10000));

  return {
    cashRisk,
    penaltyType,
    baseChance,
    chance,
    reductionApplies
  };
}

function getChoicePenaltyText(choice, currentMoney, startAmount = null, reduceLossTurns = 0, choiceCount = 2) {
  if (choice.penaltyType !== "cashRisk") {
    const description = choice.penalty || "패널티: 없음";
    if (!Number(choice.penaltyChance) || !Number.isFinite(Number(startAmount))) {
      return description;
    }
    const details = getEffectivePenaltyDetails(
      choice, currentMoney, startAmount, reduceLossTurns, choiceCount
    );
    const chanceText = String(Number(details.chance.toFixed(4)));
    return description.replace(/[\d.]+% 확률/, chanceText + "% 확률");
  }

  const details = getEffectivePenaltyDetails(
    choice, currentMoney, startAmount, reduceLossTurns, choiceCount
  );
  const chance = String(Number(details.chance.toFixed(4)));
  if (details.penaltyType === "totalLoss") {
    return `패널티: ${chance}% 확률로 전액 손실`;
  }

  const lossPercent = {
    loss10: 10,
    loss25: 25,
    loss50: 50
  }[details.penaltyType];
  return `패널티: ${chance}% 확률로 ${lossPercent}% 손실`;
}

function isChoiceAvailableAtMoney(choice, currentMoney) {
  const money = Number(currentMoney);
  if (!Number.isFinite(money) || money <= 0) return true;
  const baseMultiplier = choice.effect < 0
    ? 1 - Math.abs(choice.effect) / 100
    : 1 + choice.effect / 100;
  const moneyAfterEffect = choice.amountEffect != null
    ? clampMoney(Math.round(money + Number(choice.amountEffect || 0)))
    : Math.round(money * baseMultiplier);
  const isPercentLoss = ["loss10", "loss25", "loss50"].includes(choice.penaltyType);
  // 시작 금액보다 잔액이 작아진 구간에서는 보너스 비용이 정수 반올림으로 0원이 되거나 과도해질 수 있어 제외합니다.
  if (money < 1000 && choice.effect < 0) return false;
  if (isPercentLoss && choice.penaltyChance > 0 && moneyAfterEffect <= 1) return false;
  return true;
}

function estimateChoiceValue(choice, currentMoney = null, startAmount = null, reduceLossTurns = 0, choiceCount = 2) {
  const money = Number(currentMoney);
  const hasMoney = Number.isFinite(money) && money > 0;
  const details = getEffectivePenaltyDetails(
    choice, hasMoney ? money : null, startAmount, reduceLossTurns, choiceCount
  );

  let moneyAfterEffect = null;
  if (hasMoney) {
    if (choice.amountEffect != null) {
      moneyAfterEffect = clampMoney(
        Math.round(money + Number(choice.amountEffect || 0))
      );
    } else if (choice.effect < 0) {
      moneyAfterEffect = money <= 1
        ? 0
        : clampMoney(Math.round(money * (1 - Math.abs(choice.effect) / 100)));
    } else {
      moneyAfterEffect = clampMoney(
        Math.round(money * (1 + Number(choice.effect || 0) / 100))
      );
    }
  }

  const lossFraction = {
    loss10: 0.10,
    loss25: 0.25,
    loss50: 0.50,
    totalLoss: 1
  }[details.penaltyType] || 0;

  let expectedFinal;
  if (hasMoney) {
    let moneyAfterPenalty = moneyAfterEffect;
    if (lossFraction > 0) {
      moneyAfterPenalty = details.penaltyType === "totalLoss" || moneyAfterEffect <= 1
        ? 0
        : clampMoney(Math.round(moneyAfterEffect * (1 - lossFraction)));
    }

    const chance = details.chance / 100;
    expectedFinal = moneyAfterEffect * (1 - chance) +
      moneyAfterPenalty * chance;

    if (["forceBlue", "forceRed", "forceGreen"].includes(details.penaltyType)) {
      // 강제 색상은 실제 현금 차감이 아니므로, 다음 턴 선택권 제한의 위험 환산치만 후보 비교에 반영합니다.
      expectedFinal *= 1 - chance * getForcedColorEquivalentCost(choiceCount);
    }

    const immediateValue = (expectedFinal / money - 1) * 100;
    if (choice.bonusType !== "reduceLoss") return immediateValue;

    const addedTurns = getAddedReduceLossTurns(
      reduceLossTurns, choice.bonusTurns
    );
    const futureValue = addedTurns * getReduceLossReferenceExposure(choiceCount) *
      (1 - LOSS_CHANCE_REDUCTION_FACTOR) * 100;
    return immediateValue + futureValue;
  }

  const baseMultiplier = choice.amountEffect != null
    ? 1
    : (choice.effect < 0
        ? 1 - Math.abs(choice.effect) / 100
        : 1 + Number(choice.effect || 0) / 100);
  let penaltyMultiplier = 1;
  if (lossFraction > 0) {
    penaltyMultiplier = 1 - (details.chance / 100) * lossFraction;
  } else if (["forceBlue", "forceRed", "forceGreen"].includes(details.penaltyType)) {
    penaltyMultiplier = 1 -
      (details.chance / 100) * getForcedColorEquivalentCost(choiceCount);
  }
  let value = (baseMultiplier * penaltyMultiplier - 1) * 100;

  if (choice.bonusType === "reduceLoss") {
    const addedTurns = getAddedReduceLossTurns(
      reduceLossTurns, choice.bonusTurns
    );
    value += addedTurns * getReduceLossReferenceExposure(choiceCount) *
      (1 - LOSS_CHANCE_REDUCTION_FACTOR) * 100;
  }
  return value;
}

function getChoiceRiskProfile(choice, currentMoney, startAmount, reduceLossTurns = 0, choiceCount = 2) {
  const money = Number(currentMoney);
  const hasMoney = Number.isFinite(money) && money > 0;
  const details = getEffectivePenaltyDetails(
    choice, hasMoney ? money : null, startAmount, reduceLossTurns, choiceCount
  );

  // 위험도는 패널티 확률만이 아니라 기본 효과로 확정되는 손실도 포함합니다.
  // 그래야 패널티가 없는 -10% 선택지가 근거 없이 '저위험'으로 분류되지 않습니다.
  const baseAfter = hasMoney
    ? getMoneyAfterChoiceEffect(choice, money)
    : null;
  const baseLoss = hasMoney
    ? Math.max(0, (money - baseAfter) / money)
    : (choice.effect < 0 ? Math.abs(choice.effect) / 100 : 0);
  const penaltyAfter = hasMoney
    ? getMoneyAfterPenalty(baseAfter, details.penaltyType)
    : null;
  const penaltyLoss = hasMoney
    ? Math.max(0, (money - penaltyAfter) / money)
    : (details.penaltyType === "totalLoss" ? 1 :
      ({ loss10: 0.10, loss25: 0.25, loss50: 0.50 }[details.penaltyType] || 0));
  const isForcedColor = [
    "forceBlue", "forceRed", "forceGreen"
  ].includes(details.penaltyType);
  const penaltyOutcomeLoss = isForcedColor
    ? Math.max(baseLoss, Math.min(1, baseLoss + getForcedColorEquivalentCost(choiceCount)))
    : penaltyLoss;

  const chance = details.chance / 100;
  const baseChance = details.baseChance / 100;
  const expectedLossFraction =
    baseLoss * (1 - chance) + penaltyOutcomeLoss * chance;
  const baseExpectedLossFraction =
    baseLoss * (1 - baseChance) + penaltyOutcomeLoss * baseChance;
  const worstCaseLossFraction = Math.max(baseLoss, penaltyOutcomeLoss);

  // 실제 위험 점수에는 보너스가 적용된 확률을 사용합니다.
  const riskScore =
    expectedLossFraction * 100 + worstCaseLossFraction * 20;
  // 위험 등급은 일시적 보너스에 흔들리지 않도록 보너스 적용 전 기본 확률로 고정합니다.
  // 그래야 보너스가 위험을 낮춘 직후 생성기가 더 위험한 선택지를 끌어와 효과를 상쇄하지 않습니다.
  const baseRiskScore =
    baseExpectedLossFraction * 100 + worstCaseLossFraction * 20;
  const tier = baseRiskScore <= 6.5 ? 0 : baseRiskScore <= 20 ? 1 : 2;

  return {
    tier,
    riskScore,
    baseRiskScore,
    chance: details.chance,
    baseChance: details.baseChance,
    lossFraction: worstCaseLossFraction,
    expectedLossFraction,
    baseExpectedLossFraction,
    penaltyType: details.penaltyType,
    reductionApplies: details.reductionApplies
  };
}

function selectFallbackChoiceSet(candidates, targetCount, riskById, valueById, currentMoney, previous) {
  if (candidates.length < targetCount) return candidates.slice();

  const combinations = [];
  function build(startIndex, picked) {
    if (picked.length === targetCount) {
      if (!picked.some(choice => !choice.bonusType)) return;
      const duplicateDisplay = picked.some((choice, index) =>
        picked.slice(0, index).some(item =>
          item.title === choice.title &&
          (item.penalty || "패널티: 없음") === (choice.penalty || "패널티: 없음")
        )
      );
      if (duplicateDisplay) return;

      const risks = picked.map(choice => riskById.get(choice.id));
      const values = picked.map(choice => valueById.get(choice.id));
      const incomeTiers = picked.map(choice => {
        const gross = choice.amountEffect != null
          ? Number(choice.amountEffect) / Math.max(1, Number(currentMoney) || 1) * 100
          : Number(choice.effect) || 0;
        return gross <= 2 ? 0 : gross <= 10 ? 1 : 2;
      });
      const tiers = new Set(risks.map(item => item.tier));
      const hasRequiredTierMix = targetCount === 2
        ? tiers.has(0) && tiers.size >= 2
        : tiers.has(0) && tiers.has(1) && tiers.has(2);
      combinations.push({
        choices: picked.slice(),
        previous: samePair(picked, previous),
        hasRequiredTierMix,
        riskTierCount: tiers.size,
        incomeTierCount: new Set(incomeTiers).size,
        riskSpread: Math.max(...risks.map(item => item.riskScore)) -
          Math.min(...risks.map(item => item.riskScore)),
        evSpread: Math.max(...values) - Math.min(...values),
        averageError: Math.abs(
          values.reduce((sum, value) => sum + value, 0) / values.length -
          TARGET_CHOICE_EV_PERCENT
        )
      });
      return;
    }

    for (let i = startIndex; i < candidates.length; i++) {
      picked.push(candidates[i]);
      build(i + 1, picked);
      picked.pop();
    }
  }
  build(0, []);

  if (!combinations.length) return candidates.slice(0, targetCount);
  const tierBalanced = combinations.filter(item => item.hasRequiredTierMix);
  const source = tierBalanced.length ? tierBalanced : combinations;
  const fresh = source.filter(item => !item.previous);
  const pool = (fresh.length ? fresh : source).sort((a, b) =>
    Number(b.hasRequiredTierMix) - Number(a.hasRequiredTierMix) ||
    b.riskTierCount - a.riskTierCount ||
    b.incomeTierCount - a.incomeTierCount ||
    b.riskSpread - a.riskSpread ||
    a.evSpread - b.evSpread ||
    a.averageError - b.averageError
  );

  // 정상 조합을 만들 수 없는 극단 잔액에서도 가능한 위험도·소득 다양성을 최대한 보존합니다.
  const shortlist = pool.slice(0, Math.min(10, pool.length));
  const selected = shortlist[Math.floor(Math.random() * shortlist.length)].choices.slice();
  for (let i = selected.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [selected[i], selected[j]] = [selected[j], selected[i]];
  }
  return selected;
}

function generateChoices(previous = null, count = 2, safeBoost = false, currentMoney = null, startAmount = null, reduceLossTurns = 0) {
  const targetCount = count === 3 ? 3 : 2;
  const pool = [...SAFE_CHOICES, ...RISKY_CHOICES]
    .filter(choice =>
      choice.id !== "riskMinus15Bonus" &&
      (targetCount === 3 || choice.penaltyType !== "forceGreen")
    )
    .map(choice => prepareChoiceForGeneration(
      scaleCashChoice(choice, currentMoney ?? startAmount),
      reduceLossTurns,
      targetCount
    ))
    .filter(Boolean);

  const candidates = [...new Map(pool.map(choice => [choice.id, choice])).values()]
    .filter(choice => isChoiceAvailableAtMoney(choice, currentMoney));
  if (candidates.length < targetCount) return candidates;

  // 선택지 구성은 일시적 손실 감소 보너스 전의 고유 기대값을 기준으로 유지합니다.
  // 보너스가 실제 손실 확률을 낮춘 뒤 생성기가 더 위험한 메뉴로 보상하지 않도록 분리합니다.
  const valueById = new Map(candidates.map(choice => [
    choice.id,
    estimateChoiceValue(choice, currentMoney, startAmount, 0, targetCount)
  ]));
  const riskById = new Map(candidates.map(choice => [
    choice.id,
    getChoiceRiskProfile(choice, currentMoney, startAmount, reduceLossTurns, targetCount)
  ]));

  // 선택지 수에 따라 위험도 구성이 달라집니다.
  // 2개 모드: 서로 다른 위험도 2종류 이상
  // 3개 모드: 저위험·중위험·고위험을 하나씩 포함
  const combinations = [];
  function build(startIndex, picked) {
    if (picked.length === targetCount) {
      // 적어도 하나는 일반 보상 선택지를 남겨 보너스끼리만 구성된 선택 세트를 방지합니다.
      if (!picked.some(choice => !choice.bonusType)) return;
      const tiers = picked.map(choice => riskById.get(choice.id).tier);
      const uniqueTiers = new Set(tiers);
      if (targetCount === 2 && (
        !uniqueTiers.has(0) || uniqueTiers.size < 2
      )) return;
      if (targetCount === 3 && (
        !uniqueTiers.has(0) || !uniqueTiers.has(1) || !uniqueTiers.has(2)
      )) return;

      const values = picked.map(choice => valueById.get(choice.id));
      const spread = Math.max(...values) - Math.min(...values);
      combinations.push({
        choices: picked.slice(),
        tiers,
        tierKey: tiers.slice().sort((a, b) => a - b).join("-"),
        spread,
        averageValue: values.reduce((sum, value) => sum + value, 0) / values.length,
        bestValue: Math.max(...values),
        previous: samePair(picked, previous)
      });
      return;
    }

    for (let i = startIndex; i < candidates.length; i++) {
      const choice = candidates[i];
      const duplicateDisplay = picked.some(item =>
        item.title === choice.title &&
        (item.penalty || "패널티: 없음") === (choice.penalty || "패널티: 없음")
      );
      if (picked.some(item => item.id === choice.id) || duplicateDisplay) continue;
      picked.push(choice);
      build(i + 1, picked);
      picked.pop();
    }
  }
  build(0, []);

  const fresh = combinations.filter(item => !item.previous);
  const available = fresh.length ? fresh : combinations;
  if (!available.length) return selectFallbackChoiceSet(candidates, targetCount, riskById, valueById, currentMoney, previous);

  // 기대 손익이 크게 치우친 조합은 우선 제외하되, 선택지의 위험도 차이는 유지합니다.
  let eligible = available.filter(item =>
    item.spread <= 1.25 && item.bestValue <= 0.25 && item.bestValue >= -0.75
  );
  if (!eligible.length) eligible = available.filter(item => item.spread <= 2);
  if (!eligible.length) eligible = available;

  const targetBestValue = TARGET_CHOICE_EV_PERCENT;
  const score = item =>
    4 * Math.abs(item.bestValue - targetBestValue) +
    2 * Math.abs(item.averageValue - targetBestValue) +
    0.25 * item.spread;

  const occurrenceCount = new Map();
  const tierCombinationCount = new Map();
  eligible.forEach(item => {
    item.choices.forEach(choice => {
      occurrenceCount.set(choice.id, (occurrenceCount.get(choice.id) || 0) + 1);
    });
    tierCombinationCount.set(
      item.tierKey,
      (tierCombinationCount.get(item.tierKey) || 0) + 1
    );
  });

  const weighted = eligible.map(item => {
    const hasBonus = item.choices.some(choice => choice.bonusType && choice.effect < 0);
    const hasNoPenaltyZero = item.choices.some(choice => choice.id === "safeNoPenalty");
    const baseRarityWeight = item.choices.reduce(
      (rarity, choice) => Math.min(
        rarity,
        Number(choice.rarityWeight) > 0 ? Number(choice.rarityWeight) : 1
      ),
      1
    );
    const containsRareJackpot = item.choices.some(choice =>
      ["rare25", "rare50", "rare100", "rare900", "ultra100x"].includes(choice.id)
    );
    // 3개 선택지 모드는 카드 수가 늘어나므로, 희귀 잭팟의 턴당 출현률을 2개 모드와 비슷하게 유지합니다.
    const rarityWeight = baseRarityWeight * (
      containsRareJackpot
        ? (targetCount === 3 ? 0.30 : 1.5)
        : 1
    );
    const riskLevels = item.choices.map(choice =>
      riskById.get(choice.id).tier
    );
    const riskGap = Math.max(...riskLevels) - Math.min(...riskLevels);
    const highRiskPairWeight =
      targetCount === 2 && riskLevels.includes(2) ? 0.7 : 1;

    return {
      item,
      weight:
        item.choices.reduce(
          (sum, choice) => sum + 1 / occurrenceCount.get(choice.id),
          0
        ) *
        (1 / tierCombinationCount.get(item.tierKey)) *
        (hasBonus ? 0.8 : 1) *
        (hasNoPenaltyZero ? 0.35 : 1) *
        rarityWeight *
        (1 + riskGap * 0.12) *
        highRiskPairWeight *
        (1 / (1 + score(item))) *
        (safeBoost && item.choices.some(choice =>
          SAFE_CHOICES.some(safeChoice => safeChoice.id === choice.id) &&
          choice.effect > 0
        ) ? 1.5 : 1)
    };
  });

  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return selectFallbackChoiceSet(candidates, targetCount, riskById, valueById, currentMoney, previous);
  }

  let roll = Math.random() * totalWeight;
  let picked = weighted[weighted.length - 1].item;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll < 0) {
      picked = entry.item;
      break;
    }
  }

  // 각 위치는 파랑·빨강·초록에 연결되므로, 무작위 셔플로 색상과 위험도의 고정 결합을 방지합니다.
  const selected = picked.choices.map(choice => ({ ...choice }));
  for (let i = selected.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [selected[i], selected[j]] = [selected[j], selected[i]];
  }
  return selected;
}

function calculateBankAccrual(principal, rate, elapsedMs, fractionalRemainder = 0) {
  const safePrincipal = Math.max(0, Number(principal) || 0);
  const safeRate = Math.max(0, Number(rate) || 0);
  const safeElapsed = Math.max(0, Number(elapsedMs) || 0);
  const safeRemainder = Math.max(0, Math.min(0.999999999, Number(fractionalRemainder) || 0));
  const exactInterest =
    safePrincipal * (safeRate / 100) * (safeElapsed / 60000) +
    safeRemainder;
  const whole = Math.floor(exactInterest + 1e-10);
  return {
    whole,
    remainder: Math.max(0, Math.min(0.999999999, exactInterest - whole))
  };
}

function calculateBankPartialInterest(principal, rate, elapsedMs) {
  return calculateBankAccrual(principal, rate, elapsedMs).whole;
}

function findChoice(id) {
  return [...SAFE_CHOICES, ...RISKY_CHOICES].find(choice => choice.id === id);
}

function normalizeChoice(raw, currentMoney = null) {
  if (!raw || typeof raw !== "object") return null;
  const known = findChoice(raw.id);
  if (!known) return null;
  const normalized = { ...known };
  // 손실 감소 보너스는 남은 보너스 턴에 따라 비용이 달라지므로 저장된 실제 비용과 표시를 그대로 복원합니다.
  if (known.bonusType === "reduceLoss") {
    const savedEffect = Number(raw.effect);
    if (Number.isFinite(savedEffect)) normalized.effect = savedEffect;
    if (typeof raw.title === "string" && raw.title) normalized.title = raw.title;
  }
  // 새 저장 형식은 이미 잔액에 맞춘 금액을 보존하고, 구버전의 미보정 금액은 현재 잔액 기준으로 한 번만 보정합니다.
  if (known.amountEffect != null) {
    const savedAmount = Number(raw.amountEffect);
    if (Number.isFinite(savedAmount) && savedAmount > 0) {
      const money = Number(currentMoney);
      const isLegacyUnscaled = savedAmount === Number(known.amountEffect) &&
        Number.isFinite(money) && money > 0 && money !== CASH_REWARD_REFERENCE_STAKE;
      const restoredAmount = isLegacyUnscaled
        ? savedAmount * getCashRewardScale(money)
        : savedAmount;
      normalized.amountEffect = Math.max(1, Math.round(restoredAmount));
      normalized.title = "+" + moneyFormat.format(normalized.amountEffect) + "원";
    }
  }
  return normalized;
}

/* =========================
   저장과 복구
========================= */

function defaultState() {
  return {
    budget: 10000,
    gameLimit: 5000,
    rerolls: 5,
    rerollCap: 5,
    bankPrincipal: 0,
    bankDepositLimit: 5000,
    bankInterest: 0,
    bankFractionalInterest: 0,
    bankElapsedMs: 0,
    bankRate: INITIAL_BANK_RATE,
    threeChoiceUnlocked: false,
    threeChoiceMode: false,
    backgroundTheme: "default",
    vibrationEnabled: true,
    wageNextAt: 0,
    activeGame: null,
    pendingSummary: null,
    gameHistory: []
  };
}

function readObject(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeState(raw) {
  const base = defaultState();

  if (!raw || typeof raw !== "object") return base;

  const normalized = {
    ...base,
    budget: clampMoney(raw.budget ?? raw.money ?? raw.balance ?? base.budget),
    gameLimit: clampMoney(raw.gameLimit ?? raw.maxGameMoney ?? base.gameLimit),
    rerolls: 0,
    rerollCap: 5,
    bankPrincipal: clampMoney(raw.bankPrincipal ?? raw.bankMoney ?? 0),
    bankDepositLimit: Math.max(
      5000,
      clampMoney(raw.bankDepositLimit ?? 5000),
      clampMoney(raw.bankPrincipal ?? raw.bankMoney ?? 0)
    ),
    bankInterest: clampMoney(raw.bankInterest ?? raw.interest ?? 0),
    bankFractionalInterest: Math.max(
      0,
      Math.min(0.999999999, Number(raw.bankFractionalInterest) || 0)
    ),
    bankRate: Math.max(
      1,
      Math.min(10, Math.floor(Number(raw.bankRate) || INITIAL_BANK_RATE))
    ),
    threeChoiceUnlocked: Boolean(raw.threeChoiceUnlocked),
    threeChoiceMode: Boolean(raw.threeChoiceMode && raw.threeChoiceUnlocked),
    backgroundTheme: ["default", "graphite", "cocoa", "plum", "stone"].includes(raw.backgroundTheme)
      ? raw.backgroundTheme
      : base.backgroundTheme,
    vibrationEnabled: raw.vibrationEnabled !== false,
    bankElapsedMs: Math.max(
      0,
      Math.floor(Number(raw.bankElapsedMs) || 0) % BANK_MINUTE_MS
    ),
    wageNextAt: Math.max(0, Number(raw.wageNextAt) || 0),
    activeGame: null,
    pendingSummary: null
  };

  normalized.gameLimit = Math.max(1000, normalized.gameLimit || 5000);
  normalized.rerollCap = Math.max(
    5,
    Math.min(50, Math.floor((Number(raw.rerollCap) || 5) / 5) * 5)
  );
  normalized.rerolls = Math.max(
    0,
    Math.min(
      normalized.rerollCap,
      Math.floor(Number(raw.rerolls ?? normalized.rerollCap) || 0)
    )
  );

  if (raw.activeGame && typeof raw.activeGame === "object") {
    const game = raw.activeGame;
    const choices = Array.isArray(game.choices)
      ? game.choices.map(rawChoice => {
          // 저장된 선택지는 이미 게임 잔액 기준으로 보정된 값입니다.
          // 불러올 때 다시 배율을 곱하면 재접속할 때마다 고정 보상이 중복 확대되므로 그대로 복원합니다.
          return normalizeChoice(rawChoice, game.money);
        })
      : [];

    const expectedChoiceCount = game.threeChoiceMode
      ? 3
      : (choices.length === 3 ? 3 : 2);

    if (
      clampMoney(game.startAmount) > 0 &&
      choices.length === expectedChoiceCount &&
      choices.every(Boolean)
    ) {
      normalized.activeGame = {
        startAmount: clampMoney(game.startAmount),
        money: clampMoney(game.money),
        turn: Math.max(1, Math.floor(Number(game.turn) || 1)),
        turnsPlayed: Math.max(0, Math.floor(Number(game.turnsPlayed) || 0)),
        rerollsUsed: Math.max(0, Math.floor(Number(game.rerollsUsed) || 0)),
        choices,
        threeChoiceMode: Boolean(game.threeChoiceMode || choices.length === 3),
        reduceLossTurns: Math.max(
          0,
          Math.min(10, Math.floor(Number(game.reduceLossTurns) || 0))
        ),
        safePositiveTurns: Math.max(
          0,
          Math.min(10, Math.floor(Number(game.safePositiveTurns) || 0))
        ),
        forcedColor:
          ["blue", "red"].includes(game.forcedColor) ||
          (game.forcedColor === "green" && choices.length === 3)
            ? game.forcedColor
            : null
      };
    }
  }

  if (raw.pendingSummary && typeof raw.pendingSummary === "object") {
    normalized.pendingSummary = {
      startAmount: clampMoney(raw.pendingSummary.startAmount),
      finalAmount: clampMoney(raw.pendingSummary.finalAmount),
      reason: String(raw.pendingSummary.reason || "게임 종료"),
      turnsPlayed: Math.max(0, Math.floor(Number(raw.pendingSummary.turnsPlayed) || 0)),
      rerollsUsed: Math.max(0, Math.floor(Number(raw.pendingSummary.rerollsUsed) || 0)),
      finishedAt: Math.max(0, Number(raw.pendingSummary.finishedAt) || 0)
    };
  }

  if (Array.isArray(raw.gameHistory)) {
    normalized.gameHistory = raw.gameHistory
      .filter(item => item && typeof item === "object")
      .map(item => ({
        startAmount: clampMoney(item.startAmount),
        finalAmount: clampMoney(item.finalAmount),
        turnsPlayed: Math.max(0, Math.floor(Number(item.turnsPlayed) || 0)),
        rerollsUsed: Math.max(0, Math.floor(Number(item.rerollsUsed) || 0)),
        finishedAt: Math.max(0, Number(item.finishedAt) || 0)
      }))
      .filter(item => item.startAmount > 0 && item.finishedAt > 0)
      .slice(0, 20);
  }

  return normalized;
}

function findLegacyState() {
  for (const key of LEGACY_KEYS) {
    if (key === STORAGE_KEY) continue;

    const old = readObject(key);
    if (old) return old;
  }

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);

      if (!key || key === STORAGE_KEY || !/risk|game/i.test(key)) {
        continue;
      }

      const old = readObject(key);

      if (old && (
        "budget" in old ||
        "money" in old ||
        "gameLimit" in old ||
        "rerolls" in old
      )) {
        return old;
      }
    }
  } catch {}

  return null;
}

function loadState() {
  const current = readObject(STORAGE_KEY);
  if (current) return normalizeState(current);

  const old = findLegacyState();

  if (old) {
    const migrated = normalizeState(old);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    } catch {}

    return migrated;
  }

  return defaultState();
}

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const name = String(parsed.name || "").trim();
    const code = String(parsed.code || "");
    if (!name || !/^\d{3,4}$/.test(code)) return null;
    return { name: name.slice(0, 20), code };
  } catch {
    return null;
  }
}

function saveProfile() {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    return true;
  } catch (error) {
    console.error("계정 정보 저장 실패:", error);
    return false;
  }
}

function createProfile(name) {
  return {
    name,
    code: String(Math.floor(Math.random() * 10000)).padStart(4, "0")
  };
}

let profile = loadProfile();
let state = loadState();
window.riskGameGetBudget = () => state.budget;
window.riskGameChangeBudget = delta => {
  const change=Number(delta);if(!Number.isSafeInteger(change))return false;
  const nextBudget=Number(state.budget)+change;if(!Number.isFinite(nextBudget)||nextBudget<0)return false;
  state.budget=Math.floor(nextBudget);saveState();updateAll();return true;
};
window.riskGameGetState = () => JSON.parse(JSON.stringify(state));
window.riskGameApplyCloudState = cloudState => {
  if (!cloudState || typeof cloudState !== "object" || Array.isArray(cloudState)) return false;
  try {
    state = normalizeState(cloudState);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem("risk-game-local-updated-at", String(Date.now()));
    updateAll();
    if (state.pendingSummary) showScreen("summaryScreen");
    else if (state.activeGame) showScreen("gameScreen");
    else showScreen("homeScreen");
    return true;
  } catch (error) {
    console.error("클라우드 게임 데이터 적용 실패:", error);
    return false;
  }
};
let currentScreen = "homeScreen";
let currentBankTab = "bank";
let moneyModalMode = null;
let saveTimer = null;
let appPermanentlyStopped = false;
let lastActiveTick =
  document.visibilityState === "visible" ? Date.now() : null;

function saveState() {
  if (appPermanentlyStopped) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem("risk-game-local-updated-at", String(Date.now()));
    window.dispatchEvent(new Event("risk-game-budget-updated"));
    window.dispatchEvent(new CustomEvent("risk-game-state-updated"));
    $("saveStatus").textContent = "저장됨";
    $("saveStatus").style.color = "var(--green)";
    return true;
  } catch (error) {
    $("saveStatus").textContent = "저장 실패";
    $("saveStatus").style.color = "#ff8295";
    console.error("저장 실패", error);
    return false;
  }
}

function scheduleSave() {
  if (appPermanentlyStopped) return;
  if (saveTimer !== null) clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveState();
  }, 100);
}

window.riskGameFinishAccountDeletion = () => {
  appPermanentlyStopped = true;
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const app = document.querySelector(".app");
  if (app) app.classList.add("hidden");
  const deletedScreen = $("accountDeletedScreen");
  if (deletedScreen) deletedScreen.classList.remove("hidden");
};

const SETTINGS_DEFAULT_CATEGORY = "accountSecurity";

function setSettingsCategory(category) {
  const allowed = ["accountSecurity", "controlsBackground", "reset"];
  const selected = allowed.includes(category) ? category : SETTINGS_DEFAULT_CATEGORY;
  document.querySelectorAll("[data-settings-category]").forEach(button => {
    const active = button.dataset.settingsCategory === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-settings-panel]").forEach(panel => {
    panel.classList.toggle("hidden", panel.dataset.settingsPanel !== selected);
  });
}

function applyBackgroundTheme() {
  const allowed = ["default", "graphite", "cocoa", "plum", "stone"];
  const theme = allowed.includes(state.backgroundTheme) ? state.backgroundTheme : "graphite";
  document.documentElement.dataset.appTheme = theme;
  document.querySelectorAll("[data-theme-value]").forEach(button => {
    const active = button.dataset.themeValue === theme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function updateSettingsControls() {
  applyBackgroundTheme();
  const toggle = $("vibrationEnabledToggle");
  if (toggle) toggle.checked = state.vibrationEnabled !== false;
}

function triggerGameVibration() {
  if (state.vibrationEnabled === false || !("vibrate" in navigator)) return;
  try { navigator.vibrate(170); } catch (error) {
    console.warn("진동을 실행하지 못했습니다:", error);
  }
}

document.querySelectorAll("[data-settings-category]").forEach(button => {
  button.addEventListener("click", () => setSettingsCategory(button.dataset.settingsCategory));
});

document.querySelectorAll("[data-theme-value]").forEach(button => {
  button.addEventListener("click", () => {
    const theme = button.dataset.themeValue;
    if (!["default", "graphite", "cocoa", "plum", "stone"].includes(theme)) return;
    state.backgroundTheme = theme;
    applyBackgroundTheme();
    saveState();
    const message = $("backgroundThemeMessage");
    if (message) message.textContent = "배경색을 저장했습니다.";
  });
});

$("vibrationEnabledToggle").addEventListener("change", event => {
  state.vibrationEnabled = Boolean(event.target.checked);
  saveState();
});

function renderProfile() {
  if (!profile) return;
  const displayName = profile.name;
  const displayCode = "#" + profile.code;
  $("homeProfileName").textContent = displayName;
  $("homeProfileCode").textContent = displayCode;
  $("profileDisplayName").textContent = displayName;
  $("profileDisplayCode").textContent = displayCode;
}

window.riskGameApplyCloudProfile = cloudProfile => {
  if (!cloudProfile || typeof cloudProfile.display_name !== "string" ||
      !/^\d{4}$/.test(String(cloudProfile.friend_code || ""))) return;
  profile = {
    name: cloudProfile.display_name.trim().slice(0, 20) || "플레이어",
    code: String(cloudProfile.friend_code)
  };
  saveProfile();
  renderProfile();
};

window.addEventListener("risk-game-account-restored", () => {
  // 복구 성공 후에는 새 기기의 계정 세션과 게임 기능을 다시 활성화합니다.
  appPermanentlyStopped = false;
  if (!state.pendingSummary && !state.activeGame) showScreen("homeScreen");
});

window.addEventListener("risk-game-account-displaced", () => {
  // 이전 기기의 진행 상태/프로필을 즉시 분리합니다. 서버의 클라우드 저장 데이터는 삭제하지 않습니다.
  appPermanentlyStopped = true;
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  state = defaultState();
  profile = null;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(PROFILE_STORAGE_KEY);
  localStorage.removeItem("risk-game-local-updated-at");
  LEGACY_KEYS.forEach(key => localStorage.removeItem(key));

  updateAll();
  renderProfile();
  showScreen("accountChoiceScreen");
});

function openProfileEditor(initialSetup = false) {
  $("profileError").textContent = "";
  $("profileModal").classList.remove("hidden");
  $("profileModalTitle").textContent = initialSetup ? "이름 등록" : "이름 변경";
  $("profileModalDescription").textContent = initialSetup
    ? "처음 시작하기 전에 사용할 이름을 등록하세요. 온라인 계정 연결 후 고유한 4자리 코드가 부여됩니다."
    : "이름만 변경됩니다. 기존 숫자 코드는 그대로 유지됩니다.";
  $("profileNameInput").value = profile ? profile.name : "";
  $("profileCodePreview").textContent = profile
    ? "내 코드: #" + profile.code
    : "온라인 계정 연결 후 4자리 코드가 부여됩니다.";
  $("saveProfileButton").textContent = initialSetup ? "등록하기" : "변경 저장";
  $("cancelProfileButton").classList.toggle("hidden", initialSetup);
  $("backToAccountChoiceButton").classList.toggle("hidden", !initialSetup);
  $("profileModal").dataset.initialSetup = initialSetup ? "true" : "false";
  $("profileNameInput").focus();
}

function closeProfileEditor() {
  if (!profile) return;
  $("profileModal").classList.add("hidden");
}

$("backToAccountChoiceButton").addEventListener("click", () => {
  // 아직 신규 프로필을 저장하지 않았을 때만 계정 선택 화면으로 돌아갑니다.
  if ($("profileModal").dataset.initialSetup !== "true") return;
  $("profileModal").classList.add("hidden");
  $("profileError").textContent = "";
  $("profileNameInput").value = "";
  showScreen("accountChoiceScreen");
});

$("saveProfileButton").addEventListener("click", () => {
  const name = $("profileNameInput").value.trim();
  if (!name) {
    $("profileError").textContent = "이름을 입력하세요.";
    return;
  }
  if (name.length > 20) {
    $("profileError").textContent = "이름은 20자 이내로 입력하세요.";
    return;
  }

  if (profile) {
    profile.name = name;
  } else {
    profile = createProfile(name);
  }

  if (!saveProfile()) {
    $("profileError").textContent = "저장하지 못했습니다. 브라우저 저장 공간을 확인하세요.";
    return;
  }

  renderProfile();
  window.dispatchEvent(new CustomEvent("risk-game-profile-updated", {
    detail: { name: profile.name, code: profile.code }
  }));
  const wasInitialSetup = $("profileModal").dataset.initialSetup === "true";
  $("profileModal").classList.add("hidden");
  if (wasInitialSetup) {
    window.dispatchEvent(new Event("risk-game-initial-profile-created"));
  }
});

$("cancelProfileButton").addEventListener("click", closeProfileEditor);
$("changeProfileNameButton").addEventListener("click", () => openProfileEditor(false));

/* =========================
   화면 이동
========================= */

const TITLES = {
  accountChoiceScreen: "계정 시작",
  restoreScreen: "기존 계정 복구",
  homeScreen: "리스크 게임",
  manualScreen: "설명서",
  amountScreen: "게임 금액 설정",
  gameScreen: "게임",
  summaryScreen: "게임 결과",
  historyScreen: "결과 내역",
  shopScreen: "상점",
  settingsScreen: "설정",
  moneyScreen: "돈 관리",
  friendScreen: "친구"
};

function showScreen(id) {
  const displaced = localStorage.getItem("risk-game-account-displaced-v1") === "true";
  if (displaced && id !== "accountChoiceScreen" && id !== "restoreScreen") return;
  if (!displaced && state.activeGame && id !== "gameScreen") return;
  if (!displaced && state.pendingSummary && id !== "summaryScreen") return;

  const target = $(id);
  if (!target) return;

  document.querySelectorAll("main .screen").forEach(screen => {
    screen.classList.toggle("hidden", screen.id !== id);
  });

  currentScreen = id;
  $("headerTitle").textContent = TITLES[id] || "리스크 게임";

  $("backButton").classList.toggle(
    "hidden",
    id === "homeScreen" ||
    id === "accountChoiceScreen" ||
    id === "gameScreen" ||
    id === "summaryScreen" ||
    Boolean(state.activeGame) ||
    Boolean(state.pendingSummary)
  );

  if (id === "amountScreen") {
    $("gameAmount").value = "";
    $("amountError").textContent = "";
    updateAmountScreen();
  }
  if (id === "gameScreen") renderGame();
  if (id === "summaryScreen") renderSummary();
  if (id === "shopScreen") updateShop();
  if (id === "historyScreen") renderGameHistory();
  if (id === "settingsScreen") {
    setSettingsCategory(SETTINGS_DEFAULT_CATEGORY);
    updateSettingsControls();
  }

  if (id === "moneyScreen") {
    setBankTab(currentBankTab);
    updateBank();
    updateWage();
  }

  window.scrollTo(0, 0);
}

$("newAccountButton").addEventListener("click", () => {
  appPermanentlyStopped = false;
  // 신규 계정은 이전 계정의 로컬 진행 데이터·프로필을 이어받지 않습니다.
  // 서버의 기존 계정과 데이터는 삭제하지 않고, 이 기기의 로컬 작업 공간만 새로 시작합니다.
  localStorage.removeItem("risk-game-account-displaced-v1");
  localStorage.removeItem("risk-game-recovery-enabled-v1");
  localStorage.removeItem(PROFILE_STORAGE_KEY);
  profile = null;
  state = defaultState();
  saveState();
  updateAll();
  $("homeProfileName").textContent = "이름";
  $("homeProfileCode").textContent = "#000";
  $("profileDisplayName").textContent = "이름";
  $("profileDisplayCode").textContent = "#000";
  $("profileNameInput").value = "";
  showScreen("homeScreen");
  openProfileEditor(true);
});

$("openRestoreScreenButton").addEventListener("click", () => showScreen("restoreScreen"));

document.querySelectorAll("[data-screen]").forEach(button => {
  button.addEventListener("click", () => showScreen(button.dataset.screen));
});

$("backButton").addEventListener("click", () => {
  if (state.activeGame || state.pendingSummary) return;
  if (currentScreen === "restoreScreen") {
    $("restoreRecoveryMessage").textContent = "";
    $("restoreRecoveryPassword").value = "";
    showScreen("accountChoiceScreen");
    return;
  }
  showScreen("homeScreen");
});

/* =========================
   메인 / 금액 선택
========================= */

function updateHome() {
  $("budgetDisplay").textContent = moneyText(state.budget);
  $("rerollDisplay").textContent =
    `${state.rerolls} / ${state.rerollCap}개`;
}

function relativeHistoryTime(timestamp) {
  const elapsed = Math.max(0, Date.now() - Number(timestamp || 0));
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "최근";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "하루 전";
  return `${days}일 전`;
}

function renderGameHistory() {
  const container = $("gameHistoryList");
  if (!container) return;
  const records = Array.isArray(state.gameHistory) ? state.gameHistory.slice(0, 20) : [];
  container.replaceChildren();

  if (!records.length) {
    const empty = document.createElement("p");
    empty.className = "muted history-empty";
    empty.textContent = "아직 정산된 게임 기록이 없습니다.";
    container.appendChild(empty);
    return;
  }

  records.forEach((record, index) => {
    const profit = record.finalAmount - record.startAmount;
    const item = document.createElement("article");
    item.className = "history-item";
    const top = document.createElement("div");
    top.className = "history-item-top";
    const title = document.createElement("strong");
    const stakeForRating = Math.max(1, Number(record.startAmount) || 0);
    const profitRate = profit / stakeForRating;
    if (profit === 0) {
      title.textContent = "변동없음";
    } else if (profit > 0) {
      title.textContent = profitRate < 0.25
        ? "약간의 수익"
        : profitRate < 1
          ? "큰 이익"
          : "매우 큰 이익";
    } else {
      const lossRate = Math.abs(profitRate);
      title.textContent = lossRate < 0.25
        ? "약간 손해"
        : lossRate < 0.75
          ? "큰 손해"
          : "매우 큰 손해";
    }
    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = relativeHistoryTime(record.finishedAt);
    top.append(title, time);
    const stake = document.createElement("div");
    stake.className = "history-detail-row";
    const stakeLabel = document.createElement("span");
    stakeLabel.textContent = "판돈";
    const stakeValue = document.createElement("strong");
    stakeValue.textContent = moneyText(record.startAmount);
    stake.append(stakeLabel, stakeValue);
    const result = document.createElement("div");
    result.className = "history-detail-row";
    const resultLabel = document.createElement("span");
    resultLabel.textContent = "손익";
    const resultValue = document.createElement("strong");
    resultValue.className = profit < 0 ? "history-loss" : "history-profit";
    resultValue.textContent = (profit > 0 ? "+" : profit < 0 ? "-" : "") + moneyText(Math.abs(profit));
    result.append(resultLabel, resultValue);
    const stats = document.createElement("p");
    stats.className = "history-stats";
    stats.textContent = `턴 ${record.turnsPlayed}회 · 리롤 ${record.rerollsUsed}회`;
    item.append(top, stake, result, stats);
    container.appendChild(item);
  });
}

$("startGameButton").addEventListener("click", () => {
  if (state.pendingSummary) return showScreen("summaryScreen");
  if (state.activeGame) return showScreen("gameScreen");

  showScreen("amountScreen");
});

function updateAmountScreen() {
  $("threeChoiceModeWrap").classList.toggle("hidden", !state.threeChoiceUnlocked);
  $("threeChoiceMode").checked = Boolean(state.threeChoiceMode && state.threeChoiceUnlocked);
  const maximum = Math.floor(Math.min(state.budget, state.gameLimit) / 1000) * 1000;
  $("availableBudgetDisplay").textContent = moneyText(state.budget);
  $("gameLimitDisplay").textContent = moneyText(state.gameLimit);
  $("gameAmount").max = String(maximum);
  const unavailable = maximum < 1000;
  $("confirmStartButton").disabled = unavailable;
  $("amountError").textContent = unavailable
    ? "게임을 시작하려면 최소 1,000원이 필요합니다."
    : "";
}

function readGameAmount() {
  const maximum = Math.floor(Math.min(state.budget, state.gameLimit) / 1000) * 1000;
  const textValue = $("gameAmount").value.trim();
  const raw = Number(textValue);
  if (!textValue || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < 1000) {
    $("amountError").textContent = "최소 금액은 1,000원이며 1,000원 단위로 입력하세요.";
    return null;
  }
  if (raw % 1000 !== 0) {
    $("amountError").textContent = "1,000원 단위로 입력하세요.";
    return null;
  }
  if (maximum < 1000) {
    $("amountError").textContent = "사용 가능한 금액이 부족합니다.";
    return null;
  }
  if (raw > maximum) {
    $("amountError").textContent = "입력한 금액이 예산 또는 게임 한도를 초과합니다.";
    return null;
  }
  $("amountError").textContent = "";
  return raw;
}

$("amountMinus").addEventListener("click", () => {
  const value = Number($("gameAmount").value) || 1000;

  $("gameAmount").value = String(Math.max(1000, value - 1000));
  readGameAmount();
});

$("amountPlus").addEventListener("click", () => {
  const value = Number($("gameAmount").value) || 0;

  const max = Math.floor(
    Math.min(state.budget, state.gameLimit) / 1000
  ) * 1000;

  $("gameAmount").value = String(Math.min(max, value + 1000));
  readGameAmount();
});

$("gameAmount").addEventListener("change", readGameAmount);

$("threeChoiceMode").addEventListener("change", () => {
  if (!state.threeChoiceUnlocked) {
    state.threeChoiceMode = false;
    $("threeChoiceMode").checked = false;
    return;
  }

  state.threeChoiceMode = $("threeChoiceMode").checked;
  saveState();
});

$("confirmStartButton").addEventListener("click", () => {
  if (state.activeGame || state.pendingSummary) return;

  const amount = readGameAmount();
  if (amount === null) return;

  state.budget -= amount;

  state.activeGame = {
    startAmount: amount,
    money: amount,
    turn: 1,
    turnsPlayed: 0,
    rerollsUsed: 0,
    threeChoiceMode: Boolean(
      state.threeChoiceMode && state.threeChoiceUnlocked
    ),
    reduceLossTurns: 0,
    safePositiveTurns: 0,
    choices: generateChoices(
      null,
      state.threeChoiceMode && state.threeChoiceUnlocked ? 3 : 2,
      false,
      amount,
      amount
    ),
    forcedColor: null
  };

  saveState();
  updateAll();
  showScreen("gameScreen");
});

/* =========================
   게임 UI
========================= */

function renderGame() {
  const game = state.activeGame;
  if (!game) return;

  $("gameRerollDisplay").textContent =
    `${state.rerolls} / ${state.rerollCap}`;
  $("gameMoneyDisplay").textContent = `${moneyText(game.money)} / ${moneyText(game.startAmount)}`;
  $("turnDisplay").textContent = String(game.turn);

  $("forcedHint").classList.toggle("hidden", !game.forcedColor);

  const isThree = game.choices.length === 3;
  const grid = document.querySelector(".choice-grid");

  grid.classList.toggle("three-choice", isThree);

  const ui = [
    {
      button: $("choiceLeft"),
      color: $("leftColor"),
      title: $("leftTitle"),
      penalty: $("leftDescription"),
      overlay: $("leftOverlay"),
      colorName: "blue",
      label: "파랑"
    },
    {
      button: $("choiceRight"),
      color: $("rightColor"),
      title: $("rightTitle"),
      penalty: $("rightDescription"),
      overlay: $("rightOverlay"),
      colorName: "red",
      label: "빨강"
    },
    {
      button: $("choiceGreen"),
      color: $("greenColor"),
      title: $("greenTitle"),
      penalty: $("greenDescription"),
      overlay: $("greenOverlay"),
      colorName: "green",
      label: "초록"
    }
  ];

  ui.forEach((item, index) => {
    const visible = index < game.choices.length;

    item.button.classList.toggle("hidden", !visible);
    if (!visible) return;

    const choice = game.choices[index];

    item.color.textContent = item.colorName.toUpperCase();
    item.title.textContent = choice.title;
    item.penalty.textContent = getChoicePenaltyText(choice, game.money, game.startAmount, game.reduceLossTurns, game.choices.length);

    const blocked = Boolean(
      game.forcedColor && game.forcedColor !== item.colorName
    );

    item.button.disabled = blocked;
    item.overlay.classList.toggle("hidden", !blocked);

    item.button.setAttribute(
      "aria-label",
      `${item.label} ${choice.title}. ${getChoicePenaltyText(choice, game.money, game.startAmount, game.reduceLossTurns)}`
    );
  });

  $("rerollButton").disabled = state.rerolls <= 0;
  $("stopGameButton").disabled = false;
}

/* =========================
   게임 효과 및 패널티
========================= */

function losePercent(percent) {
  const game = state.activeGame;
  if (!game) return;

  // 1원 이하에서만 더 이상 나눌 수 없는 잔액으로 처리합니다.
  // 1,000원 기준은 판돈별 손실률을 왜곡하므로 사용하지 않습니다.
  if (game.money <= 1) {
    game.money = 0;
    return;
  }

  game.money = clampMoney(
    Math.round(game.money * (1 - percent / 100))
  );
}

function applyPenalty(choice, selectedColor, beforeMoney = null) {
  const game = state.activeGame;
  if (!game) return "";

  const details = getEffectivePenaltyDetails(
    choice,
    beforeMoney == null ? game.money : beforeMoney,
    game.startAmount,
    game.reduceLossTurns,
    game.choices.length
  );
  const effectivePenaltyType = details.penaltyType;
  const effectiveChance = details.chance;

  if (Math.random() * 100 >= effectiveChance) {
    return choice.bonusType
      ? "보너스가 적용됩니다."
      : "패널티가 발생하지 않았습니다.";
  }

  switch (effectivePenaltyType) {
    case "loss10":
      losePercent(10);
      return game.money === 0
        ? "패널티 발동: 게임 금액이 0원이 되었습니다."
        : "패널티 발동: 현재 금액의 10%를 잃었습니다.";

    case "loss25":
      losePercent(25);
      return game.money === 0
        ? "패널티 발동: 게임 금액이 0원이 되었습니다."
        : "패널티 발동: 현재 금액의 25%를 잃었습니다.";

    case "loss50":
      losePercent(50);
      return game.money === 0
        ? "패널티 발동: 게임 금액이 0원이 되었습니다."
        : "패널티 발동: 현재 금액의 50%를 잃었습니다.";

    case "forceBlue":
    case "forceRed":
    case "forceGreen": {
      game.forcedColor = choice.penaltyType
        .replace("force", "")
        .toLowerCase();

      const names = {
        blue: "파랑",
        red: "빨강",
        green: "초록"
      };

      return `패널티 발동: 다음 턴은 ${names[game.forcedColor]}만 선택할 수 있습니다.`;
    }

    case "totalLoss":
      game.money = 0;
      return "패널티 발동: 게임 금액을 전부 잃었습니다.";

    default:
      return "패널티가 발생하지 않았습니다.";
  }
}

function chooseOption(index) {
  const game = state.activeGame;
  if (!game || state.pendingSummary) return;

  const colors = ["blue", "red", "green"];
  const color = colors[index];

  if (game.forcedColor && game.forcedColor !== color) return;

  const choice = game.choices[index];
  if (!choice) return;

  game.forcedColor = null;
  game.turnsPlayed = Math.max(0, Math.floor(Number(game.turnsPlayed) || 0)) + 1;

  const before = game.money;

  // 기본 효과를 먼저 적용하고, 그다음 패널티를 판정
  if (choice.amountEffect != null) {
    game.money = clampMoney(
      Math.round(game.money + Number(choice.amountEffect || 0))
    );
  } else if (choice.effect < 0) {
    losePercent(Math.abs(choice.effect));
  } else {
    game.money = clampMoney(
      Math.round(game.money * (1 + choice.effect / 100))
    );
  }

  if (game.money <= 0) {
    finishGame("게임 금액 소진");
    return;
  }

  const resultMessage = applyPenalty(choice, color, before);

  if (game.money <= 0) {
    finishGame("게임 금액 소진");
    return;
  }

  if (game.reduceLossTurns > 0) {
    game.reduceLossTurns -= 1;
  }

  if (game.safePositiveTurns > 0) {
    game.safePositiveTurns -= 1;
  }

  if (choice.bonusType === "reduceLoss") {
    game.reduceLossTurns = Math.min(
      10,
      Math.max(game.reduceLossTurns, choice.bonusTurns || 5)
    );
  }

  if (choice.bonusType === "safePositive") {
    game.safePositiveTurns = Math.min(
      10,
      Math.max(game.safePositiveTurns, choice.bonusTurns || 10)
    );
  }

  game.turn += 1;

  game.choices = generateChoices(
    game.choices,
    game.threeChoiceMode ? 3 : 2,
    game.safePositiveTurns > 0,
    game.money,
    game.startAmount,
    game.reduceLossTurns
  );

  const bonusStatus = [
    game.reduceLossTurns > 0
      ? `손실 패널티 감소 ${game.reduceLossTurns}턴`
      : "",
    game.safePositiveTurns > 0
      ? `안전한 양수 선택지 확률 증가 ${game.safePositiveTurns}턴`
      : ""
  ].filter(Boolean).join(" · ");

  $("gameMessage").textContent =
    `${choice.title}: ${moneyText(before)} → ${moneyText(game.money)}. ` +
    `${resultMessage}${bonusStatus ? " " + bonusStatus : ""}`;

  saveState();
  updateAll();
  renderGame();
}

$("choiceLeft").addEventListener("click", () => chooseOption(0));
$("choiceRight").addEventListener("click", () => chooseOption(1));
$("choiceGreen").addEventListener("click", () => chooseOption(2));

$("rerollButton").addEventListener("click", () => {
  const game = state.activeGame;
  if (!game || state.rerolls <= 0) return;

  state.rerolls -= 1;
  game.rerollsUsed = Math.max(0, Math.floor(Number(game.rerollsUsed) || 0)) + 1;

  game.choices = generateChoices(
    game.choices,
    game.threeChoiceMode ? 3 : 2,
    game.safePositiveTurns > 0,
    game.money,
    game.startAmount,
    game.reduceLossTurns
  );

  // 금액과 강제 색상은 유지
  saveState();
  updateAll();
  renderGame();

  $("gameMessage").textContent = "선택지가 바뀌었습니다.";
});

$("stopGameButton").addEventListener("click", () => {
  if (!state.activeGame) return;
  finishGame("사용자가 게임을 중지했습니다.");
});

/* =========================
   게임 종료 / 정산
========================= */

function finishGame(reason) {
  if (!state.activeGame || state.pendingSummary) return;

  if (reason === "사용자가 게임을 중지했습니다." || reason === "게임 금액 소진") {
    triggerGameVibration();
  }

  const game = state.activeGame;

  state.pendingSummary = {
    startAmount: clampMoney(game.startAmount),
    finalAmount: clampMoney(game.money),
    reason: String(reason || "게임 종료"),
    turnsPlayed: Math.max(0, Math.floor(Number(game.turnsPlayed) || 0)),
    rerollsUsed: Math.max(0, Math.floor(Number(game.rerollsUsed) || 0)),
    finishedAt: Date.now()
  };

  state.activeGame = null;

  saveState();
  showScreen("summaryScreen");
}

function renderSummary() {
  const result = state.pendingSummary;
  if (!result) return;

  const profit = result.finalAmount - result.startAmount;

  $("summaryTitle").textContent =
    profit > 0 ? "수익 발생!" :
    profit < 0 ? "손실 발생" :
    "원금 유지";

  $("summaryStart").textContent = moneyText(result.startAmount);
  $("summaryFinal").textContent = moneyText(result.finalAmount);

  const el = $("summaryProfit");

  el.textContent =
    (profit > 0 ? "+" : profit < 0 ? "−" : "") +
    moneyText(Math.abs(profit));

  el.classList.toggle("negative", profit < 0);
  $("summaryMessage").textContent = result.reason;
}

$("settleButton").addEventListener("click", () => {
  const result = state.pendingSummary;
  if (!result) return;

  state.budget = addMoney(state.budget, result.finalAmount);
  state.gameHistory = [{
    startAmount: clampMoney(result.startAmount),
    finalAmount: clampMoney(result.finalAmount),
    turnsPlayed: Math.max(0, Math.floor(Number(result.turnsPlayed) || 0)),
    rerollsUsed: Math.max(0, Math.floor(Number(result.rerollsUsed) || 0)),
    finishedAt: Math.max(0, Number(result.finishedAt) || Date.now())
  }, ...(Array.isArray(state.gameHistory) ? state.gameHistory : [])].slice(0, 20);
  state.pendingSummary = null;

  saveState();
  updateAll();
  showScreen("homeScreen");
});

/* =========================
   공통 확인 창
========================= */

let confirmAction = null;

function askConfirm(message, action, title = "구매 확인") {
  confirmAction = typeof action === "function" ? action : null;

  $("confirmModalTitle").textContent = title;
  $("confirmModalMessage").textContent = message;
  $("confirmModal").classList.remove("hidden");
}

function closeConfirm() {
  $("confirmModal").classList.add("hidden");
  confirmAction = null;
}

$("cancelConfirmButton").addEventListener("click", closeConfirm);

$("acceptConfirmButton").addEventListener("click", () => {
  const action = confirmAction;

  closeConfirm();

  if (action) action();
});

$("confirmModal").addEventListener("click", event => {
  if (event.target === $("confirmModal")) closeConfirm();
});

/* =========================
   상점
========================= */

function limitUpgrade() {
  let increment = 5000;
  let cost = 20000;

  while (
    state.gameLimit >= increment * 10 &&
    Number.isFinite(increment * 10) &&
    Number.isFinite(cost * 10)
  ) {
    increment *= 10;
    cost *= 10;
  }

  const nextLimit = state.gameLimit + increment;

  return { nextLimit, increment, cost };
}

function capUpgradeCost() {
  return 5000 + ((state.rerollCap - 5) / 5) * 2000;
}

function bankDepositLimitUpgrade() {
  const increment = 5000;
  const nextLimit = state.bankDepositLimit + increment;
  return {
    increment,
    nextLimit,
    cost: state.bankDepositLimit
  };
}

function updateShop() {
  const upgrade = limitUpgrade();
  const rateCost = bankRateUpgradeCost();
  const limitMaxed = !Number.isFinite(upgrade.nextLimit);
  const rerollMaxed = state.rerolls >= state.rerollCap;
  const capMaxed = state.rerollCap >= 50;
  const threeChoiceMaxed = state.threeChoiceUnlocked;
  const rateMaxed = state.bankRate >= 10;
  const depositUpgrade = bankDepositLimitUpgrade();
  const depositLimitMaxed = !Number.isFinite(depositUpgrade.nextLimit);

  $("shopBudgetDisplay").textContent = moneyText(state.budget);
  $("shopLimitDisplay").textContent = moneyText(state.gameLimit);

  $("limitPrice").textContent = limitMaxed ? "최대" : moneyText(upgrade.cost);
  $("buyLimitButton").classList.toggle("unavailable", limitMaxed || state.budget < upgrade.cost);
  $("buyLimitButton").setAttribute("aria-disabled", String(limitMaxed || state.budget < upgrade.cost));
  $("buyLimitButton").querySelector("small").textContent =
    limitMaxed ? "최대" : "구매";

  $("shopRerollDisplay").textContent = `${state.rerolls} / ${state.rerollCap}`;
  $("buyRerollButton").classList.toggle("unavailable", rerollMaxed || state.budget < REROLL_PURCHASE_COST);
  $("buyRerollButton").setAttribute("aria-disabled", String(rerollMaxed || state.budget < REROLL_PURCHASE_COST));
  $("buyRerollButton").querySelector("small").textContent =
    rerollMaxed ? "최대" : "구매";

  $("shopCapDisplay").textContent = `${state.rerollCap}개`;
  $("capPrice").textContent = capMaxed ? "최대" : moneyText(capUpgradeCost());
  $("buyCapButton").classList.toggle("unavailable", capMaxed || state.budget < capUpgradeCost());
  $("buyCapButton").setAttribute("aria-disabled", String(capMaxed || state.budget < capUpgradeCost()));
  $("buyCapButton").querySelector("small").textContent =
    capMaxed ? "최대" : "구매";

  $("threeChoiceUnlockDisplay").textContent = threeChoiceMaxed ? "해금 완료" : "미해금";
  $("threeChoicePrice").textContent = threeChoiceMaxed ? "구매 완료" : moneyText(100000000);
  $("buyThreeChoiceButton").classList.toggle("unavailable", threeChoiceMaxed || state.budget < 100000000);
  $("buyThreeChoiceButton").setAttribute("aria-disabled", String(threeChoiceMaxed || state.budget < 100000000));
  $("threeChoiceBuyLabel").textContent = threeChoiceMaxed ? "구매 완료" : "구매";

  $("shopBankRateDisplay").textContent = `${state.bankRate}%`;
  $("bankRatePrice").textContent = rateMaxed ? "최대" : moneyText(rateCost);
  $("buyBankRateButton").classList.toggle("unavailable", rateMaxed || state.budget < rateCost);
  $("buyBankRateButton").setAttribute("aria-disabled", String(rateMaxed || state.budget < rateCost));
  $("buyBankRateButton").querySelector("small").textContent =
    rateMaxed ? "최대" : "구매";

  $("shopBankDepositLimitDisplay").textContent = moneyText(state.bankDepositLimit);
  $("bankDepositLimitPrice").textContent = depositLimitMaxed
    ? "최대"
    : moneyText(depositUpgrade.cost);
  $("buyBankDepositLimitButton").classList.toggle(
    "unavailable",
    depositLimitMaxed || state.budget < depositUpgrade.cost
  );
  $("buyBankDepositLimitButton").setAttribute(
    "aria-disabled",
    String(depositLimitMaxed || state.budget < depositUpgrade.cost)
  );
  $("buyBankDepositLimitButton").querySelector("small").textContent =
    depositLimitMaxed ? "최대" : "구매";
}

let shopMessageTimer = null;
let shopMessageFadeTimer = null;
function shopMessage(message, isError = false) {
  const el = $("shopMessage");
  if (shopMessageTimer !== null) clearTimeout(shopMessageTimer);
  if (shopMessageFadeTimer !== null) clearTimeout(shopMessageFadeTimer);
  el.textContent = message;
  el.classList.toggle("shop-message-error", isError);
  el.classList.remove("shop-message-fading");
  el.style.opacity = "1";
  if (!message) return;
  shopMessageTimer = setTimeout(() => {
    el.classList.add("shop-message-fading");
    shopMessageFadeTimer = setTimeout(() => {
      el.textContent = "";
      el.classList.remove("shop-message-fading", "shop-message-error");
      el.style.opacity = "1";
      shopMessageTimer = null;
      shopMessageFadeTimer = null;
    }, 850);
  }, 1500);
}


let purchaseNoticeTimer = null;
let purchaseNoticeFadeTimer = null;

function showPurchaseNotice(message) {
  const el = $("purchaseNotice");
  if (!el) return;
  if (purchaseNoticeTimer !== null) clearTimeout(purchaseNoticeTimer);
  if (purchaseNoticeFadeTimer !== null) clearTimeout(purchaseNoticeFadeTimer);
  el.textContent = message;
  el.classList.remove("purchase-notice-fading");
  el.classList.add("purchase-notice-visible");
  purchaseNoticeTimer = setTimeout(() => {
    el.classList.add("purchase-notice-fading");
    purchaseNoticeFadeTimer = setTimeout(() => {
      el.textContent = "";
      el.classList.remove("purchase-notice-visible", "purchase-notice-fading");
      purchaseNoticeTimer = null;
      purchaseNoticeFadeTimer = null;
    }, 900);
  }, 1800);
}

$("buyLimitButton").addEventListener("click", () => {
  const upgrade = limitUpgrade();
  if (!Number.isFinite(upgrade.nextLimit)) return showPurchaseNotice("최대치 도달");
  if (state.budget < upgrade.cost) return showPurchaseNotice("예산 부족");

  askConfirm(
    `게임 한도를 ${moneyText(upgrade.increment)} 올립니다. 비용은 ${moneyText(upgrade.cost)}입니다. 정말 구매하시겠습니까?`,
    () => {
      const current = limitUpgrade();
      if (!Number.isFinite(current.nextLimit)) return showPurchaseNotice("최대치 도달");
      if (state.budget < current.cost) return showPurchaseNotice("예산 부족");
      state.budget -= current.cost;
      state.gameLimit = current.nextLimit;
      shopMessage(`게임 한도가 ${moneyText(state.gameLimit)}로 증가했습니다.`);
      saveState();
      updateAll();
    }
  );
});

$("buyRerollButton").addEventListener("click", () => {
  if (state.rerolls >= state.rerollCap) return showPurchaseNotice("최대치 도달");
  if (state.budget < REROLL_PURCHASE_COST) return showPurchaseNotice("예산 부족");

  askConfirm(`리롤 1회를 ${moneyText(REROLL_PURCHASE_COST)}에 구매하시겠습니까?`, () => {
    if (state.rerolls >= state.rerollCap) return showPurchaseNotice("최대치 도달");
    if (state.budget < REROLL_PURCHASE_COST) return showPurchaseNotice("예산 부족");
    state.budget -= REROLL_PURCHASE_COST;
    state.rerolls += 1;
    shopMessage("");
    saveState();
    updateAll();
  });
});

$("buyCapButton").addEventListener("click", () => {
  if (state.rerollCap >= 50) return showPurchaseNotice("최대치 도달");
  const cost = capUpgradeCost();
  if (state.budget < cost) return showPurchaseNotice("예산 부족");

  askConfirm(
    `리롤 최대치를 5회 늘립니다. 비용은 ${moneyText(cost)}입니다. 보유 리롤은 늘어나지 않습니다. 정말 구매하시겠습니까?`,
    () => {
      const actualCost = capUpgradeCost();
      if (state.rerollCap >= 50) return showPurchaseNotice("최대치 도달");
      if (state.budget < actualCost) return showPurchaseNotice("예산 부족");
      state.budget -= actualCost;
      state.rerollCap = Math.min(50, state.rerollCap + 5);
      state.rerolls = Math.min(state.rerolls, state.rerollCap);
      shopMessage("");
      saveState();
      updateAll();
    }
  );
});

$("buyThreeChoiceButton").addEventListener("click", () => {
  if (state.threeChoiceUnlocked) return showPurchaseNotice("이미 해금한 항목입니다");
  if (state.budget < 100000000) return showPurchaseNotice("예산 부족");

  askConfirm("3개 선택지 모드를 1억 원에 해금하시겠습니까?", () => {
    if (state.threeChoiceUnlocked) return showPurchaseNotice("이미 해금한 항목입니다");
    if (state.budget < 100000000) return showPurchaseNotice("예산 부족");
    state.budget -= 100000000;
    state.threeChoiceUnlocked = true;
    state.threeChoiceMode = false;
    saveState();
    updateAll();
    shopMessage("");
  });
});

$("buyBankDepositLimitButton").addEventListener("click", () => {
  const upgrade = bankDepositLimitUpgrade();
  if (!Number.isFinite(upgrade.nextLimit)) {
    return showPurchaseNotice("최대치 도달");
  }
  if (state.budget < upgrade.cost) return showPurchaseNotice("예산 부족");

  askConfirm(
    `은행 입금 한도를 ${moneyText(state.bankDepositLimit)}에서 ${moneyText(upgrade.nextLimit)}로 올립니다. 비용은 ${moneyText(upgrade.cost)}입니다. 정말 구매하시겠습니까?`,
    () => {
      const current = bankDepositLimitUpgrade();
      if (!Number.isFinite(current.nextLimit)) {
        return showPurchaseNotice("최대치 도달");
      }
      if (state.budget < current.cost) return showPurchaseNotice("예산 부족");

      state.budget -= current.cost;
      state.bankDepositLimit = current.nextLimit;
      shopMessage(`은행 입금 한도가 ${moneyText(state.bankDepositLimit)}로 증가했습니다.`);
      saveState();
      updateAll();
    },
    "입금 한도 업그레이드"
  );
});

$("buyBankRateButton").addEventListener("click", () => {
  if (state.bankRate >= 10) return showPurchaseNotice("최대치 도달");
  const cost = bankRateUpgradeCost();
  if (state.budget < cost) return showPurchaseNotice("예산 부족");

  askConfirm(
    `은행 이자율을 ${state.bankRate}%에서 ${state.bankRate + 1}%로 올립니다. 비용은 ${moneyText(cost)}입니다. 정말 구매하시겠습니까?`,
    () => {
      const actualCost = bankRateUpgradeCost();
      if (state.bankRate >= 10) return showPurchaseNotice("최대치 도달");
      if (state.budget < actualCost) return showPurchaseNotice("예산 부족");

      // 금리 변경 전까지의 시간은 기존 금리로 정산하고, 새 금리는 다음 구간부터 적용합니다.
      syncBankClock(Date.now());
      settleBankPartialInterest();
      resetBankMinute();

      state.budget -= actualCost;
      state.bankRate += 1;
      shopMessage("");
      saveState();
      updateAll();
    },
    "이자율 업그레이드"
  );
});

/* =========================
   은행
========================= */

function syncBankClock(now = Date.now()) {
  // 은행 원금이 없으면 이자 타이머를 멈추고 진행 시간을 초기화합니다.
  if (state.bankPrincipal <= 0) {
    state.bankElapsedMs = 0;
    lastActiveTick =
      document.visibilityState === "visible" ? now : null;
    return;
  }

  if (lastActiveTick === null) return;

  const elapsed = Math.max(0, now - lastActiveTick);
  lastActiveTick = now;
  state.bankElapsedMs += elapsed;

  while (state.bankElapsedMs >= BANK_MINUTE_MS) {
    state.bankElapsedMs -= BANK_MINUTE_MS;

    const accrual = calculateBankAccrual(
      state.bankPrincipal,
      state.bankRate,
      BANK_MINUTE_MS,
      state.bankFractionalInterest
    );
    state.bankInterest = addMoney(state.bankInterest, accrual.whole);
    state.bankFractionalInterest = accrual.remainder;
  }
}

function settleBankPartialInterest() {
  if (state.bankPrincipal <= 0 || state.bankElapsedMs <= 0) return;
  const accrual = calculateBankAccrual(
    state.bankPrincipal,
    state.bankRate,
    state.bankElapsedMs,
    state.bankFractionalInterest
  );
  state.bankInterest = addMoney(state.bankInterest, accrual.whole);
  state.bankFractionalInterest = accrual.remainder;
}

function resetBankMinute() {
  state.bankElapsedMs = 0;
  lastActiveTick =
    document.visibilityState === "visible" ? Date.now() : null;
}

function bankRateUpgradeCost() {
  return state.bankRate >= 10 ? 0 : state.bankRate * 100000;
}

function updateBank() {
  $("bankPrincipalDisplay").textContent = moneyText(state.bankPrincipal);
  $("bankDepositLimitDisplay").textContent =
    `${moneyText(state.bankPrincipal)} / ${moneyText(state.bankDepositLimit)}`;
  $("bankInterestDisplay").textContent = moneyText(state.bankInterest);
  $("bankTotalDisplay").textContent = moneyText(addMoney(state.bankPrincipal, state.bankInterest));
  if (state.bankPrincipal <= 0) {
    state.bankElapsedMs = 0;
    $("bankNextInterestDisplay").textContent = "입금하면 시작";
  } else {
    const secondsLeft = Math.ceil(Math.max(0, BANK_MINUTE_MS - state.bankElapsedMs) / 1000);
    $("bankNextInterestDisplay").textContent = `다음 이자까지 ${clockText(secondsLeft)}`;
  }
  $("bankRateDescription").textContent = `현재 이자율은 분당 ${state.bankRate}% 단리입니다. 앱이 활성화된 시간만 계산하며, 1분이 지날 때 이자가 반영됩니다. 원금이 너무 적으면 계산된 이자가 1원 미만으로 처리되어 표시되지 않을 수 있습니다. 입금 한도는 원금 기준이며 누적 이자는 한도에 포함되지 않습니다.`;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    // 화면이 숨겨지기 직전까지의 활성 시간만 반영
    syncBankClock(Date.now());
    lastActiveTick = null;
    saveState();
  } else {
    lastActiveTick = Date.now();
    updateBank();
  }
});

function setBankTab(tab) {
  currentBankTab = tab === "wage" ? "wage" : "bank";

  $("bankPanel").classList.toggle(
    "hidden",
    currentBankTab !== "bank"
  );

  $("wagePanel").classList.toggle(
    "hidden",
    currentBankTab !== "wage"
  );

  $("bankTab").classList.toggle("active", currentBankTab === "bank");
  $("wageTab").classList.toggle("active", currentBankTab === "wage");
}

$("bankTab").addEventListener("click", () => setBankTab("bank"));
$("wageTab").addEventListener("click", () => setBankTab("wage"));

/* =========================
   입금 / 출금
========================= */

function openMoneyModal(mode) {
  syncBankClock(Date.now());

  moneyModalMode = mode;
  $("moneyModal").classList.remove("hidden");
  $("modalError").textContent = "";
  $("moneyAmount").value = "";

  if (mode === "deposit") {
    $("modalTitle").textContent = "입금";

    const remainingDepositCapacity = Math.max(
      0,
      state.bankDepositLimit - state.bankPrincipal
    );
    $("modalDescription").textContent =
      `보유 예산 ${moneyText(state.budget)} · 입금 가능 한도 ${moneyText(remainingDepositCapacity)} (현재 한도 ${moneyText(state.bankDepositLimit)})`;

    $("moneyAmount").min = "1";
  } else {
    $("modalTitle").textContent = "출금";

    const pendingPartialInterest = calculateBankAccrual(
      state.bankPrincipal,
      state.bankRate,
      state.bankElapsedMs,
      state.bankFractionalInterest
    ).whole;
    const withdrawableAmount = addMoney(
      state.bankPrincipal,
      addMoney(state.bankInterest, pendingPartialInterest)
    );
    $("modalDescription").textContent =
      `출금 가능 금액 ${moneyText(withdrawableAmount)} · 원하는 금액만큼 출금할 수 있습니다.`;

    $("moneyAmount").min = "1";
  }

  $("confirmMoneyButton").textContent =
    mode === "deposit" ? "입금하기" : "출금하기";

  updateBank();
  $("moneyAmount").focus();
}

function closeMoneyModal() {
  $("moneyModal").classList.add("hidden");
  moneyModalMode = null;
}

$("openDepositButton").addEventListener(
  "click",
  () => openMoneyModal("deposit")
);

$("openWithdrawButton").addEventListener(
  "click",
  () => openMoneyModal("withdraw")
);

$("closeMoneyModal").addEventListener("click", closeMoneyModal);

$("moneyModal").addEventListener("click", event => {
  if (event.target === $("moneyModal")) closeMoneyModal();
});

$("confirmMoneyButton").addEventListener("click", () => {
  if (!moneyModalMode) return;

  syncBankClock(Date.now());

  const amount = Number($("moneyAmount").value);

  if (
    !Number.isFinite(amount) ||
    !Number.isInteger(amount) ||
    amount <= 0
  ) {
    $("modalError").textContent = "올바른 금액을 입력하세요.";
    return;
  }

  if (moneyModalMode === "deposit") {
    if (amount > state.budget) {
      $("modalError").textContent = "보유 예산보다 많이 입금할 수 없습니다.";
      return;
    }

    const remainingDepositCapacity = Math.max(
      0,
      state.bankDepositLimit - state.bankPrincipal
    );
    if (amount > remainingDepositCapacity) {
      $("modalError").textContent =
        `은행 입금 한도를 초과합니다. 현재 입금 가능 금액: ${moneyText(remainingDepositCapacity)}`;
      return;
    }

    // 입금 직전까지의 시간은 기존 원금 기준으로 먼저 정산합니다.
    settleBankPartialInterest();
    state.budget -= amount;
    state.bankPrincipal = addMoney(state.bankPrincipal, amount);

    resetBankMinute();
  } else {
    const pendingPartialInterest = calculateBankAccrual(
      state.bankPrincipal,
      state.bankRate,
      state.bankElapsedMs,
      state.bankFractionalInterest
    ).whole;
    const total = addMoney(
      state.bankPrincipal,
      addMoney(state.bankInterest, pendingPartialInterest)
    );

    if (amount > total) {
      $("modalError").textContent = "출금 가능 금액보다 많습니다.";
      return;
    }

    // 출금 직전까지의 시간은 출금 전 원금 기준으로 먼저 정산합니다.
    settleBankPartialInterest();

    // 누적 이자를 먼저 출금하고, 부족한 부분은 원금에서 차감
    const interestUsed = Math.min(amount, state.bankInterest);
    state.bankInterest -= interestUsed;

    const principalUsed = amount - interestUsed;
    state.bankPrincipal = Math.max(
      0,
      state.bankPrincipal - principalUsed
    );

    state.budget = addMoney(state.budget, amount);

    resetBankMinute();
  }

  saveState();
  updateAll();
  closeMoneyModal();
});

/* =========================
   시급
========================= */

function updateWage() {
  const remaining = Math.max(0, state.wageNextAt - Date.now());

  $("wageReadyDot").classList.toggle("hidden", remaining > 0);
  $("claimWageButton").disabled = remaining > 0;

  if (remaining <= 0) {
    $("wageCountdown").textContent = "지금 받을 수 있어요.";
    $("claimWageButton").textContent = "시급받기";
    return;
  }

  const seconds = Math.ceil(remaining / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  $("wageCountdown").textContent =
    `다음 시급까지 ${String(h).padStart(2, "0")}:` +
    `${String(m).padStart(2, "0")}:` +
    `${String(s).padStart(2, "0")}`;

  $("claimWageButton").textContent = "아직 받을 수 없습니다";
}

$("claimWageButton").addEventListener("click", () => {
  if (Date.now() < state.wageNextAt) return;

  state.budget = addMoney(state.budget, WAGE_AMOUNT);
  state.wageNextAt = Date.now() + WAGE_COOLDOWN_MS;

  saveState();
  updateAll();
});

/* =========================
   전체 초기화
========================= */

$("deleteAccountButton").addEventListener("click", () => {
  askConfirm(
    "정말로 이 계정을 영구 삭제할까요? 계정, 설정한 복구 비밀번호, 고유 코드, 클라우드 게임 데이터와 친구 관계가 모두 삭제됩니다. 삭제 후에는 복구할 수 없습니다.",
    () => {
      if (typeof window.riskGameDeleteAccount === "function") {
        window.riskGameDeleteAccount();
      } else {
        const status = $("deleteAccountMessage");
        if (status) {
          status.textContent = "계정 삭제 기능을 준비하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요.";
          status.classList.add("recovery-error");
        }
      }
    },
    "계정 영구 삭제 확인"
  );
});

$("leaveAccountButton").addEventListener("click", () => {
  askConfirm(
    "계정을 삭제하는 작업이 아닙니다. 이 기기에서만 계정에서 나가며, 계정과 온라인 게임 데이터는 서버에 그대로 남습니다. 다시 계정을 찾으려면 첫 화면에서 '기존 계정 복구'를 선택하고 복구 비밀번호를 입력해야 합니다. 복구 비밀번호를 설정하지 않았거나 잊어버렸다면 계정을 다시 찾지 못할 수 있습니다. 계속할까요?",
    () => {
      const status = $("leaveAccountMessage");
      if (status) {
        status.textContent = "";
        status.classList.remove("recovery-error");
      }
      if (typeof window.riskGameLeaveAccount === "function") {
        window.riskGameLeaveAccount();
      } else if (status) {
        status.textContent = "계정 나가기 기능을 준비하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요.";
        status.classList.add("recovery-error");
      }
    },
    "계정 탈퇴 확인"
  );
});

$("resetGameButton").addEventListener("click", () => {
  askConfirm(
    "모든 진행 데이터를 초기화할까요? 예산, 게임 한도, 리롤, 은행 원금과 이자, 이자율, 시급 대기 시간, 해금 항목과 진행 중인 게임이 모두 초기 상태로 돌아갑니다. 이 작업은 되돌릴 수 없습니다.",
    () => {
      state = defaultState();

      lastActiveTick =
        document.visibilityState === "visible" ? Date.now() : null;

      moneyModalMode = null;
      $("moneyModal").classList.add("hidden");
      $("gameMessage").textContent = "";
      $("shopMessage").textContent = "";

      saveState();
      applyBackgroundTheme();
      updateSettingsControls();
      updateAll();
      showScreen("homeScreen");
    },
    "전체 초기화 확인"
  );
});

/* =========================
   전체 갱신
========================= */

function updateAll() {
  updateHome();
  updateShop();
  updateBank();
  updateWage();
  updateSettingsControls();

  if (currentScreen === "amountScreen") updateAmountScreen();
  if (currentScreen === "gameScreen") renderGame();
  if (currentScreen === "summaryScreen") renderSummary();
  if (currentScreen === "historyScreen") renderGameHistory();
}

/* =========================
   서비스 워커 자동 업데이트
========================= */

if ("serviceWorker" in navigator) {
  let reloading = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;

    reloading = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration =
        await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });

      await registration.update();

      setInterval(() => {
        if (document.visibilityState === "visible") {
          registration.update().catch(() => {});
        }
      }, 60000);
    } catch (error) {
      console.error("서비스 워커 업데이트 확인 실패:", error);
    }
  });
}

/* =========================
   시작
========================= */

function initializeApp() {
  updateAll();
  renderProfile();

  if (localStorage.getItem("risk-game-account-displaced-v1") === "true") {
    showScreen("accountChoiceScreen");
  } else if (state.pendingSummary) {
    showScreen("summaryScreen");
  } else if (state.activeGame) {
    showScreen("gameScreen");
  } else if (
    profile ||
    localStorage.getItem("risk-game-recovery-enabled-v1") === "true"
  ) {
    // 이미 등록했거나 기존 계정을 복구한 사용자는 새로고침 후에도 메인으로 진입합니다.
    showScreen("homeScreen");
  } else {
    showScreen("accountChoiceScreen");
  }

  saveState();
}

setInterval(() => {
  if (appPermanentlyStopped || document.visibilityState !== "visible") return;

  syncBankClock(Date.now());
  updateBank();
  updateWage();
}, 1000);

initializeApp();