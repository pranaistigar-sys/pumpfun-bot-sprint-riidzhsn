// Dispersed-momentum + completion-ride strategy for the pump.fun replay.
//
// Written fresh for this bounty. The two entry families and the exit rules
// are tuned on this kit's dev window (24h, 1222 mints, 35 completions) by
// grading locally; see the tuning notes in the repo README. Final params
// (sweep rounds 1-3): momentum 0.20 SOL, TP +30%, SL -20%, hold 3000 slots,
// age up to 1500 slots; ride at real reserve >= 50 SOL, 0.50 SOL, SL -15%,
// hold 3000 slots. Dev grade: +1.26 SOL over 86 coins, win rate 51%,
// max drawdown 5.7%.
//
// Why this shape: single-slot rugs make exits useless against the worst
// coins, so the bot spends its risk budget on selection. A curve qualifies
// for momentum only when its early tape is broad (many distinct buyers,
// dispersed buy SOL, real net inflow) and it has run up without mooning.
// A curve qualifies for the ride only when its real reserve is already
// deep (>= 50 SOL), which is where completions concentrate. Both legs use
// one buy per coin and a hard time cap, so a dead coin never ties up a
// position slot for long.
//
// Deterministic by construction: no clock, no randomness, no environment
// reads; iteration only over insertion-ordered maps fed by the batch stream.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  // Momentum entry: age window (slots since CreateEvent).
  momMinAge: number;
  momMaxAge: number;
  // Momentum entry: distinct non-creator buyers since create.
  momMinBuyers: number;
  // Momentum entry: net SOL inflow (buys minus sells) since create.
  momMinNetSol: number;
  // Momentum entry: price now over create price.
  momMinRunup: number;
  momMaxRunup: number;
  // Momentum entry: largest single buyer's share of buy SOL, at most.
  momMaxTopShare: number;
  // Momentum stake (SOL) and exits.
  momStakeSol: number;
  momBuySlipBps: number;
  momStopLoss: number;
  momTakeProfit: number;
  momMaxHold: number;
  // Completion-ride entry: real SOL reserve at entry, at least this.
  rideMinRealSol: number;
  // Completion-ride stake (SOL) and exits (no take-profit).
  rideStakeSol: number;
  rideStopLoss: number;
  rideMaxHold: number;
  // Slots to wait after an exit before the same coin may be bought again.
  rebuyCooldown: number;
  // Most entries per coin over the run.
  maxEntriesPerCoin: number;
}

export const DEFAULT_PARAMS: Params = {
  momMinAge: 0,
  momMaxAge: 1500,
  momMinBuyers: 25,
  momMinNetSol: 8.0,
  momMinRunup: 1.5,
  momMaxRunup: 3.0,
  momMaxTopShare: 0.15,
  momStakeSol: 0.2,
  momBuySlipBps: 1500,
  momStopLoss: 0.20,
  momTakeProfit: 0.3,
  momMaxHold: 3000,
  rideMinRealSol: 50,
  rideStakeSol: 0.5,
  rideStopLoss: 0.15,
  rideMaxHold: 3000,
  rebuyCooldown: 300,
  maxEntriesPerCoin: 1,
};

const LAMPORTS = 1e9;
const SELL_CURVE_FEE = 0.0125;

interface CurveTape {
  createdSlot: number | null;
  creator: Pubkey | null;
  createPrice: number;
  netSol: number;
  buySol: number;
  buyers: Set<Pubkey>;
  largestBuySol: number;
  creatorSold: boolean;
  entriesUsed: number;
  lastExitSlot: number;
}

interface OpenPosition {
  openedSlot: number;
  isRide: boolean;
  buyFilled: boolean;
}

