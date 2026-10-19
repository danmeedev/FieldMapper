// Catalog view — rock-business specimen catalog + dig orders (mobile).
// Backed by the `specimens` / `digOrders` IndexedDB stores (waypoint-store.js).
// Syncs bidirectionally with the laptop hub via sync-engine.js.
//
// NOTE: the vocab maps and the listing/provenance/price generators below are
// intentionally duplicated in public/js/map.js (laptop) — keep the two in sync.

// =====================================================================
// Vocabulary (from the Rockhound Operations SOPs + existing geology lists)
// =====================================================================

// SOP-1 site codes. accessType auto-defaults from the site.
const SITE_CODES = {
  'BL':    { label: 'Blanchard Mine, NM',     region: 'Bingham, New Mexico',        accessType: 'private-claim', defaultMinerals: ['fluorite', 'galena', 'barite'] },
  'MI-K':  { label: 'Keweenaw Peninsula, MI',  region: 'Keweenaw Peninsula, Michigan', accessType: 'state-dnr',    defaultMinerals: ['copper'] },
  'MI-D':  { label: 'Michigan Devonian',       region: 'Michigan',                   accessType: 'state-dnr',     defaultMinerals: [] },
  'CO-GR': { label: 'Granite/Guffey, CO',      region: 'the Colorado Rockies (Guffey/Lake George)', accessType: 'blm-open', defaultMinerals: [] },
  'CO-RK': { label: 'Colorado Rockies',        region: 'the Colorado Rockies',       accessType: 'blm-open',      defaultMinerals: ['fluorite'] },
  'PY':    { label: 'Payson, AZ',              region: 'Payson, Arizona',            accessType: 'fee-dig',       defaultMinerals: ['quartz'] },
  'DO-XX': { label: 'Dig Order (client site)', region: '',                           accessType: 'dig-order',     defaultMinerals: [] },
  'XX':    { label: 'New / unassigned site',   region: '',                           accessType: '',              defaultMinerals: [] }
};

const CAT_ACCESS_TYPES = [
  { v: 'private-claim', l: 'Private claim (relationship)' },
  { v: 'blm-open',      l: 'BLM open collect' },
  { v: 'state-dnr',     l: 'State / DNR land' },
  { v: 'fee-dig',       l: 'Fee dig / commercial' },
  { v: 'dig-order',     l: 'Dig order (custom access)' }
];

// SOP-2 sort gate / SOP-3 pricing buckets
const BUCKETS = [
  { v: 0, l: '0 — Giveaway / fines', band: '$1–5 (bundle / add-on)' },
  { v: 1, l: '1 — Bread & butter',   band: '$8–25' },
  { v: 2, l: '2 — Mid-tier',         band: '$25–100 (≈90% of eBay sold comps)' },
  { v: 3, l: '3 — Showcase',         band: '$100–500+ (7-day auction w/ reserve)' }
];

const UV_RESPONSES = [
  { v: 'not-tested', l: 'Not tested' },
  { v: 'none',       l: 'No response' },
  { v: 'moderate',   l: 'Moderate' },
  { v: 'strong',     l: 'Strong' }
];

const SPECIMEN_CATEGORIES = [
  { v: 'mineral',  l: 'Mineral' },
  { v: 'rock',     l: 'Rock' },
  { v: 'crystal',  l: 'Crystal' },
  { v: 'fossil',   l: 'Fossil' },
  { v: 'lapidary', l: 'Lapidary / cut' },
  { v: 'specimen', l: 'Specimen' },
  { v: 'other',    l: 'Other' }
];

const ITEM_TYPES = [
  { v: 'specimen',  l: 'Single specimen' },
  { v: 'grab-bag',  l: 'Grab bag' },
  { v: 'glow-dirt', l: 'Glow dirt' },
  { v: 'rough-lot', l: 'Rough lot' }
];

const CONDITIONS = [
  { v: 'as-collected', l: 'As-collected' },
  { v: 'tumbled',      l: 'Tumbled' },
  { v: 'cleaned',      l: 'Cleaned' },
  { v: 'display-ready', l: 'Display-ready' }
];

const SPECIMEN_STATUSES = [
  { v: 'in-collection', l: 'In collection' },
  { v: 'for-sale',      l: 'For sale' },
  { v: 'listed',        l: 'Listed' },
  { v: 'reserved',      l: 'Reserved' },
  { v: 'sold',          l: 'Sold' }
];

const PLATFORMS = [
  { v: 'none',      l: '—' },
  { v: 'ebay',      l: 'eBay' },
  { v: 'etsy',      l: 'Etsy' },
  { v: 'facebook',  l: 'Facebook' },
  { v: 'instagram', l: 'Instagram' },
  { v: 'landing',   l: 'Landing page' }
];

const ACQ_METHODS = [
  { v: 'self-collected', l: 'Self-collected' },
  { v: 'dig-order',      l: 'Dig order' },
  { v: 'purchased',      l: 'Purchased' },
  { v: 'trade',          l: 'Trade' },
  { v: 'gift',           l: 'Gift' }
];

const WEIGHT_UNITS = [{ v: 'oz', l: 'oz' }, { v: 'lb', l: 'lb' }, { v: 'g', l: 'g' }];

// SOP-5 dig-order rate tiers + status lifecycle
const RATE_TIERS = [
  { v: 'standard-75',          l: 'Standard — $75/day',        dayRate: 75 },
  { v: 'specialty-125',        l: 'Specialty — $125/day',      dayRate: 125 },
  { v: 'remote-150',           l: 'Remote / overnight — $150+/day', dayRate: 150 },
  { v: 'blanchard-negotiated', l: 'Blanchard / private — negotiated', dayRate: 0 },
  { v: 'custom',               l: 'Custom', dayRate: 0 }
];

const DIGORDER_STATUSES = [
  { v: 'inquiry',      l: 'Inquiry' },
  { v: 'feasibility',  l: 'Feasibility check' },
  { v: 'terms-sent',   l: 'Terms sent' },
  { v: 'deposit-paid', l: 'Deposit paid' },
  { v: 'scheduled',    l: 'Scheduled' },
  { v: 'dug',          l: 'Dug' },
  { v: 'preview-sent', l: 'Preview sent' },
  { v: 'processing',   l: 'Processing' },
  { v: 'invoiced',     l: 'Invoiced' },
  { v: 'shipped',      l: 'Shipped' },
  { v: 'follow-up',    l: 'Follow-up' },
  { v: 'cancelled',    l: 'Cancelled' }
];

const DEPOSIT_METHODS = [
  { v: 'etsy',   l: 'Etsy custom listing' },
  { v: 'venmo',  l: 'Venmo' },
  { v: 'paypal', l: 'PayPal F&F' },
  { v: 'zelle',  l: 'Zelle' },
  { v: 'other',  l: 'Other' }
];

// Geology vocab — lifted verbatim from the GPS Mark form (index.html)
const GEO_ROCK_TYPES = [
  { v: '', l: '— Select —' },
  { v: 'quartz', l: 'Quartz/Quartz Vein' }, { v: 'granite', l: 'Granite' }, { v: 'schist', l: 'Schist' },
  { v: 'gneiss', l: 'Gneiss' }, { v: 'basalt', l: 'Basalt' }, { v: 'rhyolite', l: 'Rhyolite' },
  { v: 'andesite', l: 'Andesite' }, { v: 'limestone', l: 'Limestone' }, { v: 'sandstone', l: 'Sandstone' },
  { v: 'shale', l: 'Shale' }, { v: 'conglomerate', l: 'Conglomerate' }, { v: 'breccia', l: 'Breccia' },
  { v: 'skarn', l: 'Skarn' }, { v: 'hornfels', l: 'Hornfels' }, { v: 'serpentinite', l: 'Serpentinite' },
  { v: 'iron-oxide', l: 'Iron Oxide/Gossan' }, { v: 'sulfide', l: 'Sulfide Bearing' },
  { v: 'alluvium', l: 'Alluvium' }, { v: 'other', l: 'Other' }
];

