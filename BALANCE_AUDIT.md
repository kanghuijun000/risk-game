# Risk Game Balance Audit — Baseline

## Scope and safety of this change

This document records the current balance implementation and the verification plan. It does not change gameplay code, player balances, saved games, UI, or Supabase data. All currency in this game is fictional in-game currency.

Baseline inspected on 2026-11-15:
- `script.js` blob: `7fb95521e529a8e1b7a0d2adc06b6ac7ca240fa6`
- `index.html` loads `script.js?v=60`
- `sw.js` cache: `risk-game-cache-v89`

## Current choice inventory

The current source defines 9 safe choices and 19 risky choices (28 total before availability filtering).

Important observations:
- The smallest positive displayed effect currently in the choice pools is approximately +0.9% (`safeMinus10`, effect 0.86 and title +0.9%). There is no positive +0.1% to +0.8% choice in the current arrays.
- The current pool contains +25%, +50%, +100% rare choices and a `×100배` choice (effect 9,900%, 0.01 rarity weight, 99% full-loss penalty). It does not currently define a +900% choice.
- Therefore, the observed +100% ceiling is not the full theoretical ceiling: the ×100 choice exists but is extremely rare. This is a visibility/frequency issue as well as a reward-range issue.
- Several choices have cash rewards scaled to current game balance. The scaling is recomputed from the current balance each time a new set is generated.

## Current mathematical rules found in source

- Target estimated expected return per choice: `TARGET_CHOICE_EV_PERCENT = -0.05`.
- Fixed-cash reference stake: 10,000.
- Loss-probability reduction bonus factor: 0.8 (20% reduction).
- Forced-color opportunity-cost approximation: 0.06.
- Reduce-loss bonus future-exposure estimate: 0.0357.
- Risk score: `effectiveChance * lossFraction + lossFraction * 20`.
- Risk tiers: low at score <= 6.5; medium at score <= 20; high above 20.
- Two-choice generation requires two different risk tiers.
- Three-choice generation requires one choice from each of the three risk tiers.
- Candidate combinations are normally constrained to an estimated EV spread <= 1.25 percentage points and best estimated value between -0.75% and +0.25%; if none qualify, the generator progressively relaxes the spread constraint.
- Combination weights are affected by individual option occurrence counts, risk-tier-combination frequency, bonus presence, zero/no-penalty presence, rarity weights, risk gap, EV score, and the safe-positive bonus boost.
- The selected choices are shuffled before being mapped to colors. Two-choice mode maps the two positions to blue/red; three-choice mode maps positions to blue/red/green.

## Baseline risks requiring investigation

These are audit findings or hypotheses to test, not yet claims of measured long-run bias.

1. **Risk-tier thresholds are heuristic.** The score combines expected loss and a fixed tail-loss term, but the constants 20, 6.5, and 20 have no demonstrated calibration against actual outcome distributions. The same score can hide materially different loss shapes.
2. **Income tier is not enforced.** Generation enforces risk tiers, not low/medium/high expected-income tiers. This can leave medium-risk/medium-income choices underrepresented even if risk tiers are balanced.
3. **Fallback can violate tier requirements.** If no eligible combination exists, `generateChoices` returns `candidates.slice(0, targetCount)`. Since candidates are ordered as safe choices followed by risky choices, this fallback can return a set that does not satisfy the required tier composition and is not shuffled.
4. **Expected-value proximity can flatten meaningful trade-offs.** Tight EV-spread filtering may make all choices nearly equal in mean return while leaving variance, skew, ruin probability, and tail loss materially different. This is not necessarily bad, but must be intentional and measured.
5. **Forced-color cost is an approximation.** The estimator subtracts a fixed equivalent cost, while actual gameplay constrains the next turn's color and changes the player's future choice set. Its true cost depends on next-turn choices and game state.
6. **Bonus valuation is approximate.** Reduce-loss uses a fixed future exposure estimate; safe-positive changes combination weights rather than adding a directly modeled future reward. Both need stateful simulation.
7. **Rounding and near-zero balances matter.** Percentage losses use integer rounding and balances <= 1 become zero on a subsequent percentage loss. This can make realized loss differ from the nominal percentage, especially late in long games.
8. **Rerolls alter the effective choice distribution.** A reroll consumes a limited purchased reroll, keeps current money and forced color, and regenerates the set. It can be used strategically to reject unattractive combinations; it must be included in strategy simulations.
9. **The color mapping needs conditional tests.** Choices are shuffled, but forced-color effects, two-choice mode, and three-choice mode need separate statistical checks for per-color assignment and availability.
10. **The wider economy affects bankroll progression.** Current source includes a 10,000-per-hour wage, a bank with 1–10% simple interest per active minute, deposit limits and upgrades, a 5,000 fixed reroll purchase price, reroll-cap upgrades, a 100,000,000 three-choice unlock, and game-limit upgrades. These must be modeled separately from per-game choice EV.
11. **Bank-rate upgrade timing needs review.** The rate-upgrade handler changes the rate without first synchronizing accrued partial-minute time. An elapsed fraction accrued at the old rate may consequently be paid at the new rate at the next minute boundary. This is a potential timing exploit/bias and needs a deterministic test.
12. **Stopping is a player decision, not a penalty.** Simulations should report outcomes for different stopping rules, but must not alter odds or apply hidden pressure based on profit or turn count.

## Required model dimensions

The eventual test matrix must vary at least:
- Starting stakes: 1,000; 5,000; 10,000; 100,000; 1,000,000; and balances near rounding boundaries.
- Turn horizons: 1; 5; 10; 20; 50; 100; plus stop-on-profit and stop-on-loss scenarios.
- Choice mode: two and three choices.
- Strategy: random choice; lowest-risk; highest estimated EV; highest nominal reward; risk-adjusted; and reroll-aware strategies.
- State: no bonus; active reduce-loss bonus; active safe-positive bonus; forced color; different remaining rerolls.
- Economy: without bank/wage; with wage; bank deposit/withdraw; all bank rates; upgrades; different game limits.
- Distribution metrics: per-choice and per-tier appearance rate, per-color assignment rate, expected return, variance, quantiles, worst-tail outcomes, probability of ending below starting stake, probability of total loss, and probability of each option being dominated by another available option.

## Verification requirements before any balance change is merged

1. Compare every displayed penalty description with the exact probability and effect used by `applyPenalty`.
2. Derive expected value from the actual order of operations: base effect first, then penalty, integer rounding, then bonus-state updates.
3. Report confidence intervals for simulation estimates; increase sample size until the confidence interval is narrower than the pre-agreed tolerance.
4. Test all stake and turn horizons using normalized returns, not only absolute currency.
5. Test the full choice generator, including fallback paths and weighted appearance frequencies.
6. Test color assignment independently of option generation.
7. Include rerolls, bonuses, forced colors, bank, wage, and shop progression in the full-economy model.
8. Keep the player's ability to stop after profit intact; no adaptive odds based on balance, profit, or turn count.
9. Preserve the existing UI, account/cloud data, and unrelated game features.
10. Keep experimental changes on a separate branch and merge only after static checks, deterministic tests, simulation, and browser regression tests pass.

## Current status

Baseline inspection is complete. Comprehensive simulations, independent expected-value calculations, browser tests, and live Pages verification are not yet complete. No gameplay values have been changed by this audit branch.
