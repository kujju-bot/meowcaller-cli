import type { Socket } from 'net';
import type { Readable } from 'stream';

// -- Enums & Symbols --

declare const CallPhase: {
  readonly Idle: unique symbol;
  readonly Calling: unique symbol;
  readonly Ringing: unique symbol;
  readonly Connecting: unique symbol;
  readonly Active: unique symbol;
  readonly Ended: unique symbol;
};

declare const CallDirection: {
  readonly Outgoing: unique symbol;
  readonly Incoming: unique symbol;
};

declare const PlayerState: {
  readonly Idle: unique symbol;
  readonly Playing: unique symbol;
  readonly Paused: unique symbol;
};

declare const AudioCodec: {
  readonly Mlow: unique symbol;
  readonly Opus: unique symbol;
};

// -- Logger --

export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  trace(obj: Record<string, unknown>, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
  level: string;
}

// -- Baileys Socket (minimal) --

export interface WASocket {
  ev: {
    on(event: string, handler: (...args: any[]) => void): void;
    off(event: string, handler: (...args: any[]) => void): void;
  };
  user?: { id: string };
  ws?: {
    readyState: number;
    isOpen?: boolean;
    send(data: string | Uint8Array, cb?: (err?: Error) => void): boolean;
  };
  sendNode?(node: BinaryNode): Promise<void>;
  generateMessageID?(): string;
}

export interface BinaryNode {
  tag: string;
  attrs: Record<string, string>;
  content?: BinaryNode[] | string | Uint8Array;
}

// -- Config --

export type ConfigOption = (cfg: { logger: Logger | null; diag: Recorder | null }) => void;

export function WithLogger(logger: Logger): ConfigOption;
export function WithDiagnostics(rec: Recorder): ConfigOption;

// -- Recorder --

export class Recorder {
  constructor(path?: string);
  emit(category: string, data: Record<string, unknown>): void;
  close(): void;
}

// -- Client --

export class Client {
  constructor(wa: WASocket, opts?: ConfigOption | ConfigOption[]);
  connect(): this;
  call(ctx: unknown, target: string): Promise<Call>;
  onIncomingCall(fn: (call: Call) => void): void;
  listCalls(): Array<Call | CallSession>;
  getCall(callID: string): Call | CallSession | null;
}

// -- Call --

export class Call {
  id(): string;
  peer(): string;
  state(): symbol;
  isVideo(): boolean;
  answer(): Promise<void>;
  reject(): Promise<void>;
  hangup(): Promise<void>;
  subscribe(player: Player): void;
  play(src: AudioSource): Player;
  receive(sink: AudioSink): void;
  receiveVideo(sink: VideoSink): void;
  sendVideo(annexB: Uint8Array): void;
  onReady(fn: () => void): void;
  onEnd(fn: (reason: string) => void): void;
  onStateChange(fn: (phase: symbol) => void): void;
  onVideoState(fn: (state: VideoState) => void): void;
}

// -- Session --

export interface VideoState {
  Active: boolean;
  Upgrade: boolean;
}

export class CallSession {
  callID: string;
  peerJID: string;
  callCreator: string;
  direction: symbol;
  isVideo: boolean;
  phase_(): symbol;
  isActive(): boolean;
  isEnded(): boolean;
  description(): string;
  transitionTo(next: symbol): boolean;
}

export { CallDirection, CallPhase };

// -- Player --

export interface Player {
  play(source: AudioSource): void;
  pause(): void;
  resume(): void;
  stop(): void;
  state(): symbol;
  onFinish(fn: () => void): void;
  nextFrame(): Promise<Float32Array | null>;
}

export function NewPlayer(): Player;
export { PlayerState };

// -- Audio --

export interface AudioSource {
  readFrame(): Promise<Float32Array | null>;
  close(): Promise<void>;
}

export interface AudioSink {
  writeFrame(frame: Float32Array): Promise<void>;
  close(): Promise<void>;
}

export const SampleRate: 16000;
export const FrameSamples: 960;

export function SourceFunc(provider: () => Promise<Float32Array | null>): AudioSource;
export function SinkFunc(fn: (frame: Float32Array) => void): AudioSink;
export function PCMStream(r: Readable): AudioSource;
export function WAVFile(path: string): Promise<AudioSource>;
export function MP3File(path: string): Promise<AudioSource>;
export function OpusFile(path: string): Promise<AudioSource>;

// -- Video --

export interface VideoSink {
  writeVideo(au: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export function VideoSinkFunc(fn: (au: Uint8Array) => void): VideoSink;
export function AnnexBRecorder(path: string): Promise<VideoSink>;

// -- Codec --

export { AudioCodec };
export function selectAudioCodec(vs: { present: boolean; useMlowCodecV1?: boolean } | null): symbol;

// -- Opus Codec --

export interface OpusEncoderOpts {
  sampleRate?: number;
  channels?: number;
  frameSize?: number;
}

export interface OpusDecoderOpts {
  sampleRate?: number;
  channels?: number;
  maxFrameSize?: number;
}

export class OpusEncoder {
  static create(opts?: OpusEncoderOpts): Promise<OpusEncoder>;
  encode(frame: Float32Array): Buffer;
  free(): void;
}

export class OpusDecoder {
  static create(opts?: OpusDecoderOpts): Promise<OpusDecoder>;
  decode(payload: Buffer): Float32Array;
  free(): void;
}

export function NewOpusEncoder(opts?: OpusEncoderOpts): Promise<OpusEncoder>;
export function NewOpusDecoder(opts?: OpusDecoderOpts): Promise<OpusDecoder>;

// -- Registry --

export class CallRegistry {
  insert(session: CallSession, call?: Call | null): boolean;
  setMediaTask(callID: string, cancel: () => void): void;
  has(callID: string): boolean;
  get(callID: string): { session: CallSession; call: Call | null } | null;
  list(): Array<Call | CallSession>;
  phase(callID: string): [symbol | null, boolean];
  transition(callID: string, next: symbol): boolean;
  snapshot(callID: string): [Record<string, unknown> | null, boolean];
  activeCount(): number;
  remove(callID: string): boolean;
  abortAll(): number;
}
