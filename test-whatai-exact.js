#!/usr/bin/env node

import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

async function testQR() {
  console.log('Testing exact whatai Baileys setup...');
  
  const { state, saveCreds } = await useMultiFileAuthState('test_whatai_auth');
  
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
  });
  
  sock.ev.on('creds.update', saveCreds);
  
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    console.log('Connection update:', { 
      connection, 
      lastDisconnect: lastDisconnect?.error?.message,
      hasQr: !!qr,
      userId: sock.user?.id 
    });
    
    if (qr) {
      console.log('=== QR CODE ===');
      qrcode.generate(qr, { small: true });
      console.log('=== END QR ===');
    }
    
    if (connection === 'close') {
      const err = lastDisconnect?.error;
      const statusCode = err?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed, reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(() => testQR(), 2000);
      }
    } else if (connection === 'open') {
      console.log('✅ Opened connection! User:', sock.user?.id);
    }
  });
  
  // Keep alive
  await new Promise(() => {});
}

testQR().catch(console.error);