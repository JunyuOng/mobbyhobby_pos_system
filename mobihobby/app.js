// ── MOBIHOBBY POS — app.js ──
// All app logic. Works fully offline. Syncs via sync.js when online.

// ── LOCAL DATA (globals used by sync.js too) ──
let products = JSON.parse(localStorage.getItem('mhf_p') || '[]');
let sales    = JSON.parse(localStorage.getItem('mhf_s') || '[]');
let events   = JSON.parse(localStorage.getItem('mhf_ev') || '[]');
let activeEventId = localStorage.getItem('mhf_aev') || '';
let receiptCounter = parseInt(localStorage.getItem('mhf_rc') || '0');

// Pre-order module collections (Customer → Items → Model). Kept separate from
// products/sales so existing POS data is never touched.
let customers = JSON.parse(localStorage.getItem('mhf_cust') || '[]');
let poBatches = JSON.parse(localStorage.getItem('mhf_pob')  || '[]');
let poItems   = JSON.parse(localStorage.getItem('mhf_poi')  || '[]');

// expose for sync.js
window.products  = products;
window.sales     = sales;
window.events    = events;
window.customers = customers;
window.poBatches = poBatches;
window.poItems   = poItems;

function _localSave() {
  try {
    localStorage.setItem('mhf_p',  JSON.stringify(products));
    localStorage.setItem('mhf_s',  JSON.stringify(sales));
    localStorage.setItem('mhf_ev', JSON.stringify(events));
    localStorage.setItem('mhf_rc', String(receiptCounter));
    localStorage.setItem('mhf_cust', JSON.stringify(customers));
    localStorage.setItem('mhf_pob',  JSON.stringify(poBatches));
    localStorage.setItem('mhf_poi',  JSON.stringify(poItems));
  } catch(e) { if (typeof poToast === 'function') poToast('Storage full — changes may not persist'); }
}
window._localSave = _localSave;

function save(syncType, syncData) {
  _localSave();
  if (syncType && window.SyncEngine) {
    window.SyncEngine.push(syncType, syncData).catch(() => {});
  }
}

// ── LOGO (reusable brand component) ──
// Single source of truth. To replace the logo, drop a new file at assets/logo.svg
// OR point this one constant at any path (PNG/JPG/SVG). Every logo slot in the UI
// (sidebar, lock screen, topbar — any <img data-mh-logo>) updates from here.
// Sizing is em-based in CSS (no fixed dimensions) and the SVG is transparent so it
// works on light/dark and inside a collapsed sidebar. If the asset is missing, the
// slot degrades to a text badge instead of a broken-image icon.
// Drop your shop logo at assets/logo.png (transparent PNG) — it's the full
// lockup and replaces the wordmark text everywhere. Falls back to assets/logo.svg,
// then a small "MH" badge if neither exists.
const MH_LOGO_SRC = 'assets/logo.png';
const MH_LOGO_FALLBACK = 'assets/logo.svg';
function applyLogo() {
  document.querySelectorAll('img[data-mh-logo]').forEach(img => {
    img.onerror = () => {
      if (!img.dataset.mhTriedSvg) { img.dataset.mhTriedSvg = '1'; img.src = MH_LOGO_FALLBACK; return; }
      img.onerror = null;
      const badge = document.createElement('span');
      badge.className = 'mh-logo-fallback ' + img.className;
      badge.textContent = 'MH';
      img.replaceWith(badge);
    };
    img.src = MH_LOGO_SRC;
  });
}

// ── THEME ──
function initTheme() {
  const t = localStorage.getItem('mh_theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
  updateThemeBtn(t);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('mh_theme', next);
  updateThemeBtn(next);
}
function updateThemeBtn(t) {
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = t === 'dark' ? '☀' : '🌙';
}

// ── DEVICE / IDs ──
function genCode() { return 'MH' + (Math.floor(Math.random() * 9e9) + 1e9); }
function genBarcode() { document.getElementById('f-bc').value = genCode(); }
function nextReceiptNo() {
  receiptCounter++;
  localStorage.setItem('mhf_rc', String(receiptCounter));
  return String(receiptCounter).padStart(6, '0');
}

// ── CODE 128B BARCODE ──
const C128 = ['11011001100','11001101100','11001100110','10010011000','10010001100','10001001100','10011001000','10011000100','10001100100','11001001000','11001000100','11000100100','10110011100','10011011100','10011001110','10111001100','10011101100','10011100110','11001110010','11001011100','11001001110','11011100100','11001110100','11101101110','11101001100','11100101100','11100100110','11101100100','11100110100','11100110010','11011011000','11011000110','11000110110','10100011000','10001011000','10001000110','10110001000','10001101000','10001100010','11010001000','11000101000','11000100010','10110111000','10110001110','10001101110','10111011000','10111000110','10001110110','11101110110','11010001110','11000101110','11011101000','11011100010','11011101110','11101011000','11101000110','11100010110','11101101000','11101100010','11100011010','11101111010','11001000010','11110001010','10100110000','10100001100','10010110000','10010000110','10000101100','10000100110','10110010000','10110000100','10011010000','10011000010','10000110100','10000110010','11000010010','11001010000','11110111010','11000010100','10001111010','10100111100','10010111100','10010011110','10111100100','10011110100','10011110010','11110100100','11110010100','11110010010','11011011110','11011110110','11110110110','10101111000','10100011110','10001011110','10111101000','10111100010','11110101000','11110100010','10111011110','10111101110','11101011110','11110101110','11010000100','11010010000','11010011100','11000111010','11'];
function code128B(t) { const v=[104]; for(let i=0;i<t.length;i++) v.push(t.charCodeAt(i)-32); let c=104; for(let i=1;i<v.length;i++) c+=v[i]*i; v.push(c%103); v.push(106); return v.map(x=>C128[x]).join(''); }
// Bars only, supersampled `scale`× so the printer gets a high-DPI bitmap
// (at scale 6 a 44mm-wide label works out to ~500dpi — no interpolation blur).
// The human-readable digits are NOT baked into the canvas any more: they are
// printed as real text under the image, so they stay vector-sharp at any
// printer resolution instead of being a rasterized 7px bitmap.
function drawBarcode(text, scale, h, qz) {
  const p=code128B(text), cv=document.createElement('canvas');
  cv.width=(p.length+qz*2)*scale; cv.height=h*scale;
  const ctx=cv.getContext('2d');
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,cv.width,cv.height);
  ctx.fillStyle='#000'; let x=qz*scale;
  for(let i=0;i<p.length;i++){if(p[i]==='1')ctx.fillRect(x,0,scale,cv.height);x+=scale;}
  return cv.toDataURL('image/png');
}

