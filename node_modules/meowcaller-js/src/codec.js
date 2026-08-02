export const AudioCodec = Object.freeze({
  Mlow: Symbol('mlow'),
  Opus: Symbol('opus'),
});

export function selectAudioCodec(vs) {
  if (!vs || !vs.present || vs.useMlowCodecV1 !== false) {
    return AudioCodec.Mlow;
  }
  return AudioCodec.Opus;
}
