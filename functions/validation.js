'use strict';
const TYPES = new Set(['SALE','SALE_UPDATE','SALE_DELETE','HISTORY_CLEAR','PRODUCT_UPSERT',
  'PRODUCT_DELETE','STOCK_ADJUST','EVENT_UPSERT','SETTINGS','CUSTOMER_UPSERT',
  'POBATCH_UPSERT','POITEM_UPSERT','RESV_UPSERT']);
function check(ok, message) { if (!ok) { const e = new Error(message); e.code = 'invalid-argument'; throw e; } }
function amount(v) {
  check((typeof v === 'number' || typeof v === 'string') && String(v).trim() !== '', 'Missing amount');
  const n = Number(v); check(Number.isFinite(n) && n >= 0, 'Amounts must be finite and non-negative');
  const cents = Math.round(n * 100);
  check(Number.isSafeInteger(cents), 'Amount too large');
  return cents;
}
function validateEnvelope(event) {
  check(event && typeof event === 'object' && !Array.isArray(event), 'Invalid event');
  check(typeof event.eventId === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(event.eventId), 'Invalid event ID');
  check(TYPES.has(event.type), 'Unknown event type');
  check(typeof event.deviceId === 'string' && event.deviceId.length <= 100, 'Invalid device');
  check(Number.isSafeInteger(event.timestamp) && event.timestamp > 0, 'Invalid timestamp');
  check(event.data && typeof event.data === 'object' && !Array.isArray(event.data), 'Invalid event data');
  check(Buffer.byteLength(JSON.stringify(event)) < 900000, 'Event is too large; reduce its photos');
  const d = event.data;
  if (['PRODUCT_UPSERT','PRODUCT_DELETE','STOCK_ADJUST'].includes(event.type)) {
    check(typeof d.barcode === 'string' && d.barcode.length > 0 && d.barcode.length <= 200, 'Invalid barcode');
  } else if (!['HISTORY_CLEAR','SETTINGS'].includes(event.type)) {
    check(typeof d.id === 'string' && d.id.length > 0 && d.id.length <= 200, 'Invalid record ID');
  }
  if (event.type === 'PRODUCT_UPSERT') {
    amount(d.price); check(Number.isSafeInteger(d.stock) && d.stock >= 0, 'Invalid stock');
  }
  if (event.type === 'STOCK_ADJUST') check(Number.isSafeInteger(d.stock) && d.stock >= 0, 'Invalid stock');
}
function validateCashierSale(sale, catalog) {
  check(!sale._deleted && !sale.fromReservation, 'Reservation conversion requires a manager');
  check(Array.isArray(sale.arr) && sale.arr.length > 0, 'Sale needs items');
  check(['Physical','Online'].includes(sale.salesType), 'Invalid sale type');
  check(sale.salesType !== 'Online' || ['Facebook','WhatsApp','Rednote','Other'].includes(sale.platform), 'Invalid platform');
  let full = 0, subtotal = 0;
  const seen = new Set();
  for (const item of sale.arr) {
    check(item && typeof item.barcode === 'string' && !seen.has(item.barcode), 'Invalid or duplicate sale line');
    seen.add(item.barcode);
    check(Number.isSafeInteger(item.qty) && item.qty > 0, 'Invalid quantity');
    const product = catalog.get(item.barcode);
    check(product && !product.deleted, 'Product unavailable; manager review required');
    const price = amount(product.price);
    check(amount(item.price) === price, 'Price changed; manager review required');
    const actual = item.discPrice == null ? price : amount(item.discPrice);
    full += price * item.qty; subtotal += actual * item.qty;
    check(Number.isSafeInteger(full) && Number.isSafeInteger(subtotal), 'Sale amount too large');
  }
  check(Math.abs(amount(sale.subtotal) - subtotal) <= 1, 'Incorrect subtotal');
  const discount = amount(sale.discount), total = amount(sale.total);
  check(discount <= subtotal && Math.abs(total - (subtotal - discount)) <= 1, 'Incorrect sale total');
  check(total * 100 >= full * 80, 'Discount above 20% requires manager approval');
  return true;
}
module.exports = { TYPES, validateEnvelope, validateCashierSale };
