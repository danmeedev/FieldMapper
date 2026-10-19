const fs = require('fs');
const { createHash, randomUUID } = require('crypto');

const DEFAULT_MODEL = 'claude-sonnet-4-6';
module.exports = function createAIConfig(configFile, callProvider) {
  let testing = null;
  function read() {
    if (!fs.existsSync(configFile)) return {};
    return JSON.parse(fs.readFileSync(configFile, 'utf8'));
  }
  function write(config) {
    const temp = configFile + '.' + randomUUID() + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(config, null, 2));
    fs.renameSync(temp, configFile);
  }
  function effective() {
    const stored = read();
    return { ...stored, anthropicApiKey: process.env.ANTHROPIC_API_KEY || stored.anthropicApiKey || '',
      aiModel: process.env.ANTHROPIC_MODEL || stored.aiModel || DEFAULT_MODEL,
      aiEnabled: stored.aiEnabled === true };
  }
  function fingerprint(c) {
    return createHash('sha256').update(JSON.stringify([c.anthropicApiKey, c.aiModel, c.aiEnabled, c.aiRevision])).digest('hex');
  }
  function status() {
    const c = effective();
    const verified = c.aiVerification && c.aiVerification.fingerprint === fingerprint(c);
    const state = !c.aiEnabled ? 'disabled' : !c.anthropicApiKey ? 'needs-configuration' :
      testing === fingerprint(c) ? 'testing' : verified ? 'ready' : c.aiTestFailed ? 'failed' : 'needs-test';
    return { state, ready: state === 'ready', aiEnabled: c.aiEnabled, aiModel: c.aiModel,
      anthropicApiKeySet: !!c.anthropicApiKey, keyFromEnvironment: !!process.env.ANTHROPIC_API_KEY,
      modelFromEnvironment: !!process.env.ANTHROPIC_MODEL,
      testedAt: verified ? c.aiVerification.testedAt : null };
  }
  function save(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
      Object.keys(patch).some(k => !['aiEnabled', 'aiModel', 'anthropicApiKey'].includes(k))) {
      throw new Error('Unsupported AI configuration');
    }
    if ('aiEnabled' in patch && typeof patch.aiEnabled !== 'boolean') throw new Error('Enable must be true or false');
    if ('aiModel' in patch && (typeof patch.aiModel !== 'string' || !/^claude-[a-zA-Z0-9.-]{1,100}$/.test(patch.aiModel))) throw new Error('Enter a valid Claude model id');
    if ('anthropicApiKey' in patch && (typeof patch.anthropicApiKey !== 'string' || patch.anthropicApiKey.startsWith('****'))) throw new Error('Enter the actual API key, not a masked value');
    const stored = read();
    if (Object.entries(patch).some(([k,v]) => stored[k] !== v)) {
      Object.assign(stored, patch, { aiRevision: randomUUID() });
      delete stored.aiVerification; delete stored.aiTestFailed;
      write(stored);
    }
    return status();
  }
  function invalidate(c) {
    const current = effective();
    if (fingerprint(current) !== fingerprint(c)) return;
    const stored = read(); delete stored.aiVerification; stored.aiTestFailed = true; write(stored);
  }
  async function test() {
    const c = effective();
    if (!c.aiEnabled || !c.anthropicApiKey) throw new Error('Enable AI and configure an API key first');
    const revision = fingerprint(c);
    if (testing) throw new Error('An AI test is already running');
    testing = revision;
    try {
      const text = await callProvider(c.anthropicApiKey, [{ type: 'text', text: 'Reply with OK. This is a connection test.' }], c.aiModel, 32);
      if (typeof text !== 'string' || !text.trim()) throw new Error('AI test returned no text');
      if (fingerprint(effective()) !== revision) throw new Error('Configuration changed during the test. Test the new settings.');
      const stored = read(); stored.aiVerification = { fingerprint: revision, testedAt: Date.now() };
      delete stored.aiTestFailed; write(stored);
    } catch (e) { invalidate(c); throw e; }
    finally { testing = null; }
    return status();
  }
  return { effective, status, save, test, invalidate };
};
