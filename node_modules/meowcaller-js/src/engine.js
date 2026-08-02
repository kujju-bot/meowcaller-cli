import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { Call } from './call.js';
import * as stun from './stun.js';
import * as rtp from './rtp.js';
import * as relay from './relay.js';
import * as signaling from './signaling.js';
import { CallPhase, CallDirection, CallSession } from './session.js';
import { connectDtlsRelay } from './dtls.js';
import { FrameSamples, SampleRate } from './audio.js';
import { NewMediaPipeline } from './media-pipeline.js';
import { OpusEncoder, OpusDecoder } from './opus.js';

export class Engine {
  constructor(client) {
    this.c = client;
    this.calls = new Map();
    this._installed = false;
  }

  lookup(callID) {
    return this.calls.get(callID) || null;
  }

  entry(callID) {
    if (!this.calls.has(callID)) {
      this.calls.set(callID, {});
    }
    return this.calls.get(callID);
  }

  install(wa) {
    if (this._installed) return;
    this._installed = true;

    wa.ev.on('call', async ([ev]) => {
      if (!ev) return;
      switch (ev.type) {
        case 'offer':
          this._onOffer(wa, ev);
          break;
        case 'relaylatency':
        case 'transport':
          this._onRelay(wa, ev.callId, ev.data);
          break;
        case 'terminate':
          this._onTerminate(wa, ev.callId, ev.reason);
          break;
      }
    });
  }

  async placeCall(ctx, target) {
    const wa = this.c.wa;
    const selfJid = wa.user?.id;
    if (!selfJid) throw new Error('not connected — no own JID');

    const peerJid = this._resolvePeerJid(target);
    this.c.log?.info({ peerLid: peerJid, selfLid: selfJid }, 'resolved peer');

    const callKey = crypto.randomBytes(32);
    const callID = newCallID();

    const deviceKeys = this._encryptCallKeyForDevice(peerJid, callKey);

    const offer = signaling.BuildOffer({
      CallID: callID,
      To: peerJid,
      CallCreator: selfJid,
      DeviceKeys: deviceKeys,
      Capability: signaling.CapabilityOffer,
    });

    const call = new Call(this, callID, peerJid);

    const m = this.entry(callID);
    const session = new CallSession(callID, peerJid, selfJid, CallDirection.Outgoing, { logger: this.c.log });
    m.call = call;
    m.session = session;
    m.callKey = callKey;
    m.selfLID = selfJid;
    m.peerLID = peerJid;
    m.creator = selfJid;
    m.direction = CallDirection.Outgoing;
    this.c.registry?.insert(session, call);

    this.c.log?.info({ callID }, 'sending offer');
    await this._sendCallNode(wa, offer);
    call.setPhase(CallPhase.Calling);
    return call;
  }

  _resolvePeerJid(target) {
    if (target.includes('@')) return target;
    const pn = target.startsWith('+') ? target.slice(1) : target;
    return `${pn}@s.whatsapp.net`;
  }

  _encryptCallKeyForDevice(deviceJid, callKey) {
    // TODO: encrypt via Signal session for each target device
    return [{ DeviceJid: deviceJid, Ciphertext: callKey, EncType: 'pkmsg' }];
  }

  async _sendCallNode(wa, node) {
    if (typeof wa.sendNode === 'function') {
      await wa.sendNode(node);
      return;
    }

    // Fallback: use the raw WebSocket with WhatsApp's binary encoding
    const { encodeBinaryNode } = await import('@whiskeysockets/baileys');
    const id = crypto.randomBytes(12).toString('hex').toUpperCase();
    node.attrs = { ...node.attrs, id };

    if (wa.ws && wa.ws.isOpen) {
      const encoded = encodeBinaryNode(node);
      wa.ws.send(encoded);
    } else {
      this.c.log?.warn('cannot send call node — WebSocket not open');
    }
  }

