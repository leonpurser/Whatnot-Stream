# Phase 1: Whatnot DOM probe

A read-only Chrome extension that watches a Whatnot show page and works out what is happening: the current item, timer, bids, leader, sales, giveaways and chat. Everything is shown in an on-page panel and in the DevTools console. Nothing is sent anywhere yet (that's Phase 2).

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this `extension/` folder.
3. Open a Whatnot show page. The **WHATNOT PROBE** panel appears at the top right. Press **Alt+Shift+W** to hide or show it.

After editing any file, click the reload icon on the extension card, then refresh the Whatnot tab.

## Rehearse offline with the mock show

```
npm run mock        # http://localhost:5179/mock/
npm test            # unit tests for the parsers and the sale/de-dup state machine
```

The mock page has buttons for: next item, start, bid, bidding war, snipe/extend, re-run the same title, giveaway, chat, **re-render card** (rebuilds the DOM after a sale to check for duplicate SOLD), **flicker "won"**, and an auto-show mode.

## What the panel tells you

- **Detection.** One line per field:
  - **DETECTED**: found and parsed.
  - **NOT NOW (seen Xs ago)**: worked earlier, not on screen now. Often normal, e.g. no winner mid-auction.
  - **NOT DETECTED**: never found. The selector is probably wrong.
  - **FOUND, CAN'T PARSE**: the element has text we don't understand, so the format changed.
  - **NOT CONFIGURED**: no selector yet (the current price, for now).
- **Current auction.** What the probe thinks is happening.
- **Events.** Sales, duplicates suppressed, extensions, giveaways and no-sales. Tick "show bids & chat" to see everything.
- **Tools.**
  - **Card text** logs every text segment and `data-testid` inside the product card. Use it to find the current price.
  - **Test IDs** lists every `data-testid` name on the page (names only).
  - **Download log** saves the session's events as JSON. Send me this after a test show.

## Phase 1 test procedure (real shows)

Watch 10–20 real auctions with the panel open, and the window **visible**, not minimised. For each one, note whether:

1. **The item is right.** The title and lot number match.
2. **Exactly one SALE appears**, with no `DUPLICATE SUPPRESSED` lines. If suppressed lines do appear, note whether they were real second sales.
3. **The winner is right**, matching Whatnot's "X won!".
4. **The leader is right during bidding**, following "X is Winning!".
5. **The timer is right.** Note whether extensions/overtime show up as `EXTENDED`.
6. **Bid count is DETECTED.** If not, use **Card text** and tell me what the bids text looks like.
7. **The price.** Press **Card text** once during bidding and once just after "won!", and download the log. That's how we'll find the real current/final price element.
8. **Giveaways** appear as `GIVEAWAY`, not `SALE`.
9. **Chat usernames and text** are correct, and the messages already on screen when the page loaded show as `(backlog)`.
10. **Refresh the tab mid-show.** A sale seen only after reload should show a `not_observed_live` warning.

Then send me the downloaded log, a **Test IDs** dump and screenshots of anything wrong, and I'll update `src/selectors.js`.

## Privacy and safety

- Read-only. It never clicks, types or submits anything on Whatnot.
- Reads only the rendered text of the elements listed in `src/selectors.js` (plus product-card text when you press Card text).
- Doesn't touch cookies, storage, network requests, tokens or credentials.
- The exported log contains the page path only, never the query string.
