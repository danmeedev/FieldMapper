// Laptop catalog UI — full CRUD for specimens + dig orders, server-backed via /api/*.
// Vocab + generators are duplicated from mobile-app/src/js/catalog.js — keep in sync.
(function () {
  'use strict';

  // ---- Vocab (mirror of catalog.js) ----
  const SITE_CODES = {
    'BL':    { label: 'Blanchard Mine, NM',      region: 'Bingham, New Mexico',        accessType: 'private-claim' },
    'MI-K':  { label: 'Keweenaw Peninsula, MI',  region: 'Keweenaw Peninsula, Michigan', accessType: 'state-dnr' },
    'MI-D':  { label: 'Michigan Devonian',       region: 'Michigan',                   accessType: 'state-dnr' },
    'CO-GR': { label: 'Granite/Guffey, CO',      region: 'the Colorado Rockies (Guffey/Lake George)', accessType: 'blm-open' },
    'CO-RK': { label: 'Colorado Rockies',        region: 'the Colorado Rockies',       accessType: 'blm-open' },
    'PY':    { label: 'Payson, AZ',              region: 'Payson, Arizona',            accessType: 'fee-dig' },
    'DO-XX': { label: 'Dig Order (client site)', region: '',                           accessType: 'dig-order' },
    'XX':    { label: 'New / unassigned site',   region: '',                           accessType: '' }
  };
  const ACCESS_TYPES = [
    { v: 'private-claim', l: 'Private claim (relationship)' }, { v: 'blm-open', l: 'BLM open collect' },
    { v: 'state-dnr', l: 'State / DNR land' }, { v: 'fee-dig', l: 'Fee dig / commercial' },
    { v: 'dig-order', l: 'Dig order (custom access)' }
  ];
  const BUCKETS = [
    { v: 0, l: '0 — Giveaway / fines', band: '$1–5 (bundle / add-on)' },
    { v: 1, l: '1 — Bread & butter',   band: '$8–25' },
    { v: 2, l: '2 — Mid-tier',         band: '$25–100 (≈90% of eBay sold comps)' },
    { v: 3, l: '3 — Showcase',         band: '$100–500+ (7-day auction w/ reserve)' }
  ];
  const UV_RESPONSES = [
    { v: 'not-tested', l: 'Not tested' }, { v: 'none', l: 'No response' },
    { v: 'moderate', l: 'Moderate' }, { v: 'strong', l: 'Strong' }
  ];
  const SPECIMEN_CATEGORIES = [
    { v: 'mineral', l: 'Mineral' }, { v: 'rock', l: 'Rock' }, { v: 'crystal', l: 'Crystal' },
    { v: 'fossil', l: 'Fossil' }, { v: 'lapidary', l: 'Lapidary / cut' }, { v: 'specimen', l: 'Specimen' }, { v: 'other', l: 'Other' }
  ];
  const ITEM_TYPES = [
    { v: 'specimen', l: 'Single specimen' }, { v: 'grab-bag', l: 'Grab bag' },
    { v: 'glow-dirt', l: 'Glow dirt' }, { v: 'rough-lot', l: 'Rough lot' }
  ];
  const CONDITIONS = [
    { v: 'as-collected', l: 'As-collected' }, { v: 'tumbled', l: 'Tumbled' },
    { v: 'cleaned', l: 'Cleaned' }, { v: 'display-ready', l: 'Display-ready' }
  ];
  const SPECIMEN_STATUSES = [
    { v: 'in-collection', l: 'In collection' }, { v: 'for-sale', l: 'For sale' }, { v: 'listed', l: 'Listed' },
    { v: 'reserved', l: 'Reserved' }, { v: 'sold', l: 'Sold' }
  ];
  const PLATFORMS = [
    { v: 'none', l: '—' }, { v: 'ebay', l: 'eBay' }, { v: 'etsy', l: 'Etsy' },
    { v: 'facebook', l: 'Facebook' }, { v: 'instagram', l: 'Instagram' }, { v: 'landing', l: 'Landing page' }
  ];
  const ACQ_METHODS = [
    { v: 'self-collected', l: 'Self-collected' }, { v: 'dig-order', l: 'Dig order' },
    { v: 'purchased', l: 'Purchased' }, { v: 'trade', l: 'Trade' }, { v: 'gift', l: 'Gift' }
  ];
  const WEIGHT_UNITS = [{ v: 'oz', l: 'oz' }, { v: 'lb', l: 'lb' }, { v: 'g', l: 'g' }];
  const RATE_TIERS = [
    { v: 'standard-75', l: 'Standard — $75/day', dayRate: 75 },
    { v: 'specialty-125', l: 'Specialty — $125/day', dayRate: 125 },
    { v: 'remote-150', l: 'Remote / overnight — $150+/day', dayRate: 150 },
    { v: 'blanchard-negotiated', l: 'Blanchard / private — negotiated', dayRate: 0 },
    { v: 'custom', l: 'Custom', dayRate: 0 }
  ];
  const DIGORDER_STATUSES = [
    { v: 'inquiry', l: 'Inquiry' }, { v: 'feasibility', l: 'Feasibility check' }, { v: 'terms-sent', l: 'Terms sent' },
    { v: 'deposit-paid', l: 'Deposit paid' }, { v: 'scheduled', l: 'Scheduled' }, { v: 'dug', l: 'Dug' },
    { v: 'preview-sent', l: 'Preview sent' }, { v: 'processing', l: 'Processing' }, { v: 'invoiced', l: 'Invoiced' },
    { v: 'shipped', l: 'Shipped' }, { v: 'follow-up', l: 'Follow-up' }, { v: 'cancelled', l: 'Cancelled' }
  ];
  const DEPOSIT_METHODS = [
    { v: 'etsy', l: 'Etsy custom listing' }, { v: 'venmo', l: 'Venmo' }, { v: 'paypal', l: 'PayPal F&F' },
    { v: 'zelle', l: 'Zelle' }, { v: 'other', l: 'Other' }
  ];
  const PAYMENT_METHODS = [
    { v: 'ebay', l: 'eBay' }, { v: 'etsy', l: 'Etsy' }, { v: 'paypal', l: 'PayPal' }, { v: 'venmo', l: 'Venmo' },
    { v: 'zelle', l: 'Zelle' }, { v: 'cash', l: 'Cash' }, { v: 'card', l: 'Card' }, { v: 'other', l: 'Other' }
  ];
  const PAYMENT_STATUSES = [
    { v: 'unpaid', l: 'Unpaid' }, { v: 'partial', l: 'Partial' }, { v: 'paid', l: 'Paid' }, { v: 'refunded', l: 'Refunded' }
  ];
  const ORDER_STATUSES = [
    { v: 'pending', l: 'Pending' }, { v: 'paid', l: 'Paid' }, { v: 'packed', l: 'Packed' }, { v: 'shipped', l: 'Shipped' },
    { v: 'delivered', l: 'Delivered' }, { v: 'cancelled', l: 'Cancelled' }, { v: 'refunded', l: 'Refunded' }
  ];
  const ORDER_PLATFORMS = [
    { v: 'ebay', l: 'eBay' }, { v: 'etsy', l: 'Etsy' }, { v: 'facebook', l: 'Facebook' },
    { v: 'instagram', l: 'Instagram' }, { v: 'in-person', l: 'In person' }, { v: 'other', l: 'Other' }
  ];
  const GEO_ROCK_TYPES = [
    { v: '', l: '— Select —' }, { v: 'quartz', l: 'Quartz/Quartz Vein' }, { v: 'granite', l: 'Granite' }, { v: 'schist', l: 'Schist' },
    { v: 'gneiss', l: 'Gneiss' }, { v: 'basalt', l: 'Basalt' }, { v: 'rhyolite', l: 'Rhyolite' }, { v: 'andesite', l: 'Andesite' },
    { v: 'limestone', l: 'Limestone' }, { v: 'sandstone', l: 'Sandstone' }, { v: 'shale', l: 'Shale' }, { v: 'conglomerate', l: 'Conglomerate' },
    { v: 'breccia', l: 'Breccia' }, { v: 'skarn', l: 'Skarn' }, { v: 'hornfels', l: 'Hornfels' }, { v: 'serpentinite', l: 'Serpentinite' },
    { v: 'iron-oxide', l: 'Iron Oxide/Gossan' }, { v: 'sulfide', l: 'Sulfide Bearing' }, { v: 'alluvium', l: 'Alluvium' }, { v: 'other', l: 'Other' }
  ];
  // Open vocab — autocomplete only; any typed value is accepted (free text).
  const GEO_MINERALS = [
    { v: 'free-gold', l: 'Visible Gold' }, { v: 'gold', l: 'Gold' }, { v: 'silver', l: 'Silver' },
    { v: 'copper', l: 'Copper' }, { v: 'sulfur', l: 'Sulfur' }, { v: 'graphite', l: 'Graphite' },
    { v: 'diamond', l: 'Diamond' }, { v: 'bismuth', l: 'Bismuth' }, { v: 'platinum', l: 'Platinum' },
    { v: 'pyrite', l: 'Pyrite' }, { v: 'marcasite', l: 'Marcasite' }, { v: 'chalcopyrite', l: 'Chalcopyrite' },
    { v: 'bornite', l: 'Bornite' }, { v: 'chalcocite', l: 'Chalcocite' }, { v: 'covellite', l: 'Covellite' },
    { v: 'galena', l: 'Galena' }, { v: 'sphalerite', l: 'Sphalerite' }, { v: 'pyrrhotite', l: 'Pyrrhotite' },
    { v: 'arsenopyrite', l: 'Arsenopyrite' }, { v: 'molybdenite', l: 'Molybdenite' }, { v: 'stibnite', l: 'Stibnite' },
    { v: 'cinnabar', l: 'Cinnabar' }, { v: 'realgar', l: 'Realgar' }, { v: 'orpiment', l: 'Orpiment' },
    { v: 'cobaltite', l: 'Cobaltite' }, { v: 'enargite', l: 'Enargite' }, { v: 'tetrahedrite', l: 'Tetrahedrite' },
    { v: 'magnetite', l: 'Magnetite' }, { v: 'hematite', l: 'Hematite' }, { v: 'limonite', l: 'Limonite/Goethite' },
    { v: 'goethite', l: 'Goethite' }, { v: 'rutile', l: 'Rutile' }, { v: 'cassiterite', l: 'Cassiterite' },
    { v: 'corundum', l: 'Corundum (Ruby/Sapphire)' }, { v: 'spinel', l: 'Spinel' }, { v: 'chromite', l: 'Chromite' },
    { v: 'cuprite', l: 'Cuprite' }, { v: 'uraninite', l: 'Uraninite' }, { v: 'ilmenite', l: 'Ilmenite' },
    { v: 'psilomelane', l: 'Psilomelane' }, { v: 'pyrolusite', l: 'Pyrolusite' },
    { v: 'fluorite', l: 'Fluorite' }, { v: 'halite', l: 'Halite' }, { v: 'sylvite', l: 'Sylvite' }, { v: 'atacamite', l: 'Atacamite' },
    { v: 'calcite', l: 'Calcite' }, { v: 'aragonite', l: 'Aragonite' }, { v: 'dolomite', l: 'Dolomite' },
    { v: 'magnesite', l: 'Magnesite' }, { v: 'siderite', l: 'Siderite' }, { v: 'rhodochrosite', l: 'Rhodochrosite' },
    { v: 'smithsonite', l: 'Smithsonite' }, { v: 'malachite', l: 'Malachite' }, { v: 'azurite', l: 'Azurite' },
    { v: 'cerussite', l: 'Cerussite' }, { v: 'witherite', l: 'Witherite' },
    { v: 'barite', l: 'Barite' }, { v: 'gypsum', l: 'Gypsum/Selenite' }, { v: 'celestine', l: 'Celestine' },
    { v: 'anglesite', l: 'Anglesite' }, { v: 'anhydrite', l: 'Anhydrite' }, { v: 'wulfenite', l: 'Wulfenite' },
    { v: 'apatite', l: 'Apatite' }, { v: 'turquoise', l: 'Turquoise' }, { v: 'vivianite', l: 'Vivianite' },
    { v: 'pyromorphite', l: 'Pyromorphite' }, { v: 'wavellite', l: 'Wavellite' }, { v: 'variscite', l: 'Variscite' },
    { v: 'vanadinite', l: 'Vanadinite' }, { v: 'mimetite', l: 'Mimetite' },
    { v: 'scheelite', l: 'Scheelite' }, { v: 'wolframite', l: 'Wolframite' },
    { v: 'quartz', l: 'Quartz' }, { v: 'amethyst', l: 'Amethyst' }, { v: 'citrine', l: 'Citrine' },
    { v: 'smoky-quartz', l: 'Smoky Quartz' }, { v: 'rose-quartz', l: 'Rose Quartz' }, { v: 'milky-quartz', l: 'Milky Quartz' },
    { v: 'agate', l: 'Agate' }, { v: 'jasper', l: 'Jasper' }, { v: 'chalcedony', l: 'Chalcedony' },
    { v: 'carnelian', l: 'Carnelian' }, { v: 'onyx', l: 'Onyx' }, { v: 'chrysoprase', l: 'Chrysoprase' },
    { v: 'bloodstone', l: 'Bloodstone' }, { v: 'tigers-eye', l: "Tiger's Eye" }, { v: 'aventurine', l: 'Aventurine' },
    { v: 'opal', l: 'Opal' }, { v: 'petrified-wood', l: 'Petrified Wood' }, { v: 'flint', l: 'Flint/Chert' },
    { v: 'amazonite', l: 'Amazonite' }, { v: 'microcline', l: 'Microcline' }, { v: 'orthoclase', l: 'Orthoclase' },
    { v: 'labradorite', l: 'Labradorite' }, { v: 'moonstone', l: 'Moonstone' }, { v: 'sunstone', l: 'Sunstone' },
    { v: 'plagioclase', l: 'Plagioclase' },
    { v: 'garnet', l: 'Garnet' }, { v: 'almandine', l: 'Almandine Garnet' }, { v: 'grossular', l: 'Grossular Garnet' },
    { v: 'andradite', l: 'Andradite Garnet' }, { v: 'spessartine', l: 'Spessartine Garnet' },
    { v: 'tourmaline', l: 'Tourmaline' }, { v: 'schorl', l: 'Schorl (Black Tourmaline)' }, { v: 'elbaite', l: 'Elbaite Tourmaline' },
    { v: 'beryl', l: 'Beryl' }, { v: 'aquamarine', l: 'Aquamarine' }, { v: 'emerald', l: 'Emerald' },
    { v: 'morganite', l: 'Morganite' }, { v: 'heliodor', l: 'Heliodor' },
    { v: 'topaz', l: 'Topaz' }, { v: 'zircon', l: 'Zircon' }, { v: 'peridot', l: 'Peridot/Olivine' },
    { v: 'epidote', l: 'Epidote' }, { v: 'vesuvianite', l: 'Vesuvianite (Idocrase)' }, { v: 'prehnite', l: 'Prehnite' },
    { v: 'datolite', l: 'Datolite' }, { v: 'chrysocolla', l: 'Chrysocolla' }, { v: 'dioptase', l: 'Dioptase' },
    { v: 'hemimorphite', l: 'Hemimorphite' }, { v: 'kyanite', l: 'Kyanite' }, { v: 'andalusite', l: 'Andalusite' },
    { v: 'staurolite', l: 'Staurolite' }, { v: 'titanite', l: 'Titanite (Sphene)' }, { v: 'axinite', l: 'Axinite' },
    { v: 'lapis-lazuli', l: 'Lapis Lazuli' }, { v: 'sodalite', l: 'Sodalite' }, { v: 'lazurite', l: 'Lazurite' },
    { v: 'rhodonite', l: 'Rhodonite' }, { v: 'wollastonite', l: 'Wollastonite' }, { v: 'danburite', l: 'Danburite' },
    { v: 'spodumene', l: 'Spodumene/Kunzite' }, { v: 'charoite', l: 'Charoite' }, { v: 'sugilite', l: 'Sugilite' },
    { v: 'apophyllite', l: 'Apophyllite' }, { v: 'stilbite', l: 'Stilbite' }, { v: 'heulandite', l: 'Heulandite' },
    { v: 'natrolite', l: 'Natrolite' }, { v: 'analcime', l: 'Analcime' }, { v: 'chabazite', l: 'Chabazite' },
    { v: 'muscovite', l: 'Muscovite (Mica)' }, { v: 'biotite', l: 'Biotite (Mica)' }, { v: 'lepidolite', l: 'Lepidolite' },
    { v: 'serpentine', l: 'Serpentine' }, { v: 'talc', l: 'Talc' }, { v: 'chlorite', l: 'Chlorite' },
    { v: 'actinolite', l: 'Actinolite' }, { v: 'tremolite', l: 'Tremolite' }, { v: 'hornblende', l: 'Hornblende' },
    { v: 'diopside', l: 'Diopside' }, { v: 'augite', l: 'Augite' }, { v: 'jadeite', l: 'Jadeite (Jade)' },
    { v: 'nephrite', l: 'Nephrite (Jade)' },
    { v: 'petoskey', l: 'Petoskey Stone' }, { v: 'chlorastrolite', l: 'Chlorastrolite (Greenstone)' },
    { v: 'thomsonite', l: 'Thomsonite' }, { v: 'unakite', l: 'Unakite' }, { v: 'obsidian', l: 'Obsidian' },
    { v: 'amber', l: 'Amber' }, { v: 'other', l: 'Other' }
  ];
  const GEO_ALTERATION = [
    { v: '', l: '— Select —' }, { v: 'none', l: 'None' }, { v: 'silicification', l: 'Silicification' }, { v: 'argillic', l: 'Argillic (Clay)' },
    { v: 'sericitic', l: 'Sericitic' }, { v: 'propylitic', l: 'Propylitic' }, { v: 'potassic', l: 'Potassic' },
    { v: 'iron-oxide', l: 'Iron Oxide Staining' }, { v: 'chloritic', l: 'Chloritic' }, { v: 'carbonate', l: 'Carbonate' }, { v: 'supergene', l: 'Supergene' }
  ];
  const GEO_SAMPLE_TYPES = [
    { v: '', l: '— Select —' }, { v: 'rock', l: 'Rock Chip' }, { v: 'float', l: 'Float' }, { v: 'soil', l: 'Soil' },
    { v: 'pan', l: 'Pan Concentrate' }, { v: 'channel', l: 'Channel Sample' }, { v: 'grab', l: 'Grab Sample' }, { v: 'outcrop', l: 'Outcrop' }
  ];

  // ---- Helpers ----
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function vlabel(arr, v) { const f = arr.find(x => String(x.v) === String(v)); return f ? f.l : (v || ''); }
  function opts(arr, sel) { return arr.map(o => `<option value="${esc(o.v)}"${String(o.v) === String(sel) ? ' selected' : ''}>${esc(o.l)}</option>`).join(''); }
  function newId(p) { return `${p}_${Date.now()}_${Math.floor(Math.random() * 1e6).toString(36)}`; }
  function nextLabel(siteCode) {
    const yy = String(new Date().getFullYear()).slice(-2);
    const re = new RegExp('^' + siteCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-' + yy + '-(\\d+)$');
    let max = 0;
    specimensCache.forEach(s => { const m = (s.label || '').match(re); if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; } });
    return `${siteCode}-${yy}-${String(max + 1).padStart(3, '0')}`;
  }
  function resizePhoto(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX = 1600; let w = img.width, h = img.height;
          if (w > MAX || h > MAX) { if (w > h) { h = h * MAX / w; w = MAX; } else { w = w * MAX / h; h = MAX; } }
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ---- Generators (mirror of catalog.js) ----
  function mineralLabels(sp) { return (sp.mineralization || []).map(v => vlabel(GEO_MINERALS, v)).filter(Boolean); }
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
      'blm-open': 'BLM open-collection area.', 'private-claim': 'Collected with permission from a private claim.',
      'state-dnr': 'Collected on state land in accordance with local rules.', 'fee-dig': 'Collected at a fee-dig site.',
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
  function suggestPlatform(sp) { return (sp.itemType === 'glow-dirt' || sp.itemType === 'grab-bag') ? 'etsy' : 'ebay'; }
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
    const title = [mineralsTitle, location, size, 'Natural Specimen', 'Personally Collected'].filter(Boolean).join(' — ');
    const provenance = sp.provenanceStatement || generateProvenance(sp);
    const mineralsLower = minerals.length ? minerals.join(', ').toLowerCase() : (sp.speciesVariety || sp.name || 'mineral specimen');
    const conditionLabel = vlabel(CONDITIONS, sp.condition);
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
    const body = [
      `Natural ${mineralsLower}, personally collected from ${location || 'the field'}.`,
      provenance,
      sp.description ? sp.description.trim() : '',
      conditionLabel ? `Condition: ${conditionLabel}.` : '',
      '',
      specLine,
      '',
      'Ships within 3 business days. Combined shipping available. Double-boxed for protection.'
    ].filter((l, i) => l !== '' || i < 6).join('\n');
    return { title, body };
  }

  // ---- State ----
  let specimensCache = [];
  let digOrdersCache = [];
  let ordersCache = [];
  let ordFormItems = [];
  let editingOrdId = null;
  let formPhotos = [];     // [{ src, filename? }]
  let uvPhoto = null;      // { src, filename? } | null
  let formMinerals = [];
  let linkedWp = null;     // { id, lat, lon, name }
  let editingSpecId = null;
  let doPhotos = [];
  let editingDoId = null;

  // ---- Modal scaffold ----
  const INP = 'width:100%;padding:8px;margin-bottom:8px;border:1px solid #444;border-radius:4px;background:#222;color:#fff;font-size:13px;box-sizing:border-box';
  const LBL = 'display:block;font-size:12px;color:#aaa;margin:6px 0 2px';
  function openModal(html) {
    closeModal();
    const ov = document.createElement('div');
    ov.id = 'pc-cat-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,0.85);overflow-y:auto';
    ov.innerHTML = `<div style="max-width:660px;margin:20px auto;background:#1e1e1e;color:#fff;padding:20px;border-radius:8px">${html}</div>`;
    document.body.appendChild(ov);
  }
  window.pcCloseModal = closeModal;
  function closeModal() { const e = document.getElementById('pc-cat-overlay'); if (e) e.remove(); }

  // ---- Fetch + render: specimens ----
  async function loadSpecimens() {
    try { const r = await fetch('/api/specimens'); specimensCache = r.ok ? await r.json() : []; }
    catch (e) { specimensCache = []; }
    renderSpecimenList();
  }
  function renderSpecimenList() {
    const list = document.getElementById('cat-spec-list');
    const count = document.getElementById('cat-spec-count');
    if (count) count.textContent = specimensCache.length;
    if (!list) return;
    const q = (document.getElementById('cat-spec-search')?.value || '').trim().toLowerCase();
    let rows = specimensCache.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (q) rows = rows.filter(s =>
      (s.label || '').toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q) ||
      (s.speciesVariety || '').toLowerCase().includes(q) || (s.locality || '').toLowerCase().includes(q) ||
      (s.tags || []).join(' ').toLowerCase().includes(q) || (s.siteCode || '').toLowerCase().includes(q));
    const labelCounts = {};
    specimensCache.forEach(s => { if (s.label) labelCounts[s.label] = (labelCounts[s.label] || 0) + 1; });
    if (!rows.length) { list.innerHTML = '<div style="color:#777;padding:14px;font-size:12px">No specimens.</div>'; return; }
    list.innerHTML = '';
    rows.forEach(s => {
      const dup = (s.label && labelCounts[s.label] > 1) ? ' <span style="color:#ef5350;font-size:10px">dup</span>' : '';
      const div = document.createElement('div');
      div.className = 'wp-item';
      div.style.cssText = 'padding:8px;border-bottom:1px solid #333;cursor:pointer';
      div.innerHTML = `<div style="font-weight:bold;font-size:13px">${esc(s.label || s.name || 'Specimen')}${dup}</div>
        <div style="font-size:11px;color:#999">${esc(s.name || '')}${s.name && s.speciesVariety ? ' · ' : ''}${esc(s.speciesVariety || '')}</div>
        <div style="font-size:11px;color:#777">${esc(vlabel(SPECIMEN_STATUSES, s.status))} · B${s.bucket != null ? s.bucket : '–'}${s.price ? ' · $' + s.price : ''}${s.siteCode ? ' · ' + esc(s.siteCode) : ''}</div>`;
      div.onclick = () => showSpecimenDetail(s.id);
      list.appendChild(div);
    });
  }

  // ---- Specimen form ----
  window.pcNewSpecimen = function () {
    editingSpecId = null; formPhotos = []; uvPhoto = null; formMinerals = []; linkedWp = null;
    renderSpecimenForm({ itemType: 'specimen', category: 'mineral', bucket: 1, condition: 'as-collected', status: 'in-collection', uv: { response: 'not-tested', color: '' }, weightUnit: 'oz', quantity: 1, acquisition: { method: 'self-collected' }, dimensions: {} });
  };
  window.pcEditSpecimen = function (id) {
    const sp = specimensCache.find(s => String(s.id) === String(id));
    if (!sp) return;
    editingSpecId = sp.id;
    formMinerals = (sp.mineralization || []).slice();
    formPhotos = (sp.photos || []).map(f => ({ src: '/photos/' + f, filename: f }));
    uvPhoto = (sp.uv && sp.uv.photoRef) ? { src: '/photos/' + sp.uv.photoRef, filename: sp.uv.photoRef } : null;
    linkedWp = sp.waypointId ? { id: sp.waypointId, lat: sp.lat, lon: sp.lon, name: sp.waypointName || '' } : null;
    renderSpecimenForm(sp);
  };

  function waypointOptions(selId) {
    const wps = (typeof waypoints !== 'undefined' && waypoints) ? waypoints : [];
    return '<option value="">— Not linked —</option>' + wps.map(w =>
      `<option value="${esc(w.id)}"${String(w.id) === String(selId) ? ' selected' : ''}>${esc(w.name || 'WP')} (${(w.lat || 0).toFixed(4)}, ${(w.lon || 0).toFixed(4)})</option>`).join('');
  }

  function renderSpecimenForm(sp) {
    openModal(`
      <h2 style="margin:0 0 12px">${editingSpecId ? 'Edit' : 'Add'} Specimen</h2>
      <label style="${LBL}">Item Type</label><select id="ps-itemType" style="${INP}">${opts(ITEM_TYPES, sp.itemType)}</select>
      <label style="${LBL}">Collection Site (SOP-1)</label>
      <select id="ps-siteCode" style="${INP}" onchange="pcSiteChange()"><option value="">— Select site —</option>${Object.keys(SITE_CODES).map(c => `<option value="${c}"${c === sp.siteCode ? ' selected' : ''}>${c} — ${esc(SITE_CODES[c].label)}</option>`).join('')}</select>
      <label style="${LBL}">Label / SKU <span id="ps-dup" style="color:#ef5350;font-size:11px"></span></label>
      <div style="display:flex;gap:6px"><input id="ps-label" style="${INP}" value="${esc(sp.label || '')}" placeholder="BL-25-001" oninput="pcCheckDup()"><button type="button" onclick="pcRegenLabel()" style="padding:8px 14px;background:#455a64;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-bottom:8px">Auto</button></div>
      <label style="${LBL}">Access Type</label><select id="ps-accessType" style="${INP}"><option value="">—</option>${opts(ACCESS_TYPES, sp.accessType)}</select>
      <label style="${LBL}">Name</label><input id="ps-name" style="${INP}" value="${esc(sp.name || '')}" placeholder="e.g. Amethyst geode half">
      <label style="${LBL}">Category</label><select id="ps-category" style="${INP}">${opts(SPECIMEN_CATEGORIES, sp.category)}</select>
      <label style="${LBL}">Species / Variety</label><input id="ps-species" style="${INP}" value="${esc(sp.speciesVariety || '')}">
      <label style="${LBL}">Minerals <span style="color:#777">— type any name; pick a suggestion or add your own</span></label>
      <div id="ps-mineral-tags" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px"></div>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <input id="ps-mineral-input" list="pc-mineral-datalist" autocomplete="off" placeholder="e.g. Rhodochrosite, Wulfenite, Lake Superior agate..." onkeydown="pcMineralKey(event)" style="${INP};margin-bottom:0;flex:1">
        <button type="button" onclick="pcAddMineral()" style="padding:8px 14px;background:#1565c0;color:#fff;border:none;border-radius:4px;cursor:pointer">Add</button>
      </div>
      <datalist id="pc-mineral-datalist">${GEO_MINERALS.map(m => `<option value="${esc(m.l)}"></option>`).join('')}</datalist>
      <div style="display:flex;gap:8px"><div style="flex:1"><label style="${LBL}">Rock Type</label><select id="ps-rockType" style="${INP}">${opts(GEO_ROCK_TYPES, sp.rockType)}</select></div>
      <div style="flex:1"><label style="${LBL}">Alteration</label><select id="ps-alteration" style="${INP}">${opts(GEO_ALTERATION, sp.alteration)}</select></div>
      <div style="flex:1"><label style="${LBL}">Sample Type</label><select id="ps-sampleType" style="${INP}">${opts(GEO_SAMPLE_TYPES, sp.sampleType)}</select></div></div>
      <div style="display:flex;gap:8px"><div style="flex:1"><label style="${LBL}">Sort Bucket (SOP-2)</label><select id="ps-bucket" style="${INP}" onchange="pcPriceHint()">${opts(BUCKETS, sp.bucket)}</select></div>
      <div style="flex:1"><label style="${LBL}">Condition</label><select id="ps-condition" style="${INP}">${opts(CONDITIONS, sp.condition)}</select></div></div>
      <label style="${LBL}">UV Fluorescence (SOP-2)</label>
      <div style="display:flex;gap:6px"><select id="ps-uvResponse" style="${INP};flex:1" onchange="pcPriceHint()">${opts(UV_RESPONSES, (sp.uv || {}).response)}</select><input id="ps-uvColor" style="${INP};flex:1" value="${esc((sp.uv || {}).color || '')}" placeholder="color"></div>
      <div id="ps-uvphoto" style="margin-bottom:6px"></div><button type="button" onclick="pcAddUv()" style="padding:6px 12px;background:#1565c0;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-bottom:8px">Add UV Photo</button>
      <label style="${LBL}">Dimensions (in) & Weight</label>
      <div style="display:flex;gap:6px"><input id="ps-diml" type="number" step="0.1" style="${INP}" placeholder="L" value="${sp.dimensions ? (sp.dimensions.l || '') : ''}"><input id="ps-dimw" type="number" step="0.1" style="${INP}" placeholder="W" value="${sp.dimensions ? (sp.dimensions.w || '') : ''}"><input id="ps-dimh" type="number" step="0.1" style="${INP}" placeholder="H" value="${sp.dimensions ? (sp.dimensions.h || '') : ''}"></div>
      <div style="display:flex;gap:6px"><input id="ps-weight" type="number" step="0.1" style="${INP};flex:2" placeholder="Weight" value="${sp.weight || ''}"><select id="ps-weightUnit" style="${INP};flex:1">${opts(WEIGHT_UNITS, sp.weightUnit || 'oz')}</select><input id="ps-quantity" type="number" style="${INP};flex:1" placeholder="Qty" value="${sp.quantity != null ? sp.quantity : 1}"></div>
      <label style="${LBL}">Locality</label><input id="ps-locality" style="${INP}" value="${esc(sp.locality || '')}">
      <label style="${LBL}">Provenance — collected at (waypoint)</label><select id="ps-waypoint" style="${INP}" onchange="pcWpChange()">${waypointOptions(sp.waypointId)}</select>
      <label style="${LBL}">Acquisition</label>
      <div style="display:flex;gap:6px"><select id="ps-acqMethod" style="${INP};flex:1">${opts(ACQ_METHODS, (sp.acquisition || {}).method)}</select><input id="ps-acqDate" type="date" style="${INP};flex:1" value="${(sp.acquisition || {}).date || ''}"><input id="ps-acqCost" type="number" step="0.01" style="${INP};flex:1" placeholder="Cost $" value="${(sp.acquisition || {}).cost || ''}"></div>
      <label style="${LBL}">Link to Dig Order</label><select id="ps-digOrderId" style="${INP}"><option value="">— None —</option>${digOrdersCache.map(o => `<option value="${esc(o.id)}"${o.id === sp.digOrderId ? ' selected' : ''}>${esc(o.client || 'Order')} — ${esc(vlabel(DIGORDER_STATUSES, o.status))}</option>`).join('')}</select>
      <hr style="border-color:#333;margin:12px 0">
      <div style="display:flex;gap:8px"><div style="flex:1"><label style="${LBL}">Status</label><select id="ps-status" style="${INP}" onchange="pcStatusChange()">${opts(SPECIMEN_STATUSES, sp.status)}</select></div>
      <div style="flex:1"><label style="${LBL}">Price $ <span id="ps-priceHint" style="color:#81c784;font-size:11px"></span></label><input id="ps-price" type="number" step="0.01" style="${INP}" value="${sp.price || ''}"></div></div>
      <div style="display:flex;gap:8px"><div style="flex:1"><label style="${LBL}">Platform</label><select id="ps-platform" style="${INP}">${opts(PLATFORMS, sp.platform)}</select></div>
      <div style="flex:2"><label style="${LBL}">Listing URL</label><input id="ps-listingUrl" style="${INP}" value="${esc(sp.listingUrl || '')}"></div></div>
      <div id="ps-sold" style="display:none"><div style="display:flex;gap:8px"><div style="flex:1"><label style="${LBL}">Sold Price $</label><input id="ps-soldPrice" type="number" step="0.01" style="${INP}" value="${sp.soldPrice || ''}"></div>
      <div style="flex:1"><label style="${LBL}">Sold Date</label><input id="ps-soldDate" type="date" style="${INP}" value="${sp.soldDate || ''}"></div>
      <div style="flex:1"><label style="${LBL}">Buyer</label><input id="ps-buyer" style="${INP}" value="${esc(sp.buyer || '')}"></div></div></div>
      <hr style="border-color:#333;margin:12px 0">
      <label style="${LBL}">Provenance Statement (auto, editable)</label><textarea id="ps-provenance" style="${INP};min-height:60px">${esc(sp.provenanceStatement || '')}</textarea>
      <label style="${LBL}">Description</label><textarea id="ps-description" style="${INP};min-height:60px">${esc(sp.description || '')}</textarea>
      <label style="${LBL}">Tags (comma separated)</label><input id="ps-tags" style="${INP}" value="${esc((sp.tags || []).join(', '))}">
      <label style="${LBL}">Photos (SOP-3: 3 min — top-down, 45°, close-up)</label>
      <div id="ps-photos" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px"></div>
      <button type="button" onclick="pcAddPhoto()" style="padding:6px 12px;background:#1565c0;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-bottom:10px">Add Photo</button>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button onclick="pcSaveSpecimen()" style="flex:2;padding:10px;background:#4caf50;color:#fff;border:none;border-radius:4px;font-weight:bold;cursor:pointer">Save Specimen</button>
        <button onclick="pcCloseModal()" style="flex:1;padding:10px;background:#666;color:#fff;border:none;border-radius:4px;cursor:pointer">Cancel</button>
      </div>
    `);
    renderFormPhotos(); renderUvPhoto(); renderPcMineralTags(); pcPriceHint(); pcStatusChange(); pcCheckDup();
  }

  function draft() {
    const g = id => document.getElementById(id);
    return {
      siteCode: g('ps-siteCode')?.value, accessType: g('ps-accessType')?.value, locality: g('ps-locality')?.value,
      mineralization: formMinerals.slice(), bucket: g('ps-bucket') ? Number(g('ps-bucket').value) : 1,
      uv: { response: g('ps-uvResponse')?.value, color: g('ps-uvColor')?.value },
      provenanceStatement: g('ps-provenance')?.value
    };
  }
  window.pcSiteChange = function () {
    const code = document.getElementById('ps-siteCode').value; const site = SITE_CODES[code];
    if (!site) return;
    if (site.accessType) document.getElementById('ps-accessType').value = site.accessType;
    const labelEl = document.getElementById('ps-label');
    if (code && code !== 'XX' && !labelEl.value.trim()) { labelEl.value = nextLabel(code); pcCheckDup(); }
    const prov = document.getElementById('ps-provenance');
    if (prov && !prov.value.trim()) prov.value = generateProvenance(draft());
  };
  window.pcRegenLabel = function () {
    let code = document.getElementById('ps-siteCode').value;
    if (!code) { alert('Pick a collection site first.'); return; }
    if (code === 'XX') { const c = (prompt('Enter a short site code (e.g. AZ):') || '').trim().toUpperCase(); if (!c) return; code = c; }
    document.getElementById('ps-label').value = nextLabel(code); pcCheckDup();
  };
  window.pcCheckDup = function () {
    const label = document.getElementById('ps-label')?.value.trim();
    const badge = document.getElementById('ps-dup'); if (!badge) return;
    const dup = label && specimensCache.some(s => s.label === label && String(s.id) !== String(editingSpecId));
    badge.textContent = dup ? '⚠ duplicate SKU' : '';
  };
  function pcCanonicalMineral(q) {
    const t = (q || '').trim();
    if (!t) return null;
    const f = GEO_MINERALS.find(m => m.l.toLowerCase() === t.toLowerCase() || m.v.toLowerCase() === t.toLowerCase());
    return f ? f.v : t;
  }
  window.pcMineralKey = function (e) { if (e.key === 'Enter') { e.preventDefault(); pcAddMineral(); } };
  window.pcAddMineral = function () {
    const inp = document.getElementById('ps-mineral-input');
    if (!inp) return;
    const v = pcCanonicalMineral(inp.value);
    if (v && !formMinerals.some(x => String(x).toLowerCase() === String(v).toLowerCase())) formMinerals.push(v);
    inp.value = '';
    renderPcMineralTags();
    inp.focus();
  };
  window.pcRemoveMineral = function (i) { formMinerals.splice(i, 1); renderPcMineralTags(); };
  function renderPcMineralTags() {
    const el = document.getElementById('ps-mineral-tags');
    if (!el) return;
    if (!formMinerals.length) { el.innerHTML = '<span style="color:#666;font-size:12px">No minerals added yet.</span>'; return; }
    el.innerHTML = formMinerals.map((v, i) =>
      `<span style="display:inline-flex;align-items:center;gap:6px;background:#1a3a5c;border:1px solid #2196f3;color:#fff;border-radius:14px;padding:4px 6px 4px 11px;font-size:13px">${esc(vlabel(GEO_MINERALS, v))}<button type="button" onclick="pcRemoveMineral(${i})" style="background:rgba(255,255,255,0.18);border:none;color:#fff;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:13px;line-height:1">×</button></span>`
    ).join('');
  }
  window.pcStatusChange = function () {
    const sold = document.getElementById('ps-sold');
    if (sold) sold.style.display = document.getElementById('ps-status').value === 'sold' ? 'block' : 'none';
  };
  window.pcPriceHint = function () { const h = document.getElementById('ps-priceHint'); if (h) h.textContent = suggestPrice(draft()); };
  window.pcWpChange = function () {
    const id = document.getElementById('ps-waypoint').value;
    const wps = (typeof waypoints !== 'undefined' && waypoints) ? waypoints : [];
    const wp = wps.find(w => String(w.id) === String(id));
    if (!wp) { linkedWp = null; return; }
    linkedWp = { id: wp.id, lat: wp.lat, lon: wp.lon, name: wp.name || '' };
    const loc = document.getElementById('ps-locality'); if (loc && !loc.value.trim()) loc.value = wp.name || '';
    if (wp.samples && wp.samples[0]) {
      const s = wp.samples[0];
      if (s.rockType) document.getElementById('ps-rockType').value = s.rockType;
      if (s.alteration) document.getElementById('ps-alteration').value = s.alteration;
      if (s.type) document.getElementById('ps-sampleType').value = s.type;
      if (s.mineralization && !formMinerals.includes(s.mineralization)) {
        formMinerals.push(s.mineralization);
        renderPcMineralTags();
      }
    }
  };
  window.pcAddPhoto = function () {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = async (e) => { for (const f of e.target.files) formPhotos.push({ src: await resizePhoto(f) }); renderFormPhotos(); input.remove(); };
    input.click();
  };
  window.pcRemovePhoto = function (i) { formPhotos.splice(i, 1); renderFormPhotos(); };
  function renderFormPhotos() {
    const el = document.getElementById('ps-photos'); if (!el) return;
    el.innerHTML = formPhotos.map((p, i) => `<div style="position:relative"><img src="${p.src}" style="width:70px;height:70px;object-fit:cover;border-radius:6px;border:1px solid #444"><button onclick="pcRemovePhoto(${i})" style="position:absolute;top:0;right:0;background:red;color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer">X</button></div>`).join('');
  }
  window.pcAddUv = function () {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = async (e) => { if (e.target.files[0]) { uvPhoto = { src: await resizePhoto(e.target.files[0]) }; renderUvPhoto(); } input.remove(); };
    input.click();
  };
  window.pcRemoveUv = function () { uvPhoto = null; renderUvPhoto(); };
  function renderUvPhoto() {
    const el = document.getElementById('ps-uvphoto'); if (!el) return;
    el.innerHTML = uvPhoto ? `<div style="position:relative;display:inline-block"><img src="${uvPhoto.src}" style="width:70px;height:70px;object-fit:cover;border-radius:6px;border:1px solid #444"><button onclick="pcRemoveUv()" style="position:absolute;top:0;right:0;background:red;color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer">X</button></div>` : '';
  }

  window.pcSaveSpecimen = async function () {
    const g = id => document.getElementById(id);
    const id = editingSpecId || newId('sp');
    const prev = editingSpecId ? specimensCache.find(s => String(s.id) === String(id)) || {} : {};
    const sp = {
      ...prev, id,
      label: g('ps-label').value.trim(), itemType: g('ps-itemType').value, siteCode: g('ps-siteCode').value,
      accessType: g('ps-accessType').value, name: g('ps-name').value.trim(), category: g('ps-category').value,
      speciesVariety: g('ps-species').value.trim(), mineralization: formMinerals.slice(),
      rockType: g('ps-rockType').value, alteration: g('ps-alteration').value, sampleType: g('ps-sampleType').value,
      bucket: Number(g('ps-bucket').value), condition: g('ps-condition').value,
      uv: { response: g('ps-uvResponse').value, color: g('ps-uvColor').value.trim(), photoRef: uvPhoto ? (uvPhoto.filename || uvPhoto.src) : null },
      dimensions: { l: g('ps-diml').value ? Number(g('ps-diml').value) : null, w: g('ps-dimw').value ? Number(g('ps-dimw').value) : null, h: g('ps-dimh').value ? Number(g('ps-dimh').value) : null },
      weight: g('ps-weight').value ? Number(g('ps-weight').value) : null, weightUnit: g('ps-weightUnit').value,
      quantity: g('ps-quantity').value ? Number(g('ps-quantity').value) : 1, locality: g('ps-locality').value.trim(),
      waypointId: linkedWp ? linkedWp.id : null, waypointName: linkedWp ? linkedWp.name : null,
      lat: linkedWp ? linkedWp.lat : null, lon: linkedWp ? linkedWp.lon : null,
      acquisition: { method: g('ps-acqMethod').value, date: g('ps-acqDate').value || null, cost: g('ps-acqCost').value ? Number(g('ps-acqCost').value) : null },
      digOrderId: g('ps-digOrderId').value || null, status: g('ps-status').value,
      price: g('ps-price').value ? Number(g('ps-price').value) : null, platform: g('ps-platform').value, listingUrl: g('ps-listingUrl').value.trim(),
      soldPrice: g('ps-soldPrice') && g('ps-soldPrice').value ? Number(g('ps-soldPrice').value) : null,
      soldDate: g('ps-soldDate') ? (g('ps-soldDate').value || null) : null, buyer: g('ps-buyer') ? g('ps-buyer').value.trim() : null,
      provenanceStatement: g('ps-provenance').value.trim(), description: g('ps-description').value.trim(),
      tags: g('ps-tags').value.split(',').map(t => t.trim()).filter(Boolean),
      photos: formPhotos.map(p => p.filename || p.src),
      synced: true, updatedAt: Date.now()
    };
    if (!sp.createdAt) sp.createdAt = Date.now();
    if (!sp.name && !sp.label) { alert('Give the specimen a label or a name.'); return; }
    const r = await fetch('/api/specimen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sp) });
    if (!r.ok) { alert('Save failed.'); return; }
    closeModal(); await loadSpecimens();
  };

  function showSpecimenDetail(id) {
    const sp = specimensCache.find(s => String(s.id) === String(id));
    if (!sp) return;
    const photoHtml = (sp.photos || []).map(f => `<img src="/photos/${f}" style="width:110px;height:110px;object-fit:cover;border-radius:6px;border:1px solid #444">`).join('');
    const uvHtml = (sp.uv && sp.uv.photoRef) ? `<div style="margin:8px 0"><div style="font-size:11px;color:#aaa">UV</div><img src="/photos/${sp.uv.photoRef}" style="width:130px;border-radius:6px;border:1px solid #444"></div>` : '';
    const minerals = mineralLabels(sp).join(', ');
    const dims = sp.dimensions && (sp.dimensions.l || sp.dimensions.w || sp.dimensions.h) ? `${[sp.dimensions.l, sp.dimensions.w, sp.dimensions.h].filter(Boolean).join(' × ')} in` : '';
    const row = (k, v) => v ? `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #2a2a2a;font-size:13px"><span style="color:#888">${k}</span><span style="text-align:right;max-width:62%">${esc(v)}</span></div>` : '';
    openModal(`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h2 style="margin:0">${esc(sp.label || sp.name || 'Specimen')}</h2>
      <button onclick="pcCloseModal()" style="padding:6px 14px;background:#666;color:#fff;border:none;border-radius:4px;cursor:pointer">Close</button></div>
      ${sp.name ? `<div style="font-size:15px;margin-bottom:6px">${esc(sp.name)}</div>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">${photoHtml}</div>${uvHtml}
      ${row('Item type', vlabel(ITEM_TYPES, sp.itemType))}${row('Category', vlabel(SPECIMEN_CATEGORIES, sp.category))}${row('Species/variety', sp.speciesVariety)}
      ${row('Minerals', minerals)}${row('Site', sp.siteCode ? sp.siteCode + ' — ' + ((SITE_CODES[sp.siteCode] || {}).label || '') : '')}${row('Access', vlabel(ACCESS_TYPES, sp.accessType))}
      ${row('Locality', sp.locality)}${row('Bucket', sp.bucket != null ? vlabel(BUCKETS, sp.bucket) : '')}${row('Condition', vlabel(CONDITIONS, sp.condition))}
      ${row('UV', uvListingText(sp))}${row('Dimensions', dims)}${row('Weight', sp.weight ? sp.weight + ' ' + (sp.weightUnit || 'oz') : '')}${row('Quantity', sp.quantity)}
      ${row('Collected at', sp.waypointName || (sp.lat ? sp.lat.toFixed(5) + ', ' + sp.lon.toFixed(5) : ''))}
      ${row('Acquisition', sp.acquisition ? [vlabel(ACQ_METHODS, sp.acquisition.method), sp.acquisition.date, sp.acquisition.cost ? '$' + sp.acquisition.cost : ''].filter(Boolean).join(' · ') : '')}
      ${row('Status', vlabel(SPECIMEN_STATUSES, sp.status))}${row('Price', sp.price ? '$' + sp.price : '')}${row('Platform', sp.platform && sp.platform !== 'none' ? vlabel(PLATFORMS, sp.platform) : '')}
      ${row('Sold', sp.soldPrice ? '$' + sp.soldPrice + (sp.soldDate ? ' on ' + sp.soldDate : '') + (sp.buyer ? ' to ' + sp.buyer : '') : '')}${row('Tags', (sp.tags || []).join(', '))}
      ${sp.provenanceStatement ? `<div style="margin:8px 0;padding:8px;background:#222;border-radius:6px;font-size:13px;font-style:italic">${esc(sp.provenanceStatement)}</div>` : ''}
      ${sp.description ? `<div style="margin:8px 0;padding:8px;background:#222;border-radius:6px;font-size:13px">${esc(sp.description)}</div>` : ''}
      <button onclick="pcGenListing('${esc(sp.id)}')" style="width:100%;padding:10px;background:#1565c0;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-bottom:8px">Generate Listing</button>
      <div id="pc-listing-out" style="display:none;margin-bottom:8px"></div>
      <div style="display:flex;gap:8px"><button onclick="pcEditSpecimen('${esc(sp.id)}')" style="flex:1;padding:10px;background:#1565c0;color:#fff;border:none;border-radius:4px;cursor:pointer">Edit</button>
      <button onclick="pcDeleteSpecimen('${esc(sp.id)}')" style="flex:1;padding:10px;background:#d32f2f;color:#fff;border:none;border-radius:4px;cursor:pointer">Delete</button></div>
    `);
  }
  window.pcGenListing = function (id) {
    const sp = specimensCache.find(s => String(s.id) === String(id)); if (!sp) return;
    const { title, body } = generateListing(sp);
    const out = document.getElementById('pc-listing-out'); if (!out) return;
    out.style.display = 'block';
    out.innerHTML = `<div style="font-size:12px;color:#81c784;margin:4px 0">Suggested: <b>${vlabel(PLATFORMS, suggestPlatform(sp))}</b> · ${esc(suggestPrice(sp))}</div>
      <label style="${LBL}">Title</label><textarea id="pc-lt" style="${INP};height:44px">${esc(title)}</textarea>
      <label style="${LBL}">Body</label><textarea id="pc-lb" style="${INP};height:170px">${esc(body)}</textarea>
      <button onclick="pcCopyListing()" style="padding:8px 12px;background:#455a64;color:#fff;border:none;border-radius:4px;cursor:pointer">Copy Title + Body</button>`;
  };
  window.pcCopyListing = function () {
    const t = document.getElementById('pc-lt')?.value || '', b = document.getElementById('pc-lb')?.value || '';
    const text = t + '\n\n' + b;
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => alert('Listing copied.'));
    else { const ta = document.getElementById('pc-lb'); ta.select(); document.execCommand('copy'); alert('Copied.'); }
  };
  window.pcDeleteSpecimen = async function (id) {
    if (!confirm('Delete this specimen?')) return;
    await fetch('/api/specimen/' + encodeURIComponent(id), { method: 'DELETE' });
    closeModal(); await loadSpecimens();
  };

  // ---- Dig orders ----
  async function loadDigOrders() {
    try { const r = await fetch('/api/digorders'); digOrdersCache = r.ok ? await r.json() : []; }
    catch (e) { digOrdersCache = []; }
    renderDigOrderList();
  }
  function renderDigOrderList() {
    const list = document.getElementById('cat-do-list'); const count = document.getElementById('cat-do-count');
    if (count) count.textContent = digOrdersCache.length;
    if (!list) return;
    const q = (document.getElementById('cat-do-search')?.value || '').trim().toLowerCase();
    let rows = digOrdersCache.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (q) rows = rows.filter(o => (o.client || '').toLowerCase().includes(q) || (o.materialRequested || '').toLowerCase().includes(q) || (o.region || '').toLowerCase().includes(q));
    if (!rows.length) { list.innerHTML = '<div style="color:#777;padding:14px;font-size:12px">No dig orders.</div>'; return; }
    list.innerHTML = '';
    rows.forEach(o => {
      const div = document.createElement('div');
      div.className = 'wp-item'; div.style.cssText = 'padding:8px;border-bottom:1px solid #333;cursor:pointer';
      div.innerHTML = `<div style="font-weight:bold;font-size:13px">${esc(o.client || 'Dig order')}${o.depositPaid ? ' <span style="color:#4caf50;font-size:10px">deposit</span>' : ''}</div>
        <div style="font-size:11px;color:#999">${esc(o.materialRequested || '')}${o.region ? ' · ' + esc(o.region) : ''}</div>
        <div style="font-size:11px;color:#777">${esc(vlabel(DIGORDER_STATUSES, o.status))} · ${esc(vlabel(RATE_TIERS, o.rateTier))}</div>`;
      div.onclick = () => showDigOrderDetail(o.id);
      list.appendChild(div);
    });
  }
  window.pcNewDigOrder = function () { editingDoId = null; doPhotos = []; renderDigOrderForm({ status: 'inquiry', rateTier: 'standard-75', dayRate: 75, estDays: 1, depositMethod: 'etsy' }); };
  window.pcEditDigOrder = function (id) {
    const o = digOrdersCache.find(x => String(x.id) === String(id)); if (!o) return;
    editingDoId = o.id; doPhotos = (o.photos || []).map(f => ({ src: '/photos/' + f, filename: f }));
    renderDigOrderForm(o);
  };
  function renderDigOrderForm(o) {
    openModal(`
      <h2 style="margin:0 0 12px">${editingDoId ? 'Edit' : 'New'} Dig Order</h2>
      <div style="display:flex;gap:8px"><div style="flex:1"><label style="${LBL}">Client</label><input id="pd-client" style="${INP}" value="${esc(o.client || '')}"></div>
      <div style="flex:1"><label style="${LBL}">Contact</label><input id="pd-contact" style="${INP}" value="${esc(o.contact || '')}"></div></div>
      <label style="${LBL}">Material Requested</label><input id="pd-material" style="${INP}" value="${esc(o.materialRequested || '')}">
      <label style="${LBL}">Region / Site</label><select id="pd-region" style="${INP}"><option value="">— Any —</option>${Object.keys(SITE_CODES).map(c => `<option value="${c}"${c === o.region ? ' selected' : ''}>${c} — ${esc(SITE_CODES[c].label)}</option>`).join('')}</select>
      <div style="display:flex;gap:8px"><div style="flex:1"><label style="${LBL}">Quality Target</label><input id="pd-quality" style="${INP}" value="${esc(o.qualityTarget || '')}"></div>
      <div style="flex:1"><label style="${LBL}">Budget</label><input id="pd-budget" style="${INP}" value="${esc(o.budget || '')}"></div>
      <div style="flex:1"><label style="${LBL}">Timeline</label><input id="pd-timeline" style="${INP}" value="${esc(o.timeline || '')}"></div></div>
      <hr style="border-color:#333;margin:12px 0">
      <label style="${LBL}">Rate Tier (SOP-5)</label><select id="pd-rateTier" style="${INP}" onchange="pcRateChange()">${opts(RATE_TIERS, o.rateTier)}</select>
      <div style="display:flex;gap:8px"><div style="flex:1"><label style="${LBL}">Day Rate $</label><input id="pd-dayRate" type="number" style="${INP}" value="${o.dayRate || ''}" oninput="pcDepHint()"></div>
      <div style="flex:1"><label style="${LBL}">Est. Days</label><input id="pd-estDays" type="number" style="${INP}" value="${o.estDays || 1}"></div></div>
      <label style="${LBL}">Fuel Deposit $ <span id="pd-depHint" style="color:#81c784;font-size:11px"></span></label><input id="pd-depositAmount" type="number" style="${INP}" value="${o.depositAmount || ''}">
      <label style="${LBL}">Deposit Method</label><select id="pd-depositMethod" style="${INP}">${opts(DEPOSIT_METHODS, o.depositMethod)}</select>
      <label style="font-size:13px;display:flex;align-items:center;gap:8px;margin:6px 0"><input type="checkbox" id="pd-depositPaid" ${o.depositPaid ? 'checked' : ''}> Deposit paid</label>
      <label style="font-size:13px;display:flex;align-items:center;gap:8px;margin:6px 0"><input type="checkbox" id="pd-balancePaid" ${o.balancePaid ? 'checked' : ''}> Balance paid</label>
      <label style="font-size:13px;display:flex;align-items:center;gap:8px;margin:6px 0"><input type="checkbox" id="pd-termsAccepted" ${o.termsAccepted ? 'checked' : ''}> Terms accepted (in writing)</label>
      <label style="${LBL}">Status</label><select id="pd-status" style="${INP}">${opts(DIGORDER_STATUSES, o.status)}</select>
      <label style="${LBL}">Notes</label><textarea id="pd-notes" style="${INP};min-height:60px">${esc(o.notes || '')}</textarea>
      <label style="${LBL}">Preview / Field Photos</label><div id="pd-photos" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px"></div>
      <button type="button" onclick="pcDoAddPhoto()" style="padding:6px 12px;background:#1565c0;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-bottom:10px">Add Photo</button>
      <div style="display:flex;gap:8px"><button onclick="pcSaveDigOrder()" style="flex:2;padding:10px;background:#4caf50;color:#fff;border:none;border-radius:4px;font-weight:bold;cursor:pointer">Save</button>
      <button onclick="pcCloseModal()" style="flex:1;padding:10px;background:#666;color:#fff;border:none;border-radius:4px;cursor:pointer">Cancel</button></div>
    `);
    renderDoPhotos(); pcDepHint();
  }
  window.pcRateChange = function () {
    const t = RATE_TIERS.find(x => x.v === document.getElementById('pd-rateTier').value);
    if (t && t.dayRate) { const dr = document.getElementById('pd-dayRate'); if (dr && !dr.value) dr.value = t.dayRate; pcDepHint(); }
  };
  window.pcDepHint = function () { const dr = Number(document.getElementById('pd-dayRate')?.value || 0); const h = document.getElementById('pd-depHint'); if (h) h.textContent = dr ? `suggested 50% = $${Math.round(dr * 0.5)}` : ''; };
  window.pcDoAddPhoto = function () {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = async (e) => { for (const f of e.target.files) doPhotos.push({ src: await resizePhoto(f) }); renderDoPhotos(); input.remove(); };
    input.click();
  };
  window.pcDoRemovePhoto = function (i) { doPhotos.splice(i, 1); renderDoPhotos(); };
  function renderDoPhotos() {
    const el = document.getElementById('pd-photos'); if (!el) return;
    el.innerHTML = doPhotos.map((p, i) => `<div style="position:relative"><img src="${p.src}" style="width:70px;height:70px;object-fit:cover;border-radius:6px;border:1px solid #444"><button onclick="pcDoRemovePhoto(${i})" style="position:absolute;top:0;right:0;background:red;color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer">X</button></div>`).join('');
  }
  window.pcSaveDigOrder = async function () {
    const g = id => document.getElementById(id);
    const id = editingDoId || newId('do');
    const prev = editingDoId ? digOrdersCache.find(x => String(x.id) === String(id)) || {} : {};
    const order = {
      ...prev, id, client: g('pd-client').value.trim(), contact: g('pd-contact').value.trim(),
      materialRequested: g('pd-material').value.trim(), region: g('pd-region').value, qualityTarget: g('pd-quality').value.trim(),
      budget: g('pd-budget').value.trim(), timeline: g('pd-timeline').value.trim(), rateTier: g('pd-rateTier').value,
      dayRate: g('pd-dayRate').value ? Number(g('pd-dayRate').value) : null, estDays: g('pd-estDays').value ? Number(g('pd-estDays').value) : null,
      depositAmount: g('pd-depositAmount').value ? Number(g('pd-depositAmount').value) : null, depositMethod: g('pd-depositMethod').value,
      depositPaid: g('pd-depositPaid').checked, balancePaid: g('pd-balancePaid').checked, termsAccepted: g('pd-termsAccepted').checked,
      status: g('pd-status').value, notes: g('pd-notes').value.trim(),
      photos: doPhotos.map(p => p.filename || p.src), synced: true, updatedAt: Date.now()
    };
    if (!order.createdAt) order.createdAt = Date.now();
    if (!order.client && !order.materialRequested) { alert('Add a client or material.'); return; }
    const r = await fetch('/api/digorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order) });
    if (!r.ok) { alert('Save failed.'); return; }
    closeModal(); await loadDigOrders();
  };
  function showDigOrderDetail(id) {
    const o = digOrdersCache.find(x => String(x.id) === String(id)); if (!o) return;
    const linked = specimensCache.filter(s => String(s.digOrderId) === String(id));
    const photoHtml = (o.photos || []).map(f => `<img src="/photos/${f}" style="width:110px;height:110px;object-fit:cover;border-radius:6px;border:1px solid #444">`).join('');
    const row = (k, v) => v ? `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #2a2a2a;font-size:13px"><span style="color:#888">${k}</span><span style="text-align:right;max-width:62%">${esc(v)}</span></div>` : '';
    openModal(`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h2 style="margin:0">${esc(o.client || 'Dig Order')}</h2>
      <button onclick="pcCloseModal()" style="padding:6px 14px;background:#666;color:#fff;border:none;border-radius:4px;cursor:pointer">Close</button></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">${photoHtml}</div>
      ${row('Contact', o.contact)}${row('Material', o.materialRequested)}${row('Region', o.region ? o.region + ' — ' + ((SITE_CODES[o.region] || {}).label || '') : '')}
      ${row('Quality target', o.qualityTarget)}${row('Budget', o.budget)}${row('Timeline', o.timeline)}${row('Rate tier', vlabel(RATE_TIERS, o.rateTier))}
      ${row('Day rate', o.dayRate ? '$' + o.dayRate : '')}${row('Est. days', o.estDays)}
      ${row('Deposit', o.depositAmount ? '$' + o.depositAmount + ' (' + vlabel(DEPOSIT_METHODS, o.depositMethod) + ') ' + (o.depositPaid ? '✓ paid' : 'unpaid') : '')}
      ${row('Balance', o.balancePaid ? '✓ paid' : 'unpaid')}${row('Terms', o.termsAccepted ? '✓ accepted' : 'not accepted')}${row('Status', vlabel(DIGORDER_STATUSES, o.status))}
      ${row('Linked specimens', linked.length ? linked.map(s => s.label || s.name).join(', ') : '')}
      ${o.notes ? `<div style="margin:8px 0;padding:8px;background:#222;border-radius:6px;font-size:13px">${esc(o.notes)}</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:8px"><button onclick="pcEditDigOrder('${esc(o.id)}')" style="flex:1;padding:10px;background:#1565c0;color:#fff;border:none;border-radius:4px;cursor:pointer">Edit</button>
      <button onclick="pcDeleteDigOrder('${esc(o.id)}')" style="flex:1;padding:10px;background:#d32f2f;color:#fff;border:none;border-radius:4px;cursor:pointer">Delete</button></div>
    `);
  }
  window.pcDeleteDigOrder = async function (id) {
    if (!confirm('Delete this dig order?')) return;
    await fetch('/api/digorder/' + encodeURIComponent(id), { method: 'DELETE' });
    closeModal(); await loadDigOrders();
  };

  // ---- Sales Orders ----
  function ordMoney(n) { return '$' + (Number(n) || 0).toFixed(2); }
  function ordSubtotal(items) { return (items || []).reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0); }
  function ordTotal(o) { return ordSubtotal(o.items) + (Number(o.shipping) || 0) + (Number(o.tax) || 0) - (Number(o.discount) || 0); }
  function nextOrderNum() {
    const yy = String(new Date().getFullYear()).slice(-2);
    const re = new RegExp('^ORD-' + yy + '-(\\d+)$');
    let max = 0;
    ordersCache.forEach(o => { const m = (o.orderNumber || '').match(re); if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; } });
    return `ORD-${yy}-${String(max + 1).padStart(3, '0')}`;
  }

  async function loadOrders() {
    try { const r = await fetch('/api/orders'); ordersCache = r.ok ? await r.json() : []; }
    catch (e) { ordersCache = []; }
    renderOrderList();
  }
  function renderOrderList() {
    const list = document.getElementById('cat-ord-list'); const count = document.getElementById('cat-ord-count');
    if (count) count.textContent = ordersCache.length;
    if (!list) return;
    const q = (document.getElementById('cat-ord-search')?.value || '').trim().toLowerCase();
    let rows = ordersCache.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (q) rows = rows.filter(o => (o.orderNumber || '').toLowerCase().includes(q) || ((o.customer || {}).name || '').toLowerCase().includes(q) || (o.items || []).map(it => it.name).join(' ').toLowerCase().includes(q));
    if (!rows.length) { list.innerHTML = '<div style="color:#777;padding:14px;font-size:12px">No orders.</div>'; return; }
    const payColors = { unpaid: '#c62828', partial: '#f9a825', paid: '#1b5e20', refunded: '#6a1b9a' };
    list.innerHTML = '';
    rows.forEach(o => {
      const pay = (o.payment || {}).status || 'unpaid';
      const div = document.createElement('div');
      div.className = 'wp-item'; div.style.cssText = 'padding:8px;border-bottom:1px solid #333;cursor:pointer';
      div.innerHTML = `<div style="font-weight:bold;font-size:13px">${esc(o.orderNumber || 'Order')} <span style="font-size:10px;color:#fff;background:${payColors[pay] || '#555'};border-radius:3px;padding:1px 5px">${esc(vlabel(PAYMENT_STATUSES, pay))}</span></div>
        <div style="font-size:11px;color:#999">${esc((o.customer || {}).name || 'No customer')} · ${ordMoney(ordTotal(o))}</div>
        <div style="font-size:11px;color:#777">${esc(vlabel(ORDER_STATUSES, o.status))}${o.date ? ' · ' + esc(o.date) : ''}</div>`;
      div.onclick = () => showOrderDetail(o.id);
      list.appendChild(div);
    });
  }

  window.pcNewOrder = function () {
    editingOrdId = null; ordFormItems = [];
    renderOrderForm({ orderNumber: nextOrderNum(), date: new Date().toISOString().slice(0, 10), customer: {}, items: [], payment: { status: 'unpaid', method: 'ebay' }, status: 'pending', platform: 'ebay', shipping: 0, tax: 0, discount: 0 });
  };
  window.pcEditOrder = function (id) {
    const o = ordersCache.find(x => String(x.id) === String(id)); if (!o) return;
    editingOrdId = o.id; ordFormItems = (o.items || []).map(it => ({ ...it }));
    renderOrderForm(o);
  };

  function renderOrderForm(o) {
    const c = o.customer || {}, p = o.payment || {};
    const specOpts = '<option value="">+ Add specimen from catalog…</option>' + specimensCache.map(s => `<option value="${esc(s.id)}">${esc(s.label || s.name || 'Specimen')}${s.price ? ' — ' + ordMoney(s.price) : ''}</option>`).join('');
    openModal(`
      <h2 style="margin:0 0 12px">${editingOrdId ? 'Edit' : 'New'} Order</h2>
      <div style="display:flex;gap:8px"><div style="flex:1"><label style="${LBL}">Order #</label><input id="po-number" style="${INP}" value="${esc(o.orderNumber || '')}"></div>
      <div style="flex:1"><label style="${LBL}">Date</label><input id="po-date" type="date" style="${INP}" value="${esc(o.date || '')}"></div></div>
      <h3 style="margin:8px 0 4px;font-size:14px;color:#90caf9">Customer</h3>
      <label style="${LBL}">Name</label><input id="po-cust-name" style="${INP}" value="${esc(c.name || '')}">
      <div style="display:flex;gap:8px"><div style="flex:1"><label style="${LBL}">Email</label><input id="po-cust-email" style="${INP}" value="${esc(c.email || '')}"></div>
      <div style="flex:1"><label style="${LBL}">Phone</label><input id="po-cust-phone" style="${INP}" value="${esc(c.phone || '')}"></div></div>
      <label style="${LBL}">Shipping Address</label><textarea id="po-cust-address" style="${INP};min-height:46px">${esc(c.address || '')}</textarea>
      <div style="display:flex;gap:8px"><div style="flex:1"><label style="${LBL}">Platform</label><select id="po-platform" style="${INP}">${opts(ORDER_PLATFORMS, o.platform)}</select></div>
      <div style="flex:1"><label style="${LBL}">Handle</label><input id="po-cust-handle" style="${INP}" value="${esc(c.handle || '')}"></div></div>

      <h3 style="margin:8px 0 4px;font-size:14px;color:#90caf9">Items</h3>
      <div style="display:flex;gap:6px;font-size:11px;color:#888;padding:0 2px"><span style="flex:2">Item</span><span style="width:70px">Qty</span><span style="width:90px">Unit $</span><span style="width:30px"></span></div>
      <div id="po-items"></div>
      <div style="display:flex;gap:6px;margin:6px 0;align-items:center">
        <button type="button" onclick="pcAddOrderItem()" style="padding:6px 12px;background:#455a64;color:#fff;border:none;border-radius:4px;cursor:pointer">+ Item</button>
        <select onchange="pcAddSpecToOrder(this.value); this.value='';" style="${INP};margin:0;flex:1">${specOpts}</select>
      </div>
      <div style="text-align:right;font-size:13px;color:#aaa">Subtotal: <span id="po-subtotal">$0.00</span></div>
      <div style="display:flex;gap:8px;margin-top:6px"><div style="flex:1"><label style="${LBL}">Shipping $</label><input id="po-shipping" type="number" step="0.01" style="${INP}" value="${o.shipping || ''}" oninput="pcRecomputeOrder()"></div>
      <div style="flex:1"><label style="${LBL}">Tax $</label><input id="po-tax" type="number" step="0.01" style="${INP}" value="${o.tax || ''}" oninput="pcRecomputeOrder()"></div>
      <div style="flex:1"><label style="${LBL}">Discount $</label><input id="po-discount" type="number" step="0.01" style="${INP}" value="${o.discount || ''}" oninput="pcRecomputeOrder()"></div></div>
      <div style="text-align:right;font-size:16px;font-weight:bold;margin-bottom:8px">Total: <span id="po-total">$0.00</span></div>

      <h3 style="margin:8px 0 4px;font-size:14px;color:#90caf9">Payment</h3>
      <div style="display:flex;gap:8px"><div style="flex:1"><label style="${LBL}">Method</label><select id="po-pay-method" style="${INP}">${opts(PAYMENT_METHODS, p.method)}</select></div>
      <div style="flex:1"><label style="${LBL}">Status</label><select id="po-pay-status" style="${INP}">${opts(PAYMENT_STATUSES, p.status)}</select></div></div>
      <div style="display:flex;gap:8px"><div style="flex:1"><label style="${LBL}">Amount Paid $</label><input id="po-pay-amount" type="number" step="0.01" style="${INP}" value="${p.amountPaid || ''}"></div>
      <div style="flex:1"><label style="${LBL}">Paid Date</label><input id="po-pay-date" type="date" style="${INP}" value="${esc(p.paidDate || '')}"></div>
      <div style="flex:1"><label style="${LBL}">Txn ID</label><input id="po-pay-txn" style="${INP}" value="${esc(p.transactionId || '')}"></div></div>

      <h3 style="margin:8px 0 4px;font-size:14px;color:#90caf9">Fulfillment</h3>
      <div style="display:flex;gap:8px"><div style="flex:1"><label style="${LBL}">Status</label><select id="po-status" style="${INP}">${opts(ORDER_STATUSES, o.status)}</select></div>
      <div style="flex:1"><label style="${LBL}">Carrier</label><input id="po-carrier" style="${INP}" value="${esc(o.carrier || '')}"></div></div>
      <div style="display:flex;gap:8px"><div style="flex:2"><label style="${LBL}">Tracking #</label><input id="po-tracking" style="${INP}" value="${esc(o.trackingNumber || '')}"></div>
      <div style="flex:1"><label style="${LBL}">Shipped Date</label><input id="po-shipped-date" type="date" style="${INP}" value="${esc(o.shippedDate || '')}"></div></div>
      <label style="${LBL}">Notes</label><textarea id="po-notes" style="${INP};min-height:46px">${esc(o.notes || '')}</textarea>
      <div style="display:flex;gap:8px;margin-top:8px"><button onclick="pcSaveOrder()" style="flex:2;padding:10px;background:#4caf50;color:#fff;border:none;border-radius:4px;font-weight:bold;cursor:pointer">Save Order</button>
      <button onclick="pcCloseModal()" style="flex:1;padding:10px;background:#666;color:#fff;border:none;border-radius:4px;cursor:pointer">Cancel</button></div>
    `);
    renderOrderItemsPc();
  }

  const POI = 'padding:7px;border:1px solid #444;border-radius:4px;background:#222;color:#fff;font-size:13px';
  function renderOrderItemsPc() {
    const el = document.getElementById('po-items'); if (!el) return;
    if (!ordFormItems.length) { el.innerHTML = '<div style="color:#666;font-size:12px;padding:4px 2px">No items yet.</div>'; }
    else el.innerHTML = ordFormItems.map((it, i) => `
      <div style="display:flex;gap:6px;margin-bottom:5px;align-items:center">
        <input type="text" value="${esc(it.name || '')}" placeholder="Item name" oninput="pcUpdOrderItem(${i},'name',this.value)" style="${POI};flex:2;min-width:0">
        <input type="number" min="0" value="${it.quantity != null ? it.quantity : 1}" oninput="pcUpdOrderItem(${i},'quantity',this.value)" style="${POI};width:70px">
        <input type="number" step="0.01" min="0" value="${it.unitPrice != null ? it.unitPrice : ''}" placeholder="0.00" oninput="pcUpdOrderItem(${i},'unitPrice',this.value)" style="${POI};width:90px">
        <button type="button" onclick="pcRemoveOrderItem(${i})" style="background:#c62828;color:#fff;border:none;border-radius:50%;width:26px;height:26px;flex-shrink:0;cursor:pointer">×</button>
      </div>`).join('');
    pcRecomputeOrder();
  }
  window.pcAddOrderItem = function () { ordFormItems.push({ name: '', quantity: 1, unitPrice: 0 }); renderOrderItemsPc(); };
  window.pcRemoveOrderItem = function (i) { ordFormItems.splice(i, 1); renderOrderItemsPc(); };
  window.pcUpdOrderItem = function (i, f, v) { if (!ordFormItems[i]) return; ordFormItems[i][f] = (f === 'name') ? v : (Number(v) || 0); pcRecomputeOrder(); };
  window.pcAddSpecToOrder = function (specId) {
    if (!specId) return;
    const s = specimensCache.find(x => String(x.id) === String(specId)); if (!s) return;
    ordFormItems.push({ specimenId: s.id, name: s.label ? `${s.label} ${s.name || ''}`.trim() : (s.name || 'Specimen'), quantity: 1, unitPrice: Number(s.price) || 0 });
    renderOrderItemsPc();
  };
  window.pcRecomputeOrder = function () {
    const sub = ordSubtotal(ordFormItems);
    const g = id => Number((document.getElementById(id) || {}).value) || 0;
    const total = sub + g('po-shipping') + g('po-tax') - g('po-discount');
    const se = document.getElementById('po-subtotal'); if (se) se.textContent = ordMoney(sub);
    const te = document.getElementById('po-total'); if (te) te.textContent = ordMoney(total);
  };

  window.pcSaveOrder = async function () {
    const g = id => document.getElementById(id);
    const id = editingOrdId || newId('ord');
    const prev = editingOrdId ? ordersCache.find(x => String(x.id) === String(id)) || {} : {};
    const order = {
      ...prev, id,
      orderNumber: g('po-number').value.trim(), date: g('po-date').value || null,
      customer: { name: g('po-cust-name').value.trim(), email: g('po-cust-email').value.trim(), phone: g('po-cust-phone').value.trim(), address: g('po-cust-address').value.trim(), handle: g('po-cust-handle').value.trim() },
      platform: g('po-platform').value,
      items: ordFormItems.map(it => ({ specimenId: it.specimenId || null, name: (it.name || '').trim(), quantity: Number(it.quantity) || 0, unitPrice: Number(it.unitPrice) || 0 })).filter(it => it.name || it.quantity || it.unitPrice),
      shipping: g('po-shipping').value ? Number(g('po-shipping').value) : 0,
      tax: g('po-tax').value ? Number(g('po-tax').value) : 0,
      discount: g('po-discount').value ? Number(g('po-discount').value) : 0,
      payment: { method: g('po-pay-method').value, status: g('po-pay-status').value, amountPaid: g('po-pay-amount').value ? Number(g('po-pay-amount').value) : 0, paidDate: g('po-pay-date').value || null, transactionId: g('po-pay-txn').value.trim() },
      status: g('po-status').value, carrier: g('po-carrier').value.trim(), trackingNumber: g('po-tracking').value.trim(), shippedDate: g('po-shipped-date').value || null,
      notes: g('po-notes').value.trim(), synced: true, updatedAt: Date.now()
    };
    if (!order.createdAt) order.createdAt = Date.now();
    if (!order.customer.name && !order.items.length) { alert('Add a customer or at least one item.'); return; }
    const r = await fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order) });
    if (!r.ok) { alert('Save failed.'); return; }
    closeModal(); await loadOrders();
  };

  function showOrderDetail(id) {
    const o = ordersCache.find(x => String(x.id) === String(id)); if (!o) return;
    const c = o.customer || {}, p = o.payment || {};
    const row = (k, v) => v ? `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #2a2a2a;font-size:13px"><span style="color:#888">${k}</span><span style="text-align:right;max-width:62%">${esc(v)}</span></div>` : '';
    const items = (o.items || []).map(it => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0"><span>${esc(it.name || 'Item')} × ${it.quantity}</span><span>${ordMoney((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0))}</span></div>`).join('') || '<div style="color:#777;font-size:12px">No items</div>';
    openModal(`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h2 style="margin:0">${esc(o.orderNumber || 'Order')}</h2>
      <button onclick="pcCloseModal()" style="padding:6px 14px;background:#666;color:#fff;border:none;border-radius:4px;cursor:pointer">Close</button></div>
      <div style="font-size:12px;color:#999;margin-bottom:8px">${o.date ? esc(o.date) : ''}</div>
      <h3 style="margin:6px 0 4px;font-size:14px;color:#90caf9">Customer</h3>
      ${row('Name', c.name)}${row('Email', c.email)}${row('Phone', c.phone)}${row('Address', c.address)}${row('Platform', vlabel(ORDER_PLATFORMS, o.platform))}${row('Handle', c.handle)}
      <h3 style="margin:10px 0 4px;font-size:14px;color:#90caf9">Items</h3>${items}
      <div style="border-top:1px solid #2a2a2a;margin-top:6px;padding-top:6px">
        ${row('Subtotal', ordMoney(ordSubtotal(o.items)))}${o.shipping ? row('Shipping', ordMoney(o.shipping)) : ''}${o.tax ? row('Tax', ordMoney(o.tax)) : ''}${o.discount ? row('Discount', '-' + ordMoney(o.discount)) : ''}
        <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:15px;padding-top:4px"><span>Total</span><span>${ordMoney(ordTotal(o))}</span></div>
      </div>
      <h3 style="margin:10px 0 4px;font-size:14px;color:#90caf9">Payment</h3>
      ${row('Method', vlabel(PAYMENT_METHODS, p.method))}${row('Status', vlabel(PAYMENT_STATUSES, p.status))}${p.amountPaid ? row('Amount paid', ordMoney(p.amountPaid)) : ''}${row('Paid date', p.paidDate)}${row('Txn ID', p.transactionId)}
      <h3 style="margin:10px 0 4px;font-size:14px;color:#90caf9">Fulfillment</h3>
      ${row('Status', vlabel(ORDER_STATUSES, o.status))}${row('Carrier', o.carrier)}${row('Tracking', o.trackingNumber)}${row('Shipped', o.shippedDate)}
      ${o.notes ? `<div style="margin:8px 0;padding:8px;background:#222;border-radius:6px;font-size:13px">${esc(o.notes)}</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:8px"><button onclick="pcEditOrder('${esc(o.id)}')" style="flex:1;padding:10px;background:#1565c0;color:#fff;border:none;border-radius:4px;cursor:pointer">Edit</button>
      <button onclick="pcDeleteOrder('${esc(o.id)}')" style="flex:1;padding:10px;background:#d32f2f;color:#fff;border:none;border-radius:4px;cursor:pointer">Delete</button></div>
    `);
  }
  window.pcDeleteOrder = async function (id) {
    if (!confirm('Delete this order?')) return;
    await fetch('/api/order/' + encodeURIComponent(id), { method: 'DELETE' });
    closeModal(); await loadOrders();
  };

  // ---- Init ----
  document.addEventListener('DOMContentLoaded', () => {
    const bind = (id, fn, ev) => { const el = document.getElementById(id); if (el) el.addEventListener(ev || 'click', fn); };
    bind('toggle-catalog', loadSpecimens);
    bind('toggle-digorders', loadDigOrders);
    bind('toggle-orders', loadOrders);
    bind('cat-new-specimen', () => window.pcNewSpecimen());
    bind('cat-new-digorder', () => window.pcNewDigOrder());
    bind('cat-new-order', () => window.pcNewOrder());
    bind('cat-spec-search', renderSpecimenList, 'input');
    bind('cat-do-search', renderDigOrderList, 'input');
    bind('cat-ord-search', renderOrderList, 'input');
    // Warm the caches so the panels are populated on first open.
    loadSpecimens(); loadDigOrders(); loadOrders();
  });
})();
