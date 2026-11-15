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