// Autocomplete suggestions for the mineral tag input. NOT a closed list — any typed
// value is accepted (free text), so unusual finds/varieties are never excluded.
// Existing values (pyrite, fluorite, free-gold, etc.) are kept so old records still map.
const GEO_MINERALS = [
  // Native elements
  { v: 'free-gold', l: 'Visible Gold' }, { v: 'gold', l: 'Gold' }, { v: 'silver', l: 'Silver' },
  { v: 'copper', l: 'Copper' }, { v: 'sulfur', l: 'Sulfur' }, { v: 'graphite', l: 'Graphite' },
  { v: 'diamond', l: 'Diamond' }, { v: 'bismuth', l: 'Bismuth' }, { v: 'platinum', l: 'Platinum' },
  // Sulfides & sulfosalts
  { v: 'pyrite', l: 'Pyrite' }, { v: 'marcasite', l: 'Marcasite' }, { v: 'chalcopyrite', l: 'Chalcopyrite' },
  { v: 'bornite', l: 'Bornite' }, { v: 'chalcocite', l: 'Chalcocite' }, { v: 'covellite', l: 'Covellite' },
  { v: 'galena', l: 'Galena' }, { v: 'sphalerite', l: 'Sphalerite' }, { v: 'pyrrhotite', l: 'Pyrrhotite' },
  { v: 'arsenopyrite', l: 'Arsenopyrite' }, { v: 'molybdenite', l: 'Molybdenite' }, { v: 'stibnite', l: 'Stibnite' },
  { v: 'cinnabar', l: 'Cinnabar' }, { v: 'realgar', l: 'Realgar' }, { v: 'orpiment', l: 'Orpiment' },
  { v: 'cobaltite', l: 'Cobaltite' }, { v: 'enargite', l: 'Enargite' }, { v: 'tetrahedrite', l: 'Tetrahedrite' },
  // Oxides & hydroxides
  { v: 'magnetite', l: 'Magnetite' }, { v: 'hematite', l: 'Hematite' }, { v: 'limonite', l: 'Limonite/Goethite' },
  { v: 'goethite', l: 'Goethite' }, { v: 'rutile', l: 'Rutile' }, { v: 'cassiterite', l: 'Cassiterite' },
  { v: 'corundum', l: 'Corundum (Ruby/Sapphire)' }, { v: 'spinel', l: 'Spinel' }, { v: 'chromite', l: 'Chromite' },
  { v: 'cuprite', l: 'Cuprite' }, { v: 'uraninite', l: 'Uraninite' }, { v: 'ilmenite', l: 'Ilmenite' },
  { v: 'psilomelane', l: 'Psilomelane' }, { v: 'pyrolusite', l: 'Pyrolusite' },
  // Halides
  { v: 'fluorite', l: 'Fluorite' }, { v: 'halite', l: 'Halite' }, { v: 'sylvite', l: 'Sylvite' },
  { v: 'atacamite', l: 'Atacamite' },
  // Carbonates
  { v: 'calcite', l: 'Calcite' }, { v: 'aragonite', l: 'Aragonite' }, { v: 'dolomite', l: 'Dolomite' },
  { v: 'magnesite', l: 'Magnesite' }, { v: 'siderite', l: 'Siderite' }, { v: 'rhodochrosite', l: 'Rhodochrosite' },
  { v: 'smithsonite', l: 'Smithsonite' }, { v: 'malachite', l: 'Malachite' }, { v: 'azurite', l: 'Azurite' },
  { v: 'cerussite', l: 'Cerussite' }, { v: 'witherite', l: 'Witherite' },
  // Sulfates & molybdates
  { v: 'barite', l: 'Barite' }, { v: 'gypsum', l: 'Gypsum/Selenite' }, { v: 'celestine', l: 'Celestine' },
  { v: 'anglesite', l: 'Anglesite' }, { v: 'anhydrite', l: 'Anhydrite' }, { v: 'wulfenite', l: 'Wulfenite' },
  // Phosphates / arsenates / vanadates
  { v: 'apatite', l: 'Apatite' }, { v: 'turquoise', l: 'Turquoise' }, { v: 'vivianite', l: 'Vivianite' },
  { v: 'pyromorphite', l: 'Pyromorphite' }, { v: 'wavellite', l: 'Wavellite' }, { v: 'variscite', l: 'Variscite' },
  { v: 'vanadinite', l: 'Vanadinite' }, { v: 'mimetite', l: 'Mimetite' },
  // Tungstates
  { v: 'scheelite', l: 'Scheelite' }, { v: 'wolframite', l: 'Wolframite' },
  // Quartz family & varieties
  { v: 'quartz', l: 'Quartz' }, { v: 'amethyst', l: 'Amethyst' }, { v: 'citrine', l: 'Citrine' },
  { v: 'smoky-quartz', l: 'Smoky Quartz' }, { v: 'rose-quartz', l: 'Rose Quartz' }, { v: 'milky-quartz', l: 'Milky Quartz' },
  { v: 'agate', l: 'Agate' }, { v: 'jasper', l: 'Jasper' }, { v: 'chalcedony', l: 'Chalcedony' },
  { v: 'carnelian', l: 'Carnelian' }, { v: 'onyx', l: 'Onyx' }, { v: 'chrysoprase', l: 'Chrysoprase' },
  { v: 'bloodstone', l: 'Bloodstone' }, { v: 'tigers-eye', l: "Tiger's Eye" }, { v: 'aventurine', l: 'Aventurine' },
  { v: 'opal', l: 'Opal' }, { v: 'petrified-wood', l: 'Petrified Wood' }, { v: 'flint', l: 'Flint/Chert' },
  // Feldspars
  { v: 'amazonite', l: 'Amazonite' }, { v: 'microcline', l: 'Microcline' }, { v: 'orthoclase', l: 'Orthoclase' },
  { v: 'labradorite', l: 'Labradorite' }, { v: 'moonstone', l: 'Moonstone' }, { v: 'sunstone', l: 'Sunstone' },
  { v: 'plagioclase', l: 'Plagioclase' },
  // Garnets
  { v: 'garnet', l: 'Garnet' }, { v: 'almandine', l: 'Almandine Garnet' }, { v: 'grossular', l: 'Grossular Garnet' },
  { v: 'andradite', l: 'Andradite Garnet' }, { v: 'spessartine', l: 'Spessartine Garnet' },
  // Tourmaline & beryl
  { v: 'tourmaline', l: 'Tourmaline' }, { v: 'schorl', l: 'Schorl (Black Tourmaline)' }, { v: 'elbaite', l: 'Elbaite Tourmaline' },
  { v: 'beryl', l: 'Beryl' }, { v: 'aquamarine', l: 'Aquamarine' }, { v: 'emerald', l: 'Emerald' },
  { v: 'morganite', l: 'Morganite' }, { v: 'heliodor', l: 'Heliodor' },
  // Other gem / collector silicates
  { v: 'topaz', l: 'Topaz' }, { v: 'zircon', l: 'Zircon' }, { v: 'peridot', l: 'Peridot/Olivine' },
  { v: 'epidote', l: 'Epidote' }, { v: 'vesuvianite', l: 'Vesuvianite (Idocrase)' }, { v: 'prehnite', l: 'Prehnite' },
  { v: 'datolite', l: 'Datolite' }, { v: 'chrysocolla', l: 'Chrysocolla' }, { v: 'dioptase', l: 'Dioptase' },
  { v: 'hemimorphite', l: 'Hemimorphite' }, { v: 'kyanite', l: 'Kyanite' }, { v: 'andalusite', l: 'Andalusite' },
  { v: 'staurolite', l: 'Staurolite' }, { v: 'titanite', l: 'Titanite (Sphene)' }, { v: 'axinite', l: 'Axinite' },
  { v: 'lapis-lazuli', l: 'Lapis Lazuli' }, { v: 'sodalite', l: 'Sodalite' }, { v: 'lazurite', l: 'Lazurite' },
  { v: 'rhodonite', l: 'Rhodonite' }, { v: 'wollastonite', l: 'Wollastonite' }, { v: 'danburite', l: 'Danburite' },
  { v: 'spodumene', l: 'Spodumene/Kunzite' }, { v: 'charoite', l: 'Charoite' }, { v: 'sugilite', l: 'Sugilite' },
  // Zeolites
  { v: 'apophyllite', l: 'Apophyllite' }, { v: 'stilbite', l: 'Stilbite' }, { v: 'heulandite', l: 'Heulandite' },
  { v: 'natrolite', l: 'Natrolite' }, { v: 'analcime', l: 'Analcime' }, { v: 'chabazite', l: 'Chabazite' },
  // Sheet / chain silicates & rock-forming
  { v: 'muscovite', l: 'Muscovite (Mica)' }, { v: 'biotite', l: 'Biotite (Mica)' }, { v: 'lepidolite', l: 'Lepidolite' },
  { v: 'serpentine', l: 'Serpentine' }, { v: 'talc', l: 'Talc' }, { v: 'chlorite', l: 'Chlorite' },
  { v: 'actinolite', l: 'Actinolite' }, { v: 'tremolite', l: 'Tremolite' }, { v: 'hornblende', l: 'Hornblende' },
  { v: 'diopside', l: 'Diopside' }, { v: 'augite', l: 'Augite' }, { v: 'jadeite', l: 'Jadeite (Jade)' },
  { v: 'nephrite', l: 'Nephrite (Jade)' },
  // Regional / rockhound favorites
  { v: 'petoskey', l: 'Petoskey Stone' }, { v: 'chlorastrolite', l: 'Chlorastrolite (Greenstone)' },
  { v: 'thomsonite', l: 'Thomsonite' }, { v: 'unakite', l: 'Unakite' }, { v: 'obsidian', l: 'Obsidian' },
  { v: 'amber', l: 'Amber' },
  { v: 'other', l: 'Other' }
];

const GEO_ALTERATION = [
  { v: '', l: '— Select —' },
  { v: 'none', l: 'None' }, { v: 'silicification', l: 'Silicification' }, { v: 'argillic', l: 'Argillic (Clay)' },
  { v: 'sericitic', l: 'Sericitic' }, { v: 'propylitic', l: 'Propylitic' }, { v: 'potassic', l: 'Potassic' },
  { v: 'iron-oxide', l: 'Iron Oxide Staining' }, { v: 'chloritic', l: 'Chloritic' },
  { v: 'carbonate', l: 'Carbonate' }, { v: 'supergene', l: 'Supergene' }
];

const GEO_SAMPLE_TYPES = [
  { v: '', l: '— Select —' },
  { v: 'rock', l: 'Rock Chip' }, { v: 'float', l: 'Float' }, { v: 'soil', l: 'Soil' },
  { v: 'pan', l: 'Pan Concentrate' }, { v: 'channel', l: 'Channel Sample' }, { v: 'grab', l: 'Grab Sample' },
  { v: 'outcrop', l: 'Outcrop' }
];

// =====================================================================
// Small helpers
// =====================================================================
function catEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function vocabLabel(arr, v) { const f = arr.find(x => String(x.v) === String(v)); return f ? f.l : (v || ''); }
function optionsHtml(arr, selected) {
  return arr.map(o => `<option value="${catEsc(o.v)}"${String(o.v) === String(selected) ? ' selected' : ''}>${catEsc(o.l)}</option>`).join('');
}
function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// =====================================================================
// Generators (deterministic, fully offline) — SOP-3
// =====================================================================
function mineralLabels(sp) {
  const m = sp.mineralization || [];
  return m.map(v => vocabLabel(GEO_MINERALS, v)).filter(Boolean);
}

function uvListingText(sp) {
  const uv = sp.uv || {};
  if (uv.response === 'strong') return 'Yes — strong' + (uv.color ? ` (${uv.color})` : '');
  if (uv.response === 'moderate') return 'Yes — moderate' + (uv.color ? ` (${uv.color})` : '');
  if (uv.response === 'none') return 'No';
  return 'Not tested';
}

function generateProvenance(sp) {
  const site = SITE_CODES[sp.siteCode];
  if (sp.siteCode === 'BL') {
    return 'Collected personally at the Blanchard Mine, Bingham, New Mexico, with access through my ongoing relationship with the claim owner. Blanchard is a historically significant fluorite and galena producer in the Rio Grande Rift zone.';
  }
  const where = sp.locality || (site && site.region) || (site && site.label) || 'the field';
  const accessSentence = {
    'blm-open': 'BLM open-collection area.',
    'private-claim': 'Collected with permission from a private claim.',
    'state-dnr': 'Collected on state land in accordance with local rules.',
    'fee-dig': 'Collected at a fee-dig site.',
    'dig-order': 'Collected to fill a custom dig order.'
  }[sp.accessType] || '';
  let s = `Personally collected by me from ${where}.`;
  if (accessSentence) s += ' ' + accessSentence;
  return s;
}

function suggestPrice(sp) {
  const b = BUCKETS.find(x => x.v === Number(sp.bucket));
  let txt = b ? b.band : '';
  const uv = (sp.uv || {}).response;
  if (uv === 'strong' || uv === 'moderate') txt += ' · +25–50% UV premium';
  return txt;
}

function suggestPlatform(sp) {
  return (sp.itemType === 'glow-dirt' || sp.itemType === 'grab-bag') ? 'etsy' : 'ebay';
}

function generateListing(sp) {
  const minerals = mineralLabels(sp);
  const mineralsTitle = minerals.length ? minerals.join(', ') : (sp.speciesVariety || sp.name || 'Natural Specimen');
  const site = SITE_CODES[sp.siteCode];
  const location = (site && site.label) || sp.locality || (site && site.region) || '';
  let size = '';
  if (sp.weight) size = `${sp.weight} ${sp.weightUnit || 'oz'}`;
  else if (sp.dimensions && (sp.dimensions.l || sp.dimensions.w || sp.dimensions.h)) {
    const d = sp.dimensions; size = `${[d.l, d.w, d.h].filter(Boolean).join('x')} in`;
  }

  const titleParts = [mineralsTitle, location, size, 'Natural Specimen', 'Personally Collected'].filter(Boolean);
  const title = titleParts.join(' — ');

  const provenance = sp.provenanceStatement || generateProvenance(sp);
  const mineralsLower = minerals.length ? minerals.join(', ').toLowerCase() : (sp.speciesVariety || sp.name || 'mineral specimen');
  const conditionLabel = vocabLabel(CONDITIONS, sp.condition);

  const dims = (sp.dimensions && (sp.dimensions.l || sp.dimensions.w || sp.dimensions.h))
    ? `${[sp.dimensions.l, sp.dimensions.w, sp.dimensions.h].filter(Boolean).join(' x ')} in` : '';

  const specLine = [
    `Minerals: ${minerals.join(', ') || (sp.speciesVariety || '—')}`,
    `Location: ${location || '—'}`,
    `Weight: ${sp.weight ? sp.weight + ' ' + (sp.weightUnit || 'oz') : '—'}`,
    `Dimensions: ${dims || '—'}`,
    `UV Fluorescence: ${uvListingText(sp)}`,
    `Condition: ${conditionLabel || '—'}`
  ].join(' | ');

  const bodyLines = [
    `Natural ${mineralsLower}, personally collected from ${location || 'the field'}.`,
    provenance,
    sp.description ? sp.description.trim() : '',
    conditionLabel ? `Condition: ${conditionLabel}.` : '',
    '',
    specLine,
    '',
    'Ships within 3 business days. Combined shipping available. Double-boxed for protection.'
  ].filter((l, i) => l !== '' || i < 6);

  return { title, body: bodyLines.join('\n') };
}

// =====================================================================
// View shell + segmented control
// =====================================================================
let currentCatalogSegment = 'specimens';

function initCatalogView() {
  // Static shell lives in index.html; nothing to build here yet.
}

function refreshCatalog() {
  if (currentCatalogSegment === 'specimens') refreshSpecimenList();
  else if (currentCatalogSegment === 'orders') refreshOrderList();
  else refreshDigOrderList();
}

window.catalogSegment = function (seg) {
  currentCatalogSegment = seg;
  ['specimens', 'orders', 'digorders'].forEach(s => {
    const btn = document.getElementById('seg-' + s);
    const panel = document.getElementById('catalog-' + s);
    if (btn) btn.classList.toggle('active', seg === s);
    if (panel) panel.style.display = seg === s ? 'block' : 'none';
  });
  refreshCatalog();
};

