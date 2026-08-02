#!/usr/bin/env node

import { makeWASocket, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';

const logger = pino({ level: 'info' });

async function main() {
  const phone = process.argv[2];
  
  if (!phone) {
    console.log('Usage: node test-pairing.js +91XXXXXXXXXX');
    process.exit(1);
  }
  
  const cleanPhone = phone.replace('+', '');
  
  console.log(`Testing Baileys pairing code for ${cleanPhone}...`);
  
  const { state, saveCreds } = await useMultiFileAuthState('test_auth_info');
  
  const wa = makeWASocket({
    auth: state,
    logger,
  });
  
  wa.ev.on('creds.update', saveCreds);
  
  try {
    // Wait for socket to fully open
    console.log('Waiting for socket to open...');
    await wa.waitForSocketOpen();
    console.log('✅ Socket fully opened!');
    
    // Now request pairing code
    console.log('Requesting pairing code...');
    const code = await wa.requestPairingCode(cleanPhone);
    console.log('\n=== PAIRING CODE ===');
    console.log(`Code: ${code}`);
    console.log('Enter in WhatsApp: Settings → Linked Devices → Link a Device → "Link with phone number"');
    console.log('=== END ===\n');
    
    // Wait for pairing to complete
    console.log('Waiting for pairing to complete...');
    await wa.waitForConnectionUpdate(({ connection }) => connection === 'open' && wa.user?.id);
    console.log('✅ Successfully paired! User ID:', wa.user.id);
    
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
  }
  
  // Keep running for a bit
  await new Promise(r => setTimeout(r, 5000));
}

main().catch(console.error);