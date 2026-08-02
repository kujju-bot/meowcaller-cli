import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

export const WarpMITagLen = 10;

export class E2eSrtpKeys {
  constructor() {
    this.CipherKey = null;
    this.AuthKey = null;
    this.Salt = null;
  }
}

export class RocTracker {
  constructor() {
    this.srtpIndex = 0;
    this.roc = 0;
  }

  Advance(seq) {
    if (seq === 0) this.roc++;
    return this.roc;
  }
}

export class RecvRocTracker {
  constructor() {
    this.roc = 0;
    this.highestSeq = -1;
  }

  GuessRoc(seq) {
    if (this.highestSeq < 0) {
      this.highestSeq = seq;
      return 0;
    }
    if (seq < this.highestSeq && (this.highestSeq - seq) > 0x7FFF) {
      this.roc++;
    }
    this.highestSeq = seq;
    return this.roc;
  }
}

export function DeriveE2eKeys(callKey, participantID) {
  const salt = Buffer.from('WhatsApp VoIP E2E Key', 'utf8');
  const info = Buffer.from(participantID, 'utf8');
  const prk = crypto.createHmac('sha256', salt).update(callKey).digest();

  const required = 78;
  const okm = Buffer.alloc(required);
  let generated = 0;
  let counter = 1;
  while (generated < required) {
    const hmac = crypto.createHmac('sha256', prk);
    hmac.update(Buffer.concat([generated > 0 ? okm.subarray(0, generated) : Buffer.alloc(0), info, Buffer.from([counter])]));
    const block = hmac.digest();
    block.copy(okm, generated, 0, Math.min(32, required - generated));
    generated += 32;
    counter++;
  }

  const keys = new E2eSrtpKeys();
  keys.CipherKey = Buffer.from(okm.subarray(0, 32));
  keys.AuthKey = Buffer.from(okm.subarray(32, 64));
  keys.Salt = Buffer.from(okm.subarray(64, 78));
  return keys;
}

export function CryptPayload(keys, ssrc, seq, roc, plaintext) {
  const ivBuf = Buffer.alloc(16);
  ivBuf.writeUInt32BE(ssrc, 0);
  ivBuf[6] = 0;
  ivBuf.writeUInt32BE(roc, 8);
  ivBuf.writeUInt16BE(seq, 12);
  ivBuf[14] = 0;
  ivBuf[15] = 0;
  const iv = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) iv[i] = ivBuf[i] ^ (i < keys.Salt.length ? keys.Salt[i] : 0);

  const cipher = crypto.createCipheriv('aes-128-ctr', keys.CipherKey.subarray(0, 16), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return encrypted;
}

export function AppendWarpMITag(authKey, packet, roc, tagLen) {
  const rocBuf = Buffer.alloc(4);
  rocBuf.writeUInt32BE(roc);
  const hmac = crypto.createHmac('sha256', authKey);
  hmac.update(packet);
  hmac.update(rocBuf);
  const hash = hmac.digest();
  const tag = hash.subarray(0, tagLen);
  return Buffer.concat([packet, tag]);
}
