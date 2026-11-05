import os from 'node:os';
import { loadConfig } from './config.js';
import { createApp } from './app.js';

const cfg = loadConfig();
const app = await createApp(cfg);
app.server.listen(cfg.port, cfg.host, () => {
  const scheme = cfg.tls ? 'https' : 'http';
  console.log(`
  AI Airport Assistant — Hamad International Airport (DOH)`);
  console.log(`  On this computer:  ${scheme}://localhost:${cfg.port}`);
  if (cfg.host === '0.0.0.0') {
    const ips = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')).map(a => a.address);
    for (const ip of ips) console.log(`  On tablets/kiosks: ${scheme}://${ip}:${cfg.port}`);
    if (!cfg.tls) console.log('  ⚠ Without HTTPS, tablets and phones cannot use the microphone. Run "npm run make-cert" once, then restart.');
  }
  console.log(`  Mode: ${cfg.production ? 'production' : 'development'}${cfg.demoMode ? ' · DEMO MODE (simulated flights & demo accounts)' : ''}
`);
});

const shutdown = async () => { console.log('Shutting down…'); await app.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
