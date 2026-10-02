const { combineRgb } = require('@companion-module/base');
const { ON_AIR_NAMES, SETTINGS, getSetting } = require('./constants');

const C = {
  green: combineRgb(0, 140, 60),
  red: combineRgb(200, 0, 0),
  amber: combineRgb(230, 140, 0),
  blue: combineRgb(0, 90, 200),
  white: combineRgb(255, 255, 255),
  black: combineRgb(0, 0, 0),
};

function definitions(self) {
  const s = () => self.state;
  const conn = () => (s() && s().connections) || {};

  return {
    server_connected: {
      type: 'boolean',
      name: 'Status: server connected',
      defaultStyle: { bgcolor: C.green, color: C.white },
      options: [],
      showInvert: true,
      callback: () => !!self.connected,
    },
    whatnot_connected: {
      type: 'boolean',
      name: 'Status: Whatnot probe connected',
      defaultStyle: { bgcolor: C.green, color: C.white },
      options: [],
      showInvert: true,
      callback: () => !!(self.connected && conn().reader && conn().reader.connected),
    },
    obs_connected: {
      type: 'boolean',
      name: 'Status: OBS overlay connected',
      defaultStyle: { bgcolor: C.green, color: C.white },
      options: [],
      showInvert: true,
      callback: () => !!(self.connected && conn().overlays > 0),
    },
    review_waiting: {
      type: 'boolean',
      name: 'Sales: a sale is waiting for review',
      defaultStyle: { bgcolor: C.amber, color: C.black },
      options: [],
      callback: () => !!(s() && s().review && s().review.length),
    },
    on_air: {
      type: 'boolean',
      name: 'Graphics: on air',
      defaultStyle: { bgcolor: C.red, color: C.white },
      options: [{ type: 'dropdown', id: 'name', label: 'Graphic', default: 'any', choices: ON_AIR_NAMES }],
      callback: (fb) => {
        const oa = s() && s().onAir;
        if (!oa) return false;
        return fb.options.name === 'any' || oa.name === fb.options.name;
      },
    },
    rehearsal_mode: {
      type: 'boolean',
      name: 'Show: REHEARSAL mode is on',
      defaultStyle: { bgcolor: C.blue, color: C.white },
      options: [],
      callback: () => !!(s() && s().mode === 'rehearsal'),
    },
    segment_active: {
      type: 'boolean',
      name: 'Segment: active',
      defaultStyle: { bgcolor: C.red, color: C.white },
      options: [{ type: 'textinput', id: 'segment', label: 'Segment id (blank = any)', default: '' }],
      callback: (fb) => {
        const cur = s() && s().show && s().show.segment;
        if (!cur) return false;
        return !fb.options.segment || fb.options.segment === cur;
      },
    },
    setting_on: {
      type: 'boolean',
      name: 'Settings: setting is on',
      defaultStyle: { bgcolor: C.green, color: C.white },
      options: [{ type: 'dropdown', id: 'key', label: 'Setting', default: 'autoAir.sales', choices: SETTINGS.map((x) => ({ id: x.id, label: x.label })) }],
      callback: (fb) => !!getSetting(s() && s().settings, fb.options.key),
    },
    auction_live: {
      type: 'boolean',
      name: 'Auction: running',
      defaultStyle: { bgcolor: C.green, color: C.white },
      options: [],
      callback: () => !!(s() && s().currentAuction && s().currentAuction.phase === 'live'),
    },
    chat_slot: {
      type: 'boolean',
      name: 'Chat: message exists in slot',
      defaultStyle: { bgcolor: combineRgb(40, 40, 60), color: C.white },
      options: [{ type: 'number', id: 'slot', label: 'Message (1 = newest)', default: 1, min: 1, max: 20 }],
      callback: (fb) => !!(s() && s().chat && s().chat[(Number(fb.options.slot) || 1) - 1]),
    },
  };
}

module.exports = { definitions, C };
