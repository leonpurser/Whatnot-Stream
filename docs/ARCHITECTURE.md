# Whatnot Show Control: architecture review and plan

Status: Phase 1 (DOM probe) built. Phases 2–7 are designed here but not built yet.

## 1. Verdict

The overall shape is right: a read-only DOM reader feeds a local server, the server owns all show logic, and graphics only play cues. The split between the Whatnot reader, the show controller and the graphics engine is the most important decision in the brief, and it is correct. Node.js is a good choice for the server, and MutationObserver with stable `data-testid` selectors is the right way to read the page.

These are the changes and risks to deal with before building further, most important first.

## 2. Technical problems and risks

### 2.1 Stream latency breaks anything time-critical (most important)

Whatnot's native UI (the timer, bids and "X won!") reaches viewers' phones over Whatnot's realtime data channel, usually in well under a second. Our overlay is part of the video, so it reaches viewers only after OBS encoding, ingest and transcoding, typically 2–6 seconds later.

What this means in practice:

- **FINAL 5 countdown.** If we start "5" when our DOM timer reads 5, viewers see "5" when their native timer already reads about 1, or after the item has already sold. Driven naively from the DOM timer, the countdown will be wrong on air.
- **SOLD.** It lands a few seconds after viewers see Whatnot's own "won!". That is fine as a celebration beat, but it can never be "first".
- **Bidding war, new leader and milestones** are all reactions, so the lag doesn't matter.

Mitigations, to be decided in Phase 3 once we have measurements:

1. Measure glass-to-glass latency: put a clock in OBS and compare it with the Whatnot app on a phone. Make it a config value (`streamLatencyMs`).
2. Start the countdown early by that amount: start "5" when the DOM reads `5 + latency`. Cancel or restart it on `auction_extended`.
3. Or replace the numeric countdown with a non-numeric tension build (pulse, lighting, music) that isn't contradicted by the native timer. **This is my recommendation.** The numbers already exist on the viewer's screen.

### 2.2 Which Whatnot page is the extension watching?

The hooks you captured (`show-bid-button`, "dommy31 is Winning!") look like the **buyer/viewer** page. The seller's own live view may use different markup, may have no bid button, and may say "You" in places. Decide which page the probe runs on, then verify selectors **on that page**.

My suggestion: run the probe in a **dedicated Chrome profile** that has the show open as a viewer. It can be the seller account viewing the show page, or a second account, but never the window you use to control the show. This keeps the reader separate from the selling controls, and a viewer page is the most stable target.

### 2.3 Background tabs get throttled

Chrome throttles hidden or minimised tabs. Timers drop to once per second, and after about 5 minutes hidden, "intensive throttling" drops them to once per minute. Memory Saver can also discard the tab completely. MutationObserver callbacks still run, but the page's own React updates can be delayed.

**Rule:** the Whatnot reader runs in its own Chrome window that stays **visible** (a second monitor is ideal), never minimised. Add `whatnot.com` to Chrome's "Always keep these sites active" list. The probe's health panel will show stale data if this goes wrong.

### 2.4 The sale price is not reliably known yet

You're right that `Bid: £24` is the **next** bid, not the price. The probe:

- stores the button amount as `nextBid` and **never** uses it as a price;
- has an empty `currentPrice` selector slot, so it shows **NOT CONFIGURED** until we find the right element;
- also accepts a price that appears in the status text (e.g. if "X won! £23" turns out to be real);
- emits sales with `price: null` and `warnings: ["price_unknown"]` rather than guessing.

Use the panel's **Card text** button during a live auction and right after a win to find where the current price is shown.

### 2.5 Fingerprint de-duplication alone would drop real sales

`winner + item + price` is not unique in practice. In "£1 Madness", the same buyer can win two items called "Mystery Item" for £1 thirty seconds apart, and a pure fingerprint rule would discard the second sale. So de-duplication is layered:

1. **Lifecycle (primary).** Each auction instance can produce at most one sale. An instance is marked sold, and repeated "won!" renders change nothing.
2. **Confirmation.** "won" must stay on screen for 300 ms, so a transient render can't sell anything.
3. **Fingerprint window (secondary, 8 s).** This only catches the case where the lifecycle logic wrongly splits one auction into two. A suppressed sale is still **emitted as `sale_suppressed`** and shown in the panel, so the producer can fire it manually if it was real.

All three are covered by unit tests, including the "same title, same buyer, same price" case.

### 2.6 Giveaways also say "X won!"

Without special handling, a giveaway would count as a £0 sale, inflate the buyer's item count and possibly trigger HAT TRICK. The probe detects giveaways from the title (`/giveaway/i`) or an optional selector and emits `giveaway_result` instead of `sale`. This must be verified on a real giveaway. Whatnot's giveaway UI may be completely different.

### 2.7 Reloads and restarts

