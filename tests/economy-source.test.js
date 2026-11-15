"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

test("시급과 리롤 구매 가격·쿨다운이 고정 규칙을 유지한다", () => {
  assert.match(source, /const WAGE_AMOUNT = 10000;/);
  assert.match(source, /const REROLL_PURCHASE_COST = 5000;/);
  assert.match(source, /const WAGE_COOLDOWN_MS = 3600000;/);

  const rerollStart = source.indexOf('$("buyRerollButton").addEventListener');
  const rerollEnd = source.indexOf('$("buyCapButton").addEventListener', rerollStart);
  const rerollHandler = source.slice(rerollStart, rerollEnd);
  assert.ok(rerollStart >= 0 && rerollEnd > rerollStart);
  assert.match(rerollHandler, /state\.budget -= REROLL_PURCHASE_COST/);
  assert.match(rerollHandler, /state\.rerolls \+= 1/);
  assert.doesNotMatch(rerollHandler, /REROLL_PURCHASE_COST\s*\*|\*\s*REROLL_PURCHASE_COST/);

  const wageStart = source.indexOf('$("claimWageButton").addEventListener');
  const wageEnd = source.indexOf("/* =========================\n   전체 초기화", wageStart);
  const wageHandler = source.slice(wageStart, wageEnd);
  assert.match(wageHandler, /Date\.now\(\) < state\.wageNextAt/);
  assert.match(wageHandler, /state\.wageNextAt = Date\.now\(\) \+ WAGE_COOLDOWN_MS/);
  assert.match(wageHandler, /state\.budget = addMoney\(state\.budget, WAGE_AMOUNT\)/);
});

test("은행·리롤 한도·3개 선택 모드의 업그레이드 상한과 가격 공식을 유지한다", () => {
  assert.match(source, /function bankRateUpgradeCost\(\) \{\s*return state\.bankRate >= 10 \? 0 : state\.bankRate \* 100000;/);
  assert.match(source, /function bankDepositLimitUpgrade\(\) \{\s*const increment = 5000;[\s\S]*?cost: state\.bankDepositLimit/);
  assert.match(source, /function capUpgradeCost\(\) \{\s*return 5000 \+ \(\(state\.rerollCap - 5\) \/ 5\) \* 2000;/);
  assert.match(source, /if \(state\.rerollCap >= 50\)/);
  assert.match(source, /state\.budget < 100000000/);
  assert.match(source, /state\.budget -= 100000000/);
});


test("은행은 원금 기준 단리이며 분당 1~10% 상한과 활성 시간만 계산한다", () => {
  assert.match(source, /const BANK_MINUTE_MS = 60000;/);
  assert.match(source, /const INITIAL_BANK_RATE = 1;/);
  assert.match(source, /bankRate: Math\.max\(\s*1,\s*Math\.min\(10,/);
  assert.match(source, /function calculateBankAccrual\(principal, rate, elapsedMs, fractionalRemainder = 0\)/);
  assert.match(source, /safePrincipal \* \(safeRate \/ 100\) \* \(safeElapsed \/ 60000\)/);
  assert.doesNotMatch(source.slice(source.indexOf("function calculateBankAccrual"), source.indexOf("function calculateBankPartialInterest")), /bankInterest|compound|interest \+=/i);
  assert.match(source, /document\.visibilityState === "visible" \? Date\.now\(\) : null/);
  assert.match(source, /if \(document\.visibilityState === "hidden"\)[\s\S]*?lastActiveTick = null;[\s\S]*?saveState\(\)/);
});

test("은행 한도·금리 업그레이드는 증가량·가격·상한을 일관되게 적용한다", () => {
  assert.match(source, /function bankRateUpgradeCost\(\) \{\s*return state\.bankRate >= 10 \? 0 : state\.bankRate \* 100000;/);
  assert.match(source, /function bankDepositLimitUpgrade\(\) \{\s*const increment = 5000;[\s\S]*?cost: state\.bankDepositLimit/);
  assert.match(source, /state\.bankDepositLimit = current\.nextLimit/);
  assert.match(source, /state\.bankRate \+= 1/);
  assert.match(source, /settleBankPartialInterest\(\);\s*resetBankMinute\(\);\s*state\.budget -= actualCost;\s*state\.bankRate \+= 1/);
});

test("리롤 최대치는 5회씩 증가하고 50회에서 멈추며 3개 선택 모드 해금은 1억 원이다", () => {
  assert.match(source, /state\.rerollCap >= 50/);
  assert.match(source, /state\.rerollCap = Math\.min\(50, state\.rerollCap \+ 5\)/);
  assert.match(source, /state\.budget < 100000000/);
  assert.match(source, /state\.budget -= 100000000/);
});