// ── SOUNDS + HAPTICS ──
// One shared AudioContext — creating a new one per scan hits the browser's
// hard limit (~6) and then silently fails, which is why beeps stopped firing.
let _audioCtx = null;
function _getAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!_audioCtx) _audioCtx = new AC();
    // Mobile browsers suspend the context until a user gesture — a scan is one.
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
  } catch(e) { return null; }
}
// Returns true if a real vibration was triggered (used to verify haptics).
function _vibrate(pattern) {
  try { if (navigator.vibrate) return navigator.vibrate(pattern) === true || true; } catch(e){}
  return false;
}
function _tone(a, freq, type, start, dur, peak) {
  const o = a.createOscillator(), g = a.createGain();
  o.connect(g); g.connect(a.destination);
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(peak, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.start(start); o.stop(start + dur);
}
function beepOk() {
  const a = _getAudio();
  if (a) {
    const t = a.currentTime;
    // bright two-note rising chirp — louder and clearer than a single tone
    _tone(a, 1046, 'square', t,        0.10, 1.0); // C6
    _tone(a, 1568, 'square', t + 0.08, 0.14, 1.0); // G6
  }
  _vibrate(50);
}
function beepErr() {
  const a = _getAudio();
  if (a) {
    const t = a.currentTime;
    // sharp low double-buzz — square wave cuts through better than sawtooth
    _tone(a, 200, 'square', t,        0.14, 1.0);
    _tone(a, 140, 'square', t + 0.16, 0.20, 1.0);
  }
  _vibrate([90, 50, 90]);
}

// ── CART (shared, persists across tabs) ──
let sellCart = [];
let discType = 'rm';
let lockDiscType = 'rm';
const CASHIER_DISC_LIMIT_PCT = 20; // above this needs manager approval

// ── SALES TYPE / PLATFORM (Physical vs Online) ──
// Physical: an in-person sale. Auto-attached to the Active Event, or "Walk-in"
//   when none is active. platform = None.
// Online: requires a platform; event is always "Online" and is never attached
//   to a physical event.
// Backward compatible: legacy records (channel/salesChannel) are normalized on read.
const SALES_TYPES = ['Physical', 'Online'];
const PLATFORMS = ['Facebook', 'WhatsApp', 'Rednote', 'Other'];
const WALK_IN = 'Walk-in';
const ONLINE_EVENT = 'Online';
// Normalize any record (new OR legacy) to { salesType, event, platform }.
function saleView(s) {
  if (!s) return { salesType: 'Physical', event: WALK_IN, platform: 'None' };
  if (s.salesType) return { salesType: s.salesType, event: s.event || WALK_IN, platform: s.platform || 'None' };
  // legacy derivation from old channel/salesChannel
  const ch = s.salesChannel || s.channel || '';
  if (ch === 'Online' || PLATFORMS.includes(ch)) {
    return { salesType: 'Online', event: ONLINE_EVENT, platform: PLATFORMS.includes(ch) ? ch : 'Other' };
  }
  return { salesType: 'Physical', event: s.eventName || s.event || WALK_IN, platform: 'None' };
}

// ── PIN ──
let pinVal = '', pinCallback = null, pinMode = 'check', pinFirstEntry = '';
// PIN is fixed across all devices — change here when cloud PIN sync is ready
const MANAGER_PIN = '0858';
function getStoredPin() { return MANAGER_PIN; }

// openSetPin removed — PIN is fixed at MANAGER_PIN
function requirePin(cb) {
  pinCallback = cb;
  _openPinDialog('check', 'Enter Manager PIN', 'Enter PIN to continue');
}
function _openPinDialog(mode, title, sub) {
  pinMode = mode; pinVal = '';
  document.getElementById('pin-title').textContent = title;
  document.getElementById('pin-sub').textContent = sub;
  document.getElementById('pin-err').textContent = '';
  updatePinDots();
  document.getElementById('pin-overlay').classList.add('open');
}
function pinPress(d) { if (pinVal.length >= 4) return; pinVal += d; updatePinDots(); if (pinVal.length === 4) setTimeout(submitPin, 120); }
function pinBackspace() { pinVal = pinVal.slice(0,-1); updatePinDots(); }
function updatePinDots() { for(let i=0;i<4;i++) { const d=document.getElementById('pd'+i); if(d) d.classList.toggle('filled', i<pinVal.length); } }
function submitPin() {
  // only 'check' mode active — set1/set2 removed (PIN is fixed)
  if (pinVal === getStoredPin()) {
    document.getElementById('pin-overlay').classList.remove('open');
    const cb = pinCallback; pinCallback = null; pinVal = '';
    if (cb) cb();
  } else {
    document.getElementById('pin-err').textContent = 'Wrong PIN';
    pinVal = ''; updatePinDots(); beepErr();
  }
}
function cancelPin() { document.getElementById('pin-overlay').classList.remove('open'); pinVal=''; pinCallback=null; pinMode='check'; }

// ── CASHIER MODE ──
let _inCashierMode = false;

function enterCashierMode() {
  _inCashierMode = true;
  document.getElementById('main-app').style.display = 'none';
  document.getElementById('cashier-lock').classList.add('show');
  updateTopbarEvent();
  setSaleType(true, poDefaultSaleType());
  lockRenderCart();
  // reset stale PIN state so manager button always works fresh
  pinVal = ''; pinCallback = null; pinMode = 'check';
  setTimeout(() => { const i = document.getElementById('lock-scan-input'); if(i) i.focus(); }, 200);
}

function exitCashierMode() {
  _inCashierMode = false;
  document.getElementById('cashier-lock').classList.remove('show');
  document.getElementById('main-app').style.display = 'flex';
  renderSellCart();
  updateTopbarEvent();
}

// ── NAV ──
let currentTab = 'inventory';
const TITLES = { sell:'Sell', inventory:'Inventory', events:'Events', sold:'Sold Items', labels:'Print Labels', importexport:'Import / Export', history:'History', preorders:'Pre-orders' };
function goTab(t) {
  if (t === currentTab) return;
  const op = document.getElementById('panel-' + currentTab);
  const np = document.getElementById('panel-' + t);
  if (op) { op.classList.add('leaving'); op.addEventListener('animationend', () => op.classList.remove('active','leaving'), {once:true}); }
  setTimeout(() => { np.classList.add('active','entering'); np.addEventListener('animationend', () => np.classList.remove('entering'), {once:true}); }, 80);
  currentTab = t;
  document.querySelectorAll('.nav-item,.tab-item').forEach(n => n.classList.remove('active'));
  const sn = document.getElementById('snav-'+t); if (sn) sn.classList.add('active');
  const bn = document.getElementById('bnav-'+t); if (bn) bn.classList.add('active');
  const te = document.getElementById('topbar-title');
  te.style.opacity = '0'; setTimeout(() => { te.textContent = TITLES[t]; te.style.opacity = '1'; }, 100);
  if (t === 'inventory')    { renderInventory(); renderStats(); }
  if (t === 'history')      { populateHistEventFilter(); setHistMode(histMode); }
  if (t === 'labels')       { renderLabelList(''); }
  if (t === 'events')       { renderEventList(); }
  if (t === 'sold')         { renderSoldItems(); }
  if (t === 'preorders')    { renderPreorders(); }
  if (t === 'sell')         { updateTopbarEvent(); setSaleType(false, poDefaultSaleType()); renderSellCart(); setTimeout(() => document.getElementById('sell-input').focus(), 200); }
}

// ── EVENTS (store events) ──
function getActiveEvent() { return events.find(e => e.id === activeEventId) || null; }
function updateTopbarEvent() {
  const ev = getActiveEvent();
  const name = ev ? ev.name : 'No event';
  const te = document.getElementById('topbar-event'); if (te) te.textContent = '📅 ' + name;
  const se = document.getElementById('sell-event-name'); if (se) se.textContent = ev ? name : 'No event selected';
  const le = document.getElementById('lock-event-name'); if (le) le.textContent = ev ? '📅 ' + name : 'No event selected';
  refreshSaleTypeUI();
}
// ── SALE TYPE UI (Physical | Online) ──
let sellSaleType = 'Online';
let lockSaleType = 'Online';
// Default sale type: Physical when an event is active, else Online (no store front).
function poDefaultSaleType() { return getActiveEvent() ? 'Physical' : 'Online'; }
function applyDefaultSaleType() { setSaleType(false, poDefaultSaleType()); setSaleType(true, poDefaultSaleType()); }
function setSaleType(isLock, type) {
  if (isLock) lockSaleType = type; else sellSaleType = type;
  const prefix = isLock ? 'lock' : 'sell';
  document.querySelectorAll('#' + prefix + '-saletype-row .saletype-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.type === type));
  const prow = document.getElementById(prefix + '-platform-row');
  if (prow) prow.style.display = (type === 'Online') ? 'flex' : 'none';
  refreshSaleTypeUI();
}
// Shows where a Physical sale will be filed (the active event).
function refreshSaleTypeUI() {
  const ev = getActiveEvent();
  const target = ev ? ev.name : 'No event';
  [['sell', sellSaleType], ['lock', lockSaleType]].forEach(([prefix, type]) => {
    const hint = document.getElementById(prefix + '-saletype-hint');
    if (hint) hint.textContent = type === 'Physical' ? '→ ' + target : '';
  });
}
function saveActiveEvent() { localStorage.setItem('mhf_aev', activeEventId); }

// NOTE: must NOT be named createEvent — inline on* handlers resolve names
// against `document` first, where createEvent is a native (deprecated) method,
// so onclick="createEvent()" would call document.createEvent() and throw.
function createNewEvent() {
  const nameEl = document.getElementById('ev-name');
  const dateEl = document.getElementById('ev-date');
  const locEl  = document.getElementById('ev-loc');
  if (!nameEl || !dateEl || !locEl) { console.error('[createNewEvent] Missing form elements'); return; }
  const name = nameEl.value.trim();
  const date = dateEl.value;
  const loc  = locEl.value.trim();
  if (!name) { showMsg('ev-msg', 'Event name is required', 'err'); return; }
  const ev = { id: 'ev_' + Date.now(), name, date, loc, createdAt: new Date().toISOString() };
  events.unshift(ev);
  activeEventId = ev.id;
  saveActiveEvent();
  save('EVENT_UPSERT', ev);
  updateTopbarEvent();
  applyDefaultSaleType();
  nameEl.value = '';
  locEl.value = '';
  showMsg('ev-msg', 'Event created and set as active', 'ok');
  renderEventList();
}
function setActiveEvent(id) { activeEventId = id; saveActiveEvent(); updateTopbarEvent(); applyDefaultSaleType(); renderEventList(); }
function deleteEvent(id) {
  requirePin(() => {
    if (!confirm('Delete this event? Sales stay in history.')) return;
    events = events.filter(e => e.id !== id);
    if (activeEventId === id) { activeEventId = ''; saveActiveEvent(); updateTopbarEvent(); }
    save('EVENT_UPSERT', { id, _deleted: true });
    renderEventList();
  });
}
function renderEventList() {
  const el = document.getElementById('event-list');
  if (!events.length) { el.innerHTML = '<div class="empty-state"><span class="empty-icon">📅</span><div class="empty-title">No events yet</div></div>'; return; }
  el.innerHTML = events.map(ev => {
    const isActive = ev.id === activeEventId;
    const evSales = sales.filter(s => s.eventId === ev.id);
    const evTotal = evSales.reduce((a,s) => a + parseFloat(s.total), 0);
    return `<div class="event-card ${isActive ? 'active-event' : ''}">
      <div class="event-card-info">
        <div class="event-card-name">${isActive ? '✅ ' : ''} ${ev.name}</div>
        <div class="event-card-meta">${ev.date||'No date'}${ev.loc?' · '+ev.loc:''} · ${evSales.length} sales · RM ${evTotal.toFixed(2)}</div>
      </div>
      ${!isActive ? `<button class="btn btn-ghost btn-sm" onclick="setActiveEvent('${ev.id}')">Set active</button>` : '<span style="font-size:11px;color:var(--blue);font-weight:600">Active</span>'}
      <button class="btn btn-danger btn-sm" onclick="deleteEvent('${ev.id}')">✕</button>
    </div>`;
  }).join('');
}

// ── SELL ──
function setDiscType(t) { discType=t; document.getElementById('disc-rm').classList.toggle('active',t==='rm'); document.getElementById('disc-pct').classList.toggle('active',t==='pct'); renderCartTotals(); }
function lockSetDiscType(t) { lockDiscType=t; document.getElementById('lock-disc-rm').classList.toggle('active',t==='rm'); document.getElementById('lock-disc-pct').classList.toggle('active',t==='pct'); lockRenderTotals(); }

function _getDiscountAmount(sub, val, type) {
  if (!val) return 0;
  return type === 'rm' ? Math.min(val, sub) : Math.min(sub * val / 100, sub);
}
function getDiscount(sub) { return _getDiscountAmount(sub, parseFloat(document.getElementById('disc-val').value)||0, discType); }
function lockGetDiscount(sub) { return _getDiscountAmount(sub, parseFloat(document.getElementById('lock-disc-val').value)||0, lockDiscType); }

function _discNeedsApproval(sub, val, type) {
  const pct = type === 'rm' ? (val / sub * 100) : val;
  return pct > CASHIER_DISC_LIMIT_PCT;
}

function scanSell() {
  const inp = document.getElementById('sell-input');
  const bc = inp.value.trim(); inp.value = ''; inp.focus();
  if (!bc) { showMsg('sell-msg','Nothing scanned','err'); beepErr(); return; }
  const p = products.find(x => x.barcode === bc);
  if (!p) { showMsg('sell-msg','Not found: '+bc,'err'); beepErr(); return; }
  const ex = sellCart.find(c => c.barcode === bc);
  // hard sold-out block — robust to missing/zero/NaN stock (no silent add)
  if ((p.stock || 0) <= 0) { showMsg('sell-msg',p.name+' — Item is sold out','err'); beepErr(); return; }
  if ((ex ? ex.qty : 0) >= p.stock) { showMsg('sell-msg',p.name+' — no more stock available','err'); beepErr(); return; }
  if (ex) { ex.qty++; } else { sellCart.push({ barcode:p.barcode, name:p.name, brand:p.brand, scale:p.scale, price:p.price, discPrice:undefined, qty:1, img:p.img||null }); }
  beepOk(); showLastScan(p, ex?ex.qty:1); renderSellCart(); showMsg('sell-msg','','ok');
}

// Lock-screen status message (was referenced everywhere but never defined —
// caused a ReferenceError that swallowed cashier scan warnings, incl. sold-out).
function lockMsg(text, type) {
  const el = document.getElementById('lock-msg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'lock-msg' + (text ? (type === 'err' ? ' err' : ' ok') : '');
  if (type === 'ok' && text) setTimeout(() => { if (el) { el.textContent = ''; el.className = 'lock-msg'; } }, 2500);
}

function lockScan() {
  const inp = document.getElementById('lock-scan-input');
  const bc = inp.value.trim(); inp.value = ''; inp.focus();
  if (!bc) { lockMsg('Nothing scanned','err'); beepErr(); return; }
  const p = products.find(x => x.barcode === bc);
  if (!p) { lockMsg('Not found: '+bc,'err'); beepErr(); return; }
  const ex = sellCart.find(c => c.barcode === bc);
  // hard sold-out block — robust to missing/zero/NaN stock (no silent add)
  if ((p.stock || 0) <= 0) { lockMsg(p.name+' — Item is sold out','err'); beepErr(); return; }
  if ((ex?ex.qty:0) >= p.stock) { lockMsg(p.name+' — no more stock available','err'); beepErr(); return; }
  if (ex) { ex.qty++; } else { sellCart.push({ barcode:p.barcode, name:p.name, brand:p.brand, scale:p.scale, price:p.price, discPrice:undefined, qty:1, img:p.img||null }); }
  beepOk(); lockShowLastScan(p, ex?ex.qty:1); lockRenderCart(); lockMsg('','ok');
}

let lastScanTimer = null;
function showLastScan(p, qty) {
  clearTimeout(lastScanTimer);
  document.getElementById('ls-name').textContent = p.name;
  document.getElementById('ls-sub').textContent = p.brand + ' · RM ' + p.price.toFixed(2);
  document.getElementById('ls-badge').textContent = '×' + qty;
  document.getElementById('ls-img-wrap').innerHTML = p.img ? `<img class="ls-img" src="${p.img}" alt="">` : `<div class="ls-ph">🚗</div>`;
  document.getElementById('last-scan').classList.add('show');
  lastScanTimer = setTimeout(() => document.getElementById('last-scan').classList.remove('show'), 2500);
}

let lockLastScanTimer = null;
function lockShowLastScan(p, qty) {
  clearTimeout(lockLastScanTimer);
  document.getElementById('lock-ls-name').textContent = p.name;
  document.getElementById('lock-ls-sub').textContent = p.brand + ' · RM ' + p.price.toFixed(2);
  document.getElementById('lock-ls-badge').textContent = '×' + qty;
  document.getElementById('lock-ls-img').innerHTML = p.img ? `<img class="lock-ls-img" src="${p.img}" alt="">` : `<div class="lock-ls-ph">🚗</div>`;
  document.getElementById('lock-last-scan').classList.add('show');
  lockLastScanTimer = setTimeout(() => document.getElementById('lock-last-scan').classList.remove('show'), 2500);
}

function renderSellCart() {
  const list = document.getElementById('sell-cart-list');
  const btn  = document.getElementById('done-btn');
  if (!sellCart.length) {
    list.innerHTML = `<div class="cart-empty"><span class="cart-empty-icon">🛒</span>Scan an item to start</div>`;
    document.getElementById('cart-meta').textContent = '';
    btn.disabled = true; renderCartTotals(); return;
  }
  const tq = sellCart.reduce((a,c) => a+c.qty, 0);
  document.getElementById('cart-meta').textContent = `${tq} item${tq!==1?'s':''} · ${sellCart.length} product${sellCart.length!==1?'s':''}`;
  btn.disabled = false;
  list.innerHTML = sellCart.map(c => {
    const dp = c.discPrice !== undefined ? c.discPrice : c.price;
    const hasDisc = c.discPrice !== undefined && c.discPrice !== c.price;
    return `<div class="cart-row">
      ${c.img ? `<img class="cart-thumb" src="${c.img}" alt="">` : `<div class="cart-ph">🚗</div>`}
      <div class="cart-info">
        <div class="cart-name">${c.name}</div>
        <div class="cart-sub">${c.brand} · ${c.scale}</div>
        <div class="cart-price-row">
          ${hasDisc ? `<span class="cart-orig-price">RM ${c.price.toFixed(2)}</span>` : ''}
          <span class="cart-final-price">RM ${dp.toFixed(2)}</span>
          <input class="item-disc-input" type="number" placeholder="Override RM" value="${hasDisc?dp:''}" min="0" step="0.01" inputmode="decimal"
            onchange="setItemDisc('${c.barcode}',this.value)" title="Override price for this item">
        </div>
      </div>
      <div class="stepper">
        <button class="stepper-btn" onclick="sellQty('${c.barcode}',-1)">−</button>
        <span class="stepper-qty">${c.qty}</span>
        <button class="stepper-btn" onclick="sellQty('${c.barcode}',1)">+</button>
      </div>
      <button class="remove-btn" onclick="removeSellItem('${c.barcode}')">✕</button>
    </div>`;
  }).join('');
  renderCartTotals();
}

function renderCartTotals() {
  const sub  = sellCart.reduce((a,c) => a+(c.discPrice!==undefined?c.discPrice:c.price)*c.qty, 0);
  const val  = parseFloat(document.getElementById('disc-val').value) || 0;
  const disc = getDiscount(sub);
  const total = Math.max(0, sub - disc);
  document.getElementById('sell-total').textContent = total.toFixed(2);
  const sl = document.getElementById('subtotal-line');
  const dp = document.getElementById('disc-preview');
  if (disc > 0) { sl.textContent = `Subtotal RM ${sub.toFixed(2)} − RM ${disc.toFixed(2)}`; dp.textContent = `−RM ${disc.toFixed(2)}`; }
  else { sl.textContent=''; dp.textContent=''; }
  // manager approval warning
  const warn = document.getElementById('mgr-approval-warn');
  if (warn && val > 0 && _discNeedsApproval(sub, val, discType)) {
    warn.textContent = '⚠ Over 20% — manager approval required'; warn.classList.add('show');
  } else if (warn) { warn.classList.remove('show'); }
}

function lockRenderCart() {
  const list = document.getElementById('lock-cart-list');
  const btn  = document.getElementById('lock-done-btn');
  if (!sellCart.length) {
    list.innerHTML = '<div style="text-align:center;padding:16px;color:rgba(255,255,255,.5);font-size:13px">Cart is empty</div>';
    btn.disabled = true; lockRenderTotals(); return;
  }
  btn.disabled = false;
  list.innerHTML = sellCart.map(c => `
    <div class="lock-cart-row">
      ${c.img ? `<img class="lock-cart-img" src="${c.img}" alt="">` : `<div class="lock-cart-ph">🚗</div>`}
      <div style="flex:1;min-width:0">
        <div class="lock-cart-name">${c.name}</div>
        <div class="lock-cart-sub">${c.brand} · RM ${(c.discPrice!==undefined?c.discPrice:c.price).toFixed(2)}</div>
      </div>
      <div class="lock-stepper">
        <button class="lock-stepper-btn" onclick="lockQty('${c.barcode}',-1)">−</button>
        <span class="lock-stepper-qty">${c.qty}</span>
        <button class="lock-stepper-btn" onclick="lockQty('${c.barcode}',1)">+</button>
      </div>
      <div class="lock-cart-price">RM ${((c.discPrice!==undefined?c.discPrice:c.price)*c.qty).toFixed(2)}</div>
      <button class="lock-remove-btn" onclick="lockRemove('${c.barcode}')">✕</button>
    </div>`).join('');
  lockRenderTotals();
}

function lockRenderTotals() {
  const sub  = sellCart.reduce((a,c) => a+(c.discPrice!==undefined?c.discPrice:c.price)*c.qty, 0);
  const val  = parseFloat(document.getElementById('lock-disc-val').value) || 0;
  const disc = lockGetDiscount(sub);
  const total = Math.max(0, sub - disc);
  document.getElementById('lock-total').textContent = total.toFixed(2);
  document.getElementById('lock-total-sub').textContent = disc > 0 ? `Subtotal RM ${sub.toFixed(2)} − RM ${disc.toFixed(2)}` : '';
  // manager approval
  const warn = document.getElementById('lock-mgr-approval');
  if (warn && val > 0 && _discNeedsApproval(sub, val, lockDiscType)) {
    warn.classList.add('show');
  } else if (warn) { warn.classList.remove('show'); }
}

function setItemDisc(bc, val) { const c=sellCart.find(x=>x.barcode===bc); if(!c)return; const v=parseFloat(val); c.discPrice=(val===''||isNaN(v))?undefined:Math.max(0,v); renderCartTotals(); lockRenderTotals(); }
function sellQty(bc, delta) { const c=sellCart.find(x=>x.barcode===bc); if(!c)return; const p=products.find(x=>x.barcode===bc); c.qty=Math.min(p?p.stock:99,Math.max(1,c.qty+delta)); renderSellCart(); }
function lockQty(bc, d) { const c=sellCart.find(x=>x.barcode===bc); if(!c)return; const p=products.find(x=>x.barcode===bc); c.qty=Math.min(p?p.stock:99,Math.max(1,c.qty+d)); lockRenderCart(); }
function removeSellItem(bc) { sellCart=sellCart.filter(c=>c.barcode!==bc); renderSellCart(); }
function lockRemove(bc) { sellCart=sellCart.filter(c=>c.barcode!==bc); lockRenderCart(); }

function clearSellCart() {
  if (sellCart.length && !confirm('Clear cart?')) return;
  sellCart = [];
  document.getElementById('last-scan').classList.remove('show');
  document.getElementById('disc-val').value = '';
  document.getElementById('customer-name').value = '';
  renderSellCart(); document.getElementById('sell-input').focus();
}
function lockClearCart() {
  if (sellCart.length && !confirm('Clear cart?')) return;
  sellCart = [];
  document.getElementById('lock-disc-val').value = '';
  document.getElementById('lock-customer').value = '';
  lockRenderCart();
}

// Stores sale context at confirm-open time so completeSell doesn't re-read wrong DOM
let _pendingSaleCtx = null;

// Re-validates the cart against live stock and resolves event + channel.
// Returns a sale context, or null if checkout must be blocked (with a reason shown).
function _resolveSaleContext(isLock) {
  const msg = isLock ? lockMsg : (t, k) => showMsg('sell-msg', t, k);
  // 1) live stock re-check — drop sold-out lines, clamp over-stock lines (no bypass)
  const issues = [];
  for (let i = sellCart.length - 1; i >= 0; i--) {
    const c = sellCart[i];
    const p = products.find(x => x.barcode === c.barcode);
    const stock = p ? (p.stock || 0) : 0;
    if (!p || stock <= 0) { issues.push(c.name + ' (sold out)'); sellCart.splice(i, 1); }
    else if (c.qty > stock) { c.qty = stock; issues.push(c.name + ' (reduced to ' + stock + ')'); }
  }
  if (issues.length) {
    isLock ? lockRenderCart() : renderSellCart();
    msg('Cart updated — ' + issues.join(', ') + '. Review and try again.', 'err'); beepErr();
    return null;
  }
  if (!sellCart.length) { msg('Cart is empty', 'err'); return null; }

  // 2) sales type → event + platform resolution
  const salesType = isLock ? lockSaleType : sellSaleType;
  let eventId = null, eventLabel, platform;
  if (salesType === 'Online') {
    // Online: platform required; never attached to a physical event.
    const selId = isLock ? 'lock-platform' : 'sell-platform';
    platform = document.getElementById(selId).value;
    if (!platform) {
      msg('Select a platform to continue', 'err');
      const sel = document.getElementById(selId); if (sel) sel.focus();
      beepErr();
      return null;
    }
    eventLabel = ONLINE_EVENT;          // 'Online'
  } else {
    // Physical: auto-attach to the Active Event, or Walk-in when none.
    const ev = getActiveEvent();
    eventId = ev ? ev.id : null;
    eventLabel = ev ? ev.name : 'No event';
    platform = 'None';
  }

  const sub = sellCart.reduce((a, c) => a + (c.discPrice !== undefined ? c.discPrice : c.price) * c.qty, 0);
  const dtype = isLock ? lockDiscType : discType;
  const val = parseFloat(document.getElementById(isLock ? 'lock-disc-val' : 'disc-val').value) || 0;
  const disc = isLock ? lockGetDiscount(sub) : getDiscount(sub);
  const customer = document.getElementById(isLock ? 'lock-customer' : 'customer-name').value.trim();
  return {
    isLock, sub, disc, customer, salesType, platform, eventId, eventLabel,
    needsApproval: val > 0 && _discNeedsApproval(sub, val, dtype)
  };
}

function _openConfirmWith(ctx) {
  const go = () => {
    _pendingSaleCtx = ctx;
    _buildConfirm(ctx.sub, ctx.disc);
    document.getElementById('confirm-overlay').classList.add('open');
  };
  if (ctx.needsApproval) { requirePin(go); return; }
  go();
}

function lockDone() {
  if (!sellCart.length) return;
  const ctx = _resolveSaleContext(true);
  if (ctx) _openConfirmWith(ctx);
}

function openConfirm() {
  if (!sellCart.length) return;
  const ctx = _resolveSaleContext(false);
  if (ctx) _openConfirmWith(ctx);
}

function _buildConfirm(sub, disc) {
  const total = Math.max(0, sub - disc);
  document.getElementById('confirm-items').innerHTML = sellCart.map(c => {
    const dp = c.discPrice !== undefined ? c.discPrice : c.price;
    const hasDisc = c.discPrice !== undefined && c.discPrice !== c.price;
    return `<div class="confirm-item">
      <div><div class="confirm-item-name">${c.name}</div>
      <div class="confirm-item-sub">${c.brand} · ${c.scale}${hasDisc ? ` · was RM ${c.price.toFixed(2)}` : ''}</div></div>
      <div class="confirm-item-price">×${c.qty} = RM ${(dp*c.qty).toFixed(2)}</div>
    </div>`;
  }).join('');
  const dr = document.getElementById('confirm-discount-row');
  dr.innerHTML = disc > 0 ? `
    <div class="confirm-item"><div>Subtotal</div><div class="confirm-item-price">RM ${sub.toFixed(2)}</div></div>
    <div class="confirm-item"><div style="color:var(--success)">Discount</div><div class="confirm-item-price" style="color:var(--success)">−RM ${disc.toFixed(2)}</div></div>` : '';
  document.getElementById('confirm-total-amount').textContent = total.toFixed(2);
  // sale type + event/platform context — sourced from the resolved sale context
  const cc = document.getElementById('confirm-context');
  if (cc) {
    const ctx = _pendingSaleCtx || {};
    const isOnline = ctx.salesType === 'Online';
    cc.innerHTML = `<div class="confirm-ctx">
      <span class="confirm-ctx-chip">${isOnline ? '🌐 Online' : '🏬 Physical'}</span>
      <span class="confirm-ctx-chip muted">${isOnline ? '📱 ' + (ctx.platform || '—') : '📅 ' + (ctx.eventLabel || 'No event')}</span>
    </div>`;
  }
}

function closeConfirm() { document.getElementById('confirm-overlay').classList.remove('open'); }

function completeSell() {
  closeConfirm();
  if (!_pendingSaleCtx) return; // safety guard
  const { isLock, sub, disc, customer, salesType, platform, eventId, eventLabel } = _pendingSaleCtx;
  _pendingSaleCtx = null;
  const total = Math.max(0, sub - disc);

  // deduct stock
  for (const c of sellCart) {
    const p = products.find(x => x.barcode === c.barcode);
    if (p) p.stock = Math.max(0, p.stock - c.qty);
  }

  const rNo = nextReceiptNo();
  const now = Date.now();
  // ── Standardized transaction model (Physical/Online) ──
  const rec = {
    id: 's_' + now,
    receiptNo: rNo,            // legacy field (widely read)
    receiptNumber: rNo,        // standardized
    date: new Date().toLocaleString('en-MY'),
    timestamp: now,
    items: sellCart.map(c => c.name + ' ×' + c.qty).join(', '),
    arr: JSON.parse(JSON.stringify(sellCart)),
    subtotal: sub.toFixed(2),
    discount: disc.toFixed(2),
    discType: isLock ? lockDiscType : discType,
    total: total.toFixed(2),
    paymentMethod: 'Cash',     // no payment UI yet → Cash default
    customer,
    salesType,                 // 'Physical' | 'Online'
    event: eventLabel,         // Active Event name | 'Walk-in' | 'Online'
    platform,                  // 'None' | Facebook | WhatsApp | Rednote | Other
    eventId: eventId || null,  // internal link to a physical event (null for Online/Walk-in)
    eventName: salesType === 'Physical' ? eventLabel : '', // legacy field (physical only)
    cashier: (window.SyncEngine && window.SyncEngine.deviceId) || 'Cashier'
  };

  sales.unshift(rec);
  save('SALE', rec);

  // clear inputs + reset sale type to Physical for the next sale
  if (isLock) {
    document.getElementById('lock-disc-val').value = '';
    document.getElementById('lock-customer').value = '';
    document.getElementById('lock-platform').value = '';
    setSaleType(true, poDefaultSaleType());
  } else {
    document.getElementById('disc-val').value = '';
    document.getElementById('customer-name').value = '';
    document.getElementById('sell-platform').value = '';
    setSaleType(false, poDefaultSaleType());
  }

  sellCart = [];
  lockRenderCart();
  renderSellCart();
  showReceipt(rec);
}

// ── RECEIPT ──
let currentReceipt = null;
function showReceipt(rec) {
  currentReceipt = rec;
  document.getElementById('r-meta').textContent = `Receipt #${rec.receiptNo} · ${rec.date}`;
  const rv = saleView(rec);
  document.getElementById('r-event-tag').innerHTML = `<div class="r-event">${rv.salesType === 'Online' ? '🌐' : '📅'} ${rv.event}</div>`;
  document.getElementById('r-channel-tag').innerHTML = rv.salesType === 'Online'
    ? `<div class="r-channel">📱 ${rv.platform}</div>`
    : `<div class="r-channel">🏬 Physical</div>`;
  document.getElementById('r-customer').innerHTML = rec.customer ? `<div style="font-size:13px;font-weight:600;margin-bottom:8px;color:#000">👤 ${rec.customer}</div>` : '';
  document.getElementById('r-items').innerHTML = rec.arr.map(c => {
    const dp = c.discPrice !== undefined ? c.discPrice : c.price;
    const hasDisc = c.discPrice !== undefined && c.discPrice !== c.price;
    return `<div class="r-item">
      <div class="r-item-name">${c.name}<div class="r-item-sub">${c.brand} · ${c.scale} · ×${c.qty}${hasDisc?' · was RM '+c.price.toFixed(2):''}</div></div>
      <div class="r-item-price">RM ${(dp*c.qty).toFixed(2)}</div>
    </div>`;
  }).join('');
  const dr = document.getElementById('r-discount-row');
  dr.innerHTML = parseFloat(rec.discount) > 0 ? `
    <div class="r-row"><span style="color:#555">Subtotal</span><span>RM ${rec.subtotal}</span></div>
    <div class="r-row"><span style="color:#16a34a">Discount</span><span style="color:#16a34a">−RM ${rec.discount}</span></div>` : '';
  document.getElementById('r-total').textContent = rec.total;
  document.getElementById('receipt-overlay').classList.add('open');
}
function closeReceipt() {
  document.getElementById('receipt-overlay').classList.remove('open');
  if (document.getElementById('cashier-lock').classList.contains('show')) {
    setTimeout(() => document.getElementById('lock-scan-input').focus(), 100);
  }
}
function newSale() {
  closeReceipt();
  setTimeout(() => {
    if (document.getElementById('cashier-lock').classList.contains('show')) document.getElementById('lock-scan-input').focus();
    else document.getElementById('sell-input').focus();
  }, 100);
}

// ── COPY RECEIPT (plain text for WhatsApp / Messenger / etc.) ──
const RCPT_RULE = '—'.repeat(17);
function _money(n) { return 'RM ' + Number(n).toFixed(2); }
function buildReceiptText(rec) {
  const v = saleView(rec);
  const L = [];
  L.push('🧾 MobiHobby');
  L.push('Diecast & hobby collectibles');
  L.push(RCPT_RULE);
  L.push('Receipt #' + (rec.receiptNumber || rec.receiptNo || '—'));
  L.push(rec.date || '');
  L.push(v.salesType === 'Online' ? `🌐 Online · ${v.platform}`
        : (v.event === WALK_IN ? '🏬 Walk-in' : `📅 ${v.event}`));
  if (rec.customer) L.push('Customer: ' + rec.customer);
  L.push(RCPT_RULE);
  (rec.arr || []).forEach((c, i) => {
    const unit = c.discPrice !== undefined ? c.discPrice : c.price;
    const hadDisc = c.discPrice !== undefined && c.discPrice !== c.price;
    L.push(`${i + 1}. ${c.name}`);
    L.push(`   ${c.brand} · ${c.scale}`);
    L.push(`   ${c.qty} × ${_money(unit)} = ${_money(unit * c.qty)}` + (hadDisc ? `  (was ${_money(c.price)})` : ''));
    if (i < rec.arr.length - 1) L.push('');           // blank line between items
  });
  L.push(RCPT_RULE);
  const disc = parseFloat(rec.discount || 0);
  if (disc > 0) {
    L.push('Subtotal   ' + _money(rec.subtotal));
    L.push('Discount   − ' + _money(disc));
    L.push('TOTAL      ' + _money(rec.total));
    L.push(`(You saved ${_money(disc)})`);
  } else {
    L.push('TOTAL      ' + _money(rec.total));
  }
  L.push(RCPT_RULE);
  if (v.salesType === 'Online') {
    L.push('⏰ Kindly make payment within');
    L.push('24 hours to confirm your order.');
    L.push('Unpaid orders are released');
    L.push('automatically after 24 hours.');
    L.push(RCPT_RULE);
  }
  L.push('Thank you for your purchase! 🙏');
  return L.join('\n');
}
async function copyReceipt(btn) {
  if (!currentReceipt) return;
  const text = buildReceiptText(currentReceipt);
  const ok = await copyToClipboard(text);
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = ok ? '✓ Copied' : '⚠ Copy failed';
    setTimeout(() => { btn.textContent = orig; }, 1600);
  }
}
// Clipboard helper with a legacy fallback for in-app/older browsers.
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}

// ── INVENTORY ──
let selectedRows = new Set();
function renderStats() {
  const ts = products.reduce((a,p) => a+p.stock, 0);
  const tw = products.reduce((a,p) => a+p.stock*p.price, 0);
  const cost = products.reduce((a,p) => a+(p.cost||0)*p.stock, 0);
  const profit = tw - cost;
  document.getElementById('stats').innerHTML = `
    <div class="stat-card accent"><div class="stat-label">Products</div><div class="stat-value">${products.length}</div></div>
    <div class="stat-card"><div class="stat-label">Total units</div><div class="stat-value">${ts}</div></div>
    <div class="stat-card"><div class="stat-label">Inventory value</div><div class="stat-value">RM ${tw.toFixed(0)}</div></div>
    <div class="stat-card accent"><div class="stat-label">Potential profit</div><div class="stat-value">RM ${profit.toFixed(0)}</div></div>`;
}

function getFilteredSorted() {
  const q     = (document.getElementById('inv-q')?.value||'').toLowerCase();
  const brand = document.getElementById('f-brand-filter')?.value||'';
  const scale = document.getElementById('f-scale-filter')?.value||'';
  const sort  = document.getElementById('f-sort')?.value||'name-asc';
  let f = products.filter(p =>
    (!q || p.name.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q)) &&
    (!brand || p.brand === brand) && (!scale || p.scale === scale)
  );
  const [col, dir] = sort.split('-');
  f.sort((a,b) => { let va=a[col],vb=b[col]; if(typeof va==='string'){va=va.toLowerCase();vb=vb.toLowerCase();} return dir==='asc'?(va>vb?1:va<vb?-1:0):(va<vb?1:va>vb?-1:0); });
  return f;
}
function applyFilters() { renderInventory(); }
function cycleSortCol(col) { const sel=document.getElementById('f-sort'); sel.value=col+(sel.value===col+'-asc'?'-desc':'-asc'); applyFilters(); }

