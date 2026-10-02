const { CUES, SETTINGS, TEST_KINDS, getSetting } = require('./constants');

function segmentChoices(self) {
  const segs = (self.state && self.state.segments) || [];
  return segs.length ? segs.map((s) => ({ id: s.id, label: s.title })) : [{ id: 'pound_madness', label: '£1 MADNESS' }];
}

function newestReview(self) {
  const r = (self.state && self.state.review) || [];
  return r[r.length - 1] || null;
}

function lastSale(self) {
  return (self.state && self.state.summary && self.state.summary.lastSale) || null;
}

function definitions(self) {
  const api = (path, body) => self.api(path, body);

  return {
    cue: {
      name: 'Graphics: play graphic',
      options: [{ type: 'dropdown', id: 'cue', label: 'Graphic', default: 'top_buyers', choices: CUES }],
      callback: async (a) => api(`/api/cue/${a.options.cue}`),
    },
    clear_all: {
      name: 'Graphics: CLEAR ALL (emergency)',
      options: [],
      callback: async () => api('/api/cue/clear'),
    },
    end_show: {
      name: 'Graphics: END SHOW recap',
      options: [],
      callback: async () => api('/api/show/end'),
    },

    air_review: {
      name: 'Sales: AIR newest sale waiting for review',
      options: [],
      callback: async () => api('/api/cue/air_review'),
    },
    dismiss_review: {
      name: "Sales: DON'T AIR newest waiting sale (still counts)",
      options: [],
      callback: async () => api('/api/cue/dismiss_review'),
    },
    manual_sale: {
      name: 'Sales: add manual sale',
      options: [
        { type: 'textinput', id: 'winner', label: 'Buyer username', default: '', useVariables: true },
        { type: 'textinput', id: 'price', label: 'Price (number, blank = unknown)', default: '', useVariables: true },
        { type: 'textinput', id: 'item', label: 'Item (blank = current item)', default: '', useVariables: true },
        { type: 'checkbox', id: 'air', label: 'Put on air', default: true },
      ],
      callback: async (a, ctx) => {
        const winner = (await ctx.parseVariablesInString(String(a.options.winner || ''))).trim().replace(/^@/, '');
        const price = (await ctx.parseVariablesInString(String(a.options.price || ''))).trim().replace(/[£$€]/g, '');
        const item = (await ctx.parseVariablesInString(String(a.options.item || ''))).trim();
        if (!winner) return self.log('warn', 'Manual sale needs a username');
        await api('/api/sale/manual', { winner, price, item, air: !!a.options.air });
      },
    },
    fix_last_sale: {
      name: 'Sales: fix price / buyer of the newest waiting (or last) sale',
      options: [
        { type: 'textinput', id: 'price', label: 'New price (blank = keep)', default: '', useVariables: true },
        { type: 'textinput', id: 'winner', label: 'New buyer (blank = keep)', default: '', useVariables: true },
      ],
      callback: async (a, ctx) => {
        const s = newestReview(self) || lastSale(self);
        if (!s) return self.log('warn', 'No sale to fix');
        const body = { saleId: s.saleId };
        const price = (await ctx.parseVariablesInString(String(a.options.price || ''))).trim().replace(/[£$€]/g, '');
        const winner = (await ctx.parseVariablesInString(String(a.options.winner || ''))).trim().replace(/^@/, '');
        if (price) body.price = price;
        if (winner) body.winner = winner;
        await api('/api/sale/update', body);
      },
    },
    delete_last_sale: {
      name: 'Sales: DELETE the newest waiting (or last) sale',
      options: [],
      callback: async () => {
        const s = newestReview(self) || lastSale(self);
        if (!s) return self.log('warn', 'No sale to delete');
        await api('/api/sale/delete', { saleId: s.saleId });
      },
    },

    segment_start: {
      name: 'Segment: start (plays intro)',
      options: [{ type: 'dropdown', id: 'segment', label: 'Segment', default: segmentChoices(self)[0].id, choices: segmentChoices(self) }],
      callback: async (a) => api('/api/cue/segment', { id: a.options.segment }),
    },
    segment_end: {
      name: 'Segment: end',
      options: [],
      callback: async () => api('/api/cue/segment_end'),
    },

    chat_air: {
      name: 'Chat: put message on air (1 = newest)',
      options: [{ type: 'number', id: 'slot', label: 'Message (1 = newest)', default: 1, min: 1, max: 20 }],
      callback: async (a) => api('/api/chat/air-slot', { slot: a.options.slot }),
    },
    chat_clear: {
      name: 'Chat: clear chat bubble',
      options: [],
      callback: async () => api('/api/cue/chat_clear'),
    },

    setting: {
      name: 'Settings: automatic graphics on / off',
      options: [
        { type: 'dropdown', id: 'key', label: 'Setting', default: 'autoAir.sales', choices: SETTINGS.map((s) => ({ id: s.id, label: s.label })) },
        {
          type: 'dropdown',
          id: 'mode',
          label: 'Change',
          default: 'toggle',
          choices: [
            { id: 'toggle', label: 'Toggle' },
            { id: 'on', label: 'On' },
            { id: 'off', label: 'Off' },
          ],
        },
      ],
      callback: async (a) => {
        const cur = !!getSetting(self.state && self.state.settings, a.options.key);
        const value = a.options.mode === 'on' ? true : a.options.mode === 'off' ? false : !cur;
        await api('/api/settings', { path: a.options.key, value });
      },
    },
    big_sale_threshold: {
      name: 'Settings: BIG SALE threshold',
      options: [{ type: 'number', id: 'value', label: 'Big sale from (whole number)', default: 25, min: 1, max: 100000 }],
      callback: async (a) => api('/api/settings', { path: 'thresholds.bigSale', value: Number(a.options.value) }),
    },

    mode: {
      name: 'Show: LIVE / REHEARSAL mode',
      options: [
        {
          type: 'dropdown',
          id: 'mode',
          label: 'Mode',
          default: 'toggle',
          choices: [
            { id: 'toggle', label: 'Toggle' },
            { id: 'live', label: 'LIVE' },
            { id: 'rehearsal', label: 'REHEARSAL' },
          ],
        },
      ],
      callback: async (a) => {
        const cur = self.state && self.state.mode;
        const mode = a.options.mode === 'toggle' ? (cur === 'rehearsal' ? 'live' : 'rehearsal') : a.options.mode;
        await api('/api/mode', { mode });
      },
    },
    new_show: {
      name: 'Show: start a NEW show (resets counters)',
      options: [
        { type: 'static-text', id: 'warn', label: 'Careful', value: 'Resets items sold and the leaderboard. Old shows stay saved on disk.' },
        { type: 'textinput', id: 'name', label: 'Show name (optional)', default: '', useVariables: true },
      ],
      callback: async (a, ctx) => api('/api/show/new', { name: await ctx.parseVariablesInString(String(a.options.name || '')) }),
    },

    test_event: {
      name: 'Rehearsal: fake event (REHEARSAL mode only)',
      options: [{ type: 'dropdown', id: 'kind', label: 'Event', default: 'sale', choices: TEST_KINDS }],
      callback: async (a) => api(`/api/test/${a.options.kind}`),
    },
  };
}

module.exports = { definitions };