// =====================================================================
// SPECIMENS — list
// =====================================================================
async function refreshSpecimenList() {
  const list = document.getElementById('specimen-list');
  if (!list) return;
  const all = (await getAllSpecimens()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const countBar = document.getElementById('specimen-count-bar');
  if (countBar) {
    const unsynced = all.filter(s => !s.synced).length;
    countBar.textContent = `${all.length} specimen${all.length !== 1 ? 's' : ''} · ${unsynced === 0 ? 'all synced' : unsynced + ' unsynced'}`;
  }

  const q = (document.getElementById('specimen-search')?.value || '').trim().toLowerCase();
  let rows = all;
  if (q) {
    rows = all.filter(s =>
      (s.label || '').toLowerCase().includes(q) ||
      (s.name || '').toLowerCase().includes(q) ||
      (s.speciesVariety || '').toLowerCase().includes(q) ||
      (s.locality || '').toLowerCase().includes(q) ||
      (s.tags || []).join(' ').toLowerCase().includes(q) ||
      (s.siteCode || '').toLowerCase().includes(q)
    );
  }

  // Build dup-label set for badges
  const labelCounts = {};
  all.forEach(s => { if (s.label) labelCounts[s.label] = (labelCounts[s.label] || 0) + 1; });

  list.innerHTML = '';
  if (rows.length === 0) {
    list.innerHTML = '<div style="color:#777;text-align:center;padding:20px;font-size:13px">No specimens yet. Tap "+ Add Specimen".</div>';
    return;
  }

  rows.forEach(s => {
    const statusColors = { 'in-collection': '#607d8b', 'for-sale': '#00897b', 'listed': '#1565c0', 'reserved': '#f9a825', 'sold': '#6a1b9a' };
    const sc = statusColors[s.status] || '#607d8b';
    const syncBadge = s.synced ? '<span class="recent-badge synced">synced</span>' : '<span class="recent-badge">unsynced</span>';
    const dupBadge = (s.label && labelCounts[s.label] > 1) ? '<span class="recent-badge" style="background:#c62828">dup SKU</span>' : '';
    const priceTxt = s.price ? ` · $${s.price}` : '';
    const div = document.createElement('div');
    div.className = 'recent-item';
    div.style.cursor = 'pointer';
    div.innerHTML = `
      <div class="recent-dot" style="background:${sc};width:10px;height:10px"></div>
      <div class="recent-info">
        <div class="recent-name">${catEsc(s.label || s.name || 'Specimen')} ${syncBadge} ${dupBadge}</div>
        <div class="recent-detail">${catEsc(s.name || '')}${s.name && s.speciesVariety ? ' · ' : ''}${catEsc(s.speciesVariety || '')}</div>
        <div class="recent-detail">${catEsc(vocabLabel(SPECIMEN_STATUSES, s.status))} · B${s.bucket != null ? s.bucket : '–'}${priceTxt}${s.siteCode ? ' · ' + catEsc(s.siteCode) : ''}</div>
      </div>`;
    div.addEventListener('click', () => showSpecimenDetail(s.id));
    list.appendChild(div);
  });
}

window.refreshSpecimenList = refreshSpecimenList;

// =====================================================================
// SPECIMENS — create / edit form
// =====================================================================
let specimenFormPhotos = [];   // [{ ref?, dataUrl }]
let specimenUvPhoto = null;    // { ref?, dataUrl } | null
let specimenFormMinerals = []; // [value]
let specimenLinkedWaypoint = null; // { id, lat, lon, name }
let editingSpecimenId = null;

window.openSpecimenForm = async function () {
  editingSpecimenId = null;
  specimenFormPhotos = [];
  specimenUvPhoto = null;
  specimenFormMinerals = [];
  specimenLinkedWaypoint = null;
  const digOrders = await getAllDigOrders();
  renderSpecimenForm({
    itemType: 'specimen', category: 'mineral', bucket: 1, condition: 'as-collected',
    status: 'in-collection', uv: { response: 'not-tested', color: '' }, weightUnit: 'oz',
    quantity: 1, acquisition: { method: 'self-collected' }, dimensions: {}
  }, digOrders);
};

window.editSpecimen = async function (id) {
  const sp = await getSpecimen(id);
  if (!sp) return;
  editingSpecimenId = id;
  specimenFormMinerals = (sp.mineralization || []).slice();
  // Resolve photos for display
  specimenFormPhotos = [];
  for (const ref of (sp.photos || [])) {
    const url = await resolveRoutePhoto(ref);
    specimenFormPhotos.push({ ref, dataUrl: url });
  }
  specimenUvPhoto = null;
  if (sp.uv && sp.uv.photoRef) {
    const url = await resolveRoutePhoto(sp.uv.photoRef);
    specimenUvPhoto = { ref: sp.uv.photoRef, dataUrl: url };
  }
  specimenLinkedWaypoint = sp.waypointId ? { id: sp.waypointId, lat: sp.lat, lon: sp.lon, name: sp.waypointName || '' } : null;
  const digOrders = await getAllDigOrders();
  renderSpecimenForm(sp, digOrders);
  const det = document.getElementById('specimen-detail-overlay');
  if (det) det.remove();
};

function renderSpecimenForm(sp, digOrders) {
  digOrders = digOrders || [];
  const existing = document.getElementById('specimen-form-overlay');
  if (existing) existing.remove();

  const ov = document.createElement('div');
  ov.id = 'specimen-form-overlay';
  ov.className = 'catalog-overlay';
  ov.innerHTML = `
    <h2 style="text-align:center;font-size:18px;margin-bottom:10px">${editingSpecimenId ? 'Edit' : 'Add'} Specimen</h2>

    <div class="form-group">
      <label>Item Type</label>
      <select id="sf-itemType">${optionsHtml(ITEM_TYPES, sp.itemType)}</select>
    </div>

    <div class="form-group">
      <label>Collection Site (SOP-1)</label>
      <select id="sf-siteCode" onchange="onSiteCodeChange()">
        <option value="">— Select site —</option>
        ${Object.keys(SITE_CODES).map(c => `<option value="${c}"${c === sp.siteCode ? ' selected' : ''}>${c} — ${catEsc(SITE_CODES[c].label)}</option>`).join('')}
      </select>
    </div>

    <div class="form-group">
      <label>Label / SKU <span id="sf-dup-badge" style="color:#ef5350;font-size:11px"></span></label>
      <div style="display:flex;gap:6px">
        <input type="text" id="sf-label" value="${catEsc(sp.label || '')}" placeholder="BL-25-001" oninput="checkLabelDup()" style="flex:1">
        <button type="button" class="btn" style="width:auto;margin:0;padding:0 14px;background:#455a64;font-size:13px" onclick="regenLabel()">Auto</button>
      </div>
    </div>

    <div class="form-group">
      <label>Access Type</label>
      <select id="sf-accessType"><option value="">—</option>${optionsHtml(CAT_ACCESS_TYPES, sp.accessType)}</select>
    </div>

    <div class="form-group">
      <label>Name</label>
      <input type="text" id="sf-name" value="${catEsc(sp.name || '')}" placeholder="e.g. Amethyst geode half">
    </div>

    <div class="form-group">
      <label>Category</label>
      <select id="sf-category">${optionsHtml(SPECIMEN_CATEGORIES, sp.category)}</select>
    </div>

    <div class="form-group">
      <label>Species / Variety</label>
      <input type="text" id="sf-species" value="${catEsc(sp.speciesVariety || '')}" placeholder="e.g. Purple fluorite">
    </div>

    <div class="form-group">
      <label>Minerals <span style="color:#777;font-weight:normal">— type any name, pick a suggestion or add your own</span></label>
      <div id="sf-mineral-tags" class="mineral-tags"></div>
      <div style="display:flex;gap:6px">
        <input type="text" id="sf-mineral-input" list="mineral-datalist" placeholder="e.g. Rhodochrosite, Wulfenite, Lake Superior agate..." autocomplete="off" onkeydown="onMineralKey(event)" style="flex:1">
        <button type="button" class="btn" style="width:auto;margin:0;padding:0 16px;background:#1565c0;font-size:14px" onclick="addMineralFromInput()">Add</button>
      </div>
      <datalist id="mineral-datalist">${GEO_MINERALS.map(m => `<option value="${catEsc(m.l)}"></option>`).join('')}</datalist>
    </div>

    <div class="form-group">
      <label>Rock Type</label>
      <select id="sf-rockType">${optionsHtml(GEO_ROCK_TYPES, sp.rockType)}</select>
    </div>
    <div class="form-group">
      <label>Alteration</label>
      <select id="sf-alteration">${optionsHtml(GEO_ALTERATION, sp.alteration)}</select>
    </div>
    <div class="form-group">
      <label>Sample Type</label>
      <select id="sf-sampleType">${optionsHtml(GEO_SAMPLE_TYPES, sp.sampleType)}</select>
    </div>

    <div class="form-group">
      <label>Sort Bucket (SOP-2)</label>
      <select id="sf-bucket" onchange="updatePriceHint()">${optionsHtml(BUCKETS, sp.bucket)}</select>
    </div>
    <div class="form-group">
      <label>Condition</label>
      <select id="sf-condition">${optionsHtml(CONDITIONS, sp.condition)}</select>
    </div>

    <div class="form-group">
      <label>UV Fluorescence (SOP-2)</label>
      <div style="display:flex;gap:6px">
        <select id="sf-uvResponse" onchange="updatePriceHint()" style="flex:1">${optionsHtml(UV_RESPONSES, (sp.uv || {}).response)}</select>
        <input type="text" id="sf-uvColor" value="${catEsc((sp.uv || {}).color || '')}" placeholder="color e.g. blue-white" style="flex:1">
      </div>
      <div id="sf-uv-photo" style="margin-top:6px"></div>
      <button type="button" class="btn btn-photo" style="margin-top:6px" onclick="addUvPhoto()">Add UV Photo (dark background)</button>
    </div>

    <div class="form-group">
      <label>Dimensions (in) & Weight</label>
      <div style="display:flex;gap:6px">
        <input type="number" step="0.1" id="sf-diml" value="${sp.dimensions ? (sp.dimensions.l || '') : ''}" placeholder="L" style="flex:1">
        <input type="number" step="0.1" id="sf-dimw" value="${sp.dimensions ? (sp.dimensions.w || '') : ''}" placeholder="W" style="flex:1">
        <input type="number" step="0.1" id="sf-dimh" value="${sp.dimensions ? (sp.dimensions.h || '') : ''}" placeholder="H" style="flex:1">
      </div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <input type="number" step="0.1" id="sf-weight" value="${sp.weight || ''}" placeholder="Weight" style="flex:2">
        <select id="sf-weightUnit" style="flex:1">${optionsHtml(WEIGHT_UNITS, sp.weightUnit || 'oz')}</select>
        <input type="number" id="sf-quantity" value="${sp.quantity != null ? sp.quantity : 1}" placeholder="Qty" style="flex:1">
      </div>
    </div>

    <div class="form-group">
      <label>Locality (free text)</label>
      <input type="text" id="sf-locality" value="${catEsc(sp.locality || '')}" placeholder="e.g. North drift, Blanchard">
    </div>

    <div class="form-group">
      <label>Provenance — collected at</label>
      <div id="sf-wp-link" style="font-size:13px;color:#aaa;margin-bottom:6px"></div>
      <button type="button" class="btn btn-secondary" onclick="openWaypointPicker()">Link a Waypoint</button>
    </div>

    <div class="form-group">
      <label>Acquisition</label>
      <div style="display:flex;gap:6px">
        <select id="sf-acqMethod" style="flex:1">${optionsHtml(ACQ_METHODS, (sp.acquisition || {}).method)}</select>
        <input type="date" id="sf-acqDate" value="${(sp.acquisition || {}).date || ''}" style="flex:1">
      </div>
      <input type="number" step="0.01" id="sf-acqCost" value="${(sp.acquisition || {}).cost || ''}" placeholder="Cost basis ($)" style="margin-top:6px">
    </div>

    <div class="form-group">
      <label>Link to Dig Order (optional)</label>
      <select id="sf-digOrderId"><option value="">— None —</option>${digOrders.map(o => `<option value="${catEsc(o.id)}"${o.id === sp.digOrderId ? ' selected' : ''}>${catEsc(o.client || 'Order')} — ${catEsc(vocabLabel(DIGORDER_STATUSES, o.status))}</option>`).join('')}</select>
    </div>

    <hr style="border-color:#333;margin:14px 0">
    <div class="form-group">
      <label>Status</label>
      <select id="sf-status" onchange="onStatusChange()">${optionsHtml(SPECIMEN_STATUSES, sp.status)}</select>
    </div>
    <div class="form-group">
      <label>Asking Price ($) <span id="sf-price-hint" style="color:#81c784;font-size:11px"></span></label>
      <input type="number" step="0.01" id="sf-price" value="${sp.price || ''}" placeholder="0.00">
    </div>
    <div class="form-group">
      <label>Platform</label>
      <select id="sf-platform">${optionsHtml(PLATFORMS, sp.platform)}</select>
    </div>
    <div class="form-group">
      <label>Listing URL</label>
      <input type="text" id="sf-listingUrl" value="${catEsc(sp.listingUrl || '')}" placeholder="https://...">
    </div>
    <div id="sf-sold-fields" style="display:none">
      <div class="form-group">
        <label>Sold Price ($)</label>
        <input type="number" step="0.01" id="sf-soldPrice" value="${sp.soldPrice || ''}">
      </div>
      <div class="form-group">
        <label>Sold Date</label>
        <input type="date" id="sf-soldDate" value="${sp.soldDate || ''}">
      </div>
      <div class="form-group">
        <label>Buyer</label>
        <input type="text" id="sf-buyer" value="${catEsc(sp.buyer || '')}">
      </div>
    </div>

    <hr style="border-color:#333;margin:14px 0">
    <div class="form-group">
      <label>Provenance Statement (auto-filled, editable)</label>
      <textarea id="sf-provenance" placeholder="Generated from site + access">${catEsc(sp.provenanceStatement || '')}</textarea>
    </div>
    <div class="form-group">
      <label>Description (what's interesting)</label>
      <textarea id="sf-description" placeholder="Crystal habit, color, rarity...">${catEsc(sp.description || '')}</textarea>
    </div>
    <div class="form-group">
      <label>Tags (comma separated)</label>
      <input type="text" id="sf-tags" value="${catEsc((sp.tags || []).join(', '))}" placeholder="display, blue, rare">
    </div>

    <div class="form-group">
      <label>Photos <span style="color:#777;font-size:11px">(SOP-3: 3 shots min — top-down, 45°, close-up)</span></label>
      <div id="sf-photo-strip" class="photo-preview"></div>
      <button type="button" class="btn btn-photo" onclick="addSpecimenPhoto()">Add Photo</button>
    </div>

    <button class="btn btn-save" onclick="saveSpecimenForm()">Save Specimen</button>
    <button class="btn btn-cancel" onclick="closeSpecimenForm()">Cancel</button>
  `;
  document.body.appendChild(ov);

  renderSpecimenPhotoStrip();
  renderUvPhoto();
  renderMineralTags();
  renderWpLinkLabel();
  updatePriceHint();
  onStatusChange();
  checkLabelDup();
}

window.closeSpecimenForm = function () {
  const ov = document.getElementById('specimen-form-overlay');
  if (ov) ov.remove();
  specimenFormPhotos = []; specimenUvPhoto = null; specimenFormMinerals = []; specimenLinkedWaypoint = null;
};

window.onSiteCodeChange = function () {
  const code = document.getElementById('sf-siteCode').value;
  const site = SITE_CODES[code];
  if (!site) return;
  // Default access type
  if (site.accessType) document.getElementById('sf-accessType').value = site.accessType;
  // Auto-generate label if empty
  const labelEl = document.getElementById('sf-label');
  if (code && code !== 'XX' && !labelEl.value.trim()) {
    nextSpecimenLabel(code).then(l => { labelEl.value = l; checkLabelDup(); });
  }
  // Auto-fill provenance if empty
  const prov = document.getElementById('sf-provenance');
  if (prov && !prov.value.trim()) prov.value = generateProvenance(collectSpecimenDraft());
};

window.regenLabel = function () {
  let code = document.getElementById('sf-siteCode').value;
  if (!code) { alert('Pick a collection site first.'); return; }
  if (code === 'XX') {
    const custom = (prompt('Enter a short site code (e.g. AZ, UT):') || '').trim().toUpperCase();
    if (!custom) return;
    code = custom;
  }
  nextSpecimenLabel(code).then(l => { document.getElementById('sf-label').value = l; checkLabelDup(); });
};

window.checkLabelDup = async function () {
  const label = document.getElementById('sf-label')?.value.trim();
  const badge = document.getElementById('sf-dup-badge');
  if (!badge) return;
  if (label && await isDuplicateLabel(label, editingSpecimenId)) badge.textContent = '⚠ duplicate SKU';
  else badge.textContent = '';
};

// Resolve typed text to a canonical vocab value if it matches a known mineral
// (by label or value, case-insensitive); otherwise keep the free text verbatim.
function canonicalMineral(q) {
  const t = (q || '').trim();
  if (!t) return null;
  const found = GEO_MINERALS.find(m => m.l.toLowerCase() === t.toLowerCase() || m.v.toLowerCase() === t.toLowerCase());
  return found ? found.v : t;
}
window.onMineralKey = function (e) {
  if (e.key === 'Enter') { e.preventDefault(); addMineralFromInput(); }
};
window.addMineralFromInput = function () {
  const inp = document.getElementById('sf-mineral-input');
  if (!inp) return;
  const v = canonicalMineral(inp.value);
  if (v && !specimenFormMinerals.some(x => String(x).toLowerCase() === String(v).toLowerCase())) {
    specimenFormMinerals.push(v);
  }
  inp.value = '';
  renderMineralTags();
  inp.focus();
};
window.removeMineralTag = function (i) {
  specimenFormMinerals.splice(i, 1);
  renderMineralTags();
};
function renderMineralTags() {
  const el = document.getElementById('sf-mineral-tags');
  if (!el) return;
  if (!specimenFormMinerals.length) {
    el.innerHTML = '<span style="color:#666;font-size:12px">No minerals added yet.</span>';
    return;
  }
  el.innerHTML = specimenFormMinerals.map((v, i) =>
    `<span class="mineral-tag">${catEsc(vocabLabel(GEO_MINERALS, v))}<button type="button" onclick="removeMineralTag(${i})" aria-label="remove">×</button></span>`
  ).join('');
}

window.onStatusChange = function () {
  const status = document.getElementById('sf-status')?.value;
  const sold = document.getElementById('sf-sold-fields');
  if (sold) sold.style.display = status === 'sold' ? 'block' : 'none';
};

window.updatePriceHint = function () {
  const hint = document.getElementById('sf-price-hint');
  if (!hint) return;
  hint.textContent = suggestPrice(collectSpecimenDraft());
};

// Photos
window.addSpecimenPhoto = function () {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', async (e) => {
    for (const file of e.target.files) {
      const dataUrl = await resizePhoto(file);
      specimenFormPhotos.push({ ref: null, dataUrl });
    }
    renderSpecimenPhotoStrip();
    input.remove();
  });
  input.click();
};