function renderInventory() {
  selectedRows.clear(); updateBulkBar(); document.getElementById('chk-all').checked = false;
  const f = getFilteredSorted();
  document.getElementById('inv-empty').style.display = f.length ? 'none' : 'block';
  document.getElementById('inv-result-count').textContent = f.length===products.length ? `${products.length} products` : `Showing ${f.length} of ${products.length}`;
  document.getElementById('inv-body').innerHTML = f.map(p => `
    <tr>
      <td><input type="checkbox" class="sel-check" id="ichk-${p.barcode}" onchange="toggleRowSelect('${p.barcode}',this.checked)"></td>
      <td>${p.img ? `<img class="thumb" src="${p.img}" alt="">` : `<div class="thumb-ph">🚗</div>`}</td>
      <td><div class="prod-name">${p.name}</div><div class="prod-bc">${p.barcode}</div></td>
      <td style="font-size:12px;color:var(--text-2)">${p.brand}<br><span style="color:var(--text-3);font-size:11px">${p.scale}</span></td>
      <td style="font-weight:700;color:var(--blue)">RM ${p.price.toFixed(2)}</td>
      <td><div class="stepper">
        <button class="stepper-btn" onclick="adjustStock('${p.barcode}',-1)">−</button>
        <span class="stepper-qty" id="qty-${p.barcode}">${p.stock}</span>
        <button class="stepper-btn" onclick="adjustStock('${p.barcode}',1)">+</button>
      </div></td>
      <td><div class="action-cell">
        <button class="btn btn-ghost btn-sm" onclick="editProduct('${p.barcode}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="requirePin(()=>deleteProduct('${p.barcode}'))">✕</button>
      </div></td>
    </tr>`).join('');
}

