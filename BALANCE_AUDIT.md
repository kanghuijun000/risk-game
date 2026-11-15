# Risk Game Balance Audit — Iteration 2

## Scope and safety

All currency is fictional in-game currency. This branch is isolated from `main`; no player balances, saved games, Supabase data, or production deployment have been changed.

Current inspected branch:
- `script.js` blob: `5652ef1440605624f39fed77a9b2d736c43a8b31`
- `index.html` loads `script.js?v=63`
- `sw.js` cache: `risk-game-cache-v92`

## Source corrections already made on this branch

1. Reworked cash-risk probability calculation to use the exact rounded post-effect and post-penalty balances.
2. Added exact post-effect/post-penalty balance helpers so the EV estimator follows gameplay order: base effect, then penalty, with integer rounding.
3. Increased probability precision to four decimal places and corrected the displayed-probability replacement pattern.
4. Preserved the saved cost/title of an active reduce-loss bonus when restoring an in-progress game.
5. Removed the obsolete duplicate `riskMinus15Bonus` entry from the generated candidate pool.
6. Excluded negative-percentage options below 1,000 balance, where integer rounding would make their displayed loss inconsistent. The actual game start minimum is 1,000.
7. Corrected the risk profile to include guaranteed losses from the base effect, not just the penalty. Risk score is now:
   `expectedLossFraction * 100 + worstCaseLossFraction * 20`.
   Forced-color penalties use the existing 6% equivalent opportunity-cost estimate.
8. Adjusted the 3-choice rare-jackpot weight after measuring per-turn appearance rates.
9. Bumped the script URL and service-worker cache to force clients to receive the new logic.

## Current choice inventory

The source contains 11 safe-array entries and 23 risky-array entries (34 defined entries). The obsolete duplicate `riskMinus15Bonus` is filtered out of generation, leaving at most 33 source candidates before balance/availability filtering.

The current reward range includes:
- Small positive choices: +0.3% and +0.5%.
- Medium and large percentage rewards through +100%.
- A +900% rare reward.
- A ×100 reward (9,900% effect) with a 99% full-loss penalty.

The earlier claim that the smallest positive choice was about +0.9% was incorrect for this current source: +0.3% exists.

## Current mathematical rules

- Target estimated expected return before temporary bonuses: `TARGET_CHOICE_EV_PERCENT = -0.05`.
- Fixed-cash reference stake: 10,000.
- Partial-loss probability reduction while the bonus is active: 20% (`LOSS_CHANCE_REDUCTION_FACTOR = 0.8)); full-loss jackpot probabilities are not reduced.
- Forced-color opportunity-cost approximation: 6%.
- Reduce-loss bonus future-exposure estimate: 6.1% (`REDUCE_LOSS_REFERENCE_EXPOSURE = 0.061)); this is currently a single shared value for both choice modes and is under review because the observed benefit differs by mode.
- Risk score: expected loss percentage plus 20 times the worst-case loss fraction.
- Risk tiers: low <=6.5; medium <=20; high >20.
- Two-choice generation requires low risk plus one different tier. Three-choice generation requires one of each tier.
- The generator first filters for close expected values, then relaxes the EV spread when needed; a dedicated fallback chooses the best available risk/income mix when normal combinations cannot be built.

## Verification performed

### Static checks

- `script.js`: JavaScript parse check passed.
- `sw.js`: JavaScript parse check passed.
- `manifest.json`: JSON parse check passed.
- `index.html`: checked that it loads `script.js?v=63` and references the expected local assets.
- Confirmed the service-worker cache name is `risk-game-cache-v92`.

These are source-level checks, not browser or live-site tests.

### Deterministic outcome checks

Across 340 option/stake/bonus combinations (all defined choices after scaling and availability filtering; stakes 1,000 through 1,000,000; no active bonus and five active bonus turns), deterministic checks compared the estimator with independently calculated weighted outcomes and forced-hit/forced-miss executions of the actual penalty handler:
- Expected-value formula mismatches: 0.
- Actual penalty outcome/rounding mismatches: 0.
- Displayed probability mismatches: 0.

This confirms the current source-level calculation and handler agree for the tested states. It does not prove long-run player-strategy balance.

### Choice-generation sampling

