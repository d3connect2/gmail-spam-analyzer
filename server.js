const express = require('express');
const cors = require('cors');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Extract header value(s) from raw RFC 822 message.
 * Returns single string for one-valued headers, or array of strings for multi-valued (e.g. Received).
 */
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
        if (currentName === nameLower && currentValue !== null) {
          values.push(currentValue);
        }
        currentName = name;
        currentValue = value;
      } else {
        if (currentName === nameLower && currentValue !== null) {
          values.push(currentValue);
          currentValue = null;
        }
        currentName = null;
      }
    } else if (currentName === nameLower && /^\s/.test(line)) {
      currentValue = (currentValue || '') + ' ' + line.trim();
    }
  }
  if (currentName === nameLower && currentValue !== null) {
    values.push(currentValue);
  }
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  return values;
}

/**
 * Extract domain from Return-Path header value.
 * Return-Path: <bounce@example.com> -> example.com
 * Also handles Return-Path: bounce@example.com
 */
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

/**
 * Extract PTR (reverse DNS hostname) from Received header value(s).
 * PTR is the hostname inside parentheses, e.g.:
 *   Received: from rackinger.site (use.google.com. [2.56.242.97])  -> use.google.com
 *   Received: from [1.2.3.4] (mail.example.com)                  -> mail.example.com
 * Prefer (hostname [ip]) or (hostname. [ip]) over the "from" hostname.
 */
function getPtrDomainFromReceived(received) {
  if (received == null) return null;
  const headers = Array.isArray(received) ? received : [received];
  for (const h of headers) {
    const str = (typeof h === 'string' ? h : (h && (h.value ?? h.text))) || String(h);
    const s = str.trim();
    if (!s) continue;
    // Prefer PTR: hostname inside parentheses, often before [ip], e.g. (use.google.com. [2.56.242.97])
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

app.post('/api/spam', (req, res) => {
  const { email, appPassword } = req.body;
  if (!email || !appPassword) {
    return res.status(400).json({ error: 'Email and app password are required' });
  }

  const imap = new Imap({
    user: email,
    password: appPassword,
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false }
  });

  const results = [];
  let openBoxDone = false;

  imap.once('ready', () => {
    // Gmail Spam folder name
    imap.openBox('[Gmail]/Spam', false, (err, box) => {
      if (err) {
        imap.end();
        return res.status(500).json({ error: 'Failed to open Spam folder: ' + err.message });
      }
      openBoxDone = true;
      imap.search(['UNSEEN'], (searchErr, uids) => {
        if (searchErr) {
          imap.end();
          return res.status(500).json({ error: 'Search failed: ' + searchErr.message });
        }
        if (!uids || uids.length === 0) {
          imap.end();
          return res.json({ emails: [], count: 0 });
        }
        const fetch = imap.fetch(uids, {
          bodies: '',
          struct: true,
          markSeen: true
        });
        let processed = 0;
        let responded = false;
        function send(data) {
          if (responded) return;
          responded = true;
          res.json(data);
        }
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
                // Extract from raw headers to ensure we read actual Return-Path and Received
                const returnPathHeader = getHeaderFromRaw(buffer, 'Return-Path');
                const receivedHeader = getHeaderFromRaw(buffer, 'Received');
                const returnPathDomain = getReturnPathDomain(returnPathHeader);
                const ptrDomain = getPtrDomainFromReceived(receivedHeader);
                results.push({
                  uid: seqno,
                  subject: parsed.subject || '(no subject)',
                  date: parsed.date ? parsed.date.toISOString() : null,
                  from: parsed.from ? parsed.from.text : '',
                  returnPathDomain: returnPathDomain || '',
                  ptrDomain: ptrDomain || ''
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
    if (!openBoxDone) {
      res.status(401).json({ error: 'Connection failed. Check email and app password. ' + err.message });
    }
  });

  imap.connect();
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('Gmail Spam Analyzer running at http://localhost:' + PORT);
});
