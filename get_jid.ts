import { makeWASocket, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';

async function run() {
  const { state } = await useMultiFileAuthState('auth_info_baileys');
  const sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }) });
  try {
    const res = await sock.newsletterMetadata("invite", "0029Vb7AruX8fewz8dSRD340");
    console.log("JID_FOUND:", res.id);
  } catch (e: any) {
    console.log("Error:", e.message);
  }
  process.exit(0);
}
run();
