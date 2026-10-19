const path = require('path');
const fs = require('fs');
const { addTombstone, clearTombstone } = require('./tombstones');

// Catalog routes: specimens (rocks taken home for the business) + dig orders.
// Cloned from routes-routes.js: upsert-by-id (String compare), base64 photos
// saved to disk under photosDir. Non-data photo strings are normalized to a
// bare filename so a pulled-then-repushed record never stores a full URL.
module.exports = function setupCatalogRoutes(app, dataDir, { photosDir }) {
  const specimensFile = path.join(dataDir, 'specimens.json');
  const digOrdersFile = path.join(dataDir, 'dig-orders.json');
  const ordersFile = path.join(dataDir, 'orders.json');

  function loadJson(file) {
    if (fs.existsSync(file)) {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
    }
    return [];
  }
  function saveJson(file, data) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }
  function safe(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '_'); }
  function basename(s) { return String(s).split('/').pop().split('?')[0]; }

  // data: URL -> saved file (returns filename); otherwise normalize to a bare filename.
  // New files get a unique token so a freshly-added photo can never overwrite a
  // retained photo's file when the array is reordered/trimmed on edit.
  function savePhotoString(str, baseName) {
    if (typeof str !== 'string') return null;
    if (str.startsWith('data:')) {
      const m = str.match(/^data:image\/(\w+);base64,(.+)$/);
      if (m) {
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        const filename = `${baseName}-${token}.${ext}`;
        fs.writeFileSync(path.join(photosDir, filename), Buffer.from(m[2], 'base64'));
        return filename;
      }
      return null;
    }
    return basename(str); // already a filename or URL -> keep only the filename
  }

  function processSpecimenPhotos(sp) {
    if (Array.isArray(sp.photos)) {
      const saved = [];
      sp.photos.forEach((p, i) => {
        const f = savePhotoString(p, `specimen-${safe(sp.id)}-${i}`);
        if (f) saved.push(f);
      });
      sp.photos = saved;
    }
    if (sp.uv && sp.uv.photoRef) {
      sp.uv.photoRef = savePhotoString(sp.uv.photoRef, `specimen-${safe(sp.id)}-uv`);
    }
    return sp;
  }

  function processDigOrderPhotos(order) {
    if (Array.isArray(order.photos)) {
      const saved = [];
      order.photos.forEach((p, i) => {
        const f = savePhotoString(p, `digorder-${safe(order.id)}-${i}`);
        if (f) saved.push(f);
      });
      order.photos = saved;
    }
    return order;
  }

  // ---- Specimens ----
  app.post('/api/specimen', (req, res) => {
    const sp = req.body;
    if (!sp || sp.id == null) return res.status(400).json({ error: 'Invalid specimen' });
    processSpecimenPhotos(sp);
    const all = loadJson(specimensFile);
    const idx = all.findIndex(s => String(s.id) === String(sp.id));
    if (idx >= 0) all[idx] = sp; else all.push(sp);
    saveJson(specimensFile, all);
    clearTombstone(dataDir, 'specimens', sp.id);
    console.log(`Specimen saved: ${sp.label || sp.name || sp.id}`);
    res.json({ ok: true });
  });

  app.get('/api/specimens', (req, res) => {
    res.json(loadJson(specimensFile));
  });

  app.get('/api/export/specimen/:id', (req, res) => {
    const all = loadJson(specimensFile);
    const sp = all.find(s => String(s.id) === String(req.params.id));
    if (!sp) return res.status(404).json({ error: 'Specimen not found' });
    const out = { ...sp };
    out.photoUrls = (sp.photos || []).map(f => `/photos/${f}`);
    if (sp.uv && sp.uv.photoRef) out.uvPhotoUrl = `/photos/${sp.uv.photoRef}`;
    res.json(out);
  });

  app.delete('/api/specimen/:id', (req, res) => {
    let all = loadJson(specimensFile);
    all = all.filter(s => String(s.id) !== String(req.params.id));
    saveJson(specimensFile, all);
    addTombstone(dataDir, 'specimens', req.params.id, req.query.deletedAt ? Number(req.query.deletedAt) : undefined);
    res.json({ ok: true });
  });

  // ---- Dig Orders ----
  app.post('/api/digorder', (req, res) => {
    const order = req.body;
    if (!order || order.id == null) return res.status(400).json({ error: 'Invalid dig order' });
    processDigOrderPhotos(order);
    const all = loadJson(digOrdersFile);
    const idx = all.findIndex(o => String(o.id) === String(order.id));
    if (idx >= 0) all[idx] = order; else all.push(order);
    saveJson(digOrdersFile, all);
    clearTombstone(dataDir, 'digOrders', order.id);
    console.log(`Dig order saved: ${order.client || order.id}`);
    res.json({ ok: true });
  });

  app.get('/api/digorders', (req, res) => {
    res.json(loadJson(digOrdersFile));
  });

  app.delete('/api/digorder/:id', (req, res) => {
    let all = loadJson(digOrdersFile);
    all = all.filter(o => String(o.id) !== String(req.params.id));
    saveJson(digOrdersFile, all);
    addTombstone(dataDir, 'digOrders', req.params.id, req.query.deletedAt ? Number(req.query.deletedAt) : undefined);
    res.json({ ok: true });
  });

  // ---- Sales Orders (customer + payment + line items; no photos) ----
  app.post('/api/order', (req, res) => {
    const order = req.body;
    if (!order || order.id == null) return res.status(400).json({ error: 'Invalid order' });
    const all = loadJson(ordersFile);
    const idx = all.findIndex(o => String(o.id) === String(order.id));
    if (idx >= 0) all[idx] = order; else all.push(order);
    saveJson(ordersFile, all);
    clearTombstone(dataDir, 'orders', order.id);
    console.log(`Order saved: ${order.orderNumber || order.id}`);
    res.json({ ok: true });
  });

  app.get('/api/orders', (req, res) => {
    res.json(loadJson(ordersFile));
  });

  app.delete('/api/order/:id', (req, res) => {
    let all = loadJson(ordersFile);
    all = all.filter(o => String(o.id) !== String(req.params.id));
    saveJson(ordersFile, all);
    addTombstone(dataDir, 'orders', req.params.id, req.query.deletedAt ? Number(req.query.deletedAt) : undefined);
    res.json({ ok: true });
  });

  return {
    loadSpecimens: () => loadJson(specimensFile),
    loadDigOrders: () => loadJson(digOrdersFile),
    loadOrders: () => loadJson(ordersFile)
  };
};