A seeded deterministic run sampled 10,000 consecutive generated sets per mode at a 10,000 starting balance.

Two-choice mode:
- Every generated set met the required low-risk plus a different risk-tier condition.
- Tier-pair distribution: low+medium 82.14%; low+high 17.86%.
- No adjacent repeated choice sets in this sample.
- Mean estimated value across displayed options: -0.0564% per choice.
- Blue vs red tier shares:
  - Blue: low 50.53%, medium 40.85%, high 8.62%.
  - Red: low 49.47%, medium 41.29%, high 9.24%.

Three-choice mode:
- All 10,000 sets contained one low-, one medium-, and one high-risk option.
- No adjacent repeated choice sets in this sample.
- Mean estimated value across displayed options: -0.0540% per choice.
- Color tier shares were close to one-third each:
  - Blue: 33.40%, 33.30%, 33.30%.
  - Red: 33.23%, 32.63%, 34.14%.
  - Green: 33.37%, 34.07%, 32.56%.

Exploratory stake sweep:
- Stakes tested: 1,000; 5,000; 10,000; 100,000; 1,000,000.
- 300 generated sets per stake and mode.
- Every playable stake tested produced the required set length and risk-tier composition.
- Mean estimated values stayed near the -0.05% target, with observed sample means between approximately -0.059% and -0.053%.
- A 1-unit, three-choice stress test could not always produce three distinct tiers because integer rounding collapses small losses into full losses. This is outside the game: the actual start minimum is 1,000.

### Risk/income mix

For this diagnostic only, income tiers were classified by gross effect relative to current balance: low <=2%, medium >2% to 10%, high >10%. Cash rewards were converted to a percentage of current balance.

Two-choice option shares by risk tier (rows low/medium/high) and income tier (columns low/medium/high):
- Low risk: 34.80%, 15.20%, 0%.
- Medium risk: 2.42%, 23.73%, 14.92%.
- High risk: 0%, 3.23%, 5.70%.

Three-choice option shares:
- Low risk: 25.14%, 8.19%, 0%.
- Medium risk: 2.00%, 19.33%, 12.01%.
- High risk: 0%, 13.24%, 20.09%.

This confirms that medium-risk/medium-income options are present. The matrix is not fully occupied: high-risk/low-income and low-risk/high-income are absent under the current payoff/EV rules. These cells should not be filled artificially with dominated choices; whether new mechanics are needed remains an open design decision.

## Important unresolved balance findings

1. **Reduce-loss bonus differs sharply by mode.** With five active reduce-loss turns, partial-loss choices gain expected value because their penalty probability is reduced by 20%. In a 3,000-set sample, the three-choice mode's mean displayed-choice EV rose to about +0.425% (from about -0.054% with no active bonus). In two-choice mode the generator strongly preferred low+high pairs whose high-risk option is often a full-loss penalty, which the bonus does not reduce; its mean displayed-choice EV stayed near -0.047%. This suggests the bonus's price and/or choice weighting is not yet calibrated consistently between modes.
2. **Safe-positive bonus valuation is incomplete.** It changes future generation weights, but its future value is not included as a direct term in `estimateChoiceValue`.
3. **Risk tiers remain a design model.** The revised score now includes guaranteed downside, but its weights and thresholds still need validation against ruin probability, drawdown, and actual strategy outcomes.
4. **Reroll strategy and economy interaction remain to be tested.** A reroll costs a fixed 5,000 from budget, consumes one purchased reroll, preserves game balance and forced color, and regenerates the choices. Its opportunity cost depends on the value of the rejected set.
5. **Long-horizon player strategy simulations are not complete.** The current results are choice-set samples and deterministic source-level outcome checks, not a finished 1/5/10/20/50/100-turn Monte Carlo study.
6. **Bank rate timing suspicion corrected.** Current source synchronizes elapsed bank time and settles the old-rate partial interval before changing the rate. The earlier suspected old-time/new-rate bug is not present in this branch. Fractional-won rounding and deposit/withdraw timer reset behavior still need explicit deterministic tests.
7. **No browser regression or live deployment check has been completed.** Supabase, saved-state restoration in a real browser, installed-PWA cache behavior, and Pages deployment remain unverified.

## Merge gate

