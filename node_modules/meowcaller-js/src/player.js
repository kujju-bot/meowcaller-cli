export const PlayerState = Object.freeze({
  Idle: Symbol('idle'),
  Playing: Symbol('playing'),
  Paused: Symbol('paused'),
});

export function NewPlayer() {
  let src = null;
  let state = PlayerState.Idle;
  let onFinish = null;

  const self = {
    play(source) {
      const old = src;
      src = source;
      state = PlayerState.Playing;
      if (old && typeof old.close === 'function') old.close().catch(() => {});
    },

    pause() {
      if (state === PlayerState.Playing) state = PlayerState.Paused;
    },

    resume() {
      if (state === PlayerState.Paused) state = PlayerState.Playing;
    },

    stop() {
      const old = src;
      src = null;
      state = PlayerState.Idle;
      if (old && typeof old.close === 'function') old.close().catch(() => {});
    },

    state() { return state; },

    onFinish(fn) { onFinish = fn; },

    async nextFrame() {
      if (state !== PlayerState.Playing || !src) return null;
      try {
        const frame = await src.readFrame();
        if (frame === null) {
          src = null;
          state = PlayerState.Idle;
          if (onFinish) {
            const finish = onFinish;
            onFinish = null;
            finish();
          }
          return null;
        }
        return frame;
      } catch {
        src = null;
        state = PlayerState.Idle;
        if (onFinish) {
          const finish = onFinish;
          onFinish = null;
          finish();
        }
        return null;
      }
    },
  };

  return self;
}
