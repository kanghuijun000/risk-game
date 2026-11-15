"use strict";

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
  const context = {
    Math: seededMath,
    Intl,
    setSeed: value => { randomState = value >>> 0; }
  };
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
      SAFE_CHOICES, RISKY_CHOICES, generateChoices, getChoiceRiskProfile,
      getEffectivePenaltyDetails, getMoneyAfterChoiceEffect, getMoneyAfterPenalty,
      scaleCashChoice, estimateChoiceValue, TARGET_CHOICE_EV_PERCENT,
      getForcedColorEquivalentCost, getReduceLossReferenceExposure,
      prepareChoiceForGeneration, calculateBankPartialInterest,
      random: () => Math.random(), setSeed
    };
  `, context);
  return context.balanceApi;
}

module.exports = { loadBalanceEngine };