  async answer(callObj) {
    const id = callObj.id();
    const m = this.lookup(id);
    if (!m) throw new Error(`unknown call ${id}`);
    m.acceptPending = true;
    callObj.setPhase(CallPhase.Connecting);
    this._maybeStartMedia(id);
  }

  async reject(callObj) {
    const id = callObj.id();
    const m = this.lookup(id);
    const to = m?.from || callObj.peer();
    const creator = m?.creator || callObj.peer();
    const rej = signaling.BuildReject(id, to, creator);
    await this._sendCallNode(this.c.wa, rej);
    this._stopMedia(id);
    callObj.setPhase(CallPhase.Ended);
    if (callObj._onEnd) callObj._onEnd('rejected');
  }

  async hangup(callObj) {
    const id = callObj.id();
    const m = this.lookup(id);
    const to = m?.from || callObj.peer();
    const creator = m?.creator || callObj.peer();
    const term = signaling.BuildTerminate({ CallID: id, To: to, CallCreator: creator });
    await this._sendCallNode(this.c.wa, term);
    this._stopMedia(id);
    callObj.setPhase(CallPhase.Ended);
    if (callObj._onEnd) callObj._onEnd('hangup');
  }

  _onOffer(wa, ev) {
    const callID = ev.callId;
    const callKey = crypto.randomBytes(32);
    const peer = ev.callCreator || ev.from;

    this.c.log?.info({ callID, peer }, 'incoming offer');
    const call = new Call(this, callID, peer);

    const m = this.entry(callID);
    const session = new CallSession(callID, peer, peer, CallDirection.Incoming, { logger: this.c.log });
    m.call = call;
    m.session = session;
    m.callKey = callKey;
    m.from = ev.from;
    m.creator = peer;
    m.direction = CallDirection.Incoming;
    m.isVideo = signaling.OfferHasVideo(ev.data);
    this.c.registry?.insert(session, call);

    call.setPhase(CallPhase.Ringing);

    this._sendPreaccept(wa, callID, ev.from, peer);

    if (this.c._onIncomingCall) {
      this.c._onIncomingCall(call);
    }
  }

  async _sendPreaccept(wa, callID, to, creator) {
    const pre = {
      tag: 'call',
      attrs: { to: to.toString(), id: crypto.randomBytes(12).toString('hex') },
      content: [{
        tag: 'preaccept',
        attrs: { 'call-id': callID, 'call-creator': creator.toString() },
        content: [
          { tag: 'audio', attrs: { enc: 'opus', rate: '16000' } },
          { tag: 'encopt', attrs: { keygen: '2' } },
          { tag: 'capability', attrs: { ver: '1' }, content: Array.from(signaling.CapabilityOffer) },
        ],
      }],
    };
    await this._sendCallNode(wa, pre);
  }

  _onRelay(wa, callID, data) {
    const r = findRelay(data);
    if (!r) return;
    const m = this.entry(callID);
    m.relay = parseRelayData(r);
    this._maybeStartMedia(callID);
  }

  _onTerminate(wa, callID, reason) {
    this.c.log?.info({ callID, reason }, 'call terminated');
    this._stopMedia(callID);
    const m = this.lookup(callID);
    if (m?.call) {
      if (m.session) m.session.transitionTo(CallPhase.Ended);
      m.call.setPhase(CallPhase.Ended);
      if (m.call._onEnd) m.call._onEnd(reason || 'remote_ended');
    }
    this.c.registry?.remove(callID);
  }

  _maybeStartMedia(callID) {
    const m = this.calls.get(callID);
    if (!m || m.started || !m.callKey || !m.relay) return;
    m.started = true;
    const { call, callKey, selfLID, peerLID, relay: rd } = m;

    this.c.log?.info({ callID }, 'starting media');
    const abort = new AbortController();
    m.mediaTask = () => abort.abort();

    this._runMedia(abort.signal, callID, call, callKey, selfLID, peerLID, rd).catch((err) => {
      this.c.log?.warn({ callID, err: err.message }, 'media ended');
    });
  }