window.removeSpecimenPhoto = function (i) {
  specimenFormPhotos.splice(i, 1);
  renderSpecimenPhotoStrip();
};

function renderSpecimenPhotoStrip() {
  const strip = document.getElementById('sf-photo-strip');
  if (!strip) return;
  strip.innerHTML = specimenFormPhotos.map((p, i) =>
    `<div style="position:relative"><img src="${p.dataUrl}" style="width:70px;height:70px;object-fit:cover;border-radius:6px;border:1px solid #444"><button onclick="removeSpecimenPhoto(${i})" style="position:absolute;top:0;right:0;background:red;color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer">X</button></div>`
  ).join('');
}

window.addUvPhoto = function () {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', async (e) => {
    if (e.target.files[0]) {
      const dataUrl = await resizePhoto(e.target.files[0]);
      specimenUvPhoto = { ref: null, dataUrl };
      renderUvPhoto();
    }
    input.remove();
  });
  input.click();
};

window.removeUvPhoto = function () { specimenUvPhoto = null; renderUvPhoto(); };

function renderUvPhoto() {
  const el = document.getElementById('sf-uv-photo');
  if (!el) return;
  el.innerHTML = specimenUvPhoto
    ? `<div style="position:relative;display:inline-block"><img src="${specimenUvPhoto.dataUrl}" style="width:70px;height:70px;object-fit:cover;border-radius:6px;border:1px solid #444"><button onclick="removeUvPhoto()" style="position:absolute;top:0;right:0;background:red;color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer">X</button></div>`
    : '';
}

function renderWpLinkLabel() {
  const el = document.getElementById('sf-wp-link');
  if (!el) return;
  if (specimenLinkedWaypoint) {
    el.innerHTML = `Linked: <b>${catEsc(specimenLinkedWaypoint.name || 'waypoint')}</b> (${(specimenLinkedWaypoint.lat || 0).toFixed(5)}, ${(specimenLinkedWaypoint.lon || 0).toFixed(5)}) <button onclick="unlinkWaypoint()" style="background:none;border:none;color:#ef5350;cursor:pointer">remove</button>`;
  } else {
    el.textContent = 'Not linked.';
  }
}

window.unlinkWaypoint = function () { specimenLinkedWaypoint = null; renderWpLinkLabel(); };

