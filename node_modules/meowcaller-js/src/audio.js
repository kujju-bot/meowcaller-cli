import { Buffer } from 'node:buffer';
import { createReadStream } from 'node:fs';

export const SampleRate = 16000;
export const FrameSamples = 960;

export function SinkFunc(fn) {
  return {
    writeFrame(f) { fn(f); return Promise.resolve(); },
    close() { return Promise.resolve(); },
  };
}

export function SourceFunc(provider) {
  let closed = false;
  return {
    async readFrame() {
      if (closed) return null;
      return provider();
    },
    close() {
      closed = true;
      return Promise.resolve();
    },
  };
}

class PcmS16Source {
  constructor(r) {
    this.r = r;
    this.buf = Buffer.alloc(FrameSamples * 2);
    this.closed = false;
  }

  async readFrame() {
    if (this.closed) throw new Error('source closed');
    const n = await new Promise((resolve, reject) => {
      this.r.read(this.buf.length, (err, bytes) => {
        if (err) return reject(err);
        resolve(bytes);
      });
    });
    if (n === 0 || n === null) return null;
    if (n < this.buf.length) this.buf.fill(0, n);
    const frame = new Float32Array(FrameSamples);
    for (let i = 0; i < FrameSamples; i++) {
      frame[i] = this.buf.readInt16LE(i * 2) / 32768;
    }
    return frame;
  }

  close() {
    this.closed = true;
    if (this.r) this.r.destroy();
  }
}

export function PCMStream(r) {
  return new PcmS16Source(r);
}

export async function WAVFile(path) {
  const f = createReadStream(path);
  const wr = await newWavReader(f);
  const res = new DownmixResampler(wr.sampleRate, wr.channels);
  const buf = Buffer.alloc(8192);
  let pending = [];
  let done = false;
  let closed = false;

  async function read() {
    while (pending.length < FrameSamples && !done && !closed) {
      await new Promise((resolve) => {
        f.once('readable', () => {
          const chunk = f.read(buf.length);
          if (chunk === null) return resolve(0);
          const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          let bytes = b.length;
          const frameBytes = wr.channels * 2;
          bytes -= bytes % frameBytes;
          if (bytes === 0) return resolve(0);
          const mono = wavMono(b.subarray(0, bytes), wr.channels);
          const resampled = res.process(mono);
          pending = pending.concat(Array.from(resampled));
          if (b.length < buf.length) { done = true; }
          resolve(bytes);
        });
        f.read(0);
      });
    }
    if (pending.length === 0 && done) return null;
    const frame = new Float32Array(FrameSamples);
    const n = Math.min(pending.length, FrameSamples);
    for (let i = 0; i < n; i++) frame[i] = pending[i];
    pending = pending.slice(n);
    return frame;
  }

  return {
    readFrame: read,
    close() { closed = true; f.destroy(); },
  };
}

function wavMono(b, channels) {
  const frames = Math.floor(b.length / (channels * 2));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      acc += b.readInt16LE((i * channels + c) * 2);
    }
    out[i] = (acc / channels) / 32768;
  }
  return out;
}

async function newWavReader(r) {
  const hdr = await readExact(r, 12);
  if (hdr.toString('ascii', 0, 4) !== 'RIFF' || hdr.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let sampleRate = 0;
  let channels = 0;
  let haveFmt = false;

  while (true) {
    const ch = await readExact(r, 8);
    const id = ch.toString('ascii', 0, 4);
    const size = ch.readUInt32LE(4);
    switch (id) {
      case 'fmt ': {
        const body = await readExact(r, size);
        const audioFormat = body.readUInt16LE(0);
        channels = body.readUInt16LE(2);
        sampleRate = body.readUInt32LE(4);
        const bits = body.readUInt16LE(14);
        if ((audioFormat !== 1 && audioFormat !== 0xFFFE) || bits !== 16) {
          throw new Error(`unexpected format ${audioFormat} bits ${bits}`);
        }
        haveFmt = true;
        break;
      }
      case 'data':
        if (!haveFmt) throw new Error('fmt chunk missing');
        return { r, sampleRate, channels, size };
      default:
        if (size > 0) await readExact(r, size + (size % 2));
    }
  }
}

function readExact(r, n) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let remaining = n;
    r.on('data', function onData(chunk) {
      chunks.push(chunk);
      remaining -= chunk.length;
      if (remaining <= 0) {
        r.removeListener('data', onData);
        resolve(Buffer.concat(chunks, n));
      }
    });
    r.on('error', reject);
    r.on('end', () => {
      if (remaining > 0) reject(new Error('unexpected EOF'));
    });
    r.read(0);
  });
}

export async function MP3File() {
  throw new Error('MP3File not yet implemented — use PCMStream with an external decoder');
}

export async function OpusFile() {
  throw new Error('OpusFile not yet implemented — use PCMStream with an external decoder');
}

class DownmixResampler {
  constructor(inRate, channels) {
    this.inRate = inRate;
    this.channels = channels;
    this.pos = 0;
    this.last = 0;
    this.havePrev = false;
  }

  process(mono) {
    if (mono.length === 0) return [];
    if (this.inRate === SampleRate) return Array.from(mono);
    const step = this.inRate / SampleRate;
    const src = this.havePrev ? [this.last, ...mono] : Array.from(mono);
    const base = this.havePrev ? 1 : 0;
    const out = [];
    while (true) {
      const idx = this.pos + base;
      const i = Math.floor(idx);
      if (i + 1 >= src.length) break;
      const frac = idx - i;
      const s = src[i] * (1 - frac) + src[i + 1] * frac;
      out.push(s);
      this.pos += step;
    }
    this.pos -= mono.length;
    this.last = mono[mono.length - 1];
    this.havePrev = true;
    return out;
  }
}