function quotePrice(vq: bigint, vt: bigint): number {
  return Number(vq) / Number(vt);
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<Pubkey, CurveTape>();
  const open = new Map<Pubkey, OpenPosition>();

  function tapeFor(mint: Pubkey): CurveTape {
    let tape = tapes.get(mint);
    if (tape === undefined) {
      tape = {
        createdSlot: null,
        creator: null,
        createPrice: 0,
        netSol: 0,
        buySol: 0,
        buyers: new Set(),
        largestBuySol: 0,
        creatorSold: false,
        entriesUsed: 0,
        lastExitSlot: -1e12,
      };
      tapes.set(mint, tape);
    }
    return tape;
  }

  function momentumQualifies(tape: CurveTape, now: number, price: number): boolean {
    if (tape.createdSlot === null || tape.creator === null) return false;
    const age = now - tape.createdSlot;
    if (age < p.momMinAge || age > p.momMaxAge) return false;
    if (tape.buyers.size < p.momMinBuyers) return false;
    if (tape.netSol < p.momMinNetSol) return false;
    if (tape.creatorSold) return false;
    if (tape.createPrice <= 0) return false;
    const runup = price / tape.createPrice;
    if (runup < p.momMinRunup || runup > p.momMaxRunup) return false;
    if (tape.buySol > 0 && tape.largestBuySol > p.momMaxTopShare * tape.buySol) return false;
    if (tape.entriesUsed >= p.maxEntriesPerCoin) return false;
    if (now - tape.lastExitSlot < p.rebuyCooldown) return false;
    return true;
  }

  function rideQualifies(tape: CurveTape, now: number, realSol: number): boolean {
    if (tape.createdSlot === null || tape.creator === null) return false;
    if (realSol < p.rideMinRealSol) return false;
    if (tape.creatorSold) return false;
    if (tape.entriesUsed >= p.maxEntriesPerCoin) return false;
    if (now - tape.lastExitSlot < p.rebuyCooldown) return false;
    return true;
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const touched = new Set<Pubkey>();

      for (const event of batch.events) {
        if (event.event === 'CreateEvent') {
          const tape = tapeFor(event.mint);
          tape.createdSlot = event.slot;
          tape.creator = event.creator;
          tape.createPrice = quotePrice(
            BigInt(event.virtual_quote_reserves),
            BigInt(event.virtual_token_reserves),
          );
        } else if (event.event === 'TradeEvent') {
          const tape = tapeFor(event.mint);
          const sol = Number(event.sol_amount) / LAMPORTS;
          tape.netSol += event.is_buy ? sol : -sol;
          if (event.is_buy) {
            tape.buySol += sol;
            if (event.user !== tape.creator) tape.buyers.add(event.user);
            if (sol > tape.largestBuySol) tape.largestBuySol = sol;
          } else if (event.user === tape.creator) {
            tape.creatorSold = true;
          }
          touched.add(event.mint);
        } else {
          // CompleteEvent: the replay closes the position itself.
          touched.add(event.mint);
        }
      }

      // Marks are only needed to price held positions; skip the map when
      // nothing is held. One pass over pending orders builds both the
      // per-mint counts and the set of mints with a sell in flight.
      const marks = open.size > 0
        ? new Map(batch.marks.map((m) => [m.mint, m] as const))
        : null;
      const pendingCount = new Map<Pubkey, number>();
      const sellPending = new Set<Pubkey>();
      for (const pending of state.pending.values()) {
        pendingCount.set(
          pending.order.mint,
          (pendingCount.get(pending.order.mint) ?? 0) + 1,
        );
        if (pending.order.side === 'sell') sellPending.add(pending.order.mint);
      }

      const orders: OrderInput[] = [];
      const batchCap = state.hello.caps.max_orders_per_batch;
      const txSol = Number(state.txFeeLamports()) / LAMPORTS;

      // Exits first, so a freed slot can be reused by an entry this batch.
      for (const [mint, held] of open) {
        const position = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (position === undefined) {
          if (!pendingCount.has(mint)) {
            open.delete(mint);
            if (held.buyFilled) tapeFor(mint).lastExitSlot = now;
            else tapeFor(mint).entriesUsed--;
          }
          continue;
        }
        held.buyFilled = true;
        if (curve === undefined || curve.complete) continue;
        const mark = marks?.get(mint);
        const vq = mark ? Number(mark.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mark ? Number(mark.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const tokens = Number(position.token_amount);
        const valueSol = ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - SELL_CURVE_FEE) - txSol;
        const costSol = Number(position.cost_lamports) / LAMPORTS;
        const stop = held.isRide ? p.rideStopLoss : p.momStopLoss;
        const holdLimit = held.isRide ? p.rideMaxHold : p.momMaxHold;
        let shouldExit = false;
        if (valueSol < costSol * (1 - stop)) shouldExit = true;
        if (!shouldExit && !held.isRide && valueSol >= costSol * (1 + p.momTakeProfit)) {
          shouldExit = true;
        }
        if (!shouldExit && now - held.openedSlot > holdLimit) shouldExit = true;
        if (!shouldExit) continue;
        if (sellPending.has(mint)) continue;
        if (orders.length >= batchCap) break;
        orders.push({
          side: 'sell',
          mint,
          token_amount: position.token_amount,
          max_slippage_bps: 10_000,
        });
      }

      // Entries: rides first (the fat tail), then momentum.
      let freeSol = Number(state.freeCashLamports()) / LAMPORTS;
      let openSlots = state.hello.caps.max_open_positions - state.committedPositionCount();

      const tryBuy = (mint: Pubkey, ride: boolean): void => {
        if (orders.length >= batchCap || openSlots <= 0) return;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) return;
        if (pendingCount.has(mint) || open.has(mint)) return;
        const tape = tapes.get(mint)!;
        const price = quotePrice(curve.virtual_quote_reserves, curve.virtual_token_reserves);
        const realSol = Number(curve.real_quote_reserves) / LAMPORTS;
        if (ride) {
          if (!rideQualifies(tape, now, realSol)) return;
        } else if (!momentumQualifies(tape, now, price)) {
          return;
        }
        const wantSol = ride ? p.rideStakeSol : p.momStakeSol;
        const sizeCapSol = Number(state.maxBuyLamports(mint)) / LAMPORTS;
        let amount = Math.min(sizeCapSol, wantSol);
        if (amount > freeSol - txSol) amount = freeSol - txSol;
        if (amount < 0.01) return;
        const lamports = BigInt(Math.floor(amount * LAMPORTS));
        if (lamports <= 0n) return;
        orders.push({
          side: 'buy',
          mint,
          quote_lamports: lamports,
          max_slippage_bps: p.momBuySlipBps,
        });
        freeSol -= amount + txSol;
        open.set(mint, { openedSlot: now, isRide: ride, buyFilled: false });
        tape.entriesUsed++;
        openSlots--;
      };

      for (const mint of touched) tryBuy(mint, true);
      for (const mint of touched) tryBuy(mint, false);

      return orders;
    },
  };
}
