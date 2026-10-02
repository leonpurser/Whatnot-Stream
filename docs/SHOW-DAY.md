# Setup and show-day guide

This guide covers getting everything running on the broadcast PC (Windows) and what to do on show day.

## One-time setup (about 15 minutes)

### 1. Install Node.js

Download the **LTS** version from https://nodejs.org and install it with the default options. That's the only thing to install, since the server has no other dependencies.

### 2. Get the code

On https://github.com/leonpurser/Whatnot-Stream:
1. Choose the branch `claude/whatnot-streaming-app-y9rhm6`.
2. Click **Code → Download ZIP**.
3. Unzip it somewhere permanent, for example `Documents\Whatnot-Stream`.

To update later, download again and copy the new files over the old ones. Your show data in `data\` is never in the ZIP, so it won't be overwritten.

### 3. Start the server

Double-click **`start-show-control.bat`**. A black window opens; leave it open, because closing it stops the server. After a couple of seconds the dashboard opens in your browser at http://127.0.0.1:3000/dashboard/.

If Windows asks about network access, **Private networks** is enough. The server only listens on this PC.

### 4. Chrome extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `extension` folder.
3. If you loaded an older version, click its **reload** icon instead.

Then refresh any open Whatnot tab.

### 5. OBS

Add a **Browser Source** to your vertical scene, at the top of the source list:

| Setting | Value |
|---|---|
| URL | `http://127.0.0.1:3000/overlay/` |
| Width / Height | `1080` / `1920` |
| Control audio via OBS | ✅ (stings get their own fader) |
| Shutdown source when not visible | ❌ |
| Refresh browser when scene becomes active | ❌ |

The dashboard's **OBS GRAPHICS** light turns green when it's connected.

To see where graphics land compared with Whatnot's own buttons, open http://127.0.0.1:3000/overlay/?safe=1&bg=1. To watch every graphic on a loop, open http://127.0.0.1:3000/overlay/?demo=1.

## Rehearse first

1. In the dashboard, open **Settings & show** and click **Toggle REHEARSAL mode**.
2. Use the **Rehearsal / test events** buttons: Sale, Big sale, Record sale, Hat trick, Bidding war, Chat message and so on. Watch the graphics in OBS.
3. Try **AIR IT**, **EDIT**, **DELETE**, **ON AIR** for chat, the segments and **END SHOW**.
4. Switch rehearsal mode off again. Rehearsal data is thrown away, and the live show is untouched.

Real Whatnot sales still go to the live show even while rehearsal mode is on.

## Show day checklist

