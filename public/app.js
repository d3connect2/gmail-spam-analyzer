(function () {
  const form = document.getElementById('form');
  const submitBtn = document.getElementById('submitBtn');
  const statusEl = document.getElementById('status');
  const resultsSection = document.getElementById('resultsSection');
  const countEl = document.getElementById('count');
  const resultsBody = document.getElementById('resultsBody');

  function setStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = 'status' + (type ? ' ' + type : '');
  }

  function clearStatus() {
    statusEl.textContent = '';
    statusEl.className = 'status';
  }

  function showResults(emails) {
    resultsSection.hidden = false;
    const n = emails.length;
    countEl.textContent = n === 0
      ? 'No unread emails in Spam.'
      : n + ' unread spam email(s) fetched and marked as read.';
    resultsBody.innerHTML = '';
    emails.forEach(function (row, i) {
      const tr = document.createElement('tr');
      const dateStr = row.date ? new Date(row.date).toLocaleString() : '';
      tr.innerHTML =
        '<td>' + (i + 1) + '</td>' +
        '<td class="subject" title="' + escapeAttr(row.subject) + '">' + escapeHtml(row.subject) + '</td>' +
        '<td title="' + escapeAttr(row.from) + '">' + escapeHtml(row.from) + '</td>' +
        '<td class="date">' + escapeHtml(dateStr) + '</td>' +
        '<td class="domain">' + escapeHtml(row.returnPathDomain) + '</td>' +
        '<td class="domain">' + escapeHtml(row.ptrDomain) + '</td>';
      resultsBody.appendChild(tr);
    });
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function escapeAttr(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  var twoPartExtensions = {
    'uk.com': true, 'de.com': true, 'fr.com': true, 'it.com': true,
    'eu.com': true, 'us.com': true, 'no.com': true, 'gb.com': true,
    'co.uk': true, 'com.uk': true, 'org.uk': true, 'net.uk': true,
    'co.nz': true, 'co.za': true, 'co.jp': true, 'com.au': true,
    'net.au': true, 'org.au': true, 'com.br': true, 'co.in': true,
    'com.mx': true, 'co.kr': true, 'com.sg': true, 'com.hk': true
  };

  function getMainDomain(domain) {
    if (!domain || typeof domain !== 'string') return '';
    var d = domain.trim().toLowerCase();
    if (!d) return '';
    var parts = d.split('.');
    if (parts.length <= 2) return d;
    var lastTwo = parts[parts.length - 2] + '.' + parts[parts.length - 1];
    if (twoPartExtensions[lastTwo]) {
      return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      return Promise.resolve();
    } finally {
      document.body.removeChild(ta);
    }
  }

  var lastEmails = [];

  function showResults(emails) {
    resultsSection.hidden = false;
    lastEmails = emails || [];
    const n = lastEmails.length;
    countEl.textContent = n === 0
      ? 'No unread emails in Spam.'
      : n + ' unread spam email(s) fetched and marked as read.';
    resultsBody.innerHTML = '';
    lastEmails.forEach(function (row, i) {
      const tr = document.createElement('tr');
      const dateStr = row.date ? new Date(row.date).toLocaleString() : '';
      const mainDomain = getMainDomain(row.returnPathDomain);
      const domainCell = document.createElement('td');
      domainCell.className = 'domain cell-with-copy';
      const domainSpan = document.createElement('span');
      domainSpan.textContent = row.returnPathDomain || '';
      domainSpan.title = mainDomain ? 'Main: ' + mainDomain : '';
      domainCell.appendChild(domainSpan);
      if (row.returnPathDomain) {
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'copy-btn';
        copyBtn.title = 'Copy main domain: ' + mainDomain;
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', function () {
          var toCopy = getMainDomain(row.returnPathDomain);
          if (!toCopy) return;
          copyToClipboard(toCopy).then(function () {
            setStatus('Copied: ' + toCopy, 'success');
            setTimeout(clearStatus, 1500);
          }).catch(function () {
            setStatus('Copy failed', 'error');
          });
        });
        domainCell.appendChild(copyBtn);
      }
      tr.appendChild(document.createElement('td')).textContent = i + 1;
      tr.appendChild(document.createElement('td')).className = 'subject';
      tr.lastChild.title = row.subject || '';
      tr.lastChild.textContent = row.subject || '';
      const fromTd = document.createElement('td');
      fromTd.title = row.from || '';
      fromTd.textContent = row.from || '';
      tr.appendChild(fromTd);
      const dateTd = document.createElement('td');
      dateTd.className = 'date';
      dateTd.textContent = dateStr;
      tr.appendChild(dateTd);
      tr.appendChild(domainCell);
      const ptrTd = document.createElement('td');
      ptrTd.className = 'domain';
      ptrTd.textContent = row.ptrDomain || '';
      tr.appendChild(ptrTd);
      resultsBody.appendChild(tr);
    });

    const copyAllBtn = document.getElementById('copyAllBtn');
    if (copyAllBtn) {
      copyAllBtn.onclick = function () {
        var domains = lastEmails.map(function (r) { return getMainDomain(r.returnPathDomain); }).filter(Boolean);
        var seen = {};
        var unique = [];
        for (var j = 0; j < domains.length; j++) {
          if (!seen[domains[j]]) {
            seen[domains[j]] = true;
            unique.push(domains[j]);
          }
        }
        if (unique.length === 0) {
          setStatus('No domains to copy.', 'error');
          return;
        }
        var text = unique.join('\n');
        copyToClipboard(text).then(function () {
          setStatus('Copied ' + unique.length + ' unique main domain(s).', 'success');
          setTimeout(clearStatus, 2000);
        }).catch(function () {
          setStatus('Copy failed', 'error');
        });
      };
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = document.getElementById('email').value.trim();
    var appPassword = document.getElementById('appPassword').value;

    if (!email || !appPassword) {
      setStatus('Please enter email and app password.', 'error');
      return;
    }

    submitBtn.disabled = true;
    setStatus('Connecting and fetching unread spam…', 'loading');

    fetch('/api/spam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, appPassword: appPassword })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || res.statusText);
          return data;
        });
      })
      .then(function (data) {
        setStatus('Done. Emails have been marked as read.', 'success');
        showResults(data.emails || []);
      })
      .catch(function (err) {
        setStatus(err.message || 'Request failed.', 'error');
        resultsSection.hidden = true;
      })
      .finally(function () {
        submitBtn.disabled = false;
      });
  });
})();