// Waypoint picker (snapshot provenance — SOP-1)
window.openWaypointPicker = async function () {
  const wps = (await getAllWaypoints()).sort((a, b) => (b.id || 0) - (a.id || 0));
  const ov = document.createElement('div');
  ov.id = 'wp-picker-overlay';
  ov.className = 'catalog-overlay';
  ov.style.zIndex = '9000';
  ov.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h2 style="font-size:17px">Link Waypoint</h2>
      <button class="btn" style="width:auto;margin:0;padding:6px 14px;background:#555" onclick="document.getElementById('wp-picker-overlay').remove()">Close</button>
    </div>
    <input type="text" id="wp-picker-search" placeholder="Search waypoints..." style="width:100%;padding:10px;border:1px solid #444;border-radius:6px;background:#222;color:#fff;margin-bottom:8px" oninput="filterWpPicker()">
    <div id="wp-picker-list"></div>
  `;
  document.body.appendChild(ov);
  window._wpPickerAll = wps;
  renderWpPicker(wps);
};

function renderWpPicker(wps) {
  const list = document.getElementById('wp-picker-list');
  if (!list) return;
  if (wps.length === 0) { list.innerHTML = '<div style="color:#777;padding:16px;text-align:center">No waypoints found.</div>'; return; }
  list.innerHTML = '';
  wps.slice(0, 100).forEach(wp => {
    const div = document.createElement('div');
    div.className = 'recent-item';
    div.style.cursor = 'pointer';
    div.innerHTML = `<div class="recent-info"><div class="recent-name">${catEsc(wp.name || 'WP')}</div><div class="recent-detail">${(wp.lat || 0).toFixed(5)}, ${(wp.lon || 0).toFixed(5)} · ${catEsc(wp.category || '')}</div></div>`;
    div.addEventListener('click', () => linkWaypoint(wp.id));
    list.appendChild(div);
  });
}

window.filterWpPicker = function () {
  const q = (document.getElementById('wp-picker-search').value || '').trim().toLowerCase();
  const all = window._wpPickerAll || [];
  renderWpPicker(q ? all.filter(wp => (wp.name || '').toLowerCase().includes(q) || (wp.notes || '').toLowerCase().includes(q) || (wp.category || '').toLowerCase().includes(q)) : all);
};

window.linkWaypoint = async function (wpId) {
  const wp = await getWaypoint(wpId);
  if (!wp) return;
  specimenLinkedWaypoint = { id: wp.id, lat: wp.lat, lon: wp.lon, name: wp.name || '' };
  renderWpLinkLabel();
  // Inherit geology vocab from the waypoint's first sample (snapshot)
  if (wp.samples && wp.samples[0]) {
    const s = wp.samples[0];
    if (s.rockType) { const el = document.getElementById('sf-rockType'); if (el) el.value = s.rockType; }
    if (s.alteration) { const el = document.getElementById('sf-alteration'); if (el) el.value = s.alteration; }
    if (s.type) { const el = document.getElementById('sf-sampleType'); if (el) el.value = s.type; }
    if (s.mineralization && !specimenFormMinerals.includes(s.mineralization)) {
      specimenFormMinerals.push(s.mineralization);
      renderMineralTags();
    }
  }
  // Pre-fill locality from waypoint name if empty
  const loc = document.getElementById('sf-locality');
  if (loc && !loc.value.trim()) loc.value = wp.name || '';
  const picker = document.getElementById('wp-picker-overlay');
  if (picker) picker.remove();
};

// Gather a draft object from the form (for live hints / provenance gen)
function collectSpecimenDraft() {
  const g = id => document.getElementById(id);
  return {
    itemType: g('sf-itemType')?.value,
    siteCode: g('sf-siteCode')?.value,
    accessType: g('sf-accessType')?.value,
    name: g('sf-name')?.value,
    speciesVariety: g('sf-species')?.value,
    locality: g('sf-locality')?.value,
    mineralization: specimenFormMinerals.slice(),
    bucket: g('sf-bucket') ? Number(g('sf-bucket').value) : 1,
    condition: g('sf-condition')?.value,
    weight: g('sf-weight')?.value ? Number(g('sf-weight').value) : null,
    weightUnit: g('sf-weightUnit')?.value,
    dimensions: {
      l: g('sf-diml')?.value ? Number(g('sf-diml').value) : null,
      w: g('sf-dimw')?.value ? Number(g('sf-dimw').value) : null,
      h: g('sf-dimh')?.value ? Number(g('sf-dimh').value) : null
    },
    uv: { response: g('sf-uvResponse')?.value, color: g('sf-uvColor')?.value },
    description: g('sf-description')?.value,
    provenanceStatement: g('sf-provenance')?.value
  };
}

window.saveSpecimenForm = async function () {
  const g = id => document.getElementById(id);
  const id = editingSpecimenId || newId('sp');

  // Persist new photos to IndexedDB; keep existing refs.
  const photoRefs = [];
  for (const p of specimenFormPhotos) {
    if (p.ref) { photoRefs.push(p.ref); }
    else {
      const ref = `sp_${id}_${photoRefs.length}_${Date.now()}${Math.floor(Math.random() * 1000)}`;
      await saveCatalogPhoto(ref, p.dataUrl);
      photoRefs.push(ref);
    }
  }
  let uvRef = null;
  if (specimenUvPhoto) {
    if (specimenUvPhoto.ref) uvRef = specimenUvPhoto.ref;
    else { uvRef = `sp_${id}_uv_${Date.now()}`; await saveCatalogPhoto(uvRef, specimenUvPhoto.dataUrl); }
  }

  const prev = editingSpecimenId ? await getSpecimen(editingSpecimenId) : {};

  const sp = {
    ...prev,
    id,
    label: g('sf-label').value.trim(),
    itemType: g('sf-itemType').value,
    siteCode: g('sf-siteCode').value,
    accessType: g('sf-accessType').value,
    name: g('sf-name').value.trim(),
    category: g('sf-category').value,
    speciesVariety: g('sf-species').value.trim(),
    mineralization: specimenFormMinerals.slice(),
    rockType: g('sf-rockType').value,
    alteration: g('sf-alteration').value,
    sampleType: g('sf-sampleType').value,
    bucket: Number(g('sf-bucket').value),
    condition: g('sf-condition').value,
    uv: { response: g('sf-uvResponse').value, color: g('sf-uvColor').value.trim(), photoRef: uvRef },
    dimensions: {
      l: g('sf-diml').value ? Number(g('sf-diml').value) : null,
      w: g('sf-dimw').value ? Number(g('sf-dimw').value) : null,
      h: g('sf-dimh').value ? Number(g('sf-dimh').value) : null
    },
    weight: g('sf-weight').value ? Number(g('sf-weight').value) : null,
    weightUnit: g('sf-weightUnit').value,
    quantity: g('sf-quantity').value ? Number(g('sf-quantity').value) : 1,
    locality: g('sf-locality').value.trim(),
    waypointId: specimenLinkedWaypoint ? specimenLinkedWaypoint.id : null,
    waypointName: specimenLinkedWaypoint ? specimenLinkedWaypoint.name : null,
    lat: specimenLinkedWaypoint ? specimenLinkedWaypoint.lat : null,
    lon: specimenLinkedWaypoint ? specimenLinkedWaypoint.lon : null,
    acquisition: {
      method: g('sf-acqMethod').value,
      date: g('sf-acqDate').value || null,
      cost: g('sf-acqCost').value ? Number(g('sf-acqCost').value) : null
    },
    digOrderId: g('sf-digOrderId').value || null,
    status: g('sf-status').value,
    price: g('sf-price').value ? Number(g('sf-price').value) : null,
    platform: g('sf-platform').value,
    listingUrl: g('sf-listingUrl').value.trim(),
    soldPrice: g('sf-soldPrice') && g('sf-soldPrice').value ? Number(g('sf-soldPrice').value) : null,
    soldDate: g('sf-soldDate') ? (g('sf-soldDate').value || null) : null,
    buyer: g('sf-buyer') ? g('sf-buyer').value.trim() : null,
    provenanceStatement: g('sf-provenance').value.trim(),
    description: g('sf-description').value.trim(),
    tags: g('sf-tags').value.split(',').map(t => t.trim()).filter(Boolean),
    photos: photoRefs,
    synced: false,
    updatedAt: Date.now()
  };

  if (!sp.name && !sp.label) { alert('Give the specimen a label or a name.'); return; }

  await saveSpecimen(sp);
  closeSpecimenForm();
  if (navigator.vibrate) navigator.vibrate(80);
  refreshSpecimenList();
};

// =====================================================================
// SPECIMENS — detail
// =====================================================================
async function showSpecimenDetail(id) {
  const sp = await getSpecimen(id);
  if (!sp) return;

  const photoUrls = [];
  for (const ref of (sp.photos || [])) photoUrls.push(await resolveRoutePhoto(ref));
  const uvUrl = sp.uv && sp.uv.photoRef ? await resolveRoutePhoto(sp.uv.photoRef) : null;

  let photoHtml = '';
  if (photoUrls.length) {
    photoHtml = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">' +
      photoUrls.map(u => `<img src="${u}" style="width:90px;height:90px;object-fit:cover;border-radius:6px;border:1px solid #444">`).join('') + '</div>';
  }
  const uvHtml = uvUrl ? `<div style="margin:8px 0"><div style="font-size:12px;color:#aaa">UV photo</div><img src="${uvUrl}" style="width:120px;border-radius:6px;border:1px solid #444"></div>` : '';

  const minerals = mineralLabels(sp).join(', ');
  const dims = sp.dimensions && (sp.dimensions.l || sp.dimensions.w || sp.dimensions.h)
    ? `${[sp.dimensions.l, sp.dimensions.w, sp.dimensions.h].filter(Boolean).join(' × ')} in` : '';

  const row = (label, val) => val ? `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #2a2a2a;font-size:13px"><span style="color:#888">${label}</span><span style="text-align:right;max-width:60%">${catEsc(val)}</span></div>` : '';

  const ov = document.createElement('div');
  ov.id = 'specimen-detail-overlay';
  ov.className = 'catalog-overlay';
  ov.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h2 style="font-size:18px">${catEsc(sp.label || sp.name || 'Specimen')}</h2>
      <button class="btn" style="width:auto;margin:0;padding:8px 14px;background:#555" onclick="document.getElementById('specimen-detail-overlay').remove()">Back</button>
    </div>
    ${sp.name ? `<div style="font-size:15px;margin-bottom:4px">${catEsc(sp.name)}</div>` : ''}
    <div style="font-size:12px;color:${sp.synced ? '#4caf50' : '#e65100'};margin-bottom:8px">${sp.synced ? 'Synced' : 'Not synced'}</div>
    ${photoHtml}
    ${uvHtml}
    <div style="margin:10px 0">
      ${row('Item type', vocabLabel(ITEM_TYPES, sp.itemType))}
      ${row('Category', vocabLabel(SPECIMEN_CATEGORIES, sp.category))}
      ${row('Species/variety', sp.speciesVariety)}
      ${row('Minerals', minerals)}
      ${row('Site', sp.siteCode ? `${sp.siteCode} — ${(SITE_CODES[sp.siteCode] || {}).label || ''}` : '')}
      ${row('Access', vocabLabel(CAT_ACCESS_TYPES, sp.accessType))}
      ${row('Locality', sp.locality)}
      ${row('Bucket', sp.bucket != null ? vocabLabel(BUCKETS, sp.bucket) : '')}
      ${row('Condition', vocabLabel(CONDITIONS, sp.condition))}
      ${row('UV', uvListingText(sp))}
      ${row('Dimensions', dims)}
      ${row('Weight', sp.weight ? `${sp.weight} ${sp.weightUnit || 'oz'}` : '')}
      ${row('Quantity', sp.quantity)}
      ${row('Collected at', sp.waypointName || (sp.lat ? `${sp.lat.toFixed(5)}, ${sp.lon.toFixed(5)}` : ''))}
      ${row('Acquisition', sp.acquisition ? [vocabLabel(ACQ_METHODS, sp.acquisition.method), sp.acquisition.date, sp.acquisition.cost ? '$' + sp.acquisition.cost : ''].filter(Boolean).join(' · ') : '')}
      ${row('Status', vocabLabel(SPECIMEN_STATUSES, sp.status))}
      ${row('Price', sp.price ? '$' + sp.price : '')}
      ${row('Platform', sp.platform && sp.platform !== 'none' ? vocabLabel(PLATFORMS, sp.platform) : '')}
      ${row('Sold', sp.soldPrice ? `$${sp.soldPrice}${sp.soldDate ? ' on ' + sp.soldDate : ''}${sp.buyer ? ' to ' + sp.buyer : ''}` : '')}
      ${row('Tags', (sp.tags || []).join(', '))}
    </div>
    ${sp.provenanceStatement ? `<div style="margin:8px 0;padding:8px;background:#222;border-radius:6px;font-size:13px;font-style:italic">${catEsc(sp.provenanceStatement)}</div>` : ''}
    ${sp.description ? `<div style="margin:8px 0;padding:8px;background:#222;border-radius:6px;font-size:13px">${catEsc(sp.description)}</div>` : ''}

    <button class="btn" style="background:#1565c0" onclick="generateListingUI('${sp.id}')">Generate Listing</button>
    <div id="listing-output" style="display:none;margin-bottom:8px"></div>

    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-photo" style="flex:1" onclick="editSpecimen('${sp.id}')">Edit</button>
      <button class="btn" style="flex:1;background:#d32f2f" onclick="deleteSpecimenUI('${sp.id}')">Delete</button>
    </div>
  `;
  document.body.appendChild(ov);
}
window.showSpecimenDetail = showSpecimenDetail;

window.generateListingUI = async function (id) {
  const sp = await getSpecimen(id);
  if (!sp) return;
  const { title, body } = generateListing(sp);
  const out = document.getElementById('listing-output');
  if (!out) return;
  out.style.display = 'block';
  out.innerHTML = `
    <div style="font-size:12px;color:#81c784;margin:6px 0 2px">Suggested platform: <b>${vocabLabel(PLATFORMS, suggestPlatform(sp))}</b> · Price: ${catEsc(suggestPrice(sp))}</div>
    <label style="font-size:12px;color:#aaa">Title</label>
    <textarea id="listing-title" style="width:100%;height:48px;background:#222;color:#fff;border:1px solid #444;border-radius:6px;padding:6px;font-size:13px">${catEsc(title)}</textarea>
    <label style="font-size:12px;color:#aaa">Body</label>
    <textarea id="listing-body" style="width:100%;height:180px;background:#222;color:#fff;border:1px solid #444;border-radius:6px;padding:6px;font-size:13px">${catEsc(body)}</textarea>
    <button class="btn btn-secondary" onclick="copyListing()">Copy Title + Body</button>
  `;
};

window.copyListing = function () {
  const t = document.getElementById('listing-title')?.value || '';
  const b = document.getElementById('listing-body')?.value || '';
  const text = t + '\n\n' + b;
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => alert('Listing copied to clipboard.'));
  else { const ta = document.getElementById('listing-body'); ta.select(); document.execCommand('copy'); alert('Listing copied.'); }
};

window.deleteSpecimenUI = async function (id) {
  if (!confirm('Delete this specimen and its photos?')) return;
  await deleteSpecimen(id);
  const ov = document.getElementById('specimen-detail-overlay');
  if (ov) ov.remove();
  refreshSpecimenList();
};

// =====================================================================
// DIG ORDERS — list
// =====================================================================
async function refreshDigOrderList() {
  const list = document.getElementById('digorder-list');
  if (!list) return;
  const all = (await getAllDigOrders()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const countBar = document.getElementById('digorder-count-bar');
  if (countBar) {
    const unsynced = all.filter(o => !o.synced).length;
    countBar.textContent = `${all.length} order${all.length !== 1 ? 's' : ''} · ${unsynced === 0 ? 'all synced' : unsynced + ' unsynced'}`;
  }

  const q = (document.getElementById('digorder-search')?.value || '').trim().toLowerCase();
  let rows = all;
  if (q) rows = all.filter(o =>
    (o.client || '').toLowerCase().includes(q) ||
    (o.materialRequested || '').toLowerCase().includes(q) ||
    (o.region || '').toLowerCase().includes(q));

  list.innerHTML = '';
  if (rows.length === 0) {
    list.innerHTML = '<div style="color:#777;text-align:center;padding:20px;font-size:13px">No dig orders yet. Tap "+ New Dig Order".</div>';
    return;
  }
  rows.forEach(o => {
    const syncBadge = o.synced ? '<span class="recent-badge synced">synced</span>' : '<span class="recent-badge">unsynced</span>';
    const depBadge = o.depositPaid ? '<span class="recent-badge synced">deposit</span>' : '';
    const div = document.createElement('div');
    div.className = 'recent-item';
    div.style.cursor = 'pointer';
    div.innerHTML = `
      <div class="recent-info">
        <div class="recent-name">${catEsc(o.client || 'Dig order')} ${syncBadge} ${depBadge}</div>
        <div class="recent-detail">${catEsc(o.materialRequested || '')}${o.region ? ' · ' + catEsc(o.region) : ''}</div>
        <div class="recent-detail">${catEsc(vocabLabel(DIGORDER_STATUSES, o.status))} · ${catEsc(vocabLabel(RATE_TIERS, o.rateTier))}</div>
      </div>`;
    div.addEventListener('click', () => showDigOrderDetail(o.id));
    list.appendChild(div);
  });
}
window.refreshDigOrderList = refreshDigOrderList;

// =====================================================================
// DIG ORDERS — create / edit
// =====================================================================
let digOrderFormPhotos = [];
let editingDigOrderId = null;

window.openDigOrderForm = function () {
  editingDigOrderId = null;
  digOrderFormPhotos = [];
  renderDigOrderForm({ status: 'inquiry', rateTier: 'standard-75', dayRate: 75, estDays: 1, depositMethod: 'etsy' });
};

window.editDigOrder = async function (id) {
  const o = await getDigOrder(id);
  if (!o) return;
  editingDigOrderId = id;
  digOrderFormPhotos = [];
  for (const ref of (o.photos || [])) digOrderFormPhotos.push({ ref, dataUrl: await resolveRoutePhoto(ref) });
  renderDigOrderForm(o);
  const det = document.getElementById('digorder-detail-overlay');
  if (det) det.remove();
};

function renderDigOrderForm(o) {
  const existing = document.getElementById('digorder-form-overlay');
  if (existing) existing.remove();
  const ov = document.createElement('div');
  ov.id = 'digorder-form-overlay';
  ov.className = 'catalog-overlay';
  ov.innerHTML = `
    <h2 style="text-align:center;font-size:18px;margin-bottom:10px">${editingDigOrderId ? 'Edit' : 'New'} Dig Order</h2>
    <div class="form-group"><label>Client</label><input type="text" id="do-client" value="${catEsc(o.client || '')}" placeholder="Name / handle"></div>
    <div class="form-group"><label>Contact</label><input type="text" id="do-contact" value="${catEsc(o.contact || '')}" placeholder="Email / phone / DM"></div>
    <div class="form-group"><label>Material Requested</label><input type="text" id="do-material" value="${catEsc(o.materialRequested || '')}" placeholder="e.g. blue fluorite with galena"></div>
    <div class="form-group">
      <label>Region / Site</label>
      <select id="do-region">
        <option value="">— Any —</option>
        ${Object.keys(SITE_CODES).map(c => `<option value="${c}"${c === o.region ? ' selected' : ''}>${c} — ${catEsc(SITE_CODES[c].label)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Quality Target</label><input type="text" id="do-quality" value="${catEsc(o.qualityTarget || '')}" placeholder="display-grade, crystal faces..."></div>
    <div class="form-group"><label>Budget</label><input type="text" id="do-budget" value="${catEsc(o.budget || '')}" placeholder="$"></div>
    <div class="form-group"><label>Timeline</label><input type="text" id="do-timeline" value="${catEsc(o.timeline || '')}" placeholder="e.g. before August"></div>

    <hr style="border-color:#333;margin:14px 0">
    <div class="form-group">
      <label>Rate Tier (SOP-5)</label>
      <select id="do-rateTier" onchange="onRateTierChange()">${optionsHtml(RATE_TIERS, o.rateTier)}</select>
    </div>
    <div class="form-group">
      <label>Day Rate ($) & Estimated Days</label>
      <div style="display:flex;gap:6px">
        <input type="number" id="do-dayRate" value="${o.dayRate || ''}" placeholder="Day rate" style="flex:1" oninput="updateDepositHint()">
        <input type="number" id="do-estDays" value="${o.estDays || 1}" placeholder="Days" style="flex:1" oninput="updateDepositHint()">
      </div>
    </div>
    <div class="form-group">
      <label>Fuel Deposit ($) <span id="do-deposit-hint" style="color:#81c784;font-size:11px"></span></label>
      <input type="number" id="do-depositAmount" value="${o.depositAmount || ''}" placeholder="50% of day rate">
    </div>
    <div class="form-group">
      <label>Deposit Method</label>
      <select id="do-depositMethod">${optionsHtml(DEPOSIT_METHODS, o.depositMethod)}</select>
    </div>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="do-depositPaid" ${o.depositPaid ? 'checked' : ''} style="width:auto"> Deposit paid</label>
    </div>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="do-balancePaid" ${o.balancePaid ? 'checked' : ''} style="width:auto"> Balance paid</label>
    </div>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="do-termsAccepted" ${o.termsAccepted ? 'checked' : ''} style="width:auto"> Terms accepted (in writing)</label>
    </div>

    <div class="form-group">
      <label>Status</label>
      <select id="do-status">${optionsHtml(DIGORDER_STATUSES, o.status)}</select>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="do-notes" placeholder="Written terms, no-yield-guarantee, etc.">${catEsc(o.notes || '')}</textarea></div>

    <div class="form-group">
      <label>Preview / Field Photos</label>
      <div id="do-photo-strip" class="photo-preview"></div>
      <button type="button" class="btn btn-photo" onclick="addDigOrderPhoto()">Add Photo</button>
    </div>

    <button class="btn btn-save" onclick="saveDigOrderForm()">Save Dig Order</button>
    <button class="btn btn-cancel" onclick="closeDigOrderForm()">Cancel</button>
  `;
  document.body.appendChild(ov);
  renderDigOrderPhotoStrip();
  updateDepositHint();
}

window.closeDigOrderForm = function () {
  const ov = document.getElementById('digorder-form-overlay');
  if (ov) ov.remove();
  digOrderFormPhotos = [];
};

window.onRateTierChange = function () {
  const tier = RATE_TIERS.find(t => t.v === document.getElementById('do-rateTier').value);
  if (tier && tier.dayRate) {
    const dr = document.getElementById('do-dayRate');
    if (dr && !dr.value) dr.value = tier.dayRate;
    updateDepositHint();
  }
};

window.updateDepositHint = function () {
  const dayRate = Number(document.getElementById('do-dayRate')?.value || 0);
  const hint = document.getElementById('do-deposit-hint');
  if (hint) hint.textContent = dayRate ? `suggested 50% = $${Math.round(dayRate * 0.5)}` : '';
};

window.addDigOrderPhoto = function () {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', async (e) => {
    for (const file of e.target.files) digOrderFormPhotos.push({ ref: null, dataUrl: await resizePhoto(file) });
    renderDigOrderPhotoStrip();
    input.remove();
  });
  input.click();
};

