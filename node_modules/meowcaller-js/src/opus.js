// Opus codec via libopus-wasm (libopus 1.6.1)
//
// Matches the MlowEncoder/MlowDecoder API surface:
//   encode(Float32Array) -> Buffer
//   decode(Buffer) -> Float32Array
//
// 16 kHz mono, 960 samples per frame (60 ms)

import { Buffer } from 'node:buffer';

let _mod = null;

async function loadModule() {
  if (!_mod) {
    _mod = await import('libopus-wasm');
  }
  return _mod;
}

export class OpusEncoder {
  #enc;

  constructor(enc) {
    this.#enc = enc;
  }

  static async create(opts = {}) {
    const mod = await loadModule();
    const enc = await mod.createEncoder({
      sampleRate: opts.sampleRate || 16000,
      channels: opts.channels || 1,
      frameSize: opts.frameSize || 960,
    });
    return new OpusEncoder(enc);
  }

  encode(frame) {
    const pkt = this.#enc.encodeFloat(frame);
    return Buffer.from(pkt);
  }

  free() {
    this.#enc.free();
  }
}

export class OpusDecoder {
  #dec;

  constructor(dec) {
    this.#dec = dec;
  }

  static async create(opts = {}) {
    const mod = await loadModule();
    const dec = await mod.createDecoder({
      sampleRate: opts.sampleRate || 16000,
      channels: opts.channels || 1,
      maxFrameSize: opts.maxFrameSize || 960,
    });
    return new OpusDecoder(dec);
  }

  decode(payload) {
    const pkt = payload instanceof Buffer
      ? new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
      : payload;
    return this.#dec.decodeFloat(pkt);
  }

  free() {
    this.#dec.free();
  }
}

export async function NewOpusEncoder(opts) { return OpusEncoder.create(opts); }
export async function NewOpusDecoder(opts) { return OpusDecoder.create(opts); }
