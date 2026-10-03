// Central selector / pattern / tuning map for the Whatnot DOM probe.
//
// If Whatnot changes its UI, this should be the ONLY file you need to edit.
// After editing, reload the extension at chrome://extensions and refresh the
// Whatnot tab.
//
// Rules:
//  - Prefer data-testid, aria-* and semantic structure.
//  - Never add generated CSS class names (e.g. ".css-1x2y3z").
//  - Each entry is a list: selectors are tried in order, first match wins.
//  - Patterns are strings (not RegExp literals) so this can later be served as
//    JSON by the local server. They are compiled case-insensitively.

(function (root) {
  const WNSC = (root.WNSC = root.WNSC || {});

  WNSC.SELECTORS = {
    version: '2026-10-02.1',

    productTitle: ['[data-testid="show-product-title"]'],
    productImage: ['[data-testid="show-product-image"]'],
    winningStatus: ['[data-testid="show-winning-status"]'],
    timer: ['[data-testid="show-timer"]'],
    bidButton: ['[data-testid="show-bid-button"]'],

    // UNKNOWN YET. The bid button shows the NEXT bid, not the current price.
    // On a real show the price appears as "£3" + "Sold" beside the product
    // card. Until its selector is known, the probe GUESSES it from text (see
    // PATTERNS.priceSegment / TUNING.trustPriceGuess). Use "Card text" to find
    // the element, then add its selector here.
    currentPrice: [],

    // UNKNOWN YET. Until a dedicated element is found, bid count and
    // condition are found by scanning the product card's text (see PATTERNS).
    bidCount: [],

    // Optional explicit giveaway marker. Title text is also checked
    // against PATTERNS.giveawayTitle.
    giveawayIndicator: [],

    chatPanel: ['[data-testid="desktop-chat-panel"]'],
    chatMessage: ['[data-testid="chat-message"]'],
    chatAvatarLink: ['[data-testid="chat-message-avatar-link"]'],
  };

  WNSC.PATTERNS = {
    // "dommy31 is Winning!"
    leading: ['^@?(\\S+)\\s+is\\s+winning'],
    // "dommy31 won!"
    won: ['^@?(\\S+)\\s+won\\b'],
    // Seen when the logged-in account is the bidder. Username is unknown.
    youLeading: ["^you(?:'re|\\u2019re| are)\\s+winning"],
    youWon: ['^you\\s+won\\b'],
    // Text in the status element that means "auction ended, nobody won".
    noSale: ['no\\s+bids', 'not\\s+sold', 'unsold'],

    bidCount: '(\\d[\\d,]*)\\s+bids?\\b',
    // A text segment that is only an amount, e.g. "£3" (not "Bid: £4",
    // not "Shipping is £3.27 + Taxes").
    priceSegment: '^[£$€]\\s?\\d[\\d,]*(?:\\.\\d{1,2})?$',
    // Bid button text between items. Not an error.
    bidButtonIdle: 'awaiting|starting|coming up|next item',
    lotNumber: '#\\s?(\\d+)',
    giveawayTitle: '\\bgiveaway\\b',
    chatUserHref: '/user/([^/?#]+)',
    showIdHref: '/live/([^/?#]+)',

    // Matched against whole text segments only, so order doesn't matter.
    conditions: [
      'Vintage',
      'New With Tags',
      'New Without Tags',
      'New With Defects',
      'Like New',
      'Pre-Owned',
      'Pre-owned - Excellent',
      'Pre-owned - Good',
      'Pre-owned - Fair',
      'Used',
    ],
  };

  WNSC.TUNING = {
    // A "won" status must be seen continuously for this long before a sale
    // is emitted (protects against transient render states).
    saleConfirmMs: 300,
    // Secondary guard: identical winner+item+price within this window is
    // treated as a duplicate. Primary guard is "one sale per auction".
    saleDedupWindowMs: 8000,
    // Timer jumping UP by at least this many seconds = auction extended.
    extensionJumpSec: 2,
    // Never re-read the DOM more often than this.
    minReadIntervalMs: 40,
    // Low-rate health check so missing elements are noticed even when the
    // page is quiet. A handful of querySelector calls; very cheap.
    heartbeatMs: 1000,
    // Same user + same text within this window = re-rendered node, not a new message.
    chatRepeatWindowMs: 3000,
    maxLogEntries: 3000,
    maxChatTextLength: 500,
    // How many parent levels above the product card to search for a price.
    priceGuessMaxLevels: 3,
    // false: sales priced from the text guess are marked low confidence
    // (warning "price_is_guess"). Set true once the guess has been checked
    // against 10-20 real sales.
    trustPriceGuess: false,
    // A price shown right beside Whatnot's red "Sold" label when the win
    // appears counts as confirmed (no "price_is_guess" warning). Set false to
    // treat it as a guess too.
    trustSoldLabelPrice: true,
    // After "X won!" appears, wait up to this long for the "Sold" label.
    soldLabelWaitMs: 1500,
  };

  // Selector overrides applied only on the local mock page (tools/mock-show),
  // which marks its <html> element with data-wnsc-mock. Never on whatnot.com.
  WNSC.DEV_OVERRIDES = {};

  if (typeof module !== 'undefined' && module.exports) module.exports = WNSC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