Do not merge this branch yet. Before merging, complete:
- Independent outcome simulation against the actual `applyPenalty` order and rounding.
- Mode-specific reduce-loss and safe-positive bonus valuation.
- Reroll-aware strategies and full 1/5/10/20/50/100-turn outcome distributions.
- Bank, wage, shop, and stopping-rule economy tests.
- Browser regression checks for active-game restore, forced colors, rerolls, and PWA updates.
- Confirmation that no unrelated UI, account, cloud, or saved data behavior changed.

No odds are adjusted based on player profit, current balance, or turn count.

## Iteration 3 — latest branch state (2026-11-15)

Latest code snapshot:
- Branch: balance-system-audit
- script.js URL: script.js?v=67
- Service-worker cache: risk-game-cache-v96
- Production main remains unchanged; this is still a draft PR.

### Corrections since the earlier snapshot

1. Forced-color opportunity cost is now mode-specific: 6% for two-choice mode and 12% for three-choice mode. The latter reflects the greater loss of choice freedom when one of three colors is forced. The calibration is used consistently by penalty probability, expected-value, and risk-profile calculations.
2. Risk-tier classification now uses the intrinsic/base penalty chance, while the displayed risk score still reflects the currently active reduce-loss bonus. A temporary bonus therefore reduces actual risk without causing the generator to replace that safer menu with a more dangerous tier mix.
3. Choice-set expected-value matching uses the no-temporary-bonus baseline. This prevents the generator from counterbalancing an active bonus by silently selecting higher-risk choices.
4. Bonus-only choice sets are rejected in both the primary combination search and fallback search.
5. Reduce-loss bonus reference exposure is now mode-specific: 8.97% for two-choice and 10.51% for three-choice. For a five-turn bonus this produces an in-game cost of approximately 9.02% and 10.56%, respectively, including the existing target-EV offset.

### Automated regression checks

Latest GitHub Actions run for the current branch completed successfully:
- Balance audit tests: **7 passed, 0 failed**.
- Recovery/source validation: **passed**.
- The balance tests include exact expected-value vs penalty-outcome checks, 20% partial-loss reduction checks, forced-color mode calibration, bonus price calibration, risk-tier composition, color-position tier-frequency checks, and low-balance generator stress.
- The color-position sampling test uses 4,000 generated sets per mode and accepts at most a 4-percentage-point difference in any tier's frequency between color positions.

These are automated source-level tests, not a live browser test.

### Additional strategy-conditioned bonus-value sample

A seeded 1,500-choice sample per mode and strategy measured the expected benefit of the active five-turn loss-reduction bonus on the selected ordinary choice. This is a one-turn conditional value estimate multiplied by five for a simple exposure estimate; it is not a full five-turn stateful run.

| Mode | Selection strategy | Mean benefit / turn | Simple five-turn estimate |
|---|---|---:|---:|
| 2 choices | Random | 1.2854% | 6.427% |
| 2 choices | Lowest risk | 0.3844% | 1.922% |
| 2 choices | Medium risk | 1.7179% | 8.590% |
| 2 choices | Highest nominal reward | 2.1666% | 10.833% |
| 3 choices | Random | 1.8119% | 9.060% |
| 3 choices | Lowest risk | 0.3848% | 1.924% |
| 3 choices | Medium risk | 1.9818% | 9.909% |
| 3 choices | Highest nominal reward | 3.4293% | 17.146% |

The current five-turn bonus prices are close to the medium-risk selection estimate in each mode. Conservative play receives less value, while high-risk play can extract more value but also has substantially greater downside. This is a deliberate trade-off, not a guarantee of equal realized outcomes. The simple five-turn estimate ignores compounding, changing balances, and future menu changes, so it must not be treated as a final valuation.

### Preliminary 20-turn session simulation

A separate seeded source-function simulation ran 100 sessions for each mode/strategy pair, starting at 10,000 and stopping at zero or 20 turns. It used the current choice generator, effect and penalty helpers, forced-color restriction, and temporary bonus countdown. It did not yet include reroll purchases, wage, bank, or the full UI settlement path.