  async _runMedia(signal, callID, callObj, callKey, selfLID, peerLID, rd) {
    const log = this.c.log;
    const ep = getMediaRelayEndpoint(rd);
    if (!ep || ep.addresses.length === 0) throw new Error('no relay endpoint');

    const addr = { address: ep.addresses[0].ipv4, port: ep.addresses[0].port };
    log?.info({ relayName: ep.relayName, addr }, 'connecting to relay');

    let ch;
    try {
      log?.info('attempting DTLS relay connection');
      ch = await connectDtlsRelay(addr, { logger: log, timeout: 12000 });
      log?.info('DTLS relay connected');
    } catch (err) {
      log?.warn({ err: err.message }, 'DTLS failed, falling back to direct UDP');
      ch = await relay.ConnectRelayMedia(addr, { logger: log, timeout: 12000 });
    }

    let encoder = null;
    let decoder = null;
    try {
      encoder = await OpusEncoder.create({ sampleRate: SampleRate, channels: 1, frameSize: FrameSamples });
      decoder = await OpusDecoder.create({ sampleRate: SampleRate, channels: 1, maxFrameSize: FrameSamples });
      log?.info('Opus codec initialized');
    } catch (err) {
      log?.warn({ err: err.message }, 'Opus codec init failed, sending raw PCM');
    }

    const tx = crypto.randomBytes(12);
    const endpointXor = stun.EncodeXorRelayEndpoint(ep.addresses[0].ipv4, ep.addresses[0].port);
    const allocate = stun.BuildWasmStunAllocateRequest(tx, rd.relayTokens[ep.tokenID],
      endpointXor, rd.relayKeyASCII);
    await ch.send(allocate);

    const ptx = crypto.randomBytes(12);
    const initPing = stun.BuildWhatsappPing(ptx);
    await ch.send(initPing);

    const ssrc = rtp.DeriveWasmParticipantSsrc(callID, rtp.FormatE2ESrtpParticipantID(selfLID), 0);
    log?.info({ ssrc: '0x' + ssrc.toString(16).padStart(8, '0') }, 'media SSRC');

    const txPipe = new NewMediaPipeline(callKey, selfLID, peerLID, ssrc, FrameSamples);
    const rxPipe = new NewMediaPipeline(callKey, selfLID, peerLID, ssrc, FrameSamples);

    const keepaliveTimer = setInterval(async () => {
      if (signal.aborted) { clearInterval(keepaliveTimer); return; }
      try {
        const ktx = crypto.randomBytes(12);
        await ch.send(allocate);
        await ch.send(stun.BuildWhatsappPing(ktx));
      } catch (err) {
        log?.debug({ err: err.message }, 'keepalive failed');
      }
    }, 1000);

    const frameInterval = (FrameSamples / SampleRate) * 1000;
    const sendTimer = setInterval(async () => {
      if (signal.aborted) { clearInterval(sendTimer); return; }
      try {
        const player = callObj._player;
        let frame = null;
        if (player) frame = await player.nextFrame();
        if (!frame) frame = new Float32Array(FrameSamples);

        const pcmBytes = Buffer.from(frame.buffer);
        const opusPayload = encoder ? encoder.encode(frame) : pcmBytes;
        const packet = await txPipe.ProtectAudio(opusPayload);
        await ch.send(packet);
      } catch (err) {
        log?.debug({ err: err.message }, 'audio send failed');
      }
    }, frameInterval);

    const recvBuf = Buffer.alloc(1500);
    signal.addEventListener('abort', () => {
      clearInterval(keepaliveTimer);
      clearInterval(sendTimer);
      encoder?.free();
      decoder?.free();
      ch.close();
    });

    try {
      let rtpIn = 0;
      while (!signal.aborted) {
        const n = await ch.recv(recvBuf);
        if (signal.aborted) break;
        const pkt = recvBuf.subarray(0, n);
        const isRTP = relay.ClassifyRelayPacket(pkt) === relay.RelayPacketRtp;
        if (!isRTP) {
          const [mt, isStun] = stun.StunMessageType(pkt);
          if (isStun && mt === stun.MsgBindingRequest) {
            const [txId] = stun.StunTransactionID(pkt);
            if (txId) {
              const resp = stun.EncodeStunRequest(stun.MsgBindingSuccess, txId, null, rd.relayKeyASCII, true);
              await ch.send(resp);
            }
          }
          continue;
        }

        const [result, plain] = this._unprotectAndDecode(rxPipe, pkt);
        if (!result) continue;
        const sink = callObj._sink;
        if (sink) {
          let frame;
          if (decoder) {
            frame = decoder.decode(plain);
          } else {
            frame = new Float32Array(plain.buffer, plain.byteOffset, plain.byteLength / 4);
          }
          await sink.writeFrame(frame);
        }

        rtpIn++;
        if (rtpIn === 1) {
          log?.info('first RTP decoded, inbound audio flowing');
          callObj.setPhase(CallPhase.Active);
          if (callObj._onReady) callObj._onReady();
        }
      }
    } catch (err) {
      if (!signal.aborted) throw err;
    }
  }

