import fs from 'fs';
let code = fs.readFileSync('server.ts', 'utf-8');
code = code.replace(/await sock\.sendMessage\(msg\.key\.remoteJid, \{ text: (.*?) \}, \{ quoted: msg \}\);/g, 'await reply($1, msg);');
code = code.replace(/await sock\.sendMessage\(msg\.key\.remoteJid, \{ text: (.*?) \}\);/g, 'await reply($1);');
fs.writeFileSync('server.ts', code);
console.log('Done');
