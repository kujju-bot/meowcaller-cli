#!/usr/bin/env node

import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Client, SourceFunc, FrameSamples, SampleRate } from 'meowcaller-js';
import pino from 'pino';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';

const logger = pino({ level: 'info' });

function printUsage() {
  console.log(`
Usage: meowcaller-cli <phone> "message"

Makes a WhatsApp call to <phone> and plays the message as TTS audio,
then hangs up after 3 seconds.

Example:
  meowcaller-cli +919876543210 "Hello, this is a test message"

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
  
  return { phone, message };
}

async function textToSpeechBuffer(text) {
  // Try espeak first (Linux), then say (macOS)
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
    proc.stderr.on('data', () => {}); // ignore stderr
    
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

// Convert PCM buffer to Float32Array frames
function pcmToFrames(buffer) {
  const frames = [];
  const bytesPerFrame = FrameSamples * 2; // 16-bit = 2 bytes per sample
  
  for (let offset = 0; offset < buffer.length; offset += bytesPerFrame) {
    const chunk = buffer.subarray(offset, offset + bytesPerFrame);
    if (chunk.length === 0) break;
    
    const frame = new Float32Array(FrameSamples);
    const actualSamples = Math.min(FrameSamples, chunk.length / 2);
    
    for (let i = 0; i < actualSamples; i++) {
      frame[i] = chunk.readInt16LE(i * 2) / 32768;
    }
    
    // Pad with silence if needed
    for (let i = actualSamples; i < FrameSamples; i++) {
      frame[i] = 0;
    }
    
    frames.push(frame);
  }
  
  return frames;
}

async function main() {
  const { phone, message } = parseArgs();
  
  console.log(`Starting meowcaller-cli...`);
  console.log(`Target: ${phone}`);
  console.log(`Message: "${message}"`);
  
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  
  const wa = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: true,
  });
  
  const meow = new Client(wa, { logger });
  meow.connect();
  
  wa.ev.on('creds.update', saveCreds);
  
  wa.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        logger.info('reconnecting...');
      }
    }
    if (connection === 'open') {
      logger.info('WhatsApp connected!');
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
  
  console.log('Connected to WhatsApp. Placing call...');
  
  try {
    const call = await meow.call({}, phone);
    
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
            return null; // End of stream
          }
          return frames[frameIndex++];
        });
        
        call.play(source);
        
        // Wait 3 seconds then hang up
        setTimeout(() => {
          console.log('3 seconds elapsed. Hanging up...');
          call.hangup();
          process.exit(0);
        }, 3000);
        
      } catch (err) {
        console.error('TTS error:', err.message);
        call.hangup();
        process.exit(1);
      }
    });
    
    call.onEnd((reason) => {
      console.log('Call ended:', reason);
      process.exit(0);
    });
    
  } catch (err) {
    console.error('Call failed:', err.message);
    process.exit(1);
  }
}

main().catch(console.error);