// Shared AI settings UI. Keep public/js and mobile-app/src/js copies identical.
window.AiSettings = (() => {
  let current = { ready: false, state: 'unavailable' };
  let generation = 0;
  let dialog;
  async function baseUrl() {
    if (typeof getSetting !== 'function') return '';
    const url = await getSetting('laptopUrl');
    if (!url) throw new Error('Set the laptop server URL in Map Settings first.');
    return url.replace(/\/$/, '');
  }
  function apply(value) {
    current = value;
    document.documentElement.classList.toggle('ai-ready', value.ready === true);
    if (!value.ready) {
      document.getElementById('ai-panel')?.classList.remove('visible');
      document.getElementById('toggle-ai')?.classList.remove('active');
    }
    document.dispatchEvent(new CustomEvent('ai-readiness', { detail: value }));
    return value;
  }
  async function request(path, body, base) {
    const response = await fetch((base ?? await baseUrl()) + path, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(path.endsWith('/test') ? 130000 : 6000)
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || `Request failed (${response.status})`);
    return value;
  }
  async function refresh() {
    const own = ++generation;
    try {
      const base = await baseUrl();
      const value = await request('/api/ai/status', undefined, base);
      if (own !== generation || base !== await baseUrl()) return current;
      return apply(value);
    } catch (e) {
      if (own === generation) apply({ ready: false, state: 'unavailable' });
      return current;
    }
  }
  async function requireReady() {
    if (!(await refresh()).ready) throw new Error('Configure AI and pass Test Connection in AI Configuration first.');
  }
  function setMessage(text) { document.getElementById('ai-config-message').textContent = text; }
  function makeDialog() {
    if (dialog) return;
    dialog = document.createElement('dialog'); dialog.id = 'ai-config-dialog';
    dialog.style.cssText = 'margin:auto;background:#202124;color:#eee;border:1px solid #555;border-radius:12px;padding:22px;width:420px;max-width:90vw;max-height:85vh;overflow:auto';
    dialog.innerHTML = `<h2 style="margin:0 0 16px">AI Configuration</h2>
      <p>AI tools appear only after you enable AI, save its settings, and pass a connection test.</p>
      <label><input id="ai-config-enabled" type="checkbox"> Enable AI</label>
      <label style="display:block;margin-top:14px">Claude model <input id="ai-config-model" style="display:block;width:100%;box-sizing:border-box;padding:10px" autocomplete="off"></label>
      <label style="display:block;margin-top:14px">API key <input id="ai-config-key" type="password" style="display:block;width:100%;box-sizing:border-box;padding:10px" autocomplete="off" placeholder="Leave blank to keep stored key"></label>
      <p id="ai-config-source" style="font-size:12px"></p>
      <p style="font-size:12px">Credentials are stored on the laptop. Test Connection sends a small synthetic request to Anthropic and may incur a small charge.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0">
        <button id="ai-config-save" type="button">Save</button><button id="ai-config-test" type="button">Test Connection</button><button id="ai-config-close" type="button">Close</button>
      </div><p id="ai-config-message" role="status" aria-live="polite"></p>`;
    document.body.appendChild(dialog);
    dialog.querySelector('#ai-config-close').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { dialog.querySelector('#ai-config-key').value = ''; refresh(); });
    dialog.querySelector('#ai-config-save').onclick = async () => {
      const button = dialog.querySelector('#ai-config-save'); button.disabled = true;
      apply({ ready: false, state: 'needs-test' });
      try {
        const patch = { aiEnabled: dialog.querySelector('#ai-config-enabled').checked };
        if (!dialog.querySelector('#ai-config-model').disabled) patch.aiModel = dialog.querySelector('#ai-config-model').value.trim();
        const key = dialog.querySelector('#ai-config-key');
        if (key.value.trim() && !key.disabled) patch.anthropicApiKey = key.value.trim();
        await request('/api/config', patch); key.value = '';
        const state = await refresh(); setMessage(state.ready ? 'Ready.' : `Saved. Status: ${state.state}. Run Test Connection to enable tools.`);
        dialog.querySelector('#ai-config-test').disabled = false;
      } catch (e) { setMessage(e.message); }
      finally { button.disabled = false; }
    };
    dialog.querySelector('#ai-config-test').onclick = async () => {
      const button = dialog.querySelector('#ai-config-test'); button.disabled = true;
      dialog.querySelector('#ai-config-save').disabled = true;
      setMessage('Testing saved configuration...');
      apply({ ready: false, state: 'testing' });
      try { await request('/api/ai/test', {}); await refresh(); setMessage(current.ready ? 'Connection test succeeded. AI tools are now available.' : 'Configuration changed. Save and test again.'); }
      catch (e) { await refresh(); setMessage(`Test failed: ${e.message}`); }
      finally { button.disabled = false; dialog.querySelector('#ai-config-save').disabled = false; }
    };
    dialog.querySelectorAll('input').forEach(input => input.addEventListener('input', () => {
      dialog.querySelector('#ai-config-test').disabled = true;
      setMessage('Unsaved changes. Save before testing.');
    }));
  }
  async function open() {
    makeDialog(); if (!dialog.open) dialog.showModal();
    setMessage('Loading laptop configuration...');
    const state = await refresh();
    dialog.querySelector('#ai-config-enabled').checked = state.aiEnabled === true;
    dialog.querySelector('#ai-config-model').value = state.aiModel || 'claude-sonnet-4-6';
    dialog.querySelector('#ai-config-model').disabled = state.modelFromEnvironment === true;
    dialog.querySelector('#ai-config-key').value = '';
    dialog.querySelector('#ai-config-key').disabled = state.keyFromEnvironment === true;
    dialog.querySelector('#ai-config-source').textContent = state.keyFromEnvironment ? 'Key is managed by the laptop environment.' : state.anthropicApiKeySet ? 'An API key is stored on the laptop.' : 'No API key configured.';
    dialog.querySelector('#ai-config-test').disabled = false;
    setMessage(`Status: ${state.state}`);
  }
  document.addEventListener('DOMContentLoaded', refresh);
  window.addEventListener('online', refresh);
  window.addEventListener('offline', () => { generation++; apply({ ready: false, state: 'unavailable' }); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 15000);
  return { refresh, requireReady, open, get ready() { return current.ready === true; } };
})();
