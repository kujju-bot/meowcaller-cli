import { NewPlayer } from './player.js';

export class Call {
  constructor(engine, id, peer) {
    this.eng = engine;
    this._id = id;
    this._peer = peer;
    this._phase = null;
    this._player = null;
    this._sink = null;
    this._onReady = null;
    this._onEnd = null;
    this._onState = null;
    this._videoSink = null;
    this._onVideoState = null;
  }

  id() { return this._id; }
  peer() { return this._peer; }
  state() { return this._phase; }

  isVideo() {
    const m = this.eng.lookup(this._id);
    return m ? m.isVideo : false;
  }

  answer() { return this.eng.answer(this); }
  reject() { return this.eng.reject(this); }
  hangup() { return this.eng.hangup(this); }

  subscribe(p) { this._player = p; }

  play(src) {
    const p = NewPlayer();
    this.subscribe(p);
    p.play(src);
    return p;
  }

  receive(sink) { this._sink = sink; }
  receiveVideo(sink) { this._videoSink = sink; }

  sendVideo(accessUnit) { return this.eng.sendVideoFrame(this._id, accessUnit); }

  onReady(fn) { this._onReady = fn; }
  onEnd(fn) { this._onEnd = fn; }
  onStateChange(fn) { this._onState = fn; }
  onVideoState(fn) { this._onVideoState = fn; }

  setPhase(next) {
    if (this._phase === next) return;
    this._phase = next;
    if (this._onState) this._onState(next);
  }
}