| Mode | Strategy | Mean final balance | Median | Ruin rate | Mean turns |
|---|---|---:|---:|---:|---:|
| 2 | Random | 10,371 | 8,563 | 22% | 18.14 |
| 2 | Lowest risk | 11,048 | 10,891 | 1% | 19.97 |
| 2 | Highest estimated EV | 10,040 | 7,544 | 24% | 18.02 |
| 2 | Highest nominal reward | 13,414 | 8,619 | 29% | 17.02 |
| 3 | Random | 9,106 | 0 | 51% | 14.61 |
| 3 | Lowest risk | 11,310 | 11,112 | 4% | 19.77 |
| 3 | Highest estimated EV | 9,693 | 3,383 | 44% | 14.10 |
| 3 | Highest nominal reward | 7,933 | 0 | 87% | 8.94 |

This sample is exploratory only (100 sessions per cell; wide uncertainty). It suggests that three-choice mode has much more severe tail risk under aggressive selection, while a lowest-risk strategy behaves similarly in both modes. It does not justify changing three-choice probabilities yet. Larger runs and a verified stateful strategy harness are required before making a balance change.

### Remaining work / merge gate

- Expand stateful Monte Carlo to 1,000+ sessions per cell, then continue where confidence intervals remain wide.
- Test 1/5/10/20/50/100 turns and stakes 1,000/5,000/10,000/100,000/1,000,000.
- Add reroll-aware, stop-after-profit, risk-tier-targeting, and forced-color-aware strategies.
- Validate red/blue/green realized monetary outcomes, not only tier-position frequencies.
- Add exact bank/wage/shop economy tests, including fractional-interest behavior at rate-upgrade boundaries.
- Verify the actual choice execution path, save/restore, rerolls, and settlement against the harness.
- Run browser/PWA regression checks before considering merge.

**Do not merge or deploy yet.** No change in this branch is live on Pages, and no player balance or Supabase data has been touched.

### Red/blue/green position-value comparison

A separate seeded sample generated 6,000 choice sets per mode at a 10,000 balance and compared the estimated value of each returned color position. Since the generator shuffles the selected options before assigning positions, this tests whether the color assignment itself creates an advantage.

| Mode | Position | Mean estimated EV | Standard error | Low / medium / high risk share |
|---|---|---:|---:|---:|
| 2 choices | Blue position | -0.0558% | 0.0004 pp | 50.2 / 41.5 / 8.3% |
| 2 choices | Red position | -0.0564% | 0.0004 pp | 49.8 / 41.3 / 8.8% |
| 3 choices | Blue position | -0.0542% | 0.0004 pp | 34.2 / 32.6 / 33.3% |
| 3 choices | Red position | -0.0537% | 0.0003 pp | 32.1 / 33.7 / 34.2% |
| 3 choices | Green position | -0.0539% | 0.0003 pp | 33.7 / 33.8 / 32.6% |

The largest observed mean-EV gap was 0.0006 percentage points in two-choice mode and 0.0005 percentage points in three-choice mode. These differences are small relative to the sampling error and do not show a meaningful structural color advantage in this sample. This is an estimated-value comparison, not a long-run realized payout test under forced-color chains.

Current source inventory remains 11 safe entries and 23 risky entries (34 defined entries); one obsolete duplicate is filtered out during generation.

## Iteration 4 — focused triage and regression speed (2026-11-16)

Latest inspected branch snapshot before this iteration:
- Branch: `balance-system-audit`
- Commit: `62f78697b86e371e4b167d98e5f9415aa8d6cce0`
- Script URL: `script.js?v=77`
- Service-worker cache: `risk-game-cache-v106`
- Latest Actions run: 18 tests passed, 0 failed. The complete run took about 8 minutes 57 seconds; the 20-turn Monte Carlo alone took about 8 minutes 57 seconds.

### Focused findings

