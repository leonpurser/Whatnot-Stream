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
    // Use the probe's "Card text" button during a real auction to find the
    // element that shows the current / final price, then add it here.
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
    lotNumber: '#\\s?(\\d+)',
    giveawayTitle: '\\bgiveaway\\b',
    chatUserHref: '/user/([^/?#]+)',
    showIdHref: '/live/([^/?#]+)',

    conditions: [
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
  };

  // Applied only on the local mock page (tools/mock-show), which marks its
  // <html> element with data-wnsc-mock. Never applied on whatnot.com.
  WNSC.DEV_OVERRIDES = {
    currentPrice: ['[data-testid="mock-current-price"]'],
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = WNSC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
