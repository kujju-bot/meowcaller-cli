export const CallDirection = Object.freeze({
  Outgoing: Symbol('outgoing'),
  Incoming: Symbol('incoming'),
});

export const CallPhase = Object.freeze({
  Idle: Symbol('idle'),
  Calling: Symbol('calling'),
  Ringing: Symbol('ringing'),
  Connecting: Symbol('connecting'),
  Active: Symbol('active'),
  Ended: Symbol('ended'),
});

const phaseName = (p) => {
  for (const [name, sym] of Object.entries(CallPhase)) {
    if (sym === p) return name.toLowerCase();
  }
  return 'unknown';
};

export class CallSession {
  constructor(callID, peerJID, callCreator, direction, opts = {}) {
    this.callID = callID;
    this.peerJID = peerJID;
    this.callCreator = callCreator;
    this.direction = direction;
    this.isVideo = false;
    this.phase = direction === CallDirection.Incoming ? CallPhase.Ringing : CallPhase.Idle;
    this.log = opts.logger || null;
    this.meta = opts.meta || {};
  }

  phase_() { return this.phase; }
  isActive() { return this.phase === CallPhase.Active; }
  isEnded() { return this.phase === CallPhase.Ended; }

  description() {
    const label = this.direction === CallDirection.Incoming ? 'incoming' : 'outgoing';
    const peer = this.direction === CallDirection.Incoming ? this.callCreator : this.peerJID;
    return `${label} call ${this.callID} to ${peer}`;
  }

  transitionTo(next) {
    const prev = this.phase;
    const ok = canTransition(this.direction, this.phase, next);
    if (ok) {
      this.phase = next;
      if (this.log) {
        this.log.debug({ call_id: this.callID, from: phaseName(prev), to: phaseName(next) }, 'phase transition');
      }
    }
    return ok;
  }
}

function canTransition(direction, from, to) {
  if (from === CallPhase.Ended) return false;
  if (to === CallPhase.Ended) return true;
  if (from === to) return true;
  if (from === CallPhase.Idle && to === CallPhase.Calling) return direction === CallDirection.Outgoing;
  if (from === CallPhase.Calling && to === CallPhase.Ringing) return true;
  if (from === CallPhase.Ringing && to === CallPhase.Connecting) return true;
  if (from === CallPhase.Connecting && to === CallPhase.Active) return true;
  return false;
}