window.removeDigOrderPhoto = function (i) { digOrderFormPhotos.splice(i, 1); renderDigOrderPhotoStrip(); };

function renderDigOrderPhotoStrip() {
  const strip = document.getElementById('do-photo-strip');
  if (!strip) return;
  strip.innerHTML = digOrderFormPhotos.map((p, i) =>
    `<div style="position:relative"><img src="${p.dataUrl}" style="width:70px;height:70px;object-fit:cover;border-radius:6px;border:1px solid #444"><button onclick="removeDigOrderPhoto(${i})" style="position:absolute;top:0;right:0;background:red;color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer">X</button></div>`
  ).join('');
}

window.saveDigOrderForm = async function () {
  const g = id => document.getElementById(id);
  const id = editingDigOrderId || newId('do');

  const photoRefs = [];
  for (const p of digOrderFormPhotos) {
    if (p.ref) photoRefs.push(p.ref);
    else { const ref = `do_${id}_${photoRefs.length}_${Date.now()}${Math.floor(Math.random() * 1000)}`; await saveCatalogPhoto(ref, p.dataUrl); photoRefs.push(ref); }
  }

  const prev = editingDigOrderId ? await getDigOrder(editingDigOrderId) : {};
  const order = {
    ...prev, id,
    client: g('do-client').value.trim(),
    contact: g('do-contact').value.trim(),
    materialRequested: g('do-material').value.trim(),
    region: g('do-region').value,
    qualityTarget: g('do-quality').value.trim(),
    budget: g('do-budget').value.trim(),
    timeline: g('do-timeline').value.trim(),
    rateTier: g('do-rateTier').value,
    dayRate: g('do-dayRate').value ? Number(g('do-dayRate').value) : null,
    estDays: g('do-estDays').value ? Number(g('do-estDays').value) : null,
    depositAmount: g('do-depositAmount').value ? Number(g('do-depositAmount').value) : null,
    depositMethod: g('do-depositMethod').value,
    depositPaid: g('do-depositPaid').checked,
    balancePaid: g('do-balancePaid').checked,
    termsAccepted: g('do-termsAccepted').checked,
    status: g('do-status').value,
    notes: g('do-notes').value.trim(),
    photos: photoRefs,
    synced: false,
    updatedAt: Date.now()
  };
  if (!order.client && !order.materialRequested) { alert('Add a client or material.'); return; }
  await saveDigOrder(order);
  closeDigOrderForm();
  if (navigator.vibrate) navigator.vibrate(80);
  refreshDigOrderList();
};