function toggleRowSelect(bc, ch) { if(ch) selectedRows.add(bc); else selectedRows.delete(bc); updateBulkBar(); }
function selectAllRows(ch) { document.querySelectorAll('[id^=ichk-]').forEach(c => { c.checked=ch; const bc=c.id.replace('ichk-',''); if(ch) selectedRows.add(bc); else selectedRows.delete(bc); }); updateBulkBar(); }
function toggleSelectAll() { const all=document.querySelectorAll('[id^=ichk-]'); const any=[...all].some(c=>!c.checked); selectAllRows(any); document.getElementById('chk-all').checked=any; }
function updateBulkBar() { const n=selectedRows.size; const bar=document.getElementById('bulk-bar'); if(n>0){bar.classList.add('show');document.getElementById('bulk-count').textContent=n+' selected';}else bar.classList.remove('show'); }
function applyBulkEdit() {
  const np=document.getElementById('bulk-price').value; const ns=document.getElementById('bulk-stock').value;
  if(!np&&!ns){poToast('Enter a price or stock value first');return;}
  let ch=0; selectedRows.forEach(bc=>{const p=products.find(x=>x.barcode===bc);if(!p)return;if(np!=='')p.price=parseFloat(np)||p.price;if(ns!=='')p.stock=Math.max(0,parseInt(ns)||0);ch++;save('PRODUCT_UPSERT',p);});
  document.getElementById('bulk-price').value=''; document.getElementById('bulk-stock').value='';
  renderInventory(); renderStats(); poToast(ch+' products updated');
}
function bulkDelete() {
  if(!selectedRows.size)return; if(!confirm(`Delete ${selectedRows.size} products?`))return;
  selectedRows.forEach(bc => save('PRODUCT_DELETE',{barcode:bc}));
  products=products.filter(p=>!selectedRows.has(p.barcode)); selectedRows.clear(); _localSave(); renderInventory(); renderStats();
}
function adjustStock(bc, delta) {
  const p=products.find(x=>x.barcode===bc); if(!p)return;
  p.stock=Math.max(0,p.stock+delta);
  const el=document.getElementById('qty-'+bc); if(el) el.textContent=p.stock;
  save('STOCK_ADJUST',{barcode:bc,stock:p.stock}); renderStats();
}
function deleteProduct(bc) {
  if(!confirm('Delete?'))return;
  products=products.filter(p=>p.barcode!==bc);
  save('PRODUCT_DELETE',{barcode:bc}); renderInventory(); renderStats();
}
// ── ADD/EDIT (modal on the Inventory page) ──
// Add Item and Edit share the same form; the modal closes itself after a
// successful save and the inventory list refreshes in place — no tab switch.
function openAddProduct() { clearForm(); poOpen('prod-modal'); setTimeout(() => { const i = document.getElementById('f-name'); if (i) i.focus(); }, 100); }
function editProduct(bc) {
  clearForm();
  document.getElementById('bc-input').value = bc;
  lookupBarcode();
  poOpen('prod-modal');
}
function closeProductModal() { poClose('prod-modal'); clearForm(); }
let editingBc=null, pendingImg=null;
function handleImg(input) {
  const file=input.files[0]; if(!file)return;
  const img=new Image();
  img.onload=()=>{
    const max=600; let w=img.width,h=img.height;
    if(w>max||h>max){if(w>h){h=h*max/w;w=max;}else{w=w*max/h;h=max;}}
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    c.getContext('2d').drawImage(img,0,0,w,h);
    pendingImg=c.toDataURL('image/jpeg',.82);
    const box=document.getElementById('img-box');
    let prev=box.querySelector('img.preview'); if(!prev){prev=document.createElement('img');prev.className='preview';box.prepend(prev);}
    prev.src=pendingImg;
    const ic=box.querySelector('.upload-icon'); if(ic) ic.style.display='none';
    const sp=box.querySelector('span:not(.upload-overlay)'); if(sp) sp.style.display='none';
  };
  img.src=URL.createObjectURL(file);
}
function lookupBarcode() {
  const bc=document.getElementById('bc-input').value.trim(); if(!bc){showMsg('bc-msg','Enter barcode','err');return;}
  const p=products.find(x=>x.barcode===bc);
  if(p){
    editingBc=bc;
    document.getElementById('f-bc').value=p.barcode; document.getElementById('f-name').value=p.name;
    document.getElementById('f-brand').value=p.brand; document.getElementById('f-scale').value=p.scale;
    document.getElementById('f-price').value=p.price; document.getElementById('f-stock').value=p.stock;
    document.getElementById('f-cost').value=p.cost||'';
    document.getElementById('form-mode-label').textContent='Edit product';
    document.getElementById('delete-btn').style.display='inline-flex';
    if(p.img){pendingImg=p.img; const box=document.getElementById('img-box'); let prev=box.querySelector('img.preview'); if(!prev){prev=document.createElement('img');prev.className='preview';box.prepend(prev);} prev.src=p.img; const ic=box.querySelector('.upload-icon');if(ic)ic.style.display='none'; const sp=box.querySelector('span:not(.upload-overlay)');if(sp)sp.style.display='none';}
    showMsg('bc-msg','Product found','ok');
  } else { clearForm(); document.getElementById('f-bc').value=bc; showMsg('bc-msg','New barcode — fill in details','ok'); }
}
function saveProduct() {
  const bc=document.getElementById('f-bc').value.trim(); const name=document.getElementById('f-name').value.trim();
  const price=parseFloat(document.getElementById('f-price').value)||0;
  const stock=parseInt(document.getElementById('f-stock').value)||1;
  const cost=parseFloat(document.getElementById('f-cost').value)||0;
  const brand=document.getElementById('f-brand').value; const scale=document.getElementById('f-scale').value;
  if(!bc||!name){showMsg('save-msg','Barcode and name required','err');return;}
  const prod = { barcode:bc, name, brand, scale, price, stock, cost, img:pendingImg||null };
  if(editingBc){
    // editing existing — allow name change only if not taken by another product
    const dupName = products.find(p => p.barcode !== editingBc && p.name.trim().toLowerCase() === name.toLowerCase());
    if(dupName){showMsg('save-msg',`"${dupName.name}" already exists. Use Edit on that product to adjust stock instead.`,'err');return;}
    const i=products.findIndex(p=>p.barcode===editingBc);
    if(i>=0) prod.img = pendingImg || products[i].img || null;
    if(i>=0) products[i]={...products[i],...prod};
    poToast('Product updated');
  } else {
    if(products.find(p=>p.barcode===bc)){showMsg('save-msg','Barcode already exists','err');return;}
    // duplicate name check for new products
    const dupName = products.find(p => p.name.trim().toLowerCase() === name.toLowerCase());
    if(dupName){
      showMsg('save-msg',`"${dupName.name}" already exists in inventory. Use the + button on that product to increase stock instead.`,'err');
      return;
    }
    products.push(prod);
    poToast('Product added');
  }
  save('PRODUCT_UPSERT', prod);
  closeProductModal();
  renderInventory(); renderStats();
}
function deleteFromForm() { if(!editingBc||!confirm('Delete?'))return; save('PRODUCT_DELETE',{barcode:editingBc}); products=products.filter(p=>p.barcode!==editingBc); _localSave(); closeProductModal(); renderInventory(); renderStats(); }
function clearForm() {
  ['f-bc','f-name','f-price','f-stock','f-cost'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('bc-input').value=''; document.getElementById('f-brand').value='Mini GT'; document.getElementById('f-scale').value='1:64';
  editingBc=null; pendingImg=null;
  document.getElementById('form-mode-label').textContent='New product'; document.getElementById('delete-btn').style.display='none';
  ['save-msg','bc-msg'].forEach(id=>document.getElementById(id).innerHTML='');
  const box=document.getElementById('img-box'); const prev=box.querySelector('img.preview'); if(prev)prev.remove();
  const ic=box.querySelector('.upload-icon');if(ic)ic.style.display='';
  const sp=box.querySelector('span:not(.upload-overlay)');if(sp)sp.style.display='';
  genBarcode();
}

// ── SOLD ITEMS ──
// Flatten every sold line item from the sales history (shared by the manager
// page and the cashier read-only view).
function flattenSoldItems() {
  const out = [];
  sales.forEach(s => {
    if (!s.arr) return;
    const v = saleView(s);
    s.arr.forEach(item => {
      out.push({ ...item, saleDate: s.date, receiptNo: s.receiptNo, saleId: s.id, saleTotal: s.total,
                 salesType: v.salesType, soldEvent: v.event, platform: v.platform });
    });
  });
  return out;
}
// Channel/event chip for a flattened sold item (shared by manager + cashier views).
function soldItemChip(it) {
  return it.salesType === 'Online'
    ? `<span class="hist-channel-chip online">🌐 ${it.platform}</span>`
    : `<span class="hist-channel-chip">🏬 ${it.soldEvent}</span>`;
}
function renderSoldItems() {
  const container = document.getElementById('sold-list');
  const soldItems = flattenSoldItems();
  if (!soldItems.length) { container.innerHTML = '<div class="empty-state"><span class="empty-icon">📦</span><div class="empty-title">No sold items yet</div><div class="empty-sub">Completed sales will appear here</div></div>'; return; }
  container.innerHTML = soldItems.map((item, i) => {
    const dp = item.discPrice !== undefined ? item.discPrice : item.price;
    return `<div class="sold-row">
      ${item.img ? `<img class="sold-thumb" src="${item.img}" alt="">` : `<div class="sold-ph">🚗</div>`}
      <div class="sold-info">
        <div class="sold-name">${item.name}</div>
        <div class="sold-meta">${soldItemChip(item)}${item.brand} · ${item.scale} · ×${item.qty} · #${item.receiptNo} · ${item.saleDate}</div>
      </div>
      <div class="sold-price">RM ${(dp*item.qty).toFixed(2)}</div>
      <button class="btn btn-ghost btn-sm" onclick="restoreToInventory(${i})">↩ Restore to stock</button>
    </div>`;
  }).join('');
  // store for restore lookup
  window._soldItems = soldItems;
}

function restoreToInventory(idx) {
  const item = window._soldItems[idx];
  if (!item) return;
  if (!confirm(`Restore ${item.qty}x "${item.name}" back to inventory? This will increase stock by ${item.qty}.`)) return;
  // restore stock
  const p = products.find(x => x.barcode === item.barcode);
  if (p) {
    p.stock += item.qty;
    save('STOCK_ADJUST', { barcode: p.barcode, stock: p.stock });
  }
  // remove the sale record that contains this item
  // find and remove just this item from its sale, or remove sale if single item
  const saleIdx = sales.findIndex(s => s.id === item.saleId);
  if (saleIdx >= 0) {
    const sale = sales[saleIdx];
    if (sale.arr && sale.arr.length === 1) {
      // only item in sale — remove whole sale (sync as deletion)
      sales.splice(saleIdx, 1);
      save('SALE_DELETE', { id: item.saleId });
    } else if (sale.arr) {
      // remove just this item from sale arr (sync the updated sale)
      sale.arr = sale.arr.filter(a => !(a.barcode === item.barcode && a.qty === item.qty));
      sale.items = sale.arr.map(c => c.name + ' ×' + c.qty).join(', ');
      save('SALE_UPDATE', sale);
    }
  } else {
    _localSave();
  }
  renderStats();
  renderSoldItems();
  showMsg('sold-msg', `${item.qty}x ${item.name} restored to inventory`, 'ok');
}

// ── CASHIER READ-ONLY SOLD ITEMS ──
// View/search only — no restore/edit/delete (those stay manager-only).
let _cashierSoldOpen = false;
function openCashierSold() {
  _cashierSoldOpen = true;
  const s = document.getElementById('cs-search'); if (s) s.value = '';
  renderCashierSold('');
  document.getElementById('cashier-sold-overlay').classList.add('open');
}
function closeCashierSold() {
  _cashierSoldOpen = false;
  document.getElementById('cashier-sold-overlay').classList.remove('open');
  if (document.getElementById('cashier-lock').classList.contains('show')) {
    setTimeout(() => { const i = document.getElementById('lock-scan-input'); if (i) i.focus(); }, 100);
  }
}
function renderCashierSold(q) {
  const list = document.getElementById('cs-list'); if (!list) return;
  const query = (q || '').toLowerCase().trim();
  let items = flattenSoldItems();
  if (query) items = items.filter(it =>
    (it.name || '').toLowerCase().includes(query) ||
    (it.brand || '').toLowerCase().includes(query) ||
    (it.platform || '').toLowerCase().includes(query) ||
    (it.soldEvent || '').toLowerCase().includes(query) ||
    String(it.receiptNo || '').toLowerCase().includes(query)
  );
  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">📦</span><div class="empty-title">${query ? 'No matching sold items' : 'No sold items yet'}</div></div>`;
    return;
  }
  list.innerHTML = items.map(it => {
    const dp = it.discPrice !== undefined ? it.discPrice : it.price;
    return `<div class="cs-row">
      ${it.img ? `<img class="cs-thumb" src="${it.img}" alt="">` : `<div class="cs-ph">🚗</div>`}
      <div class="cs-info">
        <div class="cs-name">${it.name}</div>
        <div class="cs-meta">${soldItemChip(it)}${it.brand} · ${it.scale} · ×${it.qty} · #${it.receiptNo || '—'} · ${it.saleDate || ''}</div>
      </div>
      <div class="cs-price">RM ${(dp * it.qty).toFixed(2)}</div>
    </div>`;
  }).join('');
}