If the Whatnot tab is refreshed while "X won!" is on screen, the probe sees a finished auction it never watched live. It emits the sale with `observedLive: false` (low confidence), and the server must not auto-air it. In Phase 2 the server keeps an **append-only event log on disk** and builds show state from it on startup, so restarting the server mid-show loses nothing. It also de-duplicates sales by `auctionId` and fingerprint across reader reconnects.

### 2.8 Chrome extension → localhost

A content script on `https://www.whatnot.com` that calls `http://127.0.0.1` runs into CORS and Chrome's Private Network Access rules. Instead, the content script hands events to the extension's **background service worker** with `chrome.runtime.sendMessage`. The worker has `host_permissions` for `http://127.0.0.1:3000/*` and holds a WebSocket to the server. MV3 service workers sleep when idle, so the worker sends a heartbeat every 20 s. Since Chrome 116, WebSocket activity keeps the worker alive.

### 2.9 Vertical video gets cropped differently on different phones

The 1080×1920 safe-area template should assume **horizontal cropping**. Most phones are taller than 9:16 (19.5:9 and similar), so a 9:16 video filling the screen loses some of its left and right edges. Keep critical text inside a central column, for example x = 90–990, and build the template from screenshots of the Whatnot app on at least two phone sizes.

### 2.10 The NVIDIA depth effect: use the OBS filter rather than the Broadcast app

The NVIDIA Broadcast app outputs a virtual camera **without an alpha channel** (the background is replaced, blurred or keyed to a colour) and usually takes exclusive control of the physical camera. That makes the "same camera twice" stack awkward and adds a frame offset between the two layers, which shows up as ghosting at the edges.

A better route is OBS's own **NVIDIA Background Removal** filter (needs the NVIDIA Video Effects SDK runtime; a 3090 Ti handles it easily):

- one camera source, used twice: a nested scene or *Source Clone* plugin for the top layer, with the filter on that clone only;
- real alpha, and both layers come from the same frame, so they stay in sync.

Your caveat is right, and I'd treat it as a design rule: a garment held away from the body will often be cut out of the mask. Nothing important may depend on the mask. Graphics behind the presenter are decoration only.

### 2.11 Audio

Play audio from a **separate** browser source (`/audio`) with "Control audio via OBS" enabled. That gives the music bed and stings their own mixer fader, compressor and monitoring, and graphics can be reloaded without cutting the music. The server sends audio cues just like graphic cues.

### 2.12 Other points

- **Cue arbitration.** A sale can be SOLD, BIG SALE, NEW RECORD and a HAT TRICK all at once. The show controller should merge these into **one** cue with a priority order (record > big sale > sold, with the milestone shown afterwards), not fire four graphics. Cues have IDs, and the overlay ignores repeated IDs.
- **Auto-air policy.** Automation airs a sale only when `confidence === "ok"`. Otherwise the dashboard shows "CONFIRM SALE?" with Air and Discard buttons. This puts principle 13 ("better not to display") into code.
- **Buyer privacy.** Add a config list of usernames never to show on air, for buyers who ask not to appear on the leaderboard.
- **Terms of service.** Reading the rendered page of your own show for your own production is low risk. Keep the extension strictly read-only (it never clicks or types) and unpublished (loaded unpacked). That is how it's built.

## 3. Communication

```
 Whatnot tab (dedicated Chrome window)
   content script ── chrome.runtime.sendMessage ──► extension service worker
                                                        │ WebSocket  ws://127.0.0.1:3000/ingest
                                                        ▼  (heartbeat 20s, reconnect w/ backoff,
                                                           bounded replay buffer, seq numbers)
                                          ┌──── LOCAL SHOW-CONTROL SERVER (Node) ────┐
                                          │ ingest → event log (JSONL on disk)       │
                                          │        → show state (reducer)            │
                                          │        → rules engine → cues             │
                                          └───┬──────────────┬──────────────┬────────┘
                         ws /ws?role=overlay  │   ws /ws?role=dashboard     │  HTTP /api/*
                                              ▼              ▼              ▼
                            OBS browser source  Producer dashboard   Companion / Stream Deck
                            /overlay + /audio   (also test mode)     (POST cues, GET state)
```

- **One WebSocket endpoint per role.** On connect, the server sends a full `state` message, then deltas and `cue` messages. Clients send `hello` (role, version) and heartbeats, so the dashboard can show "OBS graphics: CONNECTED" based on what the overlay reports, not on a guess.
- The overlay sends **`cue_ack`** when an animation starts and finishes. The dashboard shows what is actually on air.
- **Companion** uses plain HTTP, which its Generic HTTP module handles natively: `POST /api/cue/:name`, `POST /api/show/end`, `POST /api/clear`, and `GET /api/state` for button feedback.
- Test mode injects synthetic reader events **at the ingest stage**, so the whole pipeline (state, rules, cues and graphics) is exercised exactly as it would be live.

## 4. Schema (v1)

### 4.1 Reader event envelope (extension → server)

```js
{
  v: 1,                    // schema version
  type: "sale",            // see below
  ts: 1759417471000,       // ms epoch, when the probe observed it
  seq: 412,                // per page-load sequence number
  source: "whatnot-dom",   // or "test", "manual"
  auctionId: "amg8x2k-14", // probe-local auction instance id
  data: { ... }
}
```

