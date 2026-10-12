// Inventory photo library. All images come from existing product records.
let photoSelection = new Set();
function photoItems() { return products.filter(p => !!p.img); }
function photoOpen() {
  if (typeof managerGuard === 'function' && !managerGuard(() => photoOpen())) return;
  photoSelection.clear();
  document.getElementById('photo-search').value = '';
  poOpen('photo-modal');
  photoRender();
}
function photoFiltered() {
  const q = (document.getElementById('photo-search').value || '').trim().toLowerCase();
  return photoItems().filter(p => [p.name, p.brand, p.barcode].some(v => String(v || '').toLowerCase().includes(q)));
}
function photoRender() {
  const list = photoFiltered(), grid = document.getElementById('photo-grid');
  document.getElementById('photo-count').textContent = photoItems().length + ' product photos · ' + photoSelection.size + ' selected';
  document.getElementById('photo-export').disabled = !photoSelection.size;
  document.getElementById('photo-export').textContent = '⬇ Download selected ZIP (' + photoSelection.size + ')';
  if (!list.length) { grid.innerHTML = '<p>No product photos found.</p>'; return; }
  grid.innerHTML = list.map(p => {
    const key = encodeURIComponent(p.barcode);
    const selected = photoSelection.has(p.barcode);
    return '<div class="photo-tile"><img alt="" src="' + _esc(_imageSrc(p.img)) + '">' +
      '<div class="photo-tile-name">' + _esc(p.name) + '</div>' +
      '<div class="photo-tile-actions"><label><input type="checkbox" ' + (selected ? 'checked ' : '') +
      'onchange="photoToggle(decodeURIComponent(\'' + key + '\'),this.checked)"> Select</label>' +
      '<button class="btn btn-outline btn-sm" onclick="photoDownloadOne(decodeURIComponent(\'' + key + '\'))">⬇ Save</button></div></div>';
  }).join('');
}
function photoToggle(bc, checked) { if (checked) photoSelection.add(bc); else photoSelection.delete(bc); photoRender(); }
function photoSelectVisible() { photoFiltered().forEach(p => photoSelection.add(p.barcode)); photoRender(); }
function photoClearSelection() { photoSelection.clear(); photoRender(); }
function photoName(p) {
  const safe = s => String(s || '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 65);
  return (safe(p.name) || 'product') + '_' + (safe(p.barcode) || 'no_barcode') + '.jpg';
}
function photoBlob(p) {
  const src = _imageSrc(p.img);
  if (!src.startsWith('data:image/')) throw new Error('Unsupported photo format');
  const parts = src.split(','), mime = parts[0].slice(5).split(';')[0];
  const binary = atob(parts[1]), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return {bytes, mime};
}
function photoSaveBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function photoDownloadOne(bc) {
  const p = photoItems().find(p => p.barcode === bc);
  if (!p) return;
  try {
    const data = photoBlob(p);
    const ext = data.mime === 'image/png' ? '.png' : data.mime === 'image/webp' ? '.webp' : '.jpg';
    photoSaveBlob(new Blob([data.bytes], {type:data.mime}), photoName(p).replace(/\.jpg$/, ext));
  } catch(e) { poToast('Could not download this photo'); }
}
// Self-contained ZIP writer (uncompressed STORE entries): no external script or network dependency.
const photoEncoder = new TextEncoder();
function photoCrc(bytes) {
  let crc = -1;
  for (const b of bytes) {
    crc ^= b;
    for (let j=0; j<8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
function photoZip(items) {
  const parts = [], central = []; let offset = 0;
  const put16 = (d, pos, val) => d.setUint16(pos, val, true);
  const put32 = (d, pos, val) => d.setUint32(pos, val, true);
  for (const p of items) {
    const data = photoBlob(p), bytes = data.bytes;
    const ext = data.mime === 'image/png' ? '.png' : data.mime === 'image/webp' ? '.webp' : '.jpg';
    const filename = photoEncoder.encode(photoName(p).replace(/\.jpg$/, ext));
    const crc = photoCrc(bytes);
    const local = new Uint8Array(30 + filename.length), l = new DataView(local.buffer);
    put32(l,0,0x04034b50); put16(l,4,20); put16(l,6,0x800); put16(l,8,0);
    put32(l,14,crc); put32(l,18,bytes.length); put32(l,22,bytes.length); put16(l,26,filename.length);
    local.set(filename,30); parts.push(local,bytes);
    const c = new Uint8Array(46 + filename.length), v = new DataView(c.buffer);
    put32(v,0,0x02014b50); put16(v,4,20); put16(v,6,20); put16(v,8,0x800); put16(v,10,0);
    put32(v,16,crc); put32(v,20,bytes.length); put32(v,24,bytes.length); put16(v,28,filename.length);
    put32(v,42,offset); c.set(filename,46); central.push(c);
    offset += local.length + bytes.length;
  }
  const centralSize = central.reduce((n,c) => n+c.length,0);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  put32(e,0,0x06054b50); put16(e,8,items.length); put16(e,10,items.length);
  put32(e,12,centralSize); put32(e,16,offset);
  return new Blob([...parts,...central,end],{type:'application/zip'});
}
function photoDownloadSelected() {
  const items = photoItems().filter(p => photoSelection.has(p.barcode));
  if (!items.length) return;
  if (items.length > 65535) { poToast('Too many photos for a ZIP'); return; }
  try {
    photoSaveBlob(photoZip(items), 'mobihobby_photos_' + new Date().toISOString().slice(0,10) + '.zip');
    poToast(items.length + ' photos exported in one ZIP');
  } catch(e) { poToast('Photo export failed: ' + (e.message || 'unknown error')); }
}
function photoDownloadAll() { photoItems().forEach(p => photoSelection.add(p.barcode)); photoDownloadSelected(); photoRender(); }