// ── LABELS ──
function renderLabelList(q) {
  const list = document.getElementById('label-list');
  if (!products.length) { list.innerHTML='<div class="empty-state"><span class="empty-icon">🏷️</span><div class="empty-title">No products</div></div>'; updateLabelBadge(); return; }
  const f = q ? products.filter(p=>p.name.toLowerCase().includes(q.toLowerCase())||p.brand.toLowerCase().includes(q.toLowerCase())) : products;
  list.innerHTML = f.map(p => `
    <div class="label-row" id="lr-${p.barcode}">
      <input type="checkbox" class="label-row-check" id="lc-${p.barcode}" onchange="onLabelCheck('${p.barcode}')">
      <div class="label-row-info" onclick="document.getElementById('lc-${p.barcode}').click()">
        <div class="label-row-name">${p.name}</div>
        <div class="label-row-sub">${p.brand} · ${p.scale} · RM ${p.price.toFixed(2)} · Stock: ${p.stock}</div>
      </div>
      <div class="label-qty-wrap">
        <span>Qty</span>
        <input class="label-qty-input" type="number" id="lq-${p.barcode}" value="${Math.max(1,p.stock)}" min="1" inputmode="numeric" oninput="updateLabelBadge()">
      </div>
    </div>`).join('');
  updateLabelBadge();
}
function filterLabelList(q) { renderLabelList(q); }
function onLabelCheck(bc) { const chk=document.getElementById('lc-'+bc); const row=document.getElementById('lr-'+bc); if(row)row.classList.toggle('selected',chk.checked); updateLabelBadge(); }
function selectAllLabels(val) { document.querySelectorAll('[id^=lc-]').forEach(c=>{c.checked=val;const bc=c.id.replace('lc-','');const row=document.getElementById('lr-'+bc);if(row)row.classList.toggle('selected',val);}); updateLabelBadge(); }
function updateLabelBadge() { let t=0; document.querySelectorAll('[id^=lc-]').forEach(c=>{if(!c.checked)return;const bc=c.id.replace('lc-','');const qi=document.getElementById('lq-'+bc);t+=qi?Math.max(1,parseInt(qi.value)||1):1;}); document.getElementById('label-badge').textContent=t+' label'+(t!==1?'s':''); }

function printLabelSheet() {
  const items = [];
  document.querySelectorAll('[id^=lc-]').forEach(c => {
    if (!c.checked) return;
    const bc = c.id.replace('lc-',''); const p = products.find(x=>x.barcode===bc); if(!p)return;
    const qty = Math.max(1, parseInt(document.getElementById('lq-'+bc)?.value)||1);
    for (let i=0;i<qty;i++) items.push(p);
  });
  if (!items.length) { alert('Select at least one product.'); return; }

  // paginate: 36 per sheet
  const PERPAGE = 36;
  const pages = [];
  for (let i=0; i<items.length; i+=PERPAGE) pages.push(items.slice(i,i+PERPAGE));

  const bcCache = {};
  items.forEach(p => { if (!bcCache[p.barcode]) bcCache[p.barcode] = drawBarcode(p.barcode,6,38,8); });

  const sheetsHtml = pages.map(page => {
    while (page.length < PERPAGE) page.push(null);
    return `<div class="sheet">${page.map(p => {
      if (!p) return `<div class="lbl"></div>`;
      const name = p.name.length > 28 ? p.name.substring(0,26)+'…' : p.name;
      return `<div class="lbl"><div class="lbl-name">${name}</div><div class="lbl-brand">${p.brand} ${p.scale}</div><img class="lbl-bc" src="${bcCache[p.barcode]}" alt="${p.barcode}"><div class="lbl-bc-text">${p.barcode}</div><div class="lbl-price">RM ${p.price.toFixed(2)}</div></div>`;
    }).join('')}</div>`;
  }).join('');

  const w = window.open('','_blank','width=900,height=700');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Labels</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{background:#fff;font-family:Arial,sans-serif}
  .sheet{width:210mm;height:297mm;padding:8.5mm 5mm;display:grid;grid-template-columns:repeat(4,50mm);grid-template-rows:repeat(9,30mm);gap:0;page-break-after:always}
  .lbl{width:50mm;height:30mm;border:.3pt solid #bbb;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1.5mm 2mm;text-align:center;overflow:hidden}
  .lbl-name{font-size:6.5pt;font-weight:700;color:#000;line-height:1.2;margin-bottom:.5mm}
  .lbl-brand{font-size:5.5pt;color:#555;margin-bottom:.5mm}
  .lbl-bc{width:44mm;height:8mm;display:block;margin:0 auto}
  .lbl-bc-text{font-family:'Courier New',monospace;font-size:6.5pt;font-weight:600;color:#000;letter-spacing:1.5px;line-height:1.2;margin-top:.3mm}
  .lbl-price{font-size:9pt;font-weight:800;color:#002FA7;margin-top:.5mm}
  @media print{html,body{width:210mm}@page{size:A4 portrait;margin:0}.np{display:none}}</style></head><body>
  <div class="np" style="padding:12px 20px;background:#f0f4ff;font-family:Arial;font-size:13px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #c5d0f5">
    <strong style="color:#002FA7">MobiHobby Labels</strong>
    <span style="color:#5a6482">${pages.length} sheet${pages.length>1?'s':''} · A4 · Portrait · No scaling (100%)</span>
    <button onclick="window.print()" style="margin-left:auto;background:#002FA7;color:#fff;border:none;padding:8px 20px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer">🖨 Print</button>
  </div>
  ${sheetsHtml}</body></html>`);
  w.document.close();
}

// ── IMPORT/EXPORT ──
function exportCSV() {
  if (!products.length) { alert('No products.'); return; }
  const rows = [['Barcode','Name','Brand','Scale','Price','Stock','Cost']];
  products.forEach(p => rows.push([
    p.barcode,
    `"${p.name.replace(/"/g,'""')}"`,
    p.brand,
    `="1:${(p.scale||'1:64').split(':')[1]||'64'}"`,
    p.price, p.stock, p.cost||0
  ]));
  const blob = new Blob([rows.map(r=>r.join(',')).join('\n')], {type:'text/csv'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='mobihobby_'+new Date().toISOString().slice(0,10)+'.csv'; a.click();
}

function parseScale(raw) {
  if (!raw) return '1:64';
  const clean = raw.replace(/^="?|"?=?$/g,'').replace(/^"|"$/g,'').trim();
  if (/^\d*\.\d+$/.test(clean)) { const n=parseFloat(clean); if(n>0&&n<1) return `1:${Math.round(1/n)}`; }
  return clean || '1:64';
}

let pendingImportData = [];
function handleCSVImport(input) {
  const file=input.files[0]; if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    const lines=e.target.result.trim().split(/\r?\n/); if(lines.length<2){showMsg('import-msg','File empty','err');return;}
    const hdr=lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/[^a-z]/g,''));
    const ci=n=>hdr.findIndex(h=>h.includes(n));
    const iN=ci('name'),iB=ci('brand'),iSc=ci('scale'),iP=ci('price'),iSt=ci('stock'),iBc=ci('barcode'),iC=ci('cost');
    if(iN<0){showMsg('import-msg','No "Name" column','err');return;}
    const parsed=[];
    for(let i=1;i<lines.length;i++){
      const cols=lines[i].split(',');
      const g=idx=>idx>=0?(cols[idx]||'').replace(/^="?|"?=?$/g,'').replace(/^"|"$/g,'').trim():'';
      const name=g(iN); if(!name)continue;
      parsed.push({barcode:g(iBc)||genCode(),name,brand:g(iB)||'Other',scale:parseScale(g(iSc)),price:parseFloat(g(iP))||0,stock:parseInt(g(iSt))||1,cost:parseFloat(g(iC))||0,img:null});
    }
    if(!parsed.length){showMsg('import-msg','No valid rows','err');return;}
    pendingImportData=parsed;
    document.getElementById('import-preview').innerHTML=`<div class="import-preview"><table>
      <thead><tr><th>Name</th><th>Brand</th><th>Scale</th><th>Price</th><th>Stock</th></tr></thead>
      <tbody>${parsed.slice(0,8).map(p=>`<tr><td>${p.name}</td><td>${p.brand}</td><td>${p.scale}</td><td>RM ${p.price.toFixed(2)}</td><td>${p.stock}</td></tr>`).join('')}
      ${parsed.length>8?`<tr><td colspan="5" style="color:#9aa3be;text-align:center;padding:8px">…and ${parsed.length-8} more</td></tr>`:''}</tbody>
    </table></div>`;
    document.getElementById('import-count').textContent=parsed.length;
    document.getElementById('import-actions').style.display='block';
    showMsg('import-msg',parsed.length+' rows ready','ok');
  };
  reader.readAsText(file);
}
function confirmImport() {
  let added=0,updated=0;
  pendingImportData.forEach(row=>{
    const i=products.findIndex(p=>p.barcode===row.barcode);
    if(i>=0){products[i]={...products[i],...row,img:products[i].img};updated++;}
    else{products.push(row);added++;}
    save('PRODUCT_UPSERT',row);
  });
  pendingImportData=[];
  document.getElementById('import-preview').innerHTML='';
  document.getElementById('import-actions').style.display='none';
  showMsg('import-msg',`Done — ${added} added, ${updated} updated`,'ok');
  renderStats();
}
function cancelImport() { pendingImportData=[]; document.getElementById('import-preview').innerHTML=''; document.getElementById('import-actions').style.display='none'; document.getElementById('import-msg').innerHTML=''; }

