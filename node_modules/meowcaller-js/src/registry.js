export class CallRegistry {
  constructor() {
    this._calls = new Map();
  }

  insert(session, call = null) {
    if (this._calls.has(session.callID)) return false;
    this._calls.set(session.callID, { session, call, mediaTask: null });
    return true;
  }

  setMediaTask(callID, cancel) {
    const entry = this._calls.get(callID);
    if (!entry) { if (typeof cancel === 'function') cancel(); return; }
    const old = entry.mediaTask;
    entry.mediaTask = cancel;
    if (old) old();
  }

  has(callID) {
    return this._calls.has(callID);
  }

  get(callID) {
    const entry = this._calls.get(callID);
    return entry ? entry : null;
  }

  list() {
    return Array.from(this._calls.values(), (entry) => entry.call || entry.session);
  }

  phase(callID) {
    const entry = this._calls.get(callID);
    return entry ? [entry.session.phase_(), true] : [null, false];
  }

  transition(callID, next) {
    const entry = this._calls.get(callID);
    return entry ? entry.session.transitionTo(next) : false;
  }

  snapshot(callID) {
    const entry = this._calls.get(callID);
    return entry ? [{ ...entry.session }, true] : [null, false];
  }

  activeCount() { return this._calls.size; }

  remove(callID) {
    const entry = this._calls.get(callID);
    if (!entry) return false;
    this._calls.delete(callID);
    if (entry.mediaTask) entry.mediaTask();
    return true;
  }

  abortAll() {
    const entries = [...this._calls.values()];
    this._calls.clear();
    for (const e of entries) { if (e.mediaTask) e.mediaTask(); }
    return entries.length;
  }
}
