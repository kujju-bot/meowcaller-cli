import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

export const RelayPacketRtp = 0;
export const RelayPacketStun = 1;
export const RelayPacketUnknown = 2;

export function ClassifyRelayPacket(pkt) {
  if (pkt.length < 2) return RelayPacketUnknown;
  const first = pkt[0];
  if ((first & 0xC0) === 0x80) return RelayPacketRtp;
  if (first === 0x00 || first === 0x01) return RelayPacketStun;
  return RelayPacketUnknown;
}

export class RelayMediaChannel {
  constructor(socket, addr, log) {
    this.socket = socket;
    this.addr = addr;
    this.log = log;
    this._closed = false;
    this._recvQueue = [];
    this._recvResolve = null;
    this._recvReject = null;

    socket.on('message', (msg) => {
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

    socket.on('error', (err) => {
      if (this._recvReject) {
        const r = this._recvReject;
        this._recvReject = null;
        r(err);
      }
    });
  }

  async send(data) {
    if (this._closed) return 0;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    return new Promise((resolve, reject) => {
      this.socket.send(buf, this.addr.port, this.addr.address, (err) => {
        if (err) reject(err);
        else resolve(buf.length);
      });
    });
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
    this._closed = true;
    this.socket.close();
  }
}

export async function ConnectRelayMedia(addr, opts = {}) {
  const log = opts.logger;
  const timeoutMs = opts.timeout || 12000;
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let resolved = false;
    let timer = null;

    socket.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        if (timer) clearTimeout(timer);
        reject(err);
      }
    });

    socket.on('message', () => {
      if (!resolved) {
        resolved = true;
        if (timer) clearTimeout(timer);
        resolve(new RelayMediaChannel(socket, addr, log));
      }
    });

    const tx = crypto.randomBytes(12);
    const ping = Buffer.alloc(20);
    ping.writeUInt16BE(0x0001, 0);
    ping.writeUInt16BE(0, 2);
    ping.writeUInt32BE(0x2112A442, 4);
    tx.copy(ping, 8);
    socket.send(ping, addr.port, addr.address);

    timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.close();
        reject(new Error('relay connect timeout'));
      }
    }, timeoutMs);
  });
}