// ── HISTORY ──
function clearHistory() { if(!confirm('Clear ALL history?'))return; sales=[]; save('HISTORY_CLEAR', { timestamp: Date.now() }); renderHistory(); renderHistStats(); }
// History has two mutually-exclusive report modes (per spec):
//   events → Physical sales only (grouped by event, incl. Walk-in); excludes Online
//   online → Online sales only (grouped/filtered by platform); excludes Physical
let histMode = 'events';
function setHistMode(mode) {
  histMode = mode;
  document.querySelectorAll('#hist-mode-row .saletype-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  const ef = document.getElementById('hist-event-filter'); if (ef) ef.style.display = mode === 'events' ? '' : 'none';
  const pf = document.getElementById('hist-platform-filter'); if (pf) pf.style.display = mode === 'online' ? '' : 'none';
  renderHistory(); renderHistStats();
}
function populateHistEventFilter() {
  const sel=document.getElementById('hist-event-filter'); if(!sel) return; const cur=sel.value;
  sel.innerHTML='<option value="">All events</option><option value="__walkin__">Walk-in</option>';
  events.forEach(ev=>{const o=document.createElement('option');o.value=ev.id;o.textContent=ev.name;sel.appendChild(o);});
  if(cur)sel.value=cur;
  populateHistPlatformFilter();
}
function populateHistPlatformFilter() {
  const sel=document.getElementById('hist-platform-filter'); if(!sel) return; const cur=sel.value;
  sel.innerHTML='<option value="">All platforms</option>';
  PLATFORMS.forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;sel.appendChild(o);});
  if(cur)sel.value=cur;
}
// Rows visible under the current mode + filters (shared by render + stats).
function _histRows() {
  let rows = sales.map((s, i) => ({ s, v: saleView(s), origIdx: i }));
  if (histMode === 'online') {
    const fp = document.getElementById('hist-platform-filter')?.value || '';
    return rows.filter(r => r.v.salesType === 'Online' && (!fp || r.v.platform === fp));
  }
  const fe = document.getElementById('hist-event-filter')?.value || '';
  return rows.filter(r => r.v.salesType === 'Physical' &&
    (!fe || (fe === '__walkin__' ? r.v.event === WALK_IN : r.s.eventId === fe)));
}
function renderHistStats() {
  const rows=_histRows();
  const rev=rows.reduce((a,r)=>a+parseFloat(r.s.total),0);
  const items=rows.reduce((a,r)=>a+(r.s.arr?r.s.arr.reduce((b,c)=>b+c.qty,0):0),0);
  const today=new Date().toLocaleDateString('en-MY');
  const todayRev=rows.filter(r=>r.s.date&&r.s.date.includes(today)).reduce((a,r)=>a+parseFloat(r.s.total),0);
  const label=histMode==='online'?'Online':'Event';
  document.getElementById('hist-stats').innerHTML=`
    <div class="stat-card"><div class="stat-label">${label} sales</div><div class="stat-value">${rows.length}</div></div>
    <div class="stat-card"><div class="stat-label">Items sold</div><div class="stat-value">${items}</div></div>
    <div class="stat-card accent"><div class="stat-label">Today</div><div class="stat-value">RM ${todayRev.toFixed(0)}</div></div>
    <div class="stat-card accent"><div class="stat-label">${label} revenue</div><div class="stat-value">RM ${rev.toFixed(0)}</div></div>`;
}
function renderHistory() {
  const body=document.getElementById('hist-body'); const em=document.getElementById('sales-empty');
  const rows=_histRows();
  if(!rows.length){body.innerHTML='';em.style.display='block';return;}
  em.style.display='none';
  // group by event (events mode) or platform (online mode)
  const groups={};
  rows.forEach(r=>{
    const label = histMode==='online' ? ('🌐 '+r.v.platform) : ('📅 '+r.v.event);
    (groups[label]=groups[label]||[]).push(r);
  });
  body.innerHTML=Object.entries(groups).map(([label,grows])=>{
    const gTotal=grows.reduce((a,r)=>a+parseFloat(r.s.total),0);
    const dayGroups={};grows.forEach(r=>{const day=(r.s.date||'').split(',')[0];(dayGroups[day]=dayGroups[day]||[]).push(r);});
    const daysHtml=Object.entries(dayGroups).map(([day,drows])=>{
      const dt=drows.reduce((a,r)=>a+parseFloat(r.s.total),0);
      return`<div class="hist-day-group">
        <div class="hist-day-header"><span class="hist-day-label">📅 ${day}</span><span class="hist-day-total">RM ${dt.toFixed(2)}</span></div>
        <table class="hist-table"><thead><tr><th>#</th><th>Time</th><th>Items</th><th>Total</th></tr></thead><tbody>
        ${drows.map(r=>{const s=r.s; const chip = r.v.salesType==='Online' ? `<span class="hist-channel-chip online">${r.v.platform}</span>` : '';
          return `<tr onclick="showReceipt(sales[${r.origIdx}])">
          <td style="font-size:11px;color:var(--blue);font-weight:700">#${s.receiptNo||'—'}</td>
          <td style="font-size:12px;color:var(--text-2);white-space:nowrap">${(s.date||'').split(',')[1]?.trim()||s.date}</td>
          <td style="font-size:12px;color:var(--text-2)">${chip}${s.customer?'👤 '+s.customer+' · ':''}${s.items}</td>
          <td class="hist-total">RM ${s.total}${parseFloat(s.discount||0)>0?`<br><span style="font-size:10px;color:var(--success)">−RM ${s.discount}</span>`:''}</td>
        </tr>`;}).join('')}
        </tbody></table></div>`;
    }).join('');
    return`<div class="hist-event-group">
      <div class="hist-event-header"><div><div class="hist-event-name">${label}</div><div class="hist-event-meta">${grows.length} transactions</div></div><div class="hist-event-total">RM ${gTotal.toFixed(2)}</div></div>
      ${daysHtml}</div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════════
//  PRE-ORDER MODULE V2  (Customer → Items → Model)
//  Lightweight ERP: image batches, in-model customer entry, visible
//  lifecycle with confirm + undo, FIFO receive-stock, per-customer
//  invoices, import/export, dashboard. Persists + syncs like the rest.
// ════════════════════════════════════════════════════════════════
const PO_FLOW = ['Waiting Stock', 'Arrived', 'Awaiting Payment', 'Paid', 'Ready To Ship', 'Shipped', 'Completed'];
const PO_STATUS_CLASS = {
  'Waiting Stock': 'po-st-waiting', 'Arrived': 'po-st-arrived', 'Awaiting Payment': 'po-st-awaiting',
  'Paid': 'po-st-paid', 'Ready To Ship': 'po-st-ready', 'Shipped': 'po-st-shipped',
  'Completed': 'po-st-completed', 'Cancelled': 'po-st-cancelled'
};
const PO_INVOICE_STATUSES = ['Arrived', 'Awaiting Payment'];   // eligible for invoicing
let poSel = { customerId: null, batchId: null };
let pendingPoImg = null;       // batch image being uploaded
let _poAddBatchId = null, _poReceiveBatch = null, _poInvoiceCust = null, _poConfirmCb = null, _poToastT = null;

// ── small helpers ──
function _poVal(id) { const e = document.getElementById(id); return e ? e.value : ''; }
function _poSet(id, v) { const e = document.getElementById(id); if (e) e.value = v; }
function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
function _normPhone(p) { return (p || '').replace(/\D/g, ''); }
function _poInitials(n) { return (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase(); }

// ── typo-tolerant customer search ──
const _poNorm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function _poEdit(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => { const r = new Array(n + 1).fill(0); r[0] = i; return r; });
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function _poMatch(q, c) {
  q = _poNorm(q); if (!q) return true;
  const name = _poNorm(c.name), phone = _poNorm(c.phone);
  if (name.includes(q) || phone.includes(q)) return true;
  for (const w of (c.name || '').toLowerCase().split(/\s+/)) {
    const nw = _poNorm(w);
    if (nw.startsWith(q)) return true;
    if (q.length >= 3 && _poEdit(q, nw) <= 1) return true;
  }
  return q.length >= 4 && _poEdit(q, name) <= 2;
}

// ── lookups / derived (balances always derived, never stored stale) ──
function poBatchById(id) { return poBatches.find(b => b.id === id) || null; }
function poCustomerById(id) { return customers.find(c => c.id === id) || null; }
function poItemsForCustomer(id) { return poItems.filter(i => i.customerId === id); }
function poItemsForBatch(id) { return poItems.filter(i => i.batchId === id); }
function poUnitPrice(it) { const b = poBatchById(it.batchId); return b ? (Number(b.price) || 0) : 0; }
function poItemTotal(it) { return poUnitPrice(it) * (it.qty || 0); }
function poItemOutstanding(it) { return Math.max(0, poItemTotal(it) - (Number(it.depositPaid) || 0)); }
function poIsActive(it) { return !['Completed', 'Cancelled'].includes(it.status); }
function poImgStyle(b) { return b && b.img ? `style="background-image:url('${b.img}')"` : ''; }
function poImgInner(b) { return b && b.img ? '' : '🚗'; }

// ── modal / toast / confirm primitives ──
function poOpen(id) { document.getElementById(id).classList.add('open'); }
function poClose(id) { document.getElementById(id).classList.remove('open'); }
function poConfirm(html, cb) { _poConfirmCb = cb; document.getElementById('po-confirm-msg').innerHTML = html; poOpen('po-confirm'); }
function poConfirmYes() { const cb = _poConfirmCb; _poConfirmCb = null; poClose('po-confirm'); if (cb) cb(); }
function poConfirmNo() { _poConfirmCb = null; poClose('po-confirm'); }
function poToast(msg, undoFn) {
  const t = document.getElementById('po-toast'); if (!t) return;
  document.getElementById('po-toast-msg').textContent = msg;
  const u = document.getElementById('po-toast-undo');
  if (undoFn) { u.style.display = ''; u.onclick = () => { clearTimeout(_poToastT); t.classList.remove('show'); undoFn(); }; }
  else { u.style.display = 'none'; u.onclick = null; }
  t.classList.add('show'); clearTimeout(_poToastT);
  _poToastT = setTimeout(() => t.classList.remove('show'), undoFn ? 7000 : 2600);
}

// ── batch image upload (compressed, reusable) ──
function handlePoImg(input) {
  const f = input.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    const max = 600; let w = img.width, h = img.height;
    if (w > max || h > max) { if (w > h) { h = h * max / w; w = max; } else { w = w * max / h; h = max; } }
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    pendingPoImg = cv.toDataURL('image/jpeg', .82); poRenderImgPreview();
  };
  img.src = URL.createObjectURL(f);
}
function poRenderImgPreview() {
  const box = document.getElementById('po-img-box'); if (!box) return;
  box.innerHTML = pendingPoImg
    ? `<img src="${pendingPoImg}" class="po-up-prev" alt=""><button type="button" class="po-up-x" onclick="poRemoveImg(event)">✕</button><input type="file" accept="image/*" onchange="handlePoImg(this)">`
    : `<span style="font-size:26px">📷</span><span style="font-size:12px">Tap to upload photo</span><input type="file" accept="image/*" onchange="handlePoImg(this)">`;
}
function poRemoveImg(e) { if (e) e.stopPropagation(); pendingPoImg = null; poRenderImgPreview(); }

// ── create batch ──
function openPoBatch() {
  pendingPoImg = null;
  ['po-b-name', 'po-b-eta', 'po-b-price', 'po-b-deposit', 'po-b-notes'].forEach(id => _poSet(id, ''));
  poRenderImgPreview(); document.getElementById('po-b-msg').innerHTML = ''; poOpen('po-batch-modal');
}
function createPoBatch() {
  const name = _poVal('po-b-name').trim();
  if (!name) { showMsg('po-b-msg', 'Model name is required', 'err'); return; }
  const b = { id: 'pob_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    modelName: name, brand: _poVal('po-b-brand'), eta: _poVal('po-b-eta').trim(),
    price: parseFloat(_poVal('po-b-price')) || 0, deposit: parseFloat(_poVal('po-b-deposit')) || 0,
    notes: _poVal('po-b-notes').trim(), img: pendingPoImg || null, received: 0, status: 'Open',
    createdAt: new Date().toISOString() };
  poBatches.unshift(b); save('POBATCH_UPSERT', b); pendingPoImg = null;
  poClose('po-batch-modal'); poToast('Batch created'); poSel = { customerId: null, batchId: b.id }; renderPreorders();
}

// ── find-or-create customer (no duplicates; phone-first match) ──
function findOrCreateCustomer({ name, phone, platform, address, notes }) {
  const np = _normPhone(phone); const ln = (name || '').trim().toLowerCase();
  let c = customers.find(x => (np && _normPhone(x.phone) === np) || (!np && ln && x.name.trim().toLowerCase() === ln));
  if (c) {
    let ch = false;
    if (phone && c.phone !== phone) { c.phone = phone; ch = true; }
    if (platform && c.platform !== platform) { c.platform = platform; ch = true; }
    if (address && c.address !== address) { c.address = address; ch = true; }
    if (notes && c.notes !== notes) { c.notes = notes; ch = true; }
    if (ch) save('CUSTOMER_UPSERT', c);
    return c;
  }
  c = { id: 'cust_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: (name || '').trim(), phone: (phone || '').trim(), platform: platform || 'Walk-in',
    address: (address || '').trim(), notes: (notes || '').trim(), createdAt: new Date().toISOString() };
  customers.push(c); save('CUSTOMER_UPSERT', c); return c;
}

// ── add customer inside a model ──
function openAddCustomer(batchId) {
  _poAddBatchId = batchId || poSel.batchId; if (!_poAddBatchId) return;
  const b = poBatchById(_poAddBatchId);
  document.getElementById('po-cust-title').textContent = 'Add customer to ' + (b ? b.modelName : 'model');
  ['po-c-name', 'po-c-phone', 'po-c-address', 'po-c-notes', 'po-c-deposit'].forEach(id => _poSet(id, ''));
  _poSet('po-c-qty', '1'); document.getElementById('po-c-msg').innerHTML = ''; poOpen('po-cust-modal');
}
function addCustomerToBatch() {
  const name = _poVal('po-c-name').trim();
  if (!name) { showMsg('po-c-msg', 'Customer name is required', 'err'); return; }
  if (!_poAddBatchId) { showMsg('po-c-msg', 'No model selected', 'err'); return; }
  const cust = findOrCreateCustomer({ name, phone: _poVal('po-c-phone').trim(), platform: _poVal('po-c-platform'),
    address: _poVal('po-c-address').trim(), notes: _poVal('po-c-notes').trim() });
  const item = { id: 'poi_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    customerId: cust.id, batchId: _poAddBatchId, qty: Math.max(1, parseInt(_poVal('po-c-qty')) || 1),
    depositPaid: parseFloat(_poVal('po-c-deposit')) || 0, status: 'Waiting Stock', createdAt: new Date().toISOString() };
  poItems.push(item); save('POITEM_UPSERT', item);
  const filled = poAllocate(_poAddBatchId);   // auto-fill from banked stock if available
  poClose('po-cust-modal');
  poToast(filled ? `Preorder added for ${cust.name} · stock allocated (Arrived)` : `Preorder added for ${cust.name}`);
  renderPreorders();
}

// ── edit customer (keeps preorder history) ──
function openEditCustomer(id) {
  const c = poCustomerById(id); if (!c) return;
  _poSet('po-e-name', c.name); _poSet('po-e-phone', c.phone); _poSet('po-e-platform', c.platform || 'Walk-in');
  _poSet('po-e-address', c.address || ''); _poSet('po-e-notes', c.notes || '');
  document.getElementById('po-edit-modal').dataset.id = id; poOpen('po-edit-modal');
}
function saveEditCustomer() {
  const id = document.getElementById('po-edit-modal').dataset.id; const c = poCustomerById(id); if (!c) return;
  c.name = _poVal('po-e-name').trim() || c.name; c.phone = _poVal('po-e-phone').trim();
  c.platform = _poVal('po-e-platform'); c.address = _poVal('po-e-address').trim(); c.notes = _poVal('po-e-notes').trim();
  save('CUSTOMER_UPSERT', c); poClose('po-edit-modal'); poToast('Customer updated'); renderPreorders();
}

// ── status transitions: confirm before every change; step back with the Back
//    button (also confirmed). No transient undo toasts. ──
const PO_RESTING = ['Waiting Stock', 'Arrived', 'Awaiting Payment', 'Ready To Ship', 'Shipped', 'Completed'];
function poPrevStatus(s) { const i = PO_RESTING.indexOf(s); return i > 0 ? PO_RESTING[i - 1] : null; }
function poAskStatus(itemId, to) {
  const it = poItems.find(x => x.id === itemId); if (!it) return;
  const b = poBatchById(it.batchId), c = poCustomerById(it.customerId);
  poConfirm(`Mark <b>${_esc(b ? b.modelName : 'item')}</b> for ${_esc(c ? c.name : 'customer')} as <b>${to}</b>?`, () => {
    it.status = to; save('POITEM_UPSERT', it); renderPreorders(); poToast('Status → ' + to);
  });
}
function poAskPaid(itemId) {
  const it = poItems.find(x => x.id === itemId); if (!it) return; const b = poBatchById(it.batchId);
  poConfirm(`Mark <b>${_esc(b ? b.modelName : 'item')}</b> as <b>Paid</b>?<br>Balance becomes RM 0 and moves to Ready To Ship.`, () => {
    it.paidPrevDeposit = Number(it.depositPaid) || 0;   // remembered so Back can restore
    it.depositPaid = poItemTotal(it); it.status = 'Ready To Ship';
    save('POITEM_UPSERT', it); renderPreorders(); poToast('Paid · Ready To Ship');
  });
}
function poAskCancel(itemId) {
  const it = poItems.find(x => x.id === itemId); if (!it) return;
  poConfirm('Cancel this preorder item?', () => { it.status = 'Cancelled'; save('POITEM_UPSERT', it); renderPreorders(); poToast('Cancelled'); });
}
// Step one phase back (confirmed). Restores the pre-paid deposit when undoing a payment.
function poBackStatus(itemId) {
  const it = poItems.find(x => x.id === itemId); if (!it) return;
  const prev = it.status === 'Cancelled' ? 'Waiting Stock' : poPrevStatus(it.status);
  if (!prev) { poToast('Already at the first step'); return; }
  const b = poBatchById(it.batchId);
  poConfirm(`Move <b>${_esc(b ? b.modelName : 'item')}</b> back to <b>${prev}</b>?`, () => {
    if (it.status === 'Ready To Ship' && prev === 'Awaiting Payment' && it.paidPrevDeposit !== undefined) {
      it.depositPaid = it.paidPrevDeposit; delete it.paidPrevDeposit;
    }
    it.status = prev; save('POITEM_UPSERT', it);
    // Re-entering Waiting Stock: if the batch has spare received stock, the
    // standard FIFO allocation kicks in immediately (same path as receiving).
    let allocatedBack = false;
    if (prev === 'Waiting Stock') {
      poAllocate(it.batchId);
      const fresh = poItems.find(x => x.id === itemId);   // re-find: save() can replace the object
      allocatedBack = !!fresh && fresh.status !== 'Waiting Stock';
    }
    renderPreorders();
    poToast(allocatedBack ? '← Waiting Stock · stock available — re-allocated (Arrived)' : '← ' + prev);
  });
}

// ── hard deletes (confirmed; for cleanup/trial) — sync via {_deleted} ──
function deletePoItem(id) {
  const it = poItems.find(x => x.id === id); if (!it) return; const b = poBatchById(it.batchId);
  poConfirm(`Delete this preorder (${_esc(b ? b.modelName : 'item')})?<br>This cannot be undone.`, () => {
    save('POITEM_UPSERT', { id, _deleted: true });
    renderPreorders(); poToast('Preorder deleted');
  });
}
function deletePoBatch(id) {
  const b = poBatchById(id); if (!b) return; const its = poItemsForBatch(id);
  poConfirm(`Delete batch "<b>${_esc(b.modelName)}</b>"${its.length ? ` and its ${its.length} preorder item(s)` : ''}?<br>This cannot be undone.`, () => {
    its.forEach(it => save('POITEM_UPSERT', { id: it.id, _deleted: true }));
    save('POBATCH_UPSERT', { id, _deleted: true });
    if (poSel.batchId === id) poSel = { customerId: null, batchId: null };
    renderPreorders(); poToast('Batch deleted');
  });
}
function deletePoCustomer() {
  const id = document.getElementById('po-edit-modal').dataset.id; const c = poCustomerById(id); if (!c) return;
  const its = poItemsForCustomer(id);
  poConfirm(`Delete customer "<b>${_esc(c.name)}</b>"${its.length ? ` and their ${its.length} preorder item(s)` : ''}?<br>This cannot be undone.`, () => {
    its.forEach(it => save('POITEM_UPSERT', { id: it.id, _deleted: true }));
    save('CUSTOMER_UPSERT', { id, _deleted: true });
    if (poSel.customerId === id) poSel = { customerId: null, batchId: null };
    poClose('po-edit-modal'); renderPreorders(); poToast('Customer deleted');
  });
}

// ── receive stock (adjustable total; FIFO allocation, banks spare stock) ──
// Units already committed to customers (anything past Waiting).
function poAllocatedUnits(batchId) {
  return poItemsForBatch(batchId).filter(i => !['Waiting Stock', 'Cancelled'].includes(i.status)).reduce((a, i) => a + i.qty, 0);
}
// Allocate any spare received stock (received − already-allocated) to the
// longest-waiting orders (FIFO). Runs on receive AND on adding a customer, so
// banked stock auto-fills new preorders. Returns how many orders were filled.
function poAllocate(batchId) {
  const b = poBatchById(batchId); if (!b) return 0;
  let avail = Math.max(0, (b.received || 0) - poAllocatedUnits(batchId));
  let n = 0;
  const waiting = poItemsForBatch(batchId).filter(i => i.status === 'Waiting Stock')
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  for (const it of waiting) { if (it.qty <= avail) { it.status = 'Arrived'; avail -= it.qty; save('POITEM_UPSERT', it); n++; } }
  return n;
}
// quick +/- on received stock (can't drop below already-allocated), re-allocates
function poAdjustReceived(id, delta) {
  const b = poBatchById(id); if (!b) return;
  const alloc = poAllocatedUnits(id);
  const v = Math.max(alloc, (b.received || 0) + delta);
  if (v === (b.received || 0)) { if (delta < 0) poToast(`Can't go below ${alloc} allocated`); return; }
  b.received = v; save('POBATCH_UPSERT', b);
  const filled = poAllocate(id); renderPreorders();
  poToast(filled ? `Received ${v} · ${filled} allocated` : `Received ${v}`);
}
function openReceive(batchId) {
  _poReceiveBatch = batchId || poSel.batchId; const b = poBatchById(_poReceiveBatch); if (!b) return;
  const alloc = poAllocatedUnits(_poReceiveBatch);
  const waiting = poItemsForBatch(_poReceiveBatch).filter(i => i.status === 'Waiting Stock').reduce((a, i) => a + i.qty, 0);
  document.getElementById('po-rec-sub').textContent =
    `${b.modelName} — received ${b.received || 0}, allocated ${alloc}, spare ${Math.max(0, (b.received || 0) - alloc)} · ${waiting} unit(s) still waiting`;
  _poSet('po-rec-qty', String(b.received || 0));   // editable TOTAL received
  poOpen('po-receive-modal');
}
function doReceiveStock() {
  const b = poBatchById(_poReceiveBatch); if (!b) return;
  let total = parseInt(_poVal('po-rec-qty')); if (isNaN(total) || total < 0) { poClose('po-receive-modal'); return; }
  const alloc = poAllocatedUnits(_poReceiveBatch);
  if (total < alloc) { total = alloc; poToast(`Can't go below ${alloc} already allocated`); }
  b.received = total; save('POBATCH_UPSERT', b);
  const allocated = poAllocate(_poReceiveBatch);
  poClose('po-receive-modal'); renderPreorders();
  if (allocated > 0) poConfirm(`📦 ${allocated} customer(s) now have stock.<br>Notify them now? (sets them to Awaiting Payment and prepares invoices)`, () => poNotify(_poReceiveBatch));
  else poToast('Stock updated');
}

// ── notify: Arrived → Awaiting Payment, list each copyable invoice ──
function poNotify(batchId) {
  poItemsForBatch(batchId).filter(i => i.status === 'Arrived').forEach(i => { i.status = 'Awaiting Payment'; save('POITEM_UPSERT', i); });
  const custIds = [...new Set(poItemsForBatch(batchId).filter(i => PO_INVOICE_STATUSES.includes(i.status)).map(i => i.customerId))];
  renderPreorders();
  document.getElementById('po-notify-sub').textContent = `${custIds.length} customer(s) to notify — copy each message`;
  document.getElementById('po-notify-list').innerHTML = custIds.map(cid => {
    const c = poCustomerById(cid);
    return `<div class="po-notify-row"><div><b>${_esc(c.name)}</b><div class="po-cust-sub">${_esc(c.platform || '')}${c.phone ? ' · ' + _esc(c.phone) : ''}</div></div>
      <button class="btn btn-primary btn-sm" onclick="openInvoice('${cid}')">📋 Copy invoice</button></div>`;
  }).join('') || '<div class="po-empty">No eligible customers</div>';
  poOpen('po-notify-modal');
}

// ── per-customer invoice (receipt house style) ──
function poBuildInvoice(custId) {
  const c = poCustomerById(custId); const R = '—'.repeat(17); const L = [];
  const elig = poItemsForCustomer(custId).filter(i => PO_INVOICE_STATUSES.includes(i.status));
  L.push('🧾 MobiHobby'); L.push('Pre-order Invoice'); L.push(R);
  L.push('Hi ' + c.name + '! 👋'); L.push('Good news — your preorder'); L.push('items have arrived 🎉'); L.push(R);
  let items = 0, dep = 0, due = 0;
  if (!elig.length) L.push('(no arrived items yet)');
  elig.forEach((it, k) => {
    const b = poBatchById(it.batchId); const line = poItemTotal(it); const bal = poItemOutstanding(it);
    items += line; dep += Number(it.depositPaid) || 0; due += bal;
    L.push(`${k + 1}. ${b ? b.modelName : '(model)'}`);
    L.push(`   ${b ? b.brand : ''}${b && b.eta ? ' · ETA ' + b.eta : ''}`);
    L.push(`   ${it.qty} × RM ${poUnitPrice(it).toFixed(2)} = RM ${line.toFixed(2)}`);
    L.push(`   Deposit RM ${(Number(it.depositPaid) || 0).toFixed(2)} · Balance RM ${bal.toFixed(2)}`);
    if (k < elig.length - 1) L.push('');
  });
  L.push(R);
  L.push('Items total   RM ' + items.toFixed(2));
  L.push('Deposit paid  RM ' + dep.toFixed(2));
  L.push('BALANCE DUE   RM ' + due.toFixed(2));
  L.push(R);
  L.push('💳 Kindly bank in the balance');
  L.push('within 3 days to confirm shipping.');
  L.push('Send your payment slip here 🙏');
  L.push(R);
  L.push('Thank you for supporting');
  L.push('MobiHobby ❤️');
  return L.join('\n');
}
function openInvoice(custId) {
  _poInvoiceCust = custId; const c = poCustomerById(custId);
  const elig = poItemsForCustomer(custId).filter(i => PO_INVOICE_STATUSES.includes(i.status));
  document.getElementById('po-inv-sub').textContent = elig.length ? `${c.name} — ${elig.length} item(s) to invoice` : 'No eligible (Arrived / Awaiting Payment) items';
  document.getElementById('po-inv-text').textContent = poBuildInvoice(custId);
  poOpen('po-invoice-modal');
}
async function copyInvoice(btn) {
  if (!_poInvoiceCust) return;
  const ok = await copyToClipboard(poBuildInvoice(_poInvoiceCust));
  if (btn) { const o = btn.textContent; btn.textContent = ok ? '✓ Copied' : '⚠ Failed'; setTimeout(() => { btn.textContent = o; }, 1600); }
}

// ── edit a customer's preorder item (qty / deposit) ──
let _poEditItemId = null;
function openEditItem(id) {
  const it = poItems.find(x => x.id === id); if (!it) return;
  _poEditItemId = id; _poSet('po-it-qty', it.qty); _poSet('po-it-deposit', Number(it.depositPaid) || 0);
  poOpen('po-item-modal');
}
function saveEditItem() {
  const it = poItems.find(x => x.id === _poEditItemId); if (!it) return;
  it.qty = Math.max(1, parseInt(_poVal('po-it-qty')) || 1);
  it.depositPaid = parseFloat(_poVal('po-it-deposit')) || 0;
  save('POITEM_UPSERT', it); poAllocate(it.batchId);
  poClose('po-item-modal'); renderPreorders(); poToast('Preorder updated');
}

// ── preorder announcement post (fixed format for social) ──
let _poPostBatch = null;
function poBuildPost(batchId) {
  const b = poBatchById(batchId); const R = '—'.repeat(17); const L = [];
  L.push('🔥 PRE-ORDER OPEN 🔥'); L.push(R);
  L.push(`${b.brand ? b.brand + ' ' : ''}${b.modelName}`);
  if (b.eta) L.push('📅 ETA: ' + b.eta);
  L.push('💰 Price: RM ' + (Number(b.price) || 0).toFixed(2));
  L.push('💵 Deposit: RM ' + (Number(b.deposit) || 0).toFixed(2) + ' to secure your unit');
  L.push(R);
  L.push('How to order 👇');
  L.push('1️⃣ PM / WhatsApp us to reserve');
  L.push('2️⃣ Pay the deposit to confirm');
  L.push('3️⃣ Settle balance when it arrives');
  if (b.notes) { L.push(R); L.push(b.notes); }
  L.push(R);
  L.push('MobiHobby 🏁 #preorder #diecast #164');
  return L.join('\n');
}
function openPost(batchId) { _poPostBatch = batchId; document.getElementById('po-post-text').textContent = poBuildPost(batchId); poOpen('po-post-modal'); }
async function copyPost(btn) {
  if (!_poPostBatch) return;
  const ok = await copyToClipboard(poBuildPost(_poPostBatch));
  if (btn) { const o = btn.textContent; btn.textContent = ok ? '✓ Copied' : '⚠ Failed'; setTimeout(() => { btn.textContent = o; }, 1600); }
}

// ── import / export ──
function _poCsv(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function _poDownload(name, content, type) { const blob = new Blob([content], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); }
function openExport() { poOpen('po-export-modal'); }
function poExportJSON() {
  _poDownload('mobihobby_preorders_' + new Date().toISOString().slice(0, 10) + '.json',
    JSON.stringify({ exportedAt: new Date().toISOString(), customers, poBatches, poItems }, null, 2), 'application/json');
  poClose('po-export-modal'); poToast('Exported JSON');
}
function poExportCSV() {
  const rows = [['Customer', 'Phone', 'Platform', 'Address', 'Model', 'Brand', 'ETA', 'Qty', 'Price', 'Deposit', 'Outstanding', 'Status']];
  poItems.forEach(it => { const c = poCustomerById(it.customerId) || {}; const b = poBatchById(it.batchId) || {};
    rows.push([c.name, c.phone, c.platform, c.address, b.modelName, b.brand, b.eta, it.qty, b.price, it.depositPaid, poItemOutstanding(it), it.status].map(_poCsv)); });
  _poDownload('mobihobby_preorders_' + new Date().toISOString().slice(0, 10) + '.csv', rows.map(r => r.join(',')).join('\n'), 'text/csv');
  poClose('po-export-modal'); poToast('Exported CSV (Excel-friendly)');
}
function poExportModelCSV(id) {
  const b = poBatchById(id); const rows = [['Customer', 'Phone', 'Platform', 'Qty', 'Deposit', 'Outstanding', 'Status']];
  poItemsForBatch(id).forEach(it => { const c = poCustomerById(it.customerId) || {};
    rows.push([c.name, c.phone, c.platform, it.qty, it.depositPaid, poItemOutstanding(it), it.status].map(_poCsv)); });
  _poDownload('preorder_' + (b ? b.modelName.replace(/\W+/g, '_') : 'model') + '.csv', rows.map(r => r.join(',')).join('\n'), 'text/csv');
  poToast('Exported customer list');
}
function poImport(input) {
  const f = input.files[0]; if (!f) return; const r = new FileReader();
  r.onload = e => {
    try {
      const d = JSON.parse(e.target.result);
      if (!Array.isArray(d.customers) || !Array.isArray(d.poBatches) || !Array.isArray(d.poItems)) throw new Error('bad shape');
      let nc = 0, nb = 0, ni = 0;
      d.customers.forEach(c => { if (!customers.find(x => x.id === c.id || (_normPhone(x.phone) && _normPhone(x.phone) === _normPhone(c.phone)))) { customers.push(c); save('CUSTOMER_UPSERT', c); nc++; } });
      d.poBatches.forEach(b => { if (!poBatches.find(x => x.id === b.id)) { poBatches.push(b); save('POBATCH_UPSERT', b); nb++; } });
      d.poItems.forEach(i => { if (!poItems.find(x => x.id === i.id)) { poItems.push(i); save('POITEM_UPSERT', i); ni++; } });
      renderPreorders(); poToast(`Imported ${nc} customers, ${nb} models, ${ni} items (duplicates skipped)`);
    } catch (err) { poToast('Import failed — invalid preorder JSON'); }
    input.value = '';
  };
  r.readAsText(f);
}

// ── selection ──
function poSelectCustomer(id) { poSel = { customerId: id, batchId: null }; renderPreorders(); }
function poSelectBatch(id) { poSel = { customerId: null, batchId: id }; renderPreorders(); }
function poToggleCollapse(h) { h.classList.toggle('closed'); const n = h.nextElementSibling; if (n) n.style.display = n.style.display === 'none' ? '' : 'none'; }

// ── archive completed batches ──
let poShowArchived = false;
function togglePoArchived() {
  poShowArchived = !poShowArchived; poSel = { customerId: null, batchId: null };
  const btn = document.getElementById('po-arch-toggle'); if (btn) btn.textContent = poShowArchived ? '📂 Show active' : '🗄 Archived';
  renderPreorders();
}
function poBatchIsComplete(id) {
  const its = poItemsForBatch(id).filter(i => i.status !== 'Cancelled');
  return its.length > 0 && its.every(i => i.status === 'Completed');
}
function archivePoBatch(id) {
  const b = poBatchById(id); if (!b) return;
  b.archived = true; save('POBATCH_UPSERT', b);
  if (poSel.batchId === id) poSel = { customerId: null, batchId: null };
  renderPreorders(); poToast('Batch archived (unarchive from the Archived view)');
}
function unarchivePoBatch(id) {
  const b = poBatchById(id); if (!b) return;
  b.archived = false; save('POBATCH_UPSERT', b); renderPreorders(); poToast('Batch restored to active');
}
function archiveCompletedBatches() {
  const done = poBatches.filter(b => !b.archived && poBatchIsComplete(b.id));
  if (!done.length) { poToast('No fully-completed batches to archive'); return; }
  poConfirm(`Archive ${done.length} fully-completed batch(es)? They move to the Archived view (still accessible).`, () => {
    done.forEach(b => { b.archived = true; save('POBATCH_UPSERT', b); });
    renderPreorders(); poToast(`${done.length} batch(es) archived`);
  });
}

// ── render ──
function renderPreorders() { renderPoDash(); renderPoModels(); renderPoCustomers(_poVal('po-search')); renderPoDetail(); }
function renderPoDash() {
  const el = document.getElementById('po-dash'); if (!el) return;
  const act = poItems.filter(i => i.status !== 'Cancelled');
  const n = s => act.filter(i => i.status === s).length;
  const out = act.filter(poIsActive).reduce((a, i) => a + poItemOutstanding(i), 0);
  const dep = act.reduce((a, i) => a + (Number(i.depositPaid) || 0), 0);
  const cards = [['Waiting', n('Waiting Stock'), ''], ['Arrived', n('Arrived'), ''], ['Awaiting Pay', n('Awaiting Payment'), ''],
    ['Ready', n('Ready To Ship'), ''], ['Completed', n('Completed'), ''], ['Outstanding', 'RM ' + out.toFixed(0), 'accent'], ['Deposits', 'RM ' + dep.toFixed(0), 'accent']];
  el.innerHTML = cards.map(([l, v, c]) => `<div class="stat-card ${c}"><div class="stat-label">${l}</div><div class="stat-value">${v}</div></div>`).join('');
}
function renderPoModels() {
  const el = document.getElementById('po-models'); if (!el) return;
  const ttl = document.getElementById('po-models-title'); if (ttl) ttl.textContent = poShowArchived ? 'Archived models' : 'Models';
  const list = poBatches.filter(b => !!b.archived === poShowArchived);
  if (!list.length) { el.innerHTML = `<div class="po-empty">${poShowArchived ? 'No archived models.' : 'No models yet — tap “New Batch”.'}</div>`; return; }
  el.innerHTML = list.map(b => {
    const its = poItemsForBatch(b.id).filter(i => i.status !== 'Cancelled');
    const waiting = its.filter(i => i.status === 'Waiting Stock').length;
    const arrived = its.filter(i => ['Arrived', 'Awaiting Payment', 'Paid', 'Ready To Ship', 'Shipped'].includes(i.status)).length;
    const done = its.filter(i => i.status === 'Completed').length;
    return `<div class="po-mcard ${poSel.batchId === b.id ? 'sel' : ''}" onclick="poSelectBatch('${b.id}')">
      <div class="po-mcard-img" ${poImgStyle(b)}>${poImgInner(b)}</div>
      <div class="po-mcard-body"><div class="po-mcard-name">${_esc(b.modelName)}</div>
        <div class="po-mcard-sub">${_esc(b.brand || '')}${b.eta ? ' · ETA ' + _esc(b.eta) : ''}</div>
        <div class="po-mcard-counts"><span class="po-badge po-st-waiting">${waiting} waiting</span><span class="po-badge po-st-arrived">${arrived} arrived</span><span class="po-badge po-st-completed">${done} done</span></div>
      </div></div>`;
  }).join('');
}
function renderPoCustomers(q) {
  const el = document.getElementById('po-customer-list'); if (!el) return;
  const list = customers.filter(c => _poMatch(q, c)).sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) { el.innerHTML = '<div class="po-empty">No customers</div>'; return; }
  el.innerHTML = list.map(c => {
    const act = poItemsForCustomer(c.id).filter(poIsActive);
    const out = act.reduce((a, i) => a + poItemOutstanding(i), 0);
    return `<div class="po-cust-row ${poSel.customerId === c.id ? 'sel' : ''}" onclick="poSelectCustomer('${c.id}')">
      <div class="po-av">${_poInitials(c.name)}</div>
      <div class="po-cust-main"><div class="po-cust-name">${_esc(c.name)}</div><div class="po-cust-sub">${_esc(c.platform || '')} · ${act.length} active</div></div>
      <div class="po-cust-meta">${out > 0 ? `<span class="po-out">RM ${out.toFixed(0)} due</span>` : '<span style="color:var(--success)">Settled</span>'}</div>
    </div>`;
  }).join('');
}
function renderPoDetail() {
  const el = document.getElementById('po-detail'); if (!el) return;
  if (poSel.customerId) el.innerHTML = poCustomerDetailHtml(poSel.customerId);
  else if (poSel.batchId) el.innerHTML = poModelDetailHtml(poSel.batchId);
  else el.innerHTML = '<div class="po-empty" style="padding:48px">Select a model or a customer to begin.</div>';
}
function poBadge(s) { return `<span class="po-badge ${PO_STATUS_CLASS[s]}">${s}</span>`; }
function poStepper(status) {
  if (status === 'Cancelled') return `<div style="margin:10px 0">${poBadge('Cancelled')}</div>`;
  const ci = PO_FLOW.indexOf(status);
  const short = { 'Waiting Stock': 'Waiting', 'Arrived': 'Arrived', 'Awaiting Payment': 'Await Pay', 'Paid': 'Paid', 'Ready To Ship': 'Ready', 'Shipped': 'Shipped', 'Completed': 'Done' };
  return `<div class="po-stepper">` + PO_FLOW.map((s, i) => {
    const cls = i < ci ? 'done' : (i === ci ? 'cur' : '');
    return `<div class="po-step ${cls}"><span class="po-dot"></span>${short[s]}</div>${i < PO_FLOW.length - 1 ? '<span class="po-arr">›</span>' : ''}`;
  }).join('') + `</div>`;
}
function poItemActions(it) {
  const id = it.id; const b = [];
  switch (it.status) {
    case 'Arrived':
      b.push(`<button class="btn btn-warning btn-sm" onclick="poAskStatus('${id}','Awaiting Payment')">Send invoice → Await Pay</button>`);
      b.push(`<button class="btn btn-success btn-sm" onclick="poAskPaid('${id}')">Mark Paid</button>`); break;
    case 'Awaiting Payment':
      b.push(`<button class="btn btn-success btn-sm" onclick="poAskPaid('${id}')">Mark Paid</button>`); break;
    case 'Ready To Ship':
      b.push(`<button class="btn btn-ghost btn-sm" onclick="poAskStatus('${id}','Shipped')">Mark Shipped</button>`); break;
    case 'Shipped':
      b.push(`<button class="btn btn-ghost btn-sm" onclick="poAskStatus('${id}','Completed')">Mark Completed</button>`); break;
    case 'Waiting Stock':
      b.push(`<button class="btn btn-outline btn-sm" disabled>Awaiting stock arrival</button>`); break;
  }
  // Step back one phase (confirmed) — replaces the old per-action undo toasts.
  if (it.status !== 'Waiting Stock') b.push(`<button class="btn btn-outline btn-sm" onclick="poBackStatus('${id}')">↶ Back a step</button>`);
  if (!['Completed', 'Cancelled'].includes(it.status)) b.push(`<button class="btn btn-danger btn-sm" onclick="poAskCancel('${id}')">Cancel</button>`);
  return `<div class="po-item-actions">${b.join('')}</div>`;
}
function poItemCard(it, full) {
  const b = poBatchById(it.batchId);
  return `<div class="po-item${full ? '' : ' done'}">
    <div class="po-item-head">
      <div class="po-thumb" ${poImgStyle(b)}>${poImgInner(b)}</div>
      <div class="po-item-info"><div class="po-item-name">${_esc(b ? b.modelName : '(deleted model)')}</div>
        <div class="po-item-fin">Qty <b>${it.qty}</b> · RM <b>${poUnitPrice(it).toFixed(0)}</b> · Deposit <b>RM ${(Number(it.depositPaid) || 0).toFixed(0)}</b> · Outstanding <b>RM ${poItemOutstanding(it).toFixed(0)}</b></div></div>
      ${poBadge(it.status)}
      ${poIsActive(it) ? `<button class="po-del-btn" onclick="event.stopPropagation();openEditItem('${it.id}')" title="Edit qty / deposit">✎</button>` : ''}
      <button class="po-del-btn" onclick="event.stopPropagation();deletePoItem('${it.id}')" title="Delete preorder">🗑</button>
    </div>
    ${full ? poStepper(it.status) : ''}
    ${poItemActions(it)}
  </div>`;
}
function poCustomerDetailHtml(id) {
  const c = poCustomerById(id); if (!c) return '<div class="po-empty">Customer not found</div>';
  const its = poItemsForCustomer(id);
  const active = its.filter(poIsActive); const history = its.filter(i => !poIsActive(i));
  const live = its.filter(i => i.status !== 'Cancelled');
  const totDep = live.reduce((a, i) => a + (Number(i.depositPaid) || 0), 0);
  const out = active.reduce((a, i) => a + poItemOutstanding(i), 0);
  const done = its.filter(i => i.status === 'Completed').length;
  const elig = its.filter(i => PO_INVOICE_STATUSES.includes(i.status)).length;
  const activeCards = active.map(it => poItemCard(it, true)).join('') || '<div class="po-empty">No active preorders 🎉</div>';
  return `<div class="po-detail-head">
      <div class="po-av po-av-lg">${_poInitials(c.name)}</div>
      <div style="flex:1;min-width:0"><div class="po-detail-name">${_esc(c.name)}</div>
        <div class="po-detail-sub">${_esc(c.platform || '')} · ${_esc(c.phone || '—')}</div>
        ${c.address ? `<div class="po-detail-sub">📍 ${_esc(c.address)}</div>` : ''}
        ${c.notes ? `<div class="po-detail-sub">📝 ${_esc(c.notes)}</div>` : ''}</div>
      <div class="po-detail-actions">
        <button class="btn btn-outline btn-sm" onclick="openEditCustomer('${c.id}')">✎ Edit</button>
        <button class="btn btn-primary btn-sm" onclick="openInvoice('${c.id}')" ${elig ? '' : 'disabled'}>📋 Copy Invoice</button>
      </div>
    </div>
    <div class="po-summary">
      <div class="po-scard"><span>Total deposit</span>RM ${totDep.toFixed(0)}</div>
      <div class="po-scard due"><span>Outstanding</span>RM ${out.toFixed(0)}</div>
      <div class="po-scard"><span>Active</span>${active.length}</div>
      <div class="po-scard"><span>Completed</span>${done}</div>
    </div>
    <div class="po-collapse-h" onclick="poToggleCollapse(this)" style="margin-top:18px"><span class="po-chev">▾</span> Active preorders (${active.length})</div>
    <div class="po-items">${activeCards}</div>
    ${history.length ? `<div class="po-collapse-h closed" onclick="poToggleCollapse(this)"><span class="po-chev">▾</span> Completed &amp; history (${history.length})</div>
      <div class="po-items" style="display:none">${history.map(it => poItemCard(it, false)).join('')}</div>` : ''}`;
}
function poModelDetailHtml(id) {
  const b = poBatchById(id); if (!b) return '<div class="po-empty">Model not found</div>';
  const its = poItemsForBatch(id).filter(i => i.status !== 'Cancelled');
  const totQty = its.reduce((a, i) => a + i.qty, 0);
  // Aligned grid (shared column template with a header row) so Qty / Deposit /
  // Balance line up across rows and long names ellipsize instead of pushing
  // the numbers around.
  const rows = its.map(it => {
    const c = poCustomerById(it.customerId);
    return `<div class="po-wrow" onclick="poSelectCustomer('${it.customerId}')">
      <div class="po-av">${_poInitials(c ? c.name : '?')}</div>
      <div class="po-cust-main"><div class="po-cust-name">${_esc(c ? c.name : '(unknown)')}</div><div class="po-cust-sub">${_esc(c ? c.platform : '')}</div></div>
      <div class="po-wc">${it.qty}</div>
      <div class="po-wc">RM ${(Number(it.depositPaid) || 0).toFixed(0)}</div>
      <div class="po-wc">RM ${poItemOutstanding(it).toFixed(0)}</div>
      <div class="po-wst">${poBadge(it.status)}</div>
    </div>`;
  }).join('');
  const table = rows
    ? `<div class="po-wtable">
        <div class="po-whead"><span></span><span>Customer</span><span class="po-wc">Qty</span><span class="po-wc">Deposit</span><span class="po-wc">Balance</span><span>Status</span></div>
        ${rows}</div>`
    : '<div class="po-empty">No customers yet — tap “Add Customer”.</div>';
  return `<div class="po-detail-head">
      <div class="po-detail-img" ${poImgStyle(b)}>${poImgInner(b)}</div>
      <div style="flex:1;min-width:0"><div class="po-detail-name">${_esc(b.modelName)}</div>
        <div class="po-detail-sub">${_esc(b.brand || '')}${b.eta ? ' · ETA ' + _esc(b.eta) : ''}</div>
        <div class="po-kv-row">
          <div class="po-kv"><span>Price</span>RM ${(Number(b.price) || 0).toFixed(0)}</div>
          <div class="po-kv"><span>Deposit</span>RM ${(Number(b.deposit) || 0).toFixed(0)}</div>
          <div class="po-kv"><span>Ordered</span>${totQty}</div>
          <div class="po-kv"><span>Received</span>
            <span class="po-recv-step">
              <button onclick="event.stopPropagation();poAdjustReceived('${b.id}',-1)" title="Remove one">−</button>
              <b>${b.received || 0}</b>
              <button onclick="event.stopPropagation();poAdjustReceived('${b.id}',1)" title="Add one">+</button>
            </span>
          </div>
        </div>
        ${b.notes ? `<div class="po-detail-sub">📝 ${_esc(b.notes)}</div>` : ''}</div>
      <div class="po-detail-actions">
        <button class="btn btn-primary btn-sm" onclick="openReceive('${b.id}')">📦 Receive Stock</button>
        <button class="btn btn-warning btn-sm" onclick="poNotify('${b.id}')">🔔 Notify</button>
        <button class="btn btn-ghost btn-sm" onclick="openPost('${b.id}')">📝 Copy post</button>
        <button class="btn btn-outline btn-sm" onclick="poExportModelCSV('${b.id}')">⬇ Export</button>
        <button class="btn btn-ghost btn-sm" onclick="openAddCustomer('${b.id}')">＋ Add Customer</button>
        ${b.archived
          ? `<button class="btn btn-outline btn-sm" onclick="unarchivePoBatch('${b.id}')">📂 Unarchive</button>`
          : `<button class="btn btn-outline btn-sm" onclick="archivePoBatch('${b.id}')">🗄 Archive</button>`}
        <button class="btn btn-danger btn-sm" onclick="deletePoBatch('${b.id}')">🗑 Delete</button>
      </div>
    </div>
    <div class="po-collapse-h" onclick="poToggleCollapse(this)"><span class="po-chev">▾</span> Customers (${its.length})</div>
    ${table}`;
}

// ── UTILS ──
function showMsg(id, text, type) {
  const el=document.getElementById(id); if(!el)return;
  if(!text){el.innerHTML='';return;}
  el.innerHTML=`<div class="msg msg-${type==='err'?'err':'ok'}">${text}</div>`;
  if(type==='ok') setTimeout(()=>{if(el)el.innerHTML='';},2800);
}

// ── DRAG/DROP CSV ──
function initDropzone() {
  const drop=document.getElementById('import-drop');
  if(!drop)return;
  drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('drag'));
  drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('drag');const f=e.dataTransfer.files[0];if(!f)return;const inp=drop.querySelector('input');const dt=new DataTransfer();dt.items.add(f);inp.files=dt.files;handleCSVImport(inp);});
}

// ── DATA SYNC LISTENER ──
window.addEventListener('mh_data_updated', () => {
  if (currentTab === 'inventory') { renderInventory(); renderStats(); }
  if (currentTab === 'history')   { renderHistory(); renderHistStats(); }
  if (currentTab === 'sold')      { renderSoldItems(); }
  if (currentTab === 'preorders') { renderPreorders(); }
  // keep the cashier read-only Sold Items view live while it is open
  if (_cashierSoldOpen) renderCashierSold(document.getElementById('cs-search')?.value || '');
});

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  applyLogo();
  updateTopbarEvent();
  renderInventory();
  renderStats();
  document.getElementById('ev-date').value = new Date().toISOString().slice(0,10);
  initDropzone();
  // start sync engine
  if (window.SyncEngine) SyncEngine.init().catch(e => console.warn('[Sync] init error:', e));
  // always start in cashier mode
  enterCashierMode();
});
