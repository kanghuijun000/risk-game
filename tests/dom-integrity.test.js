"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "script.js"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "sw.js"), "utf8");

test("게임 스크립트의 모든 정적 DOM 참조가 존재하고 HTML ID가 중복되지 않는다", () => {
  const referencedIds = [...new Set(
    [...script.matchAll(/\$\("([^"]+)"\)/g)].map(match => match[1])
  )];
  const htmlIds = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  const htmlIdSet = new Set(htmlIds);
  const missing = referencedIds.filter(id => !htmlIdSet.has(id));
  const duplicates = htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index);

  assert.deepEqual(missing, [], "script references missing HTML IDs");
  assert.deepEqual([...new Set(duplicates)], [], "HTML contains duplicate IDs");
});

test("3개 선택 모드의 접근성 안내도 실제 선택지 수에 맞는 패널티 확률을 사용한다", () => {
  const ariaStart = script.indexOf('item.button.setAttribute(\n      "aria-label"');
  const ariaEnd = script.indexOf("\n    );", ariaStart);
  assert.ok(ariaStart >= 0 && ariaEnd > ariaStart, "choice aria-label must exist");
  assert.ok(script.slice(ariaStart, ariaEnd).includes("game.choices.length"));
});

test("서비스 워커의 사전 캐시 파일이 실제 저장소에 모두 존재한다", () => {
  const appFilesBlock = serviceWorker.match(/const APP_FILES = \[([\s\S]*?)\];/);
  assert.ok(appFilesBlock, "APP_FILES list must exist");
  const appFiles = [...appFilesBlock[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  assert.ok(appFiles.length >= 5);
  const missing = appFiles.filter(file =>
    !fs.existsSync(path.join(root, file.replace(/^\.\//, "")))
  );
  assert.deepEqual(missing, [], "service worker pre-cache references missing files");
  assert.match(serviceWorker, /const CACHE_NAME = "risk-game-cache-v\d+";/);
});
