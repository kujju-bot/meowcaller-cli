import * as srtp from './srtp.js';
import * as rtp from './rtp.js';

export class MediaPipeline {
  constructor(callKey, selfJID, peerJID, ssrc, samplesPerPacket) {
    this.sendKeys = srtp.DeriveE2eKeys(callKey, rtp.FormatE2ESrtpParticipantID(selfJID));
    this.recvKeys = srtp.DeriveE2eKeys(callKey, rtp.FormatE2ESrtpParticipantID(peerJID));
    this.warpMITagLen = srtp.WarpMITagLen;
    this.stream = new rtp.RtpStream(ssrc, samplesPerPacket, false);
    this.sendRoc = new srtp.RocTracker();
    this.recvRoc = new srtp.RecvRocTracker();
  }

  async ProtectAudio(opuPayload) {
    const header = this.stream.NextPacket(opuPayload, false);
    const roc = this.sendRoc.Advance(header.SequenceNumber);
    const packet = rtp.EncodeRtpHeader(header);
    const encrypted = srtp.CryptPayload(this.sendKeys, header.Ssrc, header.SequenceNumber, roc, opuPayload);
    const full = Buffer.concat([packet, encrypted]);
    return srtp.AppendWarpMITag(this.sendKeys.AuthKey, full, roc, this.warpMITagLen);
  }

  async ProtectRTP(header, payload) {
    const roc = this.sendRoc.Advance(header.SequenceNumber);
    const packet = rtp.EncodeRtpHeader(header);
    const encrypted = srtp.CryptPayload(this.sendKeys, header.Ssrc, header.SequenceNumber, roc, payload);
    const full = Buffer.concat([packet, encrypted]);
    return srtp.AppendWarpMITag(this.sendKeys.AuthKey, full, roc, this.warpMITagLen);
  }

  UnprotectAudio(packet) {
    if (packet.length < 12 + this.warpMITagLen) return [null, null, false];
    const withoutTag = packet.subarray(0, packet.length - this.warpMITagLen);
    const [header, ok] = rtp.ParseRtpHeader(withoutTag);
    if (!ok) return [null, null, false];
    const [headerLen] = rtp.RtpHeaderByteLength(withoutTag);
    if (!headerLen || withoutTag.length <= headerLen) return [null, null, false];
    const roc = this.recvRoc.GuessRoc(header.SequenceNumber);
    const payload = withoutTag.subarray(headerLen);
    const plain = srtp.CryptPayload(this.recvKeys, header.Ssrc, header.SequenceNumber, roc, payload);
    return [header, plain, true];
  }
}

export function NewMediaPipeline(callKey, selfJID, peerJID, ssrc, samplesPerPacket) {
  return new MediaPipeline(callKey, selfJID, peerJID, ssrc, samplesPerPacket);
}
