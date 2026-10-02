// Bitfocus Companion module for Whatnot Show Control.

const { InstanceBase, InstanceStatus, runEntrypoint } = require('@companion-module/base');
const { ServerLink } = require('./api');
const actions = require('./actions');
const feedbacks = require('./feedbacks');
const presets = require('./presets');
const variables = require('./variables');

class WhatnotShowControl extends InstanceBase {
  async init(config) {
    this.config = config || {};
    this.state = null;
    this.connected = false;
    this.segKey = '';
    this.lastValues = {};
    this.updateStatus(InstanceStatus.Connecting);
    this.defineAll();
    this.startLink();
  }

  async destroy() {
    if (this.link) this.link.stop();
  }

  async configUpdated(config) {
    this.config = config || {};
    if (this.link) this.link.stop();
    this.state = null;
    this.connected = false;
    this.defineAll();
    this.startLink();
  }

  getConfigFields() {
    return [
      {
        type: 'static-text',
        id: 'info',
        width: 12,
        label: '',
        value: 'Connects to the Whatnot Show Control server (start-show-control.bat). Leave as 127.0.0.1 / 3000 if it runs on this PC.',
      },
      { type: 'textinput', id: 'host', label: 'Server host', width: 8, default: '127.0.0.1' },
      { type: 'number', id: 'port', label: 'Server port', width: 4, default: 3000, min: 1, max: 65535 },
    ];
  }

  defineAll() {
    this.setActionDefinitions(actions.definitions(this));
    this.setFeedbackDefinitions(feedbacks.definitions(this));
    this.setVariableDefinitions(variables.definitions());
    this.setPresetDefinitions(presets.definitions(this));
    this.pushVariables();
  }

  startLink() {
    this.link = new ServerLink({ host: this.config.host || '127.0.0.1', port: this.config.port || 3000 });
    this.link.on('state', (s) => this.onState(s));
    this.link.on('down', (reason) => {
      this.connected = false;
      this.updateStatus(InstanceStatus.ConnectionFailure, reason);
      this.pushVariables();
      this.checkFeedbacks();
    });
    this.link.start();
  }

  onState(s) {
    const wasConnected = this.connected;
    this.state = s;
    this.connected = true;
    if (!wasConnected) this.updateStatus(InstanceStatus.Ok);
    // Segment names come from the server config: rebuild dropdowns / presets if they change.
    const segKey = JSON.stringify(s.segments || []);
    if (segKey !== this.segKey) {
      this.segKey = segKey;
      this.setActionDefinitions(actions.definitions(this));
      this.setPresetDefinitions(presets.definitions(this));
    }
    this.pushVariables();
    this.checkFeedbacks();
  }

  // Only send variables that changed (state arrives every couple of seconds).
  pushVariables() {
    const all = variables.values(this.state, this.connected);
    const changed = {};
    for (const [k, v] of Object.entries(all)) {
      if (this.lastValues[k] !== v) changed[k] = v;
    }
    this.lastValues = all;
    if (Object.keys(changed).length) this.setVariableValues(changed);
  }

  async api(path, body) {
    try {
      return await this.link.post(path, body);
    } catch (e) {
      this.log('warn', `${path}: ${e.message}`);
      return null;
    }
  }
}

runEntrypoint(WhatnotShowControl, []);

module.exports = { WhatnotShowControl };
