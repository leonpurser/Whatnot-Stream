## Whatnot Show Control

This module controls the local **Whatnot Show Control** server: the graphics, the sales review, chat, segments, settings and rehearsal. It also shows live show data on your buttons.

**Setup:** start the server (`start-show-control.bat`), then add this connection. The defaults are host `127.0.0.1` and port `3000`.

**The quickest start:** open the **Presets** tab and drag buttons onto a page. The categories are:

- **1. Sales**:
  - *AIR* shows the buyer and price of the newest sale waiting for review and turns amber when one is waiting. Press it to put the sale on air.
  - *DON'T AIR* counts the sale without airing it.
  - *SOLD AGAIN* replays the last sale's graphic.
  - *DELETE SALE* removes the waiting (or last) sale.
- **2. Graphics**: top buyers, stats, leader, next up, bidding war, overtime, giveaway, clear chat, **CLEAR ALL** and end show. A button turns red while its graphic is on air.
- **3. Segments**: one button per segment from the server config, plus end segment.
- **4. Chat**: the four newest chat messages. Press one to put it on air.
- **5. Status**: server, Whatnot and OBS connection lights; items sold, top buyer, biggest sale, current item, leaderboard.
- **6. Settings**: turn each automatic graphic on or off. Green means on.
- **7. Rehearsal**: switch REHEARSAL mode, plus fake events (sale, big sale, record, hat trick and others). These only work in REHEARSAL mode.
- **8. Show**: start a NEW show. This resets the counters.

**Variables** you can use on any button include:
- `$(whatnot:items_sold)`, `$(whatnot:top_buyer)`, `$(whatnot:biggest_sale)`;
- `$(whatnot:review_user)`, `$(whatnot:review_price)`, `$(whatnot:current_item)`, `$(whatnot:current_price)`;
- `$(whatnot:leader_1_user)` to `leader_5_user`, and `$(whatnot:chat_1_text)` to `chat_4_text`;
- `$(whatnot:on_air)`, `$(whatnot:mode)`.

If your connection isn't called `whatnot`, replace that part with its label.

**Chat buttons:** slot 1 is always the newest message, so in a busy chat the list can move just before you press. Glance at the button first.
