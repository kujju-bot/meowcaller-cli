#!/usr/bin/env node

import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Client, SourceFunc, SinkFunc, FrameSamples, SampleRate } from 'meowcaller-js';
import pino from 'pino';
import { spawn } from 'node:child_process';
import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const logger = pino({ level: 'info' });

function printUsage() {
  console.log(`
Usage: meowcaller-cli <phone> "message" [--pair-code]

Makes a WhatsApp call to <phone> and plays the message as TTS audio,
then hangs up after 3 seconds. Records the call by default.

Options:
  --pair-code    Use phone number pairing instead of QR code

Example (QR code):
  meowcaller-cli +919876543210 "Hello, this is a test message"

Example (phone pairing):
  meowcaller-cli +919876543210 "Hello, this is a test message" --pair-code

The phone number must include country code (e.g., +91 for India).
`);
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    printUsage();
  }
  
  const phone = args[0];
  const message = args.slice(1).join(' ');
  
  if (!phone.startsWith('+')) {
    console.error('Error: Phone number must start with + (e.g., +919876543210)');
    process.exit(1);
  }
  
  // Check for --pair-code flag
  const usePairCode = args.includes('--pair-code');
  
  return { phone, message, usePairCode };
}

async function textToSpeechBuffer(text) {
  const ttsCommands = [
    ['espeak', '-w', '/dev/stdout', '--stdout', text],
    ['say', '-o', '/dev/stdout', '--data-format=LEF32@16000', text],
  ];
  
  for (const [cmd, ...args] of ttsCommands) {
    try {
      const buffer = await runTTS(cmd, args);
      if (buffer && buffer.length > 0) {
        return buffer;
      }
    } catch (e) {
      // Try next command
    }
  }
  
  throw new Error('No TTS engine found. Install espeak (Linux: sudo apt install espeak) or use macOS say.');
}

function runTTS(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    const chunks = [];
    
    proc.stdout.on('data', (chunk) => chunks.push(chunk));
    proc.stderr.on('data', () => {});
    
    proc.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`TTS command failed with code ${code}`));
      }
    });
    
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

function pcmToFrames(buffer) {
  const frames = [];
  const bytesPerFrame = FrameSamples * 2;
  
  for (let offset = 0; offset < buffer.length; offset += bytesPerFrame) {
    const chunk = buffer.subarray(offset, offset + bytesPerFrame);
    if (chunk.length === 0) break;
    
    const frame = new Float32Array(FrameSamples);
    const actualSamples = Math.min(FrameSamples, chunk.length / 2);
    
    for (let i = 0; i < actualSamples; i++) {
      frame[i] = chunk.readInt16LE(i * 2) / 32768;
    }
    
    for (let i = actualSamples; i < FrameSamples; i++) {
      frame[i] = 0;
    }
    
    frames.push(frame);
  }
  
  return frames;
}

// WAV file writer for recording
class WAVRecorder {
  constructor(filename, sampleRate = SampleRate, channels = 1) {
    this.filename = filename;
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.frames = [];
    this.dataLength = 0;
    this.started = false;
  }
  
  writeFrame(frame) {
    // Convert Float32Array to 16-bit PCM
    const pcmBuffer = Buffer.alloc(frame.length * 2);
    for (let i = 0; i < frame.length; i++) {
      const sample = Math.max(-1, Math.min(1, frame[i]));
      pcmBuffer.writeInt16LE(Math.round(sample * 32767), i * 2);
    }
    this.frames.push(pcmBuffer);
    this.dataLength += pcmBuffer.length;
  }
  
  async save() {
    const wavHeader = this.createWAVHeader(this.dataLength);
    const dataBuffer = Buffer.concat(this.frames);
    const fullBuffer = Buffer.concat([wavHeader, dataBuffer]);
    
    const { writeFile } = await import('node:fs/promises');
    await writeFile(this.filename, fullBuffer);
    console.log(`Recording saved to: ${this.filename}`);
    return this.filename;
  }
  
  createWAVHeader(dataLength) {
    const header = Buffer.alloc(44);
    const sampleRate = this.sampleRate;
    const channels = this.channels;
    const bitsPerSample = 16;
    const byteRate = sampleRate * channels * bitsPerSample / 8;
    const blockAlign = channels * bitsPerSample / 8;
    
    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    
    // fmt chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM format
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    
    // data chunk
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);
    
    return header;
  }
}

