// Pure text parsers. No DOM access here, so everything is unit-testable in Node.

(function (root) {
  const WNSC = (root.WNSC = root.WNSC || {});

  const CURRENCY = { '£': 'GBP', $: 'USD', '€': 'EUR' };

  function normText(s) {
    return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
  }

  function compile(pattern) {
    return pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
  }

  function compileList(list) {
    return (list || []).map(compile);
  }

  // "Bid: £24" -> { amount: 24, currency: 'GBP', raw: '£24' }
  // "£1,250.50" -> { amount: 1250.5, ... }
  function parseMoney(text) {
    const t = normText(text);
    const m = t.match(/([£$€])\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/);
    if (!m) return null;
    const major = parseInt(m[2].replace(/,/g, ''), 10);
    const minor = m[3] ? parseInt(m[3].padEnd(2, '0'), 10) : 0;
    return { amount: (major * 100 + minor) / 100, currency: CURRENCY[m[1]], raw: m[0] };
  }

  // "00:07" -> 7, "1:05" -> 65, "1:00:00" -> 3600, "7s" -> 7
  function parseTimer(text) {
    const t = normText(text);
    let m = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      if (m[3] != null) return +m[1] * 3600 + +m[2] * 60 + +m[3];
      return +m[1] * 60 + +m[2];
    }
    m = t.match(/^(\d+)\s*s$/i);
    if (m) return +m[1];
    return null;
  }

  function parseBidCount(text, pattern) {
    const m = normText(text).match(compile(pattern || '(\\d[\\d,]*)\\s+bids?\\b'));
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }

  function parseLotNumber(text, pattern) {
    const m = normText(text).match(compile(pattern || '#\\s?(\\d+)'));
    return m ? m[1] : null;
  }

  function detectCondition(text, conditions) {
    const t = normText(text).toLowerCase();
    // Longest first so "Pre-owned - Good" beats "Pre-owned".
    const sorted = [...(conditions || [])].sort((a, b) => b.length - a.length);
    for (const c of sorted) if (t.includes(c.toLowerCase())) return c;
    return null;
  }

  // Status element text -> { kind, user, price }
  // kind: 'leading' | 'won' | 'no_sale' | 'unknown' | 'none'
  // user is null when the text says "You" (logged-in bidder) or can't be read.
  function parseStatus(text, patterns) {
    const t = normText(text);
    if (!t) return { kind: 'none', user: null, price: null, text: '' };
    const price = parseMoney(t);
    const tryList = (list) => {
      for (const re of compileList(list)) {
        const m = t.match(re);
        if (m) return m;
      }
      return null;
    };
    let m;
    if ((m = tryList(patterns.youWon))) return { kind: 'won', user: null, you: true, price, text: t };
    if ((m = tryList(patterns.youLeading))) return { kind: 'leading', user: null, you: true, price, text: t };
    if ((m = tryList(patterns.won))) return { kind: 'won', user: cleanUser(m[1]), price, text: t };
    if ((m = tryList(patterns.leading))) return { kind: 'leading', user: cleanUser(m[1]), price, text: t };
    if (tryList(patterns.noSale)) return { kind: 'no_sale', user: null, price: null, text: t };
    return { kind: 'unknown', user: null, price, text: t };
  }

  function cleanUser(u) {
    const s = normText(u).replace(/^@/, '').replace(/[!.,:;]+$/, '');
    return s || null;
  }

  // Key used for comparing / counting buyers.
  function normUser(u) {
    return cleanUser(u) ? cleanUser(u).toLowerCase() : '';
  }

  function normTitle(t) {
    return normText(t).toLowerCase();
  }

  Object.assign(WNSC, {
    normText,
    compile,
    compileList,
    parseMoney,
    parseTimer,
    parseBidCount,
    parseLotNumber,
    detectCondition,
    parseStatus,
    cleanUser,
    normUser,
    normTitle,
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = WNSC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
