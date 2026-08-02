import { Engine } from './engine.js';
import { CallRegistry } from './registry.js';
import { resolveConfig } from './logging.js';

export class Client {
  constructor(wa, opts = {}) {
    const cfg = resolveConfig([].concat(opts));
    this.wa = wa;
    this.log = cfg.logger;
    this.diag = cfg.diag;
    this.eng = new Engine(this);
    this.registry = new CallRegistry();
    this._onIncomingCall = null;
  }

  async call(ctx, target) {
    return this.eng.placeCall(ctx, target);
  }

  onIncomingCall(fn) {
    this._onIncomingCall = fn;
  }

  connect() {
    this.eng.install(this.wa);
    return this;
  }

  listCalls() {
    return this.registry.list();
  }

  getCall(callID) {
    const entry = this.registry.get(callID);
    return entry ? entry.call || entry.session : null;
  }
}