// =====================================================================
// DIG ORDERS — detail
// =====================================================================
async function showDigOrderDetail(id) {
  const o = await getDigOrder(id);
  if (!o) return;
  const linked = (await getAllSpecimens()).filter(s => s.digOrderId === id);

  const photoUrls = [];
  for (const ref of (o.photos || [])) photoUrls.push(await resolveRoutePhoto(ref));
  const photoHtml = photoUrls.length
    ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">' + photoUrls.map(u => `<img src="${u}" style="width:90px;height:90px;object-fit:cover;border-radius:6px;border:1px solid #444">`).join('') + '</div>' : '';

  const row = (label, val) => val ? `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #2a2a2a;font-size:13px"><span style="color:#888">${label}</span><span style="text-align:right;max-width:60%">${catEsc(val)}</span></div>` : '';

  const ov = document.createElement('div');
  ov.id = 'digorder-detail-overlay';
  ov.className = 'catalog-overlay';
  ov.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h2 style="font-size:18px">${catEsc(o.client || 'Dig Order')}</h2>
      <button class="btn" style="width:auto;margin:0;padding:8px 14px;background:#555" onclick="document.getElementById('digorder-detail-overlay').remove()">Back</button>
    </div>
    <div style="font-size:12px;color:${o.synced ? '#4caf50' : '#e65100'};margin-bottom:8px">${o.synced ? 'Synced' : 'Not synced'}</div>
    ${photoHtml}
    <div style="margin:10px 0">
      ${row('Contact', o.contact)}
      ${row('Material', o.materialRequested)}
      ${row('Region', o.region ? `${o.region} — ${(SITE_CODES[o.region] || {}).label || ''}` : '')}
      ${row('Quality target', o.qualityTarget)}
      ${row('Budget', o.budget)}
      ${row('Timeline', o.timeline)}
      ${row('Rate tier', vocabLabel(RATE_TIERS, o.rateTier))}
      ${row('Day rate', o.dayRate ? '$' + o.dayRate : '')}
      ${row('Est. days', o.estDays)}
      ${row('Deposit', o.depositAmount ? `$${o.depositAmount} (${vocabLabel(DEPOSIT_METHODS, o.depositMethod)}) ${o.depositPaid ? '✓ paid' : 'unpaid'}` : '')}
      ${row('Balance', o.balancePaid ? '✓ paid' : 'unpaid')}
      ${row('Terms', o.termsAccepted ? '✓ accepted' : 'not accepted')}
      ${row('Status', vocabLabel(DIGORDER_STATUSES, o.status))}
      ${row('Linked specimens', linked.length ? linked.map(s => s.label || s.name).join(', ') : '')}
    </div>
    ${o.notes ? `<div style="margin:8px 0;padding:8px;background:#222;border-radius:6px;font-size:13px">${catEsc(o.notes)}</div>` : ''}
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-photo" style="flex:1" onclick="editDigOrder('${o.id}')">Edit</button>
      <button class="btn" style="flex:1;background:#d32f2f" onclick="deleteDigOrderUI('${o.id}')">Delete</button>
    </div>
  `;
  document.body.appendChild(ov);
}
window.showDigOrderDetail = showDigOrderDetail;

window.deleteDigOrderUI = async function (id) {
  if (!confirm('Delete this dig order?')) return;
  await deleteDigOrder(id);
  const ov = document.getElementById('digorder-detail-overlay');
  if (ov) ov.remove();
  refreshDigOrderList();
};

// =====================================================================
// SALES ORDERS — customer + payment + line items
// =====================================================================
const PAYMENT_METHODS = [
  { v: 'ebay', l: 'eBay' }, { v: 'etsy', l: 'Etsy' }, { v: 'paypal', l: 'PayPal' },
  { v: 'venmo', l: 'Venmo' }, { v: 'zelle', l: 'Zelle' }, { v: 'cash', l: 'Cash' },
  { v: 'card', l: 'Card' }, { v: 'other', l: 'Other' }
];
const PAYMENT_STATUSES = [
  { v: 'unpaid', l: 'Unpaid' }, { v: 'partial', l: 'Partial' }, { v: 'paid', l: 'Paid' }, { v: 'refunded', l: 'Refunded' }
];
const ORDER_STATUSES = [
  { v: 'pending', l: 'Pending' }, { v: 'paid', l: 'Paid' }, { v: 'packed', l: 'Packed' },
  { v: 'shipped', l: 'Shipped' }, { v: 'delivered', l: 'Delivered' }, { v: 'cancelled', l: 'Cancelled' }, { v: 'refunded', l: 'Refunded' }
];
const ORDER_PLATFORMS = [
  { v: 'ebay', l: 'eBay' }, { v: 'etsy', l: 'Etsy' }, { v: 'facebook', l: 'Facebook' },
  { v: 'instagram', l: 'Instagram' }, { v: 'in-person', l: 'In person' }, { v: 'other', l: 'Other' }
];

function catMoney(n) { return '$' + (Number(n) || 0).toFixed(2); }
function orderSubtotal(items) { return (items || []).reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0); }
function orderTotal(o) { return orderSubtotal(o.items) + (Number(o.shipping) || 0) + (Number(o.tax) || 0) - (Number(o.discount) || 0); }

let orderFormItems = [];
let editingOrderId = null;

// --- Orders list ---
async function refreshOrderList() {
  const list = document.getElementById('order-list');
  if (!list) return;
  const all = (await getAllOrders()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const countBar = document.getElementById('order-count-bar');
  if (countBar) {
    const unsynced = all.filter(o => !o.synced).length;
    countBar.textContent = `${all.length} order${all.length !== 1 ? 's' : ''} · ${unsynced === 0 ? 'all synced' : unsynced + ' unsynced'}`;
  }

  const q = (document.getElementById('order-search')?.value || '').trim().toLowerCase();
  let rows = all;
  if (q) rows = all.filter(o =>
    (o.orderNumber || '').toLowerCase().includes(q) ||
    ((o.customer || {}).name || '').toLowerCase().includes(q) ||
    (o.items || []).map(it => it.name).join(' ').toLowerCase().includes(q));

  list.innerHTML = '';
  if (rows.length === 0) {
    list.innerHTML = '<div style="color:#777;text-align:center;padding:20px;font-size:13px">No orders yet. Tap "+ New Order".</div>';
    return;
  }
  const payColors = { unpaid: '#c62828', partial: '#f9a825', paid: '#1b5e20', refunded: '#6a1b9a' };
  rows.forEach(o => {
    const syncBadge = o.synced ? '<span class="recent-badge synced">synced</span>' : '<span class="recent-badge">unsynced</span>';
    const pay = (o.payment || {}).status || 'unpaid';
    const payBadge = `<span class="recent-badge" style="background:${payColors[pay] || '#555'}">${catEsc(vocabLabel(PAYMENT_STATUSES, pay))}</span>`;
    const itemCount = (o.items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    const div = document.createElement('div');
    div.className = 'recent-item';
    div.style.cursor = 'pointer';
    div.innerHTML = `
      <div class="recent-info">
        <div class="recent-name">${catEsc(o.orderNumber || 'Order')} ${syncBadge} ${payBadge}</div>
        <div class="recent-detail">${catEsc((o.customer || {}).name || 'No customer')} · ${itemCount} item${itemCount !== 1 ? 's' : ''} · ${catMoney(orderTotal(o))}</div>
        <div class="recent-detail">${catEsc(vocabLabel(ORDER_STATUSES, o.status))}${o.date ? ' · ' + catEsc(o.date) : ''}</div>
      </div>`;
    div.addEventListener('click', () => showOrderDetail(o.id));
    list.appendChild(div);
  });
}
window.refreshOrderList = refreshOrderList;

// --- Order create / edit ---
window.openOrderForm = async function () {
  editingOrderId = null;
  orderFormItems = [];
  const num = await nextOrderNumber();
  const today = new Date().toISOString().slice(0, 10);
  renderOrderForm({
    orderNumber: num, date: today, customer: {}, items: [], payment: { status: 'unpaid', method: 'ebay' },
    status: 'pending', platform: 'ebay', shipping: 0, tax: 0, discount: 0
  });
};

window.editOrder = async function (id) {
  const o = await getOrder(id);
  if (!o) return;
  editingOrderId = id;
  orderFormItems = (o.items || []).map(it => ({ ...it }));
  renderOrderForm(o);
  const det = document.getElementById('order-detail-overlay');
  if (det) det.remove();
};

function renderOrderForm(o) {
  const existing = document.getElementById('order-form-overlay');
  if (existing) existing.remove();
  const cust = o.customer || {};
  const pay = o.payment || {};
  const ov = document.createElement('div');
  ov.id = 'order-form-overlay';
  ov.className = 'catalog-overlay';
  ov.innerHTML = `
    <h2 style="text-align:center;font-size:18px;margin-bottom:10px">${editingOrderId ? 'Edit' : 'New'} Order</h2>

    <div style="display:flex;gap:6px">
      <div class="form-group" style="flex:1"><label>Order #</label><input type="text" id="ord-number" value="${catEsc(o.orderNumber || '')}"></div>
      <div class="form-group" style="flex:1"><label>Date</label><input type="date" id="ord-date" value="${catEsc(o.date || '')}"></div>
    </div>

    <h3 style="font-size:14px;margin:6px 0;color:#90caf9">Customer</h3>
    <div class="form-group"><label>Name</label><input type="text" id="ord-cust-name" value="${catEsc(cust.name || '')}" placeholder="Buyer name / handle"></div>
    <div style="display:flex;gap:6px">
      <div class="form-group" style="flex:1"><label>Email</label><input type="text" id="ord-cust-email" value="${catEsc(cust.email || '')}"></div>
      <div class="form-group" style="flex:1"><label>Phone</label><input type="text" id="ord-cust-phone" value="${catEsc(cust.phone || '')}"></div>
    </div>
    <div class="form-group"><label>Shipping Address</label><textarea id="ord-cust-address" rows="2">${catEsc(cust.address || '')}</textarea></div>
    <div style="display:flex;gap:6px">
      <div class="form-group" style="flex:1"><label>Platform</label><select id="ord-platform">${optionsHtml(ORDER_PLATFORMS, o.platform)}</select></div>
      <div class="form-group" style="flex:1"><label>Handle / Username</label><input type="text" id="ord-cust-handle" value="${catEsc(cust.handle || '')}"></div>
    </div>

    <h3 style="font-size:14px;margin:6px 0;color:#90caf9">Items</h3>
    <div style="display:flex;gap:6px;font-size:11px;color:#888;padding:0 2px">
      <span style="flex:2">Item</span><span style="flex:1;min-width:46px">Qty</span><span style="flex:1;min-width:56px">Unit $</span><span style="width:26px"></span>
    </div>
    <div id="ord-items"></div>
    <div style="display:flex;gap:6px;margin:6px 0">
      <button type="button" class="btn btn-secondary" style="flex:1;margin:0;font-size:13px" onclick="addOrderItem()">+ Item</button>
      <button type="button" class="btn" style="flex:1;margin:0;font-size:13px;background:#455a64" onclick="openSpecimenPickerForOrder()">+ From Catalog</button>
    </div>
    <div style="text-align:right;font-size:13px;color:#aaa">Subtotal: <span id="ord-subtotal">$0.00</span></div>

    <div style="display:flex;gap:6px;margin-top:6px">
      <div class="form-group" style="flex:1"><label>Shipping $</label><input type="number" step="0.01" id="ord-shipping" value="${o.shipping || ''}" oninput="recomputeOrderTotals()"></div>
      <div class="form-group" style="flex:1"><label>Tax $</label><input type="number" step="0.01" id="ord-tax" value="${o.tax || ''}" oninput="recomputeOrderTotals()"></div>
      <div class="form-group" style="flex:1"><label>Discount $</label><input type="number" step="0.01" id="ord-discount" value="${o.discount || ''}" oninput="recomputeOrderTotals()"></div>
    </div>
    <div style="text-align:right;font-size:16px;font-weight:bold;margin-bottom:8px">Total: <span id="ord-total">$0.00</span></div>

    <h3 style="font-size:14px;margin:6px 0;color:#90caf9">Payment</h3>
    <div style="display:flex;gap:6px">
      <div class="form-group" style="flex:1"><label>Method</label><select id="ord-pay-method">${optionsHtml(PAYMENT_METHODS, pay.method)}</select></div>
      <div class="form-group" style="flex:1"><label>Status</label><select id="ord-pay-status">${optionsHtml(PAYMENT_STATUSES, pay.status)}</select></div>
    </div>
    <div style="display:flex;gap:6px">
      <div class="form-group" style="flex:1"><label>Amount Paid $</label><input type="number" step="0.01" id="ord-pay-amount" value="${pay.amountPaid || ''}"></div>
      <div class="form-group" style="flex:1"><label>Paid Date</label><input type="date" id="ord-pay-date" value="${catEsc(pay.paidDate || '')}"></div>
    </div>
    <div class="form-group"><label>Transaction / Reference ID</label><input type="text" id="ord-pay-txn" value="${catEsc(pay.transactionId || '')}"></div>

    <h3 style="font-size:14px;margin:6px 0;color:#90caf9">Fulfillment</h3>
    <div class="form-group"><label>Status</label><select id="ord-status">${optionsHtml(ORDER_STATUSES, o.status)}</select></div>
    <div style="display:flex;gap:6px">
      <div class="form-group" style="flex:1"><label>Carrier</label><input type="text" id="ord-carrier" value="${catEsc(o.carrier || '')}" placeholder="USPS, UPS..."></div>
      <div class="form-group" style="flex:1"><label>Tracking #</label><input type="text" id="ord-tracking" value="${catEsc(o.trackingNumber || '')}"></div>
    </div>
    <div class="form-group"><label>Shipped Date</label><input type="date" id="ord-shipped-date" value="${catEsc(o.shippedDate || '')}"></div>

    <div class="form-group"><label>Notes</label><textarea id="ord-notes" rows="2">${catEsc(o.notes || '')}</textarea></div>

    <button class="btn btn-save" onclick="saveOrderForm()">Save Order</button>
    <button class="btn btn-cancel" onclick="closeOrderForm()">Cancel</button>
  `;
  document.body.appendChild(ov);
  renderOrderItems();
}

window.closeOrderForm = function () {
  const ov = document.getElementById('order-form-overlay');
  if (ov) ov.remove();
  orderFormItems = [];
};

const ORD_ITEM_INP = 'padding:8px;border:1px solid #444;border-radius:6px;background:#222;color:#fff;font-size:14px';
function renderOrderItems() {
  const el = document.getElementById('ord-items');
  if (!el) return;
  if (!orderFormItems.length) {
    el.innerHTML = '<div style="color:#666;font-size:12px;padding:4px 2px">No items — add from catalog or enter manually.</div>';
  } else {
    el.innerHTML = orderFormItems.map((it, i) => `
      <div style="display:flex;gap:6px;margin-bottom:5px;align-items:center">
        <input type="text" value="${catEsc(it.name || '')}" placeholder="Item name" oninput="updateOrderItem(${i},'name',this.value)" style="${ORD_ITEM_INP};flex:2;min-width:0">
        <input type="number" step="1" min="0" value="${it.quantity != null ? it.quantity : 1}" oninput="updateOrderItem(${i},'quantity',this.value)" style="${ORD_ITEM_INP};flex:1;min-width:46px">
        <input type="number" step="0.01" min="0" value="${it.unitPrice != null ? it.unitPrice : ''}" placeholder="0.00" oninput="updateOrderItem(${i},'unitPrice',this.value)" style="${ORD_ITEM_INP};flex:1;min-width:56px">
        <button type="button" onclick="removeOrderItem(${i})" style="background:#c62828;color:#fff;border:none;border-radius:50%;width:26px;height:26px;flex-shrink:0;cursor:pointer;font-size:15px">×</button>
      </div>`).join('');
  }
  recomputeOrderTotals();
}

window.addOrderItem = function () {
  orderFormItems.push({ name: '', quantity: 1, unitPrice: 0 });
  renderOrderItems();
};
window.removeOrderItem = function (i) {
  orderFormItems.splice(i, 1);
  renderOrderItems();
};
window.updateOrderItem = function (i, field, val) {
  if (!orderFormItems[i]) return;
  orderFormItems[i][field] = (field === 'name') ? val : (Number(val) || 0);
  recomputeOrderTotals(); // no full re-render — keeps input focus
};
window.recomputeOrderTotals = function () {
  const sub = orderSubtotal(orderFormItems);
  const g = id => Number((document.getElementById(id) || {}).value) || 0;
  const total = sub + g('ord-shipping') + g('ord-tax') - g('ord-discount');
  const se = document.getElementById('ord-subtotal'); if (se) se.textContent = catMoney(sub);
  const te = document.getElementById('ord-total'); if (te) te.textContent = catMoney(total);
};

// Pick a specimen from the catalog to add as a line item (autofills name + price + link)
window.openSpecimenPickerForOrder = async function () {
  const specimens = (await getAllSpecimens()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const ov = document.createElement('div');
  ov.id = 'ord-spec-picker';
  ov.className = 'catalog-overlay';
  ov.style.zIndex = '9000';
  ov.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h2 style="font-size:17px">Add from Catalog</h2>
      <button class="btn" style="width:auto;margin:0;padding:6px 14px;background:#555" onclick="document.getElementById('ord-spec-picker').remove()">Close</button>
    </div>
    <input type="text" id="ord-spec-search" placeholder="Search specimens..." style="width:100%;padding:10px;border:1px solid #444;border-radius:6px;background:#222;color:#fff;margin-bottom:8px" oninput="filterOrderSpecPicker()">
    <div id="ord-spec-list"></div>`;
  document.body.appendChild(ov);
  window._ordSpecAll = specimens;
  renderOrderSpecPicker(specimens);
};
function renderOrderSpecPicker(specs) {
  const list = document.getElementById('ord-spec-list');
  if (!list) return;
  if (!specs.length) { list.innerHTML = '<div style="color:#777;padding:16px;text-align:center">No specimens found.</div>'; return; }
  list.innerHTML = '';
  specs.slice(0, 100).forEach(s => {
    const div = document.createElement('div');
    div.className = 'recent-item';
    div.style.cursor = 'pointer';
    div.innerHTML = `<div class="recent-info"><div class="recent-name">${catEsc(s.label || s.name || 'Specimen')}</div><div class="recent-detail">${catEsc(s.name || '')}${s.price ? ' · ' + catMoney(s.price) : ''}</div></div>`;
    div.addEventListener('click', () => addSpecimenToOrder(s.id));
    list.appendChild(div);
  });
}
window.filterOrderSpecPicker = function () {
  const q = (document.getElementById('ord-spec-search').value || '').trim().toLowerCase();
  const all = window._ordSpecAll || [];
  renderOrderSpecPicker(q ? all.filter(s => (s.label || '').toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q) || (s.speciesVariety || '').toLowerCase().includes(q)) : all);
};
window.addSpecimenToOrder = async function (specId) {
  const s = await getSpecimen(specId);
  if (!s) return;
  orderFormItems.push({
    specimenId: s.id,
    name: s.label ? `${s.label} ${s.name || ''}`.trim() : (s.name || 'Specimen'),
    quantity: 1,
    unitPrice: Number(s.price) || 0
  });
  const picker = document.getElementById('ord-spec-picker');
  if (picker) picker.remove();
  renderOrderItems();
};

