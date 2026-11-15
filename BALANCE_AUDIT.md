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
