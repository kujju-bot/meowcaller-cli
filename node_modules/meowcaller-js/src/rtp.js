import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

export const RtpPayloadTypeH264 = 97;
export const VideoSlotWord = 1;
export const defaultSampleRate = 16000;

export class RtpHeader {
  constructor() {
    this.Marker = false;
    this.PayloadType = 0;
    this.SequenceNumber = 0;
    this.Timestamp = 0;
    this.Ssrc = 0;
  }
}

export function ParseRtpHeader(pkt) {
  if (pkt.length < 12) return [null, false];
  const hdr = new RtpHeader();
  const first = pkt[0];
  const second = pkt[1];
  hdr.Marker = !!(second & 0x80);
  hdr.PayloadType = second & 0x7F;
  hdr.SequenceNumber = pkt.readUInt16BE(2);
  hdr.Timestamp = pkt.readUInt32BE(4);
  hdr.Ssrc = pkt.readUInt32BE(8);
  const cc = first & 0x0F;
  const headerLen = 12 + cc * 4;
  return [hdr, headerLen <= pkt.length];
}

export function RtpHeaderByteLength(pkt) {
  if (pkt.length < 12) return [0, false];
  const cc = pkt[0] & 0x0F;
  return [12 + cc * 4, true];
}

export function EncodeRtpHeader(hdr) {
  const buf = Buffer.alloc(12);
  buf[0] = 0x80;
  buf[1] = (hdr.Marker ? 0x80 : 0) | (hdr.PayloadType & 0x7F);
  buf.writeUInt16BE(hdr.SequenceNumber, 2);
  buf.writeUInt32BE(hdr.Timestamp, 4);
  buf.writeUInt32BE(hdr.Ssrc, 8);
  return buf;
}

export class RtpStream {
  constructor(ssrc, samplesPerPacket, markerFirst) {
    this.ssrc = ssrc;
    this.samplesPerPacket = samplesPerPacket;
    this.markerFirst = markerFirst;
    this.seq = 0;
    this.ts = 0;
    this.started = false;
  }

  NextPacket(payload, marker) {
    const hdr = new RtpHeader();
    hdr.PayloadType = 120;
    hdr.SequenceNumber = this.seq++;
    if (!this.started) {
      this.started = true;
      this.ts = 0;
    } else {
      this.ts += this.samplesPerPacket;
    }
    hdr.Timestamp = this.ts;
    hdr.Ssrc = this.ssrc;
    hdr.Marker = marker || false;
    return hdr;
  }
}

export function DeriveWasmParticipantSsrc(callID, participantID, slotWord) {
  const MAX_U32 = 0xFFFFFFFF;
  const slotByte = slotWord & 0xFF;

  const input = `${callID}:${participantID}`;
  const hash = crypto.createHash('sha256').update(input).digest();
  const ssrcBytes = hash.subarray(0, 4);

  const base = (ssrcBytes.readUInt32BE(0) >>> 0) & 0xFFFFFF00;
  const candidate = (base | slotByte) >>> 0;

  if (candidate !== 0 && candidate !== MAX_U32) return candidate;

  for (let i = 0; i < 255; i++) {
    const test = (base | ((slotByte + i) & 0xFF)) >>> 0;
    if (test !== 0 && test !== MAX_U32) return test;
  }
  return 0xFF000001 >>> 0;
}

export function FormatE2ESrtpParticipantID(jid) {
  const s = typeof jid === 'object' && jid.user ? jid.user : String(jid);
  if (s.includes(':')) return s;
  return `${s}:0`;
}

export class H264Depacketizer {
  constructor() {
    this.buffer = [];
  }

  Depacketize(payload) {
    const nalus = [];
    let i = 0;
    while (i < payload.length - 2) {
      if (payload[i] === 0 && payload[i + 1] === 0 && payload[i + 2] === 1) {
        const start = i + 3;
        let end = start;
        while (end < payload.length - 2) {
          if (payload[end] === 0 && payload[end + 1] === 0 && payload[end + 2] === 1) break;
          end++;
        }
        nalus.push(payload.subarray(start, end));
        i = end;
      } else {
        i++;
      }
    }
    if (nalus.length === 0) nalus.push(payload);
    return nalus;
  }
}

export function SplitAnnexB(au) {
  const nalus = [];
  let i = 0;
  while (i < au.length - 3) {
    if (au[i] === 0 && au[i + 1] === 0 && au[i + 2] === 1) {
      const start = i + 3;
      let end = start;
      while (end < au.length - 3) {
        if (au[end] === 0 && au[end + 1] === 0 && au[end + 2] === 1) break;
        end++;
      }
      nalus.push(Buffer.from(au.subarray(start, end)));
      i = end;
    } else {
      i++;
    }
  }
  return nalus;
}

export function PackageH264NALU(nalu) {
  const typ = nalu[0] & 0x1F;
  if (typ <= 23) {
    const pkt = Buffer.alloc(2 + nalu.length);
    pkt[0] = 0; pkt[1] = 0;
    nalu.copy(pkt, 2);
    return [pkt];
  }
  if (typ === 28) {
    return [nalu];
  }
  return [nalu];
}
