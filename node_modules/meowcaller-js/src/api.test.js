import test from 'node:test';
import assert from 'node:assert/strict';

import { Client } from './client.js';
import { CallRegistry } from './registry.js';
import { CallSession, CallDirection, CallPhase } from './session.js';
import { NewPlayer, PlayerState } from './player.js';
import { SourceFunc, SinkFunc } from './audio.js';

class FakeWA {
  constructor() {
    this.ev = { on() {} };
    this.user = { id: 'me@whatsapp.net' };
    this.ws = { readyState: 1, send() {}, isOpen: true };
  }
}

test('call session transitions follow the expected lifecycle', () => {
  const session = new CallSession('call-1', 'peer@whatsapp.net', 'me@whatsapp.net', CallDirection.Outgoing);

  assert.equal(session.description(), 'outgoing call call-1 to peer@whatsapp.net');
  assert.equal(session.phase_(), CallPhase.Idle);
  assert.equal(session.transitionTo(CallPhase.Calling), true);
  assert.equal(session.transitionTo(CallPhase.Ringing), true);
  assert.equal(session.transitionTo(CallPhase.Connecting), true);
  assert.equal(session.transitionTo(CallPhase.Active), true);
  assert.equal(session.transitionTo(CallPhase.Ended), true);
  assert.equal(session.isEnded(), true);
});

test('registry tracks calls and aborts media tasks', () => {
  const registry = new CallRegistry();
  const session = new CallSession('call-2', 'peer@whatsapp.net', 'me@whatsapp.net', CallDirection.Incoming);
  const aborted = [];

  assert.equal(registry.insert(session), true);
  registry.setMediaTask('call-2', () => aborted.push('task'));
  assert.equal(registry.has('call-2'), true);
  registry.remove('call-2');
  assert.deepEqual(aborted, ['task']);
  assert.equal(registry.has('call-2'), false);
});

test('player advances through source frames and reports finish', async () => {
  const frames = [new Float32Array([1, 2]), new Float32Array([3, 4])];
  const source = SourceFunc(async () => {
    if (frames.length === 0) return null;
    return frames.shift();
  });
  const player = NewPlayer();
  let finished = false;
  player.onFinish(() => { finished = true; });
  player.play(source);

  const first = await player.nextFrame();
  const second = await player.nextFrame();
  const third = await player.nextFrame();

  assert.deepEqual(Array.from(first), [1, 2]);
  assert.deepEqual(Array.from(second), [3, 4]);
  assert.equal(third, null);
  assert.equal(player.state(), PlayerState.Idle);
  assert.equal(finished, true);
});

test('client exposes a registry and installs handlers', () => {
  const client = new Client(new FakeWA());
  const self = client.connect();
  assert.equal(self, client);
  assert.ok(client.registry instanceof CallRegistry);
  assert.equal(client.listCalls().length, 0);
});

test('sink adapters pass frames through cleanly', async () => {
  const received = [];
  const sink = SinkFunc((frame) => received.push(Array.from(frame)));

  await sink.writeFrame(new Float32Array([0.1, 0.2]));
  assert.equal(received.length, 1);
  assert.equal(received[0][0].toFixed(6), '0.100000');
  assert.equal(received[0][1].toFixed(6), '0.200000');
});

test('player pause and resume work', () => {
  const player = NewPlayer();
  const source = SourceFunc(() => new Float32Array([1]));
  player.play(source);

  assert.equal(player.state(), PlayerState.Playing);
  player.pause();
  assert.equal(player.state(), PlayerState.Paused);
  player.resume();
  assert.equal(player.state(), PlayerState.Playing);
  player.stop();
  assert.equal(player.state(), PlayerState.Idle);
});

test('registry insert prevents duplicates', () => {
  const registry = new CallRegistry();
  const session = new CallSession('call-3', 'peer@whatsapp.net', 'me@whatsapp.net', CallDirection.Outgoing);

  assert.equal(registry.insert(session), true);
  assert.equal(registry.insert(session), false);
  assert.equal(registry.activeCount(), 1);
  registry.remove('call-3');
  assert.equal(registry.activeCount(), 0);
});

test('registry abortAll clears everything', () => {
  const registry = new CallRegistry();
  const session = new CallSession('call-4', 'peer@whatsapp.net', 'me@whatsapp.net', CallDirection.Incoming);
  const aborted = [];

  registry.insert(session);
  registry.setMediaTask('call-4', () => aborted.push(1));
  registry.insert(new CallSession('call-5', 'other@whatsapp.net', 'me@whatsapp.net', CallDirection.Incoming));
  registry.setMediaTask('call-5', () => aborted.push(2));

  const count = registry.abortAll();
  assert.equal(count, 2);
  assert.equal(registry.activeCount(), 0);
  assert.deepEqual(aborted.sort(), [1, 2]);
});

test('incoming call session starts in ringing phase', () => {
  const session = new CallSession('call-6', 'peer@whatsapp.net', 'caller@whatsapp.net', CallDirection.Incoming);
  assert.equal(session.phase_(), CallPhase.Ringing);
  assert.equal(session.description(), 'incoming call call-6 to caller@whatsapp.net');
});

test('outgoing session rejects invalid transitions', () => {
  const session = new CallSession('call-7', 'peer@whatsapp.net', 'me@whatsapp.net', CallDirection.Outgoing);
  assert.equal(session.transitionTo(CallPhase.Active), false, 'cannot skip from idle to active');
  assert.equal(session.transitionTo(CallPhase.Ended), true);
  assert.equal(session.transitionTo(CallPhase.Calling), false, 'cannot transition after ended');
});
