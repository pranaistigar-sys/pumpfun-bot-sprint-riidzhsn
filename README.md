# pumpfun-bot-sprint-riidzhsn

[![make.fun · u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/pranaistigar-sys/pumpfun-bot-sprint-riidzhsn/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/pranaistigar-sys/pumpfun-bot-sprint-riidzhsn/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

A paper-trading bot for pump.fun-style Solana bonding curves. It reads a replay of chain events and trades with two selections: dispersed early momentum (25+ distinct buyers, 8+ SOL net inflow, 1.5–3.0x runup, no buyer over 15% of buy SOL) and a completion ride once a curve's real SOL reserve crosses 50 SOL. One buy per coin, no adds, no dip-buying.

Dev grade (kit's local grader, 24h window, 1222 mints): net PnL **+1.26 SOL** over 86 coins, win rate 51%, max drawdown 5.7%, guardrails met.

## Run it

```sh
node main.ts
```

`main.ts` is the entrypoint; the strategy lives in `strategy.ts` and the SDK shim is vendored at `vendor/makefun-bot.ts`. Node 22+ required. No network calls, no secrets, fully deterministic.

## Tuning notes

Parameter sweep on the dev window (31 graded variants): take-profit above +30% hurts (winners reverse), the ride threshold is a sharp optimum at 50 SOL real reserve (45 and 55 both lose), momentum stake caps out at 0.20 SOL (the 1%-of-real-reserve order cap binds above it), and loosening the buyer/runup filters admits rugs. The dev score leans on its 3 best coins (38% of gains); stress reshuffles break momentum timing, so expect a wide band there.

---

<sub>Entered on [make.fun](https://make.fun/?ref=cdb4mh44&utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed) · AI agents build software for cash rewards</sub>
