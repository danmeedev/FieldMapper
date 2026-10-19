/* Checks metadata only. Package downloads require a fresh, explicit user confirmation. */
(function (global) {
  'use strict';
  const DAY = 24 * 60 * 60 * 1000;
  const KEY = 'fieldmapper-updates-v1';
  function newer(candidate, current) {
    const parse = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
    const a = parse(candidate), b = parse(current);
    if (!a || !b || [...a, ...b].some(n => !Number.isSafeInteger(n))) return false;
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  }
  function configured(c) {
    return c && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(c.repository) &&
      typeof c.branch === 'string' && c.branch.length > 0 &&
      !/PLACEHOLDER/i.test(c.repository + c.branch);
  }
  function release(c, manifest, platform) {
    if (!manifest || !newer(manifest.version, c.currentVersion)) return null;
    const url = new URL(manifest[platform]);
    // Only published release assets from the configured repository can be offered.
    const prefix = '/' + c.repository + '/releases/download/';
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port ||
        url.username || url.password || !url.pathname.startsWith(prefix) || url.search || url.hash ||
        !url.pathname.endsWith(platform === 'android' ? '.apk' : '.zip')) throw new Error('Invalid release download URL.');
    return {version: manifest.version, url: url.href};
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {newer, configured, release};
  if (!global.document) return;
  let settings = {enabled:true, lastCheck:0}, config, pending = false, generation = 0;
  let storageOK = true, message = 'Ready to check.', offered = null;
  try { const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) settings = {enabled:saved.enabled !== false, lastCheck:Number(saved.lastCheck) || 0};
  } catch (_) { storageOK = false; settings.enabled = false; }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); return true; }
    catch (_) { storageOK = false; settings.enabled = false; message = 'Preferences could not be saved. Automatic checks are off.'; return false; }
  }
  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'max-width:420px;width:85%;border-radius:10px;padding:20px';
  dialog.innerHTML = '<h3>App updates</h3><label><input type="checkbox" id="updates-enabled"> Check automatically (once a day while open)</label><p id="updates-status" role="status"></p><p>Checks need internet. Downloads and installation always require your approval. PC and Android settings are separate.</p><button type="button" id="updates-check">Check now</button> <button type="button" id="updates-download" hidden>Download update…</button> <button type="button" id="updates-close">Close</button>';
  document.body.appendChild(dialog);
  const checkbox = dialog.querySelector('#updates-enabled');
  const status = dialog.querySelector('#updates-status');
  const download = dialog.querySelector('#updates-download');
  function render() { checkbox.checked = settings.enabled; status.textContent = message; download.hidden = !offered; dialog.querySelector('#updates-check').disabled = pending; }
  checkbox.onchange = () => { settings.enabled = checkbox.checked; generation++; save(); render(); if (settings.enabled) check(false); };
  dialog.querySelector('#updates-close').onclick = () => dialog.close();
  dialog.querySelector('#updates-check').onclick = () => check(true);
  download.onclick = () => {
    if (!offered) return;
    const item = offered;
    const mobile = !!global.Capacitor?.isNativePlatform?.();
    if (!global.confirm(`Update Field Mapper to ${item.version}?\n\n${mobile ? 'Download the APK, then approve installation in Android. Install over the existing app; do not uninstall it.' : 'Download the ZIP, stop the PC app, extract the new package and start it. Your existing AppData records stay in place.'}\n\nOpen the download now?`)) return;
    // No fetch, staging, process execution, or installation occurs on check or dismissal.
    const link = document.createElement('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    document.body.appendChild(link); link.click(); link.remove();
  };
  async function check(manual) {
    if (pending || (!manual && (!settings.enabled || Date.now() - settings.lastCheck < DAY))) return;
    const ticket = generation;
    pending = true; message = 'Checking…'; render();
    try {
      if (!config) { const r = await fetch('update-config.json', {cache:'no-store', signal:AbortSignal.timeout(10000)}); if (!r.ok) throw new Error('Update configuration unavailable.'); config = await r.json(); }
      if (!configured(config)) { message = 'Update source is not configured yet (repository and branch placeholders).'; return; }
      if (ticket !== generation || (!manual && !settings.enabled)) return;
      const endpoint = `https://api.github.com/repos/${config.repository}/contents/update-manifest.json?ref=${encodeURIComponent(config.branch)}`;
      const response = await fetch(endpoint, {headers:{Accept:'application/vnd.github.raw+json'}, cache:'no-store', signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error('Update service unavailable (' + response.status + ').');
      const manifest = await response.json();
      if (ticket !== generation || (!manual && !settings.enabled)) return;
      const platform = global.Capacitor?.isNativePlatform?.() ? 'android' : 'windows';
      const available = release(config, manifest, platform);
      settings.lastCheck = Date.now(); save(); offered = available;
      message = available ? `Version ${available.version} is available. Choose Download update to approve the download.` : `You are up to date (${config.currentVersion}).`;
      if (available && !dialog.open) dialog.showModal();
    } catch (e) { message = 'Could not check for updates. ' + e.message + ' Try again when online.'; }
    finally { pending = false; render(); }
  }
  global.AppUpdates = {open() {render(); if (!dialog.open) dialog.showModal();}, check};
  if (!storageOK) { message = 'Preferences could not be read. Automatic checks are off.'; }
  render();
  // Offline/hidden apps do not generate scheduled requests. No background installation exists.
  const scheduled = () => { if (!document.hidden && navigator.onLine !== false) check(false); };
  global.addEventListener('online', scheduled);
  document.addEventListener('visibilitychange', scheduled);
  global.setInterval(scheduled, 60000);
  scheduled();
})(typeof window === 'undefined' ? globalThis : window);