  _unprotectAndDecode(pipe, pkt) {
    try {
      const [result, payload] = pipe.UnprotectAudio(pkt);
      return [result, payload];
    } catch (err) {
      this.c.log?.debug({ err: err.message }, 'failed to unprotect RTP');
      return [null, null];
    }
  }

  _stopMedia(callID) {
    const m = this.calls.get(callID);
    if (m?.mediaTask) {
      m.mediaTask();
      m.mediaTask = null;
    }
  }

  sendVideoFrame(callID, au) {
    const m = this.calls.get(callID);
    if (!m?.videoTx) throw new Error('no active video media');
    m.videoTx.send(au);
  }
}

function findRelay(node) {
  if (!node) return null;
  if (node.tag === 'relay') return node;
  if (node.content) {
    const kids = Array.isArray(node.content) ? node.content : [];
    for (const kid of kids) {
      const r = findRelay(kid);
      if (r) return r;
    }
  }
  return null;
}

function parseRelayData(node) {
  const rd = { relayKeyASCII: null, relayTokens: [], endpoints: [] };
  const kids = Array.isArray(node.content) ? node.content : [];
  for (const kid of kids) {
    if (kid.tag === 'key' && kid.content) {
      rd.relayKeyASCII = Buffer.from(kid.content);
    }
    if (kid.tag === 'token' && kid.content) {
      const id = kid.attrs?.id !== undefined ? parseInt(kid.attrs.id) : rd.relayTokens.length;
      const buf = Buffer.from(kid.content);
      rd.relayTokens[id] = buf;
    }
    if (kid.tag === 'te2' && kid.content) {
      const ab = Buffer.from(kid.content);
      if (ab.length === 6) {
        rd.endpoints.push({
          relayID: parseInt(kid.attrs?.relay_id || '0'),
          relayName: kid.attrs?.relay_name || '',
          tokenID: parseInt(kid.attrs?.token_id || '0'),
          authTokenID: parseInt(kid.attrs?.auth_token_id || '0'),
          isFNA: kid.attrs?.is_fna === '1',
          addresses: [{
            ipv4: `${ab[0]}.${ab[1]}.${ab[2]}.${ab[3]}`,
            port: ab.readUInt16BE(4),
          }],
        });
      }
    }
  }
  return rd;
}

function getMediaRelayEndpoint(rd) {
  for (const ep of rd.endpoints) {
    if (!ep.isFNA && ep.authTokenID !== 0) return ep;
  }
  for (const ep of rd.endpoints) {
    if (!ep.isFNA) return ep;
  }
  return rd.endpoints[0] || null;
}

function newCallID() {
  const b = crypto.randomBytes(16);
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join('');
}
