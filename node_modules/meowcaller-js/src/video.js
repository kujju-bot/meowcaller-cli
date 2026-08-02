import { createWriteStream } from 'node:fs';

export function VideoSinkFunc(fn) {
  return {
    writeVideo(au) { fn(au); return Promise.resolve(); },
    close() { return Promise.resolve(); },
  };
}

export async function AnnexBRecorder(path) {
  const f = createWriteStream(path);
  let closed = false;
  return {
    writeVideo(au) {
      if (closed) return Promise.resolve();
      return new Promise((resolve, reject) => {
        f.write(au, (err) => { if (err) reject(err); else resolve(); });
      });
    },
    close() {
      closed = true;
      return new Promise((resolve) => f.end(resolve));
    },
  };
}