| type | data |
|---|---|
| `probe_started` | `selectorsVersion, mock, showId` |
| `probe_status` | `health{field: ok/missing/unparsed/not_configured}, selectorsVersion, invalidSelectors[]` |
| `auction_start` | auction snapshot (below) |
| `auction_update` | auction snapshot, emitted only when something changed |
| `bid` | `bids, delta, leader, previousLeader, nextBid, timerSec` |
| `leader_changed` | `leader, previousLeader` |
| `auction_extended` | `fromSec, toSec, extensions` |
| `auction_no_sale` | `item, statusText` |
| `sale` | sale record (below) |
| `sale_suppressed` | sale record + `reason, fingerprint` |
| `giveaway_result` | sale record (winner, no price) |
| `auction_hidden` | — (product card disappeared) |
| `chat_message` | `id, user, text, backlog` |

Auction snapshot:

```js
{ item, lotNumber, condition, imageUrl, phase /* pending|live|ended|sold|no_sale|giveaway_done */,
  timerSec, bids, leader, price /* null until verified */, nextBid, currency, isGiveaway, extensions }
```

Sale record:

```js
{ item, lotNumber, condition, imageUrl, winner, price, currency,
  priceSource /* "price-selector" | "status-text" | null */,
  bids, extensions, observedLive,
  warnings /* winner_unknown, price_unknown, winner_differs_from_last_leader,
              price_not_below_next_bid, not_observed_live, item_unknown, ... */,
  confidence /* "ok" | "low" */, statusText }
```

### 4.2 Show state (server, Phase 2+)

```js
{
  show: { id, startedAt, endedAt, segment: null | "pound_madness" },
  connections: { reader: {connected, lastSeenTs, health}, overlay: {...}, audio: {...}, dashboards: n },
  currentAuction: { ...auction snapshot, auctionId },
  sales: [ { saleId, auctionId, ts, item, lotNumber, winner, price, currency, confidence, aired, segment } ],
  buyers: { "<normUser>": { display, items, spend /* producer-only */, firstTs, lastTs } },
  totals: { itemsSold, revenue /* producer-only */, highestSale: saleId|null, topBuyer: normUser|null },
  milestonesFired: { show: [10, 25], buyers: { "<normUser>": [3] } },
  pendingConfirmations: [ saleId ]   // low-confidence sales waiting for the producer
}
```

Leaderboard rank = items desc, then earliest to reach that count. Spend is never sent to the overlay.

### 4.3 Cues (server → overlay/audio)

```js
{ v: 1, type: "cue", id: "cue-1234", name: "sold" /* big_sale, new_record, buyer_milestone,
  new_leader, show_milestone, countdown, bidding_war, chat, stats, top_buyers, giveaway,
  segment, end_show, clear */, priority: 50, payload: { ... }, durationMs: 2200 }
```

## 5. Project structure

```
extension/            Chrome MV3 extension (load unpacked)
  manifest.json
  src/selectors.js    selector + pattern + tuning map (the one file to edit if Whatnot changes)
  src/parse.js        pure text parsers
  src/tracker.js      pure auction state machine + de-duplication
  src/panel.js        on-page debug panel (Phase 1)
  src/content.js      DOM observer: reads snapshots, emits events
  src/background.js   (Phase 2) WebSocket transport to the server
server/               (Phase 2)
  src/index.js        http + ws bootstrap
  src/ingest.js       validate reader events, append to log
  src/store.js        reducer: events → show state
  src/rules.js        state transitions → cues (milestones, records, arbitration)
  src/api.js          HTTP API for dashboard / Companion
  public/dashboard/   producer UI (+ test mode)
  public/overlay/     1080×1920 transparent graphics
  public/audio/       audio cue player
config/               (Phase 2) thresholds.json, graphics.json, audio.json, privacy.json
data/                 (git-ignored) event logs per show
tools/mock-show/      offline Whatnot-like page for development and rehearsal
test/                 node --test unit tests (no dependencies)
docs/
```

No build step and no framework. Runtime dependencies stay minimal: the server will need only `ws`.

## 6. Phase plan (unchanged from the brief, with exit criteria)

| Phase | Done when |
|---|---|
| 1 DOM probe | On 10–20 real auctions: every sale detected exactly once with the correct winner; price source identified; giveaways classified; chat usernames correct. |
| 2 Local server | Events persist; restarting the server rebuilds state; dashboard shows health and sales; test mode works. |
| 3 Basic OBS | Plain SOLD graphic on air, exactly once per sale, only at `confidence: ok`; latency measured. |
| 4 Show memory | Buyers, leaderboard, records and milestones correct against a replayed real show log. |
| 5 Graphics | Polished package inside the safe-area template. |
| 6 NVIDIA depth | Two-layer stack tested with held garments. |
| 7 Companion | Stream Deck page driving the HTTP API. |