window.saveOrderForm = async function () {
  const g = id => document.getElementById(id);
  const id = editingOrderId || newId('ord');
  const prev = editingOrderId ? await getOrder(editingOrderId) : {};
  const order = {
    ...prev, id,
    orderNumber: g('ord-number').value.trim(),
    date: g('ord-date').value || null,
    customer: {
      name: g('ord-cust-name').value.trim(),
      email: g('ord-cust-email').value.trim(),
      phone: g('ord-cust-phone').value.trim(),
      address: g('ord-cust-address').value.trim(),
      handle: g('ord-cust-handle').value.trim()
    },
    platform: g('ord-platform').value,
    items: orderFormItems
      .map(it => ({ specimenId: it.specimenId || null, name: (it.name || '').trim(), quantity: Number(it.quantity) || 0, unitPrice: Number(it.unitPrice) || 0 }))
      .filter(it => it.name || it.quantity || it.unitPrice),
    shipping: g('ord-shipping').value ? Number(g('ord-shipping').value) : 0,
    tax: g('ord-tax').value ? Number(g('ord-tax').value) : 0,
    discount: g('ord-discount').value ? Number(g('ord-discount').value) : 0,
    payment: {
      method: g('ord-pay-method').value,
      status: g('ord-pay-status').value,
      amountPaid: g('ord-pay-amount').value ? Number(g('ord-pay-amount').value) : 0,
      paidDate: g('ord-pay-date').value || null,
      transactionId: g('ord-pay-txn').value.trim()
    },
    status: g('ord-status').value,
    carrier: g('ord-carrier').value.trim(),
    trackingNumber: g('ord-tracking').value.trim(),
    shippedDate: g('ord-shipped-date').value || null,
    notes: g('ord-notes').value.trim(),
    synced: false,
    updatedAt: Date.now()
  };
  if (!order.customer.name && !order.items.length) { alert('Add a customer or at least one item.'); return; }
  await saveOrder(order);
  closeOrderForm();
  if (navigator.vibrate) navigator.vibrate(80);
  refreshOrderList();
};

// --- Order detail ---
async function showOrderDetail(id) {
  const o = await getOrder(id);
  if (!o) return;
  const cust = o.customer || {};
  const pay = o.payment || {};
  const row = (label, val) => val ? `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #2a2a2a;font-size:13px"><span style="color:#888">${label}</span><span style="text-align:right;max-width:62%">${catEsc(val)}</span></div>` : '';
  const itemsHtml = (o.items || []).map(it =>
    `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0"><span>${catEsc(it.name || 'Item')} × ${it.quantity}</span><span>${catMoney((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0))}</span></div>`
  ).join('') || '<div style="color:#777;font-size:12px">No items</div>';

  const ov = document.createElement('div');
  ov.id = 'order-detail-overlay';
  ov.className = 'catalog-overlay';
  ov.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h2 style="font-size:18px">${catEsc(o.orderNumber || 'Order')}</h2>
      <button class="btn" style="width:auto;margin:0;padding:8px 14px;background:#555" onclick="document.getElementById('order-detail-overlay').remove()">Back</button>
    </div>
    <div style="font-size:12px;color:${o.synced ? '#4caf50' : '#e65100'};margin-bottom:8px">${o.synced ? 'Synced' : 'Not synced'}${o.date ? ' · ' + catEsc(o.date) : ''}</div>

    <h3 style="font-size:14px;margin:6px 0;color:#90caf9">Customer</h3>
    ${row('Name', cust.name)}${row('Email', cust.email)}${row('Phone', cust.phone)}${row('Address', cust.address)}
    ${row('Platform', vocabLabel(ORDER_PLATFORMS, o.platform))}${row('Handle', cust.handle)}

    <h3 style="font-size:14px;margin:10px 0 4px;color:#90caf9">Items</h3>
    ${itemsHtml}
    <div style="border-top:1px solid #2a2a2a;margin-top:6px;padding-top:6px">
      ${row('Subtotal', catMoney(orderSubtotal(o.items)))}
      ${o.shipping ? row('Shipping', catMoney(o.shipping)) : ''}
      ${o.tax ? row('Tax', catMoney(o.tax)) : ''}
      ${o.discount ? row('Discount', '-' + catMoney(o.discount)) : ''}
      <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:15px;padding-top:4px"><span>Total</span><span>${catMoney(orderTotal(o))}</span></div>
    </div>

    <h3 style="font-size:14px;margin:10px 0 4px;color:#90caf9">Payment</h3>
    ${row('Method', vocabLabel(PAYMENT_METHODS, pay.method))}${row('Status', vocabLabel(PAYMENT_STATUSES, pay.status))}
    ${pay.amountPaid ? row('Amount paid', catMoney(pay.amountPaid)) : ''}${row('Paid date', pay.paidDate)}${row('Txn ID', pay.transactionId)}

    <h3 style="font-size:14px;margin:10px 0 4px;color:#90caf9">Fulfillment</h3>
    ${row('Status', vocabLabel(ORDER_STATUSES, o.status))}${row('Carrier', o.carrier)}${row('Tracking', o.trackingNumber)}${row('Shipped', o.shippedDate)}
    ${o.notes ? `<div style="margin:8px 0;padding:8px;background:#222;border-radius:6px;font-size:13px">${catEsc(o.notes)}</div>` : ''}

    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-photo" style="flex:1" onclick="editOrder('${o.id}')">Edit</button>
      <button class="btn" style="flex:1;background:#d32f2f" onclick="deleteOrderUI('${o.id}')">Delete</button>
    </div>
  `;
  document.body.appendChild(ov);
}
window.showOrderDetail = showOrderDetail;

window.deleteOrderUI = async function (id) {
  if (!confirm('Delete this order?')) return;
  await deleteOrder(id);
  const ov = document.getElementById('order-detail-overlay');
  if (ov) ov.remove();
  refreshOrderList();
};
