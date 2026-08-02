import fs from 'node:fs';

export class Recorder {
  constructor(path) {
    this.stream = path ? fs.createWriteStream(path, { flags: 'a' }) : null;
  }

  emit(category, data) {
    if (!this.stream) return;
    const line = JSON.stringify({ t: Date.now(), cat: category, ...data }) + '\n';
    this.stream.write(line);
  }

  close() {
    if (this.stream) this.stream.end();
  }
}
