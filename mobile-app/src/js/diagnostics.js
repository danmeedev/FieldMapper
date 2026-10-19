// Forward diagnostics to the laptop during an explicitly enabled review session.
(() => {
  let enabled = false, endpoint = '', count = 0, windowStart = Date.now();
  function send(level, args) {
    if (!enabled) return;
    if (Date.now() - windowStart > 60000) { count = 0; windowStart = Date.now(); }
    if (++count > 100) return;
    const message = args.map(v => v instanceof Error ? v.message : typeof v === 'string' ? v : '[object]').join(' ').slice(0, 2000);
    fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level, message, source: typeof getSetting === 'function' ? 'mobile' : 'desktop' }) }).catch(() => {});
  }
  for (const level of ['error','warn','info']) {
    const original = console[level].bind(console);
    console[level] = (...args) => { original(...args); send(level, args); };
  }
  window.addEventListener('error', event => send('error', [event.message]));
  window.addEventListener('unhandledrejection', event => send('error', [event.reason?.message || String(event.reason)]));
  async function connect() {
    try {
      const base = typeof getSetting === 'function' ? await getSetting('laptopUrl') : '';
      if (base == null) return;
      const r = await fetch(base.replace(/\/$/, '') + '/api/status', { signal: AbortSignal.timeout(3000) });
      enabled = r.ok && (await r.json()).reviewLogs === true;
      endpoint = base.replace(/\/$/, '') + '/api/client-log';
      if (enabled) send('info', ['Review logging connected']);
    } catch (e) { enabled = false; }
  }
  document.addEventListener('DOMContentLoaded', connect);
  window.addEventListener('online', connect);
  setInterval(connect, 30000);
})();
