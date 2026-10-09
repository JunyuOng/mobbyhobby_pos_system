// Stock check drafts are local to this browser; live inventory changes only on Apply.
const MHStockCheck = {
  validCount(value) { return /^(0|[1-9]\d*)$/.test(String(value)) && Number.isSafeInteger(Number(value)); },
  conflict(row, product, held) {
    return !product || Number(product.stock || 0) !== row.expected || held !== row.held;
  },
  difference(row) { return row.counted === null ? null : row.counted - row.expected; }
};
window.MHStockCheck = MHStockCheck;
const SC_KEY = 'mh_stock_check_v1';
let scDraft = null;
let scReviewing = false;
let scStorageText = '';
function scRead() {
  try {
    const draft = JSON.parse(localStorage.getItem(SC_KEY) || 'null');
    if (draft && draft.version === 1 && Array.isArray(draft.rows) &&
        draft.rows.every(r => typeof r.barcode === 'string' &&
          MHStockCheck.validCount(r.expected) && MHStockCheck.validCount(r.held) &&
          (r.counted === null || MHStockCheck.validCount(r.counted)))) return draft;
  } catch (error) { scStorageText = 'Saved progress could not be read. Keep this screen open while counting.'; }
  return null;
}
function scPersist() {
  try {
    localStorage.setItem(SC_KEY, JSON.stringify(scDraft));
    scStorageText = '';
    return true;
  } catch (error) {
    scStorageText = 'Progress could not be saved on this device. Do not close this screen.';
    return false;
  }
}
function scOpen() {
  scStorageText = '';
  scDraft = scRead();
  scReviewing = false;
  document.getElementById('sc-search').value = '';
  document.getElementById('sc-filter').value = 'all';
  document.getElementById('sc-modal').classList.add('open');
  scRender();
}
function scClose() {
  const active = document.activeElement;
  if (active?.id?.startsWith('sc-count-')) scRecord(Number(active.id.slice(9)),active);
  document.getElementById('sc-modal').classList.remove('open');
}
function scStart() {
  if (!products.length) { poToast('Add inventory before starting a stock check'); return; }
  scDraft = {version:1, id: Date.now().toString(36), started: new Date().toISOString(),
    rows: products.map(p => ({barcode:p.barcode, name:p.name, brand:p.brand || '',
      expected:Number(p.stock || 0), held:resvUnitsFor(p.barcode), counted:null}))};
  scReviewing = false;
  scPersist(); scRender();
}
function scDiscard() {
  if (!confirm('Discard this counting draft? Your inventory will stay unchanged.')) return;
  try { localStorage.removeItem(SC_KEY); }
  catch (error) { poToast('Could not discard saved draft'); return; }
  scDraft = null; scReviewing = false; scStorageText = ''; scRender();
}
function scRecord(index, input) {
  if (!scDraft || scReviewing) return;
  const row = scDraft.rows[index];
  if (!row) return;
  if (input.value === '') {
    row.counted = null; input.setCustomValidity('');
  } else {
    if (!MHStockCheck.validCount(input.value)) {
      row.counted = null; scPersist();
      input.setCustomValidity('Enter a whole number of 0 or more.'); input.reportValidity(); return;
    }
    const p = products.find(p => p.barcode === row.barcode);
    if (!p) { poToast('This product was removed. Start a new stock check.'); scRender(); return; }
    // Re-entering a count acknowledges the latest stock and reservation amounts.
    row.expected = Number(p.stock || 0);
    row.held = resvUnitsFor(row.barcode);
    row.counted = Number(input.value); input.setCustomValidity('');
  }
  scPersist(); scRender();
}
function scRecount(index) {
  const row = scDraft?.rows[index];
  const p = row && products.find(p => p.barcode === row.barcode);
  if (!p) { poToast('Product removed. Start a new stock check.'); return; }
  row.expected = Number(p.stock || 0); row.held = resvUnitsFor(row.barcode); row.counted = null;
  scPersist(); scRender();
  document.getElementById('sc-count-' + index)?.focus();
}
function scReview() {
  if (!scDraft || !scDraft.rows.some(r => r.counted !== null)) {
    poToast('Count at least one item first'); return;
  }
  scReviewing = true; scRender();
}
function scBack() { scReviewing = false; scRender(); }
function scScan(event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const query = event.target.value.trim();
  if (!scDraft || scReviewing) return;
  const index = scDraft.rows.findIndex(r => r.barcode === query);
  if (index < 0) { poToast('No matching barcode in this stock check'); return; }
  document.getElementById('sc-filter').value = 'all'; scRender();
  const input = document.getElementById('sc-count-' + index);
  if (input) { input.focus(); input.select(); }
}
function scRender() {
  const body = document.getElementById('sc-body');
  const summary = document.getElementById('sc-summary');
  const actions = document.getElementById('sc-actions');
  document.getElementById('sc-search-controls').hidden = !scDraft || scReviewing;
  const message = document.getElementById('sc-message');
  message.textContent = scStorageText;
  if (!scDraft) {
    summary.textContent = 'Count your available stock, then review any differences.';
    body.innerHTML = '<div class="sc-empty"><p>Count only units available to sell. Keep reserved units aside.</p><p>Progress is saved on this device. Counting does not change inventory.</p><button class="btn btn-primary" onclick="scStart()">Start stock check</button></div>';
    actions.innerHTML = ''; return;
  }
  const counted = scDraft.rows.filter(r => r.counted !== null);
  const differences = counted.filter(r => MHStockCheck.difference(r) !== 0);
  const conflicts = counted.filter(r => MHStockCheck.conflict(r,
    products.find(p => p.barcode === r.barcode), resvUnitsFor(r.barcode)));
  summary.textContent = counted.length + ' of ' + scDraft.rows.length + ' checked · ' +
    (scDraft.rows.length - counted.length) + ' remaining · ' + differences.length + ' differences';
  const query = document.getElementById('sc-search').value.trim().toLowerCase();
  const filter = document.getElementById('sc-filter').value;
  let visible = scDraft.rows.map((r,i) => ({r,i}));
  if (scReviewing) visible = visible.filter(({r}) => r.counted !== null &&
    (MHStockCheck.difference(r) !== 0 || MHStockCheck.conflict(r,
      products.find(p => p.barcode === r.barcode), resvUnitsFor(r.barcode))));
  else visible = visible.filter(({r}) => (!query || [r.name,r.brand,r.barcode].some(v => String(v).toLowerCase().includes(query))) &&
    (filter === 'all' || (filter === 'remaining' && r.counted === null) ||
      (filter === 'differences' && r.counted !== null && MHStockCheck.difference(r) !== 0)));
  const note = scReviewing ?
    '<p class="sc-note">Only counted items are included. Unchecked items stay unchanged.' +
    (conflicts.length ? ' Stock changed for ' + conflicts.length + ' item(s). Go back and recount the flagged items before applying.' : '') + '</p>' :
    '<p class="sc-note">Count available units only. Reserved units are shown separately. Enter 0 if none remain.</p>';
  body.innerHTML = note + (visible.length ? visible.map(({r,i}) => {
    const p = products.find(p => p.barcode === r.barcode);
    const conflict = MHStockCheck.conflict(r,p,resvUnitsFor(r.barcode));
    const diff = MHStockCheck.difference(r);
    const difference = diff === null ? 'Unchecked' : diff === 0 ? 'Matches' : (diff > 0 ? '+' : '') + diff + ' difference';
    return '<div class="sc-row' + (conflict ? ' sc-conflict' : '') + '">' +
      '<div class="sc-product"><strong>' + _esc(r.name) + '</strong><small>' + _esc(r.brand) + ' · ' + _esc(r.barcode) + '</small>' +
      (conflict ? '<small class="sc-warning">' + (p ? 'Stock changed — recount this item' : 'Product removed — start a new check') + '</small>' + (p && !scReviewing ? '<button class="btn btn-outline btn-sm" onclick="scRecount(' + i + ')">Recount</button>' : '') : '') + '</div>' +
      '<div class="sc-expected">Recorded<strong>' + r.expected + '</strong><small>' + r.held + ' reserved separately</small></div>' +
      '<div class="sc-count"><label for="sc-count-' + i + '">Counted</label>' +
      (scReviewing ? '<strong>' + r.counted + '</strong>' :
        '<input id="sc-count-' + i + '" aria-label="Count for ' + _esc(r.name) + '" type="number" min="0" step="1" inputmode="numeric" placeholder="—" value="' +
        (r.counted === null ? '' : r.counted) + '" onchange="scRecord(' + i + ',this)">') + '</div>' +
      '<div class="sc-result' + (diff !== null && diff !== 0 ? ' sc-different' : '') + '">' + difference + '</div></div>';
  }).join('') : '<p class="sc-empty">' + (scReviewing ? 'All counted quantities match. There are no stock differences to apply.' : 'No items match this view.') + '</p>');
  if (scReviewing) actions.innerHTML = '<button class="btn btn-outline" onclick="scBack()">Back to counting</button>' +
    '<button class="btn btn-primary" onclick="scApply()"' + (conflicts.length ? ' disabled' : '') + '>' +
    (differences.length ? 'Apply ' + differences.length + ' adjustments' : 'Finish check') + '</button>';
  else actions.innerHTML = '<button class="btn btn-ghost" onclick="scDiscard()">Discard draft</button>' +
    '<button class="btn btn-primary" onclick="scReview()"' + (!counted.length ? ' disabled' : '') + '>Review counts</button>';
}
function scApply() {
  if (!scDraft || !scReviewing) return;
  if (!managerGuard(() => scApply())) return;
  // Another tab must not overwrite a newer draft without reviewing it.
  const stored = scRead();
  if (stored && JSON.stringify(stored) !== JSON.stringify(scDraft)) {
    scDraft = stored; scReviewing = false;
    poToast('Draft changed in another tab. Review the latest counts.'); scRender(); return;
  }
  const counted = scDraft.rows.filter(r => r.counted !== null);
  if (!counted.length) return;
  if (counted.some(r => MHStockCheck.conflict(r,
      products.find(p => p.barcode === r.barcode), resvUnitsFor(r.barcode)))) {
    poToast('Stock changed. Go back and recount the flagged items.'); scRender(); return;
  }
  const changes = counted.filter(r => MHStockCheck.difference(r) !== 0);
  if (changes.length && !confirm('Apply ' + changes.length + ' stock adjustments? Unchecked items and reservations will stay unchanged.')) return;
  // Persist completion locally before making adjustments so reopening cannot repeat them.
  try { localStorage.removeItem(SC_KEY); }
  catch (error) { poToast('Could not finish the draft. Try again.'); return; }
  for (const row of changes) {
    const p = products.find(p => p.barcode === row.barcode);
    p.stock = row.counted;
    save('STOCK_ADJUST', {barcode:row.barcode, stock:p.stock});
  }
  scDraft = null; scReviewing = false;
  renderInventory(); renderStats(); scClose();
  poToast(changes.length ? changes.length + ' stock adjustments saved — check the sync badge for cloud status' : 'Stock check finished — all counted items match');
}
window.addEventListener('mh_data_updated', () => {
  if (document.getElementById('sc-modal')?.classList.contains('open')) scRender();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.getElementById('sc-modal')?.classList.contains('open')) scClose();
});