1. Double-click `start-show-control.bat`.
2. Start a fresh show: **Settings & show → Start NEW show**. This resets the counters and leaderboard. Old shows stay saved in `data\shows\`.
3. Open your Whatnot show in **Chrome**, in its own window, and keep that window **visible**: not minimised, and not behind other windows if you can help it (a second monitor is ideal). Chrome slows down hidden tabs.
   - In Chrome settings, under Performance, add `whatnot.com` to **"Always keep these sites active"**.
4. In the probe panel on the Whatnot page, **Server** should say **CONNECTED**.
5. In the dashboard, **WHATNOT** and **OBS GRAPHICS** should both be green.
6. Do a quick test: press **TOP BUYERS** (it says "no buyers yet" on a fresh show), then **SHOW STATS**, then **CLEAR ALL**.

## How sales get on air (the important bit)

The probe can read the price, but not perfectly reliably yet, since it's guessed from the "£3 Sold" text. So for now:

- **Each sale lands in "Needs review"** with the winner and price. Glance at it, then press **AIR IT**: SOLD plus any milestone, record or new-leader graphic plays. Press **OK, DON'T AIR** to just count it.
- **Wrong price or winner?** Press **EDIT**. **Not a real sale?** Press **DELETE**.
- **The probe missed a sale?** Use **Manual sale**.
- **Once you've seen the price guess right for 10–20 sales,** tick **Settings → Trust the probe's price guess**. Confident sales then air automatically, with no button needed.

Sales count towards stats and the leaderboard straight away, whether or not they're aired.

**The dashboard log** tells you when a duplicate was ignored, when a sale needs review, or when the Whatnot tab was hidden.

## Stream Deck / Bitfocus Companion

Use Companion's **Generic HTTP** module and create **POST** actions. No body is needed.

| Button | URL |
|---|---|
| Air waiting sale | `http://127.0.0.1:3000/api/cue/air_review` |
| Don't air waiting sale | `http://127.0.0.1:3000/api/cue/dismiss_review` |
| SOLD (last sale again) | `http://127.0.0.1:3000/api/cue/sold_last` |
| Top buyers | `http://127.0.0.1:3000/api/cue/top_buyers` |
| Show stats | `http://127.0.0.1:3000/api/cue/stats` |
| Current leader | `http://127.0.0.1:3000/api/cue/new_leader` |
| Next up (current item) | `http://127.0.0.1:3000/api/cue/item_intro` |
| Bidding war | `http://127.0.0.1:3000/api/cue/bidding_war` |
| Overtime | `http://127.0.0.1:3000/api/cue/overtime` |
| Giveaway | `http://127.0.0.1:3000/api/cue/giveaway` |
| £1 Madness | `http://127.0.0.1:3000/api/cue/segment?id=pound_madness` |
| End segment | `http://127.0.0.1:3000/api/cue/segment_end` |
| Clear chat bubble | `http://127.0.0.1:3000/api/cue/chat_clear` |
| **CLEAR ALL** | `http://127.0.0.1:3000/api/cue/clear` |
| End show recap | `http://127.0.0.1:3000/api/show/end` |

For button feedback, `GET http://127.0.0.1:3000/api/companion` returns simple JSON:
- `itemsSold`, `topBuyer`, `biggestSale`, `lastSale`;
- `needsReview`, the number of sales waiting;
- `readerConnected`, `overlayConnected`, `onAir`.

## Changing things

Copy settings you want to change from `config\default.json` into a new file `config\local.json`, keeping only those keys. For example:

```json
{
  "thresholds": { "bigSale": 30, "buyerMilestones": { "3": "HAT TRICK", "5": "HIGH FIVE", "10": "DOUBLE DIGITS" } },
  "segments": [ { "id": "pound_madness", "title": "£1 MADNESS", "subtitle": "10 ITEMS • £1 STARTS", "color": "#ff2d55" } ],
  "brand": { "showName": "UNIT 22 VINTAGE", "accent": "#ffd400" },
  "layout": { "centerY": 640 },
  "privacy": { "hiddenBuyers": ["someone_who_asked_not_to_be_shown"] },
  "audio": { "volume": 0.5, "files": { "sold": "my-sold-sting.mp3", "chat": false } }
}
```

Restart the server after editing.

- **`layout.centerY`** moves all the main graphics up or down on the 1080×1920 canvas.
- **Audio:** put files in `server\public\assets\audio\`. Map a cue name to a file, or set it to `false` to silence it. Without files, short built-in synth stings play. You can also mute the browser source in OBS.
- **Hidden buyers** never appear by name on air: they show as "A LUCKY BUYER" and are left off the public leaderboard.

## If something goes wrong

| Symptom | Fix |
|---|---|
| Panel says **Server OFFLINE** | The black server window was closed. Double-click the .bat again. Events wait in a queue and send when it's back. |
| Panel says **REFRESH THIS TAB** | The extension was reloaded. Refresh the Whatnot tab. |
| WHATNOT light red | The Whatnot tab is closed, hidden or on the wrong page. Graphics still work manually. |
| OBS GRAPHICS light red | Right-click the browser source, choose **Refresh**, and check the URL. |
| A graphic is stuck or wrong | **CLEAR ALL**. |
| Sale counted twice | **DELETE** one. Duplicates should be caught, but this is the escape hatch. |
| Server crashed | Restart it. Nothing is lost: the show is rebuilt from `data\shows\<show>.jsonl`. |
