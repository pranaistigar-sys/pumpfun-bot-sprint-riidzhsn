// Pump.fun bot sprint — dispersed-momentum + completion-ride paper bot.
//
// The replay is a 24h window of pump.fun bonding-curve trades (agent-fun/replay/v2).
// The grader runs `node /bot/main.ts`; the strategy lives in strategy.ts and the
// SDK shim is the kit's sdk/ts/makefun-bot.ts, vendored byte for byte.
//
// Idea, in one paragraph: most new curves rug within a slot or two, and a
// stop-loss cannot catch a single-slot dump, so the edge is selection, not
// exits. Two selections earn size:
//   1. Dispersed momentum — a curve that has already run 1.5-3x on broad,
//      dispersed buying (25+ distinct buyers, 8+ SOL net inflow, no single
//      buyer over 15% of buy SOL, creator not selling). Buy 0.20 SOL, take
//      +30%, stop -20%, give up after 3000 slots.
//   2. Completion ride — a curve whose real SOL reserve has crossed 50 SOL
//      is close to bonding-curve completion (completers finish at ~14.7x
//      create price). Buy 0.50 SOL, stop -15%, hold up to 3000 slots, no
//      take-profit: ride it to completion.
// One entry per coin, no adds, no dip-buying (both lost money in testing).
// Deterministic: no clock, no randomness, no environment reads; iteration
// only over insertion-ordered maps fed by the batch stream.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