async function main() {
  const { phone, message, usePairCode } = parseArgs();
  
  console.log(`Starting meowcaller-cli...`);
  console.log(`Target: ${phone}`);
  console.log(`Message: "${message}"`);
  if (usePairCode) {
    console.log(`Using phone number pairing...`);
  }
  
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  
  const wa = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
  });
  
  const meow = new Client(wa, { logger: pino({ level: 'silent' }) });
  meow.connect();
  
  wa.ev.on('creds.update', saveCreds);
  
  // Simple connection handler like whatai
  let qrPrinted = false;
  let pairingCodeRequested = false;
  
  wa.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    console.log('Connection update:', { 
      connection, 
      lastDisconnect: lastDisconnect?.error?.message,
      hasQr: !!qr,
      userId: wa.user?.id 
    });
    
    if (qr && !qrPrinted && !usePairCode) {
      qrPrinted = true;
      console.log('\n=== SCAN THIS QR CODE WITH WHATSAPP ===');
      console.log('Settings → Linked Devices → Link a Device');
      console.log('If it says "check internet connection", ensure your phone has internet\n');
      const qrcode = await import('qrcode-terminal');
      qrcode.default.generate(qr, { small: true });
      console.log('\n=== END QR CODE ===\n');
    }
    
    // Request pairing code after socket opens (like whatai test)
    if (usePairCode && !pairingCodeRequested && connection === 'open') {
      pairingCodeRequested = true;
      const cleanPhone = phone.replace('+', '');
      console.log(`Requesting pairing code for ${cleanPhone}...`);
      try {
        const code = await wa.requestPairingCode(cleanPhone);
        console.log('\n=== PAIRING CODE ===');
        console.log(`Your pairing code: ${code}`);
        console.log('Enter this code in WhatsApp: Settings → Linked Devices → Link a Device → "Link with phone number"');
        console.log('=== END PAIRING CODE ===\n');
      } catch (err) {
        console.error('Failed to request pairing code:', err.message);
      }
    }
    
    if (connection === 'close') {
      const err = lastDisconnect?.error;
      const statusCode = err?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const isStreamError = statusCode === 515;
      
      if (isLoggedOut) {
        console.log('Logged out - please delete auth_info folder and try again');
        process.exit(1);
      } else if (isStreamError && qrPrinted) {
        console.log('Post-pairing restart... waiting for reconnection');
      } else {
        console.log('Connection lost, reconnecting...');
      }
    } else if (connection === 'open') {
      if (wa.user?.id) {
        console.log('✅ WhatsApp connected! User:', wa.user.id);
      }
    }
  });
  
  // Wait for connection
  await new Promise((resolve) => {
    const checkConnection = setInterval(() => {
      if (wa.user?.id) {
        clearInterval(checkConnection);
        resolve();
      }
    }, 500);
  });
  
  // Wait for pairing if using pair code
  if (usePairCode) {
    console.log('Waiting for pairing to complete...');
    await new Promise((resolve) => {
      const checkPairing = setInterval(() => {
        if (wa.user?.id) {
          clearInterval(checkPairing);
          console.log('✅ Pairing complete!');
          resolve();
        }
      }, 500);
    });
  }
  
  console.log('Connected to WhatsApp. Placing call...');
  
  // Retry call placement up to 3 times
  let call = null;
  let callAttempts = 0;
  const maxCallAttempts = 3;
  
  async function placeCall() {
    callAttempts++;
    try {
      call = await meow.call({}, phone);
      return call;
    } catch (err) {
      if (callAttempts < maxCallAttempts) {
        console.log(`Call attempt ${callAttempts} failed: ${err.message}. Retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
        return placeCall();
      }
      throw err;
    }
  }
  
  try {
    call = await placeCall();
    
    // Set up recording
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safePhone = phone.replace('+', '').replace(/\s+/g, '');
    const recordingFile = `recordings/call_${safePhone}_${timestamp}.wav`;
    
    // Ensure recordings directory exists
    const { mkdir } = await import('node:fs/promises');
    await mkdir('recordings', { recursive: true });
    
    const recorder = new WAVRecorder(recordingFile);
    
    call.onReady(async () => {
      console.log('Call connected! Playing message...');
      
      try {
        const pcmBuffer = await textToSpeechBuffer(message);
        const frames = pcmToFrames(pcmBuffer);
        
        if (frames.length === 0) {
          console.error('No audio frames generated');
          call.hangup();
          process.exit(1);
        }
        
        let frameIndex = 0;
        
        const source = SourceFunc(async () => {
          if (frameIndex >= frames.length) {
            return null;
          }
          return frames[frameIndex++];
        });
        
        // Set up recording sink for incoming audio
        const sink = SinkFunc((frame) => {
          recorder.writeFrame(frame);
        });
        call.receive(sink);
        
        call.play(source);
        
        // Wait 3 seconds then hang up
        setTimeout(() => {
          console.log('3 seconds elapsed. Hanging up...');
          call.hangup();
        }, 3000);
        
      } catch (err) {
        console.error('TTS error:', err.message);
        call.hangup();
        process.exit(1);
      }
    });
    
    call.onEnd(async (reason) => {
      console.log('Call ended:', reason);
      
      try {
        const savedFile = await recorder.save();
        
        // Send recording via Telegram if available
        // For now, just log the file path
        console.log(`Recording saved: ${savedFile}`);
        console.log('You can find the recording in the recordings/ directory');
        
        process.exit(0);
      } catch (err) {
        console.error('Failed to save recording:', err.message);
        process.exit(1);
      }
    });
    
  } catch (err) {
    console.error('Call failed:', err.message);
    process.exit(1);
  }
}

main().catch(console.error);