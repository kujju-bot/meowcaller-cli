# meowcaller-js

[![npm](https://img.shields.io/npm/v/meowcaller-js)](https://www.npmjs.com/package/meowcaller-js)
[![License: MIT](https://img.shields.io/github/license/bencodess/meowcaller-js)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/bencodess/meowcaller-js)](https://github.com/bencodess/meowcaller-js/stargazers)

<p align="center">
  <img src="https://github.com/bencodess/meowcaller-js/raw/main/meowcaller-js.jpg" alt="meowcaller-js" width="1200">
</p>

WhatsApp VoIP library for [Baileys](https://github.com/WhiskeySockets/Baileys). Handles signaling, DTLS relay transport, SRTP media, and call lifecycle — all in JavaScript.

## Install

```bash
npm install meowcaller-js
```

Requires Node.js 20+. Uses [`node-datachannel`](https://github.com/nicholasgasior/node-datachannel) (prebuilt native addon) for DTLS transport.

## Quick Start

### Receive a call

```js
import { makeWASocket, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Client, SinkFunc, SourceFunc } from 'meowcaller-js';

const { state } = await useMultiFileAuthState('auth');
const wa = makeWASocket({ auth: state, printQRInTerminal: true });

const client = new Client(wa);
client.connect();

client.onIncomingCall((call) => {
  console.log('Call from', call.peer());

  call.onStateChange((phase) => console.log('phase:', phase));
  call.onEnd((reason) => console.log('ended:', reason));

  call.receive(SinkFunc((frame) => {
    // frame: Float32Array — 960 samples at 16 kHz
  }));

  call.play(SourceFunc(async () => null));
  call.answer();
});
```

### Place a call

```js
const call = await client.call({}, '+15551234567');

call.onReady(() => {
  console.log('media is flowing');
  call.play(SourceFunc(async () => new Float32Array(960)));
});

call.onEnd((reason) => console.log('ended:', reason));
```

### List active calls

```js
const calls = client.listCalls();
console.log(`${calls.length} active call(s)`);
```

## Documentation

Full API reference, examples, and guides: **[benslogs.dev/meowcaller-js/docs](https://benslogs.dev/meowcaller-js/docs/)**

## Implementation Status

| Feature | Status |
|---------|--------|
| Outbound calls | Signaling ported |
| Inbound calls | Signaling ported |
| Audio calls | Signaling + DTLS/SCTP/DataChannel media relay |
| Video calls | Signaling + H.264 depacketizer |
| DTLS relay | Implemented via `node-datachannel` (libdatachannel) |
| Opus codec | Implemented via `libopus-wasm` (16 kHz mono, 60 ms frames) |
| MLow codec | Stub — needs WASM port |

## Differences from [meowcaller](https://github.com/purpshell/meowcaller)

- **Async/await** instead of goroutines and channels
- **EventEmitter** patterns instead of Go callbacks
- **Call registry** for listing and cleaning up active sessions
- **Source/sink adapters** for piping audio in and out
- **Node.js native DTLS** via `node-datachannel` (prebuilt, no CGO)
- Tests, CI, auto-publish on push

### License

MIT
