const Imap = require('imap');
const { simpleParser } = require('mailparser');

function getHeaderFromRaw(rawBuffer, headerName) {
  if (!rawBuffer || !headerName) return null;
  const raw = typeof rawBuffer === 'string' ? rawBuffer : rawBuffer.toString('utf8');
  const lines = raw.split(/\r?\n/);
  const nameLower = headerName.toLowerCase();
  const values = [];
  let currentName = null;
  let currentValue = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const name = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();
      if (name === nameLower) {
        if (currentName === nameLower && currentValue !== null) values.push(currentValue);
        currentName = name;
        currentValue = value;
      } else {
        if (currentName === nameLower && currentValue !== null) values.push(currentValue);
        currentName = null;
        currentValue = null;
      }
    } else if (currentName === nameLower && /^\s/.test(line)) {
      currentValue = (currentValue || '') + ' ' + line.trim();
    }
  }
  if (currentName === nameLower && currentValue !== null) values.push(currentValue);
  if (values.length === 0) return null;
  return values.length === 1 ? values[0] : values;
}

function getReturnPathDomain(returnPath) {
  if (returnPath == null) return null;
  const str = typeof returnPath === 'string' ? returnPath : String(returnPath);
  const trimmed = str.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/<([^>]+)>/);
  const addr = match ? match[1].trim() : trimmed;
  const parts = addr.split('@');
  return parts.length === 2 ? parts[1].toLowerCase() : null;
}

function getPtrDomainFromReceived(received) {
  if (received == null) return null;
  const headers = Array.isArray(received) ? received : [received];
  for (const h of headers) {
    const str = (typeof h === 'string' ? h : (h && (h.value ?? h.text))) || String(h);
    const s = str.trim();
    if (!s) continue;
    const ptrMatch = s.match(/\(\s*([a-zA-Z0-9][a-zA-Z0-9.-]*?)\.?\s*\[\s*[\d.]+\s*\]\s*\)/);
    if (ptrMatch) {
      const host = ptrMatch[1].replace(/\.$/, '').toLowerCase();
      if (host) return host;
    }
    const parenMatch = s.match(/\(\s*([a-zA-Z0-9][a-zA-Z0-9.-]+?)\.?\s*(?:\[|\s|\))/);
    if (parenMatch) {
      const host = parenMatch[1].replace(/\.$/, '').toLowerCase();
      if (host && !/^\d/.test(host)) return host;
    }
    const fromMatch = s.match(/from\s+([^\s\[\](]+)/i);
    if (fromMatch) {
      const host = fromMatch[1].replace(/\.$/, '').toLowerCase();
      if (host && !/^\[\d/.test(host)) return host;
    }
  }
  return null;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, appPassword } = req.body || {};
  if (!email || !appPassword) {
    return res.status(400).json({ error: 'Email and app password are required' });
  }

  const results = [];
  let openBoxDone = false;
  let responded = false;

  function send(data) {
    if (responded) return;
    responded = true;
    res.status(200).json(data);
  }

  const imap = new Imap({
    user: email,
    password: appPassword,
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false }
  });

  imap.once('ready', () => {
    imap.openBox('[Gmail]/Spam', false, (err) => {
      if (err) {
        imap.end();
        if (!responded) res.status(500).json({ error: 'Failed to open Spam folder: ' + err.message });
        return;
      }
      openBoxDone = true;
      imap.search(['UNSEEN'], (searchErr, uids) => {
        if (searchErr) {
          imap.end();
          if (!responded) res.status(500).json({ error: 'Search failed: ' + searchErr.message });
          return;
        }
        if (!uids || uids.length === 0) {
          imap.end();
          return send({ emails: [], count: 0 });
        }
        const fetch = imap.fetch(uids, { bodies: '', struct: true, markSeen: true });
        let processed = 0;

        function finish() {
          imap.end();
          send({ emails: results, count: results.length });
        }

        fetch.on('message', (msg, seqno) => {
          msg.on('body', (stream) => {
            let buffer = '';
            stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
            stream.once('end', () => {
              simpleParser(buffer, (parseErr, parsed) => {
                if (parseErr) {
                  processed++;
                  if (processed === uids.length) finish();
                  return;
                }
                const returnPathHeader = getHeaderFromRaw(buffer, 'Return-Path');
                const receivedHeader = getHeaderFromRaw(buffer, 'Received');
                results.push({
                  uid: seqno,
                  subject: parsed.subject || '(no subject)',
                  date: parsed.date ? parsed.date.toISOString() : null,
                  from: parsed.from ? parsed.from.text : '',
                  returnPathDomain: getReturnPathDomain(returnPathHeader) || '',
                  ptrDomain: getPtrDomainFromReceived(receivedHeader) || ''
                });
                processed++;
                if (processed === uids.length) finish();
              });
            });
          });
        });
        fetch.once('error', (fetchErr) => {
          imap.end();
          if (!responded) res.status(500).json({ error: 'Fetch failed: ' + fetchErr.message });
        });
      });
    });
  });

  imap.once('error', (err) => {
    if (!openBoxDone && !responded) {
      res.status(401).json({ error: 'Connection failed. Check email and app password. ' + err.message });
    }
  });

  imap.connect();
};
