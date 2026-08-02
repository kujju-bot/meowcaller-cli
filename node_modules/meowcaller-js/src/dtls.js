import nodeDataChannel from 'node-datachannel';
import { Buffer } from 'node:buffer';

let loggerInitialized = false;
function ensureLogger() {
  if (loggerInitialized) return;
  loggerInitialized = true;
  try {
    nodeDataChannel.initLogger('Warning', () => {});
  } catch {}
}

const DATA_CHANNEL_LABEL = 'pre-negotiated';
const DATA_CHANNEL_ID = 0;

export class DtlsRelayChannel {
  constructor(pc, dc, addr, log) {
    this._pc = pc;
    this._dc = dc;
    this._addr = addr;
    this._log = log;
    this._closed = false;
    this._recvQueue = [];
    this._recvResolve = null;
    this._recvReject = null;
    this._ready = false;
    this._readyWaiters = [];

    dc.onMessage((msg) => {
      if (this._closed) return;
      const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
      if (this._recvResolve) {
        const r = this._recvResolve;
        this._recvResolve = null;
        r(buf);
      } else {
        this._recvQueue.push(buf);
        if (this._recvQueue.length > 500) this._recvQueue.shift();
      }
    });

    dc.onClosed(() => {
      this._closed = true;
      if (this._recvReject) {
        const r = this._recvReject;
        this._recvReject = null;
        r(new Error('DataChannel closed'));
      }
      for (const w of this._readyWaiters) w.reject(new Error('DataChannel closed'));
      this._readyWaiters = [];
    });

    dc.onOpen(() => {
      this._ready = true;
      for (const w of this._readyWaiters) w.resolve();
      this._readyWaiters = [];
    });
  }

  async waitForOpen() {
    if (this._ready) return;
    return new Promise((resolve, reject) => {
      this._readyWaiters.push({ resolve, reject });
    });
  }

  async send(data) {
    if (this._closed || !this._ready) return 0;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const sent = this._dc.sendMessageBinary(new Uint8Array(buf));
    return sent ? buf.length : 0;
  }

  async recv(buf) {
    if (this._recvQueue.length > 0) {
      const msg = this._recvQueue.shift();
      const n = Math.min(msg.length, buf.length);
      msg.copy(buf, 0, 0, n);
      return n;
    }
    return new Promise((resolve, reject) => {
      this._recvResolve = (msg) => {
        const n = Math.min(msg.length, buf.length);
        msg.copy(buf, 0, 0, n);
        resolve(n);
      };
      this._recvReject = reject;
    });
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    try { this._dc.close(); } catch {}
    try { this._pc.close(); } catch {}
    try { nodeDataChannel.cleanup(); } catch {}
  }
}

export async function connectDtlsRelay(addr, opts = {}) {
  ensureLogger();
  const log = opts.logger;
  const timeoutMs = opts.timeout || 12000;
  const certPath = opts.certificatePemFile;
  const keyPath = opts.keyPemFile;

  return new Promise((resolve, reject) => {
    let resolved = false;
    let timer = null;

    const fail = (err) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      reject(err);
    };

    const pcConfig = {
      iceServers: [],
      iceTransportPolicy: 'all',
    };

    if (certPath && keyPath) {
      pcConfig.certificatePemFile = certPath;
      pcConfig.keyPemFile = keyPath;
    }

    const pc = new nodeDataChannel.PeerConnection('meowcaller', pcConfig);

    const dc = pc.createDataChannel(DATA_CHANNEL_LABEL, {
      negotiated: true,
      id: DATA_CHANNEL_ID,
    });

    const channel = new DtlsRelayChannel(pc, dc, addr, log);

    pc.onStateChange((state) => {
      log?.debug({ state }, 'DTLS peer state');
      if (state === 'failed') {
        fail(new Error('DTLS connection failed'));
        try { pc.close(); } catch {}
      }
    });

    pc.onGatheringStateChange((state) => {
      log?.debug({ gatheringState: state }, 'ICE gathering state');
    });

    const candidate = `candidate:1 1 UDP 2130706431 ${addr.address} ${addr.port} typ host`;
    const sdp = [
      'v=0',
      'o=- 0 0 IN IP4 127.0.0.1',
      's=meowcaller',
      't=0 0',
      'a=group:BUNDLE 0',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      'a=sctp-port:5000',
      `a=candidate:${candidate}`,
      'a=ice-ufrag:meow',
      'a=ice-pwd:callerpassword123',
      'a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00',
      'a=setup:actpass',
      'a=ice-lite',
    ].join('\r\n');

    pc.setRemoteDescription(sdp, 'offer').catch((err) => {
      log?.debug({ err: err.message }, 'setRemoteDescription failed, trying local');
    });

    timer = setTimeout(() => {
      fail(new Error('DTLS relay connect timeout'));
      try { pc.close(); } catch {}
    }, timeoutMs);

    channel.waitForOpen()
      .then(() => {
        if (!resolved) {
          resolved = true;
          if (timer) clearTimeout(timer);
          resolve(channel);
        }
      })
      .catch(fail);
  });
}
