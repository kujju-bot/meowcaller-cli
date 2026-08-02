// MLow codec stub — the real implementation is a Go audio codec.
// Needs a WASM port to work in JS. This is a passthrough that
// preserves the API surface so callers can be written against it.
//
// MLow: 16 kHz mono float32 PCM, 960 samples per frame (60 ms)

export class MlowEncoder {
  constructor(opts = {}) {
    this.log = opts.logger;
  }

  encode(frame) {
    const buf = Buffer.alloc(frame.length * 4);
    for (let i = 0; i < frame.length; i++) {
      buf.writeFloatLE(frame[i], i * 4);
    }
    return buf;
  }
}

export class MlowDecoder {
  constructor(opts = {}) {
    this.log = opts.logger;
  }

  decode(payload) {
    const sampleCount = Math.floor(payload.length / 4);
    const frame = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      frame[i] = payload.readFloatLE(i * 4);
    }
    return frame;
  }
}

export function NewMlowEncoder(opts) { return new MlowEncoder(opts); }
export function NewMlowDecoder(opts) { return new MlowDecoder(opts); }
