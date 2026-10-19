const path = require('path');
const fs = require('fs');

// Shared delete-tombstone store for bidirectional sync.
// data/tombstones.json => { waypoints: {id: deletedAt}, routes: {...}, specimens: {...}, digOrders: {...} }
// A tombstone lets a delete on one device propagate to the other instead of the
// record being re-created on the next sync. Records are upserted by id; deleting
// records the id+timestamp here, and re-creating/updating an id clears it.

function tombFile(dataDir) { return path.join(dataDir, 'tombstones.json'); }

function loadTombstones(dataDir) {
  try { return JSON.parse(fs.readFileSync(tombFile(dataDir), 'utf8')); } catch (e) { return {}; }
}

function saveTombstones(dataDir, t) {
  const dir = path.dirname(tombFile(dataDir));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tombFile(dataDir), JSON.stringify(t, null, 2));
}

// Record a delete. deletedAt defaults to now but a caller may pass the originating
// device's timestamp so both sides agree.
function addTombstone(dataDir, type, id, deletedAt) {
  const t = loadTombstones(dataDir);
  if (!t[type]) t[type] = {};
  t[type][String(id)] = deletedAt || Date.now();
  saveTombstones(dataDir, t);
}

// Clear a tombstone (record was re-created or updated, i.e. resurrected).
function clearTombstone(dataDir, type, id) {
  const t = loadTombstones(dataDir);
  if (t[type] && t[type][String(id)] != null) {
    delete t[type][String(id)];
    saveTombstones(dataDir, t);
  }
}

module.exports = { loadTombstones, addTombstone, clearTombstone };
