import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

export const MsgBindingRequest = 0x0001;
export const MsgBindingSuccess = 0x0101;
export const MsgAllocateRequest = 0x0003;
export const MsgAllocateSuccess = 0x0103;

export const AttrMappedAddress = 0x0001;
export const AttrXorMappedAddress = 0x0020;
export const AttrMessageIntegrity = 0x0008;
export const AttrFingerprint = 0x8028;
export const AttrXorRelayEndpoint = 0x8008;
export const AttrRequestedTransport = 0x0019;

const magicCookie = 0x2112A442;

export function StunMessageType(pkt) {
  if (pkt.length < 20) return [0, false];
  const type = pkt.readUInt16BE(0);
  const cookie = pkt.readUInt32BE(4);
  if (cookie !== magicCookie) return [0, false];
  return [type, true];
}

export function StunTransactionID(pkt) {
  if (pkt.length < 20) return [null, false];
  const tx = Buffer.alloc(12);
  pkt.copy(tx, 0, 8, 20);
  return [tx, true];
}

export function BuildWasmStunAllocateRequest(tx, token, xorEndpoint, relayKey) {
  const msg = Buffer.alloc(20);
  msg.writeUInt16BE(MsgAllocateRequest, 0);
  msg.writeUInt16BE(0, 2);
  msg.writeUInt32BE(magicCookie, 4);
  tx.copy(msg, 8, 0, 12);

  const attrs = [];

  if (xorEndpoint) {
    const xBuf = Buffer.alloc(8);
    xBuf.writeUInt16BE(AttrXorRelayEndpoint, 0);
    xBuf.writeUInt16BE(4, 2);
    xBuf.writeUInt32BE(xorEndpoint.readUInt32BE(0) ^ magicCookie, 4);
    attrs.push(xBuf);
  }

  const rtBuf = Buffer.alloc(8);
  rtBuf.writeUInt16BE(AttrRequestedTransport, 0);
  rtBuf.writeUInt16BE(4, 2);
  rtBuf.writeUInt32BE(0x11000000, 4);
  attrs.push(rtBuf);

  if (token) {
    const tkBuf = Buffer.alloc(4 + token.length);
    tkBuf.writeUInt16BE(0x0023, 0);
    tkBuf.writeUInt16BE(token.length, 2);
    token.copy(tkBuf, 4);
    attrs.push(tkBuf);
  }

  const full = Buffer.concat([msg, ...attrs]);
  const miLen = 20;
  const miBuf = Buffer.alloc(4 + miLen);
  miBuf.writeUInt16BE(AttrMessageIntegrity, 0);
  miBuf.writeUInt16BE(miLen, 2);

  const hmac = crypto.createHmac('sha1', relayKey);
  const msgForIntegrity = Buffer.alloc(full.length + miBuf.length);
  full.copy(msgForIntegrity);
  miBuf.copy(msgForIntegrity, full.length);
  miBuf.fill(0, 4);
  hmac.update(msgForIntegrity);
  const digest = hmac.digest();
  digest.copy(miBuf, 4, 0, 20);

  const finalAttrs = [...attrs.map(a => a.subarray(0, a.length)), miBuf];

  const finalFull = Buffer.concat([msg, ...finalAttrs]);
  const fpLen = 8;
  const fpStart = finalFull.length;
  const fpFull = Buffer.alloc(fpStart + fpLen);
  finalFull.copy(fpFull);
  fpFull.writeUInt16BE(AttrFingerprint, fpStart);
  fpFull.writeUInt16BE(4, fpStart + 2);

  const fpr = crc32(finalFull.subarray(0, fpStart)) ^ 0x5354554E;
  fpFull.writeUInt32BE(fpr, fpStart + 4);

  fpFull.writeUInt16BE(fpFull.length - 20, 2);
  return fpFull;
}

export function BuildWhatsappPing(tx) {
  const msg = Buffer.alloc(20);
  msg.writeUInt16BE(0x0801, 0);
  msg.writeUInt16BE(0, 2);
  msg.writeUInt32BE(magicCookie, 4);
  tx.copy(msg, 8, 0, 12);
  return msg;
}

export function EncodeStunRequest(msgType, tx, attrs, relayKey, addFingerprint) {
  const msgLen = 20 + (attrs ? attrs.reduce((a, b) => a + b.length, 0) : 0);
  const msg = Buffer.alloc(20);
  msg.writeUInt16BE(msgType, 0);
  msg.writeUInt16BE(msgLen - 20, 2);
  msg.writeUInt32BE(magicCookie, 4);
  tx.copy(msg, 8, 0, 12);

  let body = msg;
  if (attrs) {
    body = Buffer.concat([msg, ...attrs]);
  }

  if (addFingerprint && relayKey) {
    const miBuf = Buffer.alloc(24);
    miBuf.writeUInt16BE(AttrMessageIntegrity, 0);
    miBuf.writeUInt16BE(20, 2);

    const hmac = crypto.createHmac('sha1', relayKey);
    const msgForIntegrity = Buffer.alloc(body.length + miBuf.length);
    body.copy(msgForIntegrity);
    miBuf.copy(msgForIntegrity, body.length);
    miBuf.fill(0, 4);
    hmac.update(msgForIntegrity);
    hmac.digest().copy(miBuf, 4, 0, 20);

    body = Buffer.concat([body, miBuf]);

    const fpLen = 8;
    const fpFull = Buffer.alloc(body.length + fpLen);
    body.copy(fpFull);
    fpFull.writeUInt16BE(AttrFingerprint, body.length);
    fpFull.writeUInt16BE(4, body.length + 2);
    fpFull.writeUInt32BE(crc32(body) ^ 0x5354554E, body.length + 4);
    body = fpFull;
  }

  if (!addFingerprint) {
    body.writeUInt16BE(body.length - 20, 2);
  }

  return body;
}

export function EncodeXorRelayEndpoint(ipv4, port) {
  const ipParts = ipv4.split('.').map(Number);
  if (ipParts.length !== 4) return null;
  const ipInt = ((ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]) >>> 0;
  const xorPort = port ^ (magicCookie >> 16);
  const xorIp = ipInt ^ magicCookie;
  const buf = Buffer.alloc(8);
  buf.writeUInt16BE(0, 0);
  buf.writeUInt16BE(xorPort, 2);
  buf.writeUInt32BE(xorIp, 4);
  return buf;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