1. The expensive Monte Carlo is useful as an occasional diagnostic, but not as a mandatory test on every small change. It covered 9,600 sessions (5 stakes × 2 modes × 6 strategies × 160 sessions). It is now opt-in via manual workflow dispatch; normal PR runs skip it.
2. The latest 160-session-per-cell sample showed low-risk strategy ruin rates of 0% in 2-choice and 0.6–3.1% in 3-choice. Highest-EV strategy ruin rates were 21.3–28.1% in 2-choice and 46.9–52.5% in 3-choice. This is a strategy-dependent tail-risk trade-off, not evidence by itself that the odds should be changed. High-EV results had large positive means but deeply negative medians due to rare high payouts.
3. A real accessibility-label bug was found: the visible penalty text used `game.choices.length`, but the button's `aria-label` omitted it and therefore defaulted to 2-choice calculations. The label now passes the actual choice count; a regression assertion was added.
4. The forced-color audit's output field still reported the old 6%/12% coefficients after the source had changed to 0.35%/0.5425%. The report now reads the live helper value. Its measurement compares a random position in the current menu against the strategy's unrestricted pick; it is only a rough diagnostic, not an exact next-turn forced-color chain model. Therefore the current coefficient remains provisional and is not claimed to be fully empirically calibrated.
5. The source comment describing the old 6%/12% values was stale and has been corrected. No gameplay odds were changed in this iteration.

### Faster routine verification

- The full 20-turn simulation remains available through manual workflow dispatch; normal PR checks do not spend several minutes on it.
- Routine risk-tier composition, color-position, income/risk distribution, and forced-color sampling counts were reduced to smoke-test levels. Earlier larger seeded samples remain documented above as the broader evidence.
- The forced-color test now reports the actual configured coefficients rather than stale constants.
- `index.html` script URL and service-worker cache are bumped to `v78` and `risk-game-cache-v107` for the source correction.

The next focused check is the new fast PR run. The latest code is still isolated on the draft PR; no production deployment, Supabase mutation, or player-data change has occurred.


## Iteration 5 — forced-color legacy compatibility and stateful simulation (2026-11-16)

This section supersedes earlier statements about the latest Monte Carlo harness and the legacy forced-color behavior.

### Changes in the experimental branch

- The stateful simulator now records 1, 5, 10, 20, 50, and 100-turn checkpoints from the same session trajectory rather than replaying each horizon independently.
- The simulation's penalty resolver now models `forceRandom` by choosing uniformly among the colors available in the active mode. The previous long-run output did not model this new penalty type and is therefore exploratory only; it must not be used as final balance evidence.
- `safe15` and `safeMinus10` no longer use a forced-color penalty in newly generated menus. At the current forced-color cost coefficient, those high positive base rewards could not be balanced to the target expected return by a forced-color chance capped at 100%. They now use calibrated partial-loss penalties instead.
- The former `safeForceGreen` entry is retained with its original +1.04% / 18% green-force definition for active-game save compatibility, but is excluded from newly generated menus. A new `safeForceRandom` entry supplies the calibrated +0.1% / random-color-force option in three-choice mode.
- Active saved choices from the previous build that use `safe15` + `forceRed`, `safeMinus10` + `forceBlue`, or `safeForceGreen` + `forceGreen` retain their stored penalty probabilities. This prevents the revised forced-color cost model from silently changing a game already in progress.
- The legacy-compatibility behavior has dedicated regression coverage.
- Client cache versions are `script.js?v=80` and `risk-game-cache-v109`.

### Evidence and limits

- The prior 100-turn run completed 2,400 sessions (5 stakes × 2 modes × 6 strategies × 40 sessions), and 360 checkpoint rows were emitted. However, because `forceRandom` was not yet represented in the simulation, those long-run outcomes are superseded and are not used to justify any probability changes.
- The forced-color opportunity-cost diagnostic samples 400 menus per stake/mode/bonus/strategy cell. It compares a random menu position against a strategy's unrestricted pick. It is not a full next-turn forced-color chain simulation, and the measured cost varies substantially with strategy and active loss-reduction bonus. Therefore 0.35% (two-choice) and 0.5425% (three-choice) remain provisional modelling coefficients, not claims of exact empirically measured utility loss.
- The reroll-aware strategy is still an approximation: it models the five in-game free rerolls but does not simulate every user purchase/shop progression decision. The stateful run excludes bank interest, wages, and shop cash flows; those are covered separately by source-level and pure-helper regression tests.
- The new corrected stateful run and regression suite must complete successfully before this branch is considered ready for review. A successful syntax/test workflow does not equal browser/PWA validation.
- The experimental branch remains isolated in draft PR #7. No merge, Pages deployment, Supabase mutation, or player-data modification has been performed.
