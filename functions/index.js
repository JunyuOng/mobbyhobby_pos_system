'use strict';
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineString } = require('firebase-functions/params');
const { createHash } = require('node:crypto');
const { validateEnvelope, validateCashierSale } = require('./validation');
initializeApp();
const db = getFirestore();
const ownerEmail = defineString('MOBIHOBBY_OWNER_EMAIL', { description: 'Verified Google email of the MobiHobby owner. Set during deployment; never a password.' });
const options = { region: 'asia-southeast1', maxInstances: 3, minInstances: 0 };
const hash = s => createHash('sha256').update(s).digest('hex');
const staffRef = uid => db.collection('staff').doc(uid);
const catalogRef = barcode => db.collection('securityCatalog').doc(hash(barcode));
function uidOf(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  return request.auth.uid;
}
async function roleOf(request) {
  const uid = uidOf(request);
  const doc = await staffRef(uid).get();
  return doc.exists && doc.data().enabled === true ? doc.data().role : null;
}
async function managerOnly(request) {
  if (await roleOf(request) !== 'manager') throw new HttpsError('permission-denied', 'Manager access required.');
}
exports.managerSession = onCall(options, async request => {
  const uid = uidOf(request);
  const token = request.auth.token;
  // Bootstrap only the explicitly configured owner with a verified Google identity.
  // Other accounts cannot self-enrol by writing browser/localStorage values.
  if (token.email_verified === true && token.firebase?.sign_in_provider === 'google.com'
      && ownerEmail.value().trim() && token.email?.toLowerCase() === ownerEmail.value().trim().toLowerCase()) {
    const ref = staffRef(uid);
    await db.runTransaction(async tx => {
      const previous = await tx.get(ref);
      if (!previous.exists) tx.create(ref, { role: 'manager', enabled: true, createdAt: FieldValue.serverTimestamp() });
    });
  }
  await managerOnly(request);
  const setup = await db.doc('securityConfig/setup').get();
  return { role: 'manager', ready: setup.exists && setup.data().ready === true };
});
exports.enrolCashier = onCall(options, async request => {
  await managerOnly(request);
  const uid = request.data?.uid;
  if (typeof uid !== 'string' || !uid || uid.length > 128) throw new HttpsError('invalid-argument', 'Invalid cashier UID.');
  const user = await getAuth().getUser(uid);
  if (user.disabled || user.providerData.length) throw new HttpsError('failed-precondition', 'Use this device’s anonymous cashier account.');
  await staffRef(uid).set({ role: 'cashier', enabled: true, approvedBy: request.auth.uid, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});
// One-time, additive catalog bootstrap. Does not edit any existing event or business record.
// Run after legacy queues are drained and old clients are closed.
exports.initializePosSecurity = onCall({ ...options, timeoutSeconds: 540 }, async request => {
  await managerOnly(request);
  const config = db.doc('securityConfig/setup');
  await db.runTransaction(async tx => {
    const current = await tx.get(config);
    if (current.exists && current.data().ready) throw new HttpsError('already-exists', 'Security is already initialized.');
    // A failed run can be retried after its ten-minute lease expires.
    if (current.exists && current.data().startedAt > Date.now() - 600000) throw new HttpsError('aborted', 'Initialization is already running.');
    tx.set(config, { ready: false, startedAt: Date.now() });
  });
  try {
    const snapshot = await db.collection('events').orderBy('timestamp', 'asc').get();
    const catalog = new Map();
    for (const doc of snapshot.docs) {
      const ev = doc.data(), d = ev.data;
      if (ev.type === 'PRODUCT_UPSERT' && d?.barcode) catalog.set(d.barcode, { barcode: d.barcode, price: Number(d.price), deleted: false });
      if (ev.type === 'PRODUCT_DELETE' && d?.barcode) catalog.set(d.barcode, { barcode: d.barcode, price: 0, deleted: true });
    }
    const rows = [...catalog.values()];
    for (let i = 0; i < rows.length; i += 400) {
      const batch = db.batch();
      rows.slice(i, i + 400).forEach(p => {
        if (!Number.isFinite(p.price) || p.price < 0) throw new HttpsError('failed-precondition', 'Invalid legacy product price. Correct it before setup.');
        batch.set(catalogRef(p.barcode), p);
      });
      await batch.commit();
    }
    await config.set({ ready: true, initializedBy: request.auth.uid, initializedAt: FieldValue.serverTimestamp() });
    return { ok: true, products: rows.length };
  } catch (error) {
    await config.set({ ready: false, startedAt: 0 });
    throw error;
  }
});
exports.commitPosEvent = onCall(options, async request => {
  const uid = uidOf(request), input = request.data;
  try { validateEnvelope(input); } catch (e) { throw new HttpsError('invalid-argument', e.message); }
  const eventRef = db.collection('events').doc('v2_' + input.eventId);
  const saleRef = input.type === 'SALE' ? db.collection('securitySales').doc(hash(input.data.id)) : null;
  const digest = hash(JSON.stringify({ type: input.type, deviceId: input.deviceId, timestamp: input.timestamp, data: input.data }));
  return db.runTransaction(async tx => {
    const [staff, setup, previous] = await Promise.all([
      tx.get(staffRef(uid)), tx.get(db.doc('securityConfig/setup')), tx.get(eventRef)
    ]);
    const role = staff.exists && staff.data().enabled === true ? staff.data().role : null;
    if (!['manager','cashier'].includes(role)) throw new HttpsError('permission-denied', 'This account/device is not enrolled.');
    if (!setup.exists || setup.data().ready !== true) throw new HttpsError('failed-precondition', 'Manager must finish security setup.');
    if (previous.exists) {
      if (previous.data().payloadHash !== digest) throw new HttpsError('already-exists', 'Event ID already used for different data.');
      return { ok: true, duplicate: true };
    }
    const priorSale = saleRef ? await tx.get(saleRef) : null;
    if (role !== 'manager') {
      if (priorSale?.exists) throw new HttpsError('already-exists', 'This sale ID already exists; manager review required.');
      if (input.type !== 'SALE') throw new HttpsError('permission-denied', 'Manager access required.');
      const lines = input.data.arr;
      if (!Array.isArray(lines) || !lines.length || lines.some(l => !l || typeof l.barcode !== 'string')) {
        throw new HttpsError('invalid-argument', 'Invalid sale lines.');
      }
      const barcodes = [...new Set(lines.map(l => l.barcode))];
      const docs = await Promise.all(barcodes.map(b => tx.get(catalogRef(b))));
      try { validateCashierSale(input.data, new Map(docs.map((d,i) => [barcodes[i], d.exists ? d.data() : null]))); }
      catch (e) { throw new HttpsError('failed-precondition', e.message); }
      // Prevent a new transport ID from replaying an existing sale, including legacy IDs.
      const legacy = await tx.get(db.collection('events').where('type','==','SALE').where('data.id','==',input.data.id).limit(1));
      if (!legacy.empty) throw new HttpsError('already-exists', 'This sale ID already exists; manager review required.');
    }
    const event = { type: input.type, deviceId: input.deviceId, timestamp: input.timestamp, data: input.data,
      actorUid: uid, actorRole: role, payloadHash: digest, schemaVersion: 2, serverTime: FieldValue.serverTimestamp() };
    tx.create(eventRef, event);
    if (saleRef && !priorSale.exists) tx.create(saleRef, { eventId: input.eventId });
    if (input.type === 'PRODUCT_UPSERT') tx.set(catalogRef(input.data.barcode), { barcode: input.data.barcode, price: input.data.price, deleted: false });
    if (input.type === 'PRODUCT_DELETE') tx.set(catalogRef(input.data.barcode), { barcode: input.data.barcode, price: 0, deleted: true });
    return { ok: true, duplicate: false };
  });
});
