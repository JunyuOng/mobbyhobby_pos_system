// ── MOBIHOBBY SYNC ENGINE ──
// Firestore event-based sync. Append-only event log.
// Each device pushes local events; pulls remote events on connect.

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyATMiiluV41vZwTW2QBl3ddOajMAK2nZM0",
  authDomain: "mobihobby-pos-system.firebaseapp.com",
  projectId: "mobihobby-pos-system",
  storageBucket: "mobihobby-pos-system.firebasestorage.app",
  messagingSenderId: "463390159644",
  appId: "1:463390159644:web:f320ea5cc092f2771980d9"
};

// ── DEVICE ID ──
function getDeviceId() {
  let id = localStorage.getItem('mh_device_id');
  if (!id) { id = 'POS_' + Math.random().toString(36).slice(2,8).toUpperCase(); localStorage.setItem('mh_device_id', id); }
  return id;
}

// id-keyed upsert/delete used by the pre-order sync events (mutates in place so
// the shared app.js binding stays valid).
function _mhUpsertById(arr, data) {
  const i = arr.findIndex(x => x.id === data.id);
  if (data._deleted) { if (i >= 0) arr.splice(i, 1); }
  else if (i >= 0) arr[i] = { ...arr[i], ...data };
  else arr.push(data);
}

// ── SYNC STATE ──
const SyncEngine = {
  db: null,
  auth: null,
  online: false,
  queue: JSON.parse(localStorage.getItem('mh_sync_queue') || '[]'),
  lastPull: parseInt(localStorage.getItem('mh_last_pull') || '0'),
  deviceId: getDeviceId(),
  listeners: {},

  // ── INIT ──
  async init() {
    try {
      const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      const { getFirestore, collection, addDoc, query, where, orderBy, getDocs, onSnapshot, serverTimestamp }
        = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      const { getAuth, signInAnonymously } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');

      const app = initializeApp(FIREBASE_CONFIG);
      this.db = getFirestore(app);
      this.auth = getAuth(app);
      this._fs = { collection, addDoc, query, where, orderBy, getDocs, onSnapshot, serverTimestamp };

      // sign in anonymously
      await signInAnonymously(this.auth);
      this.online = true;
      this._updateSyncBadge('synced');

      // push queued events
      await this.flushQueue();

      // pull missed events
      await this.pull();

      // listen for realtime updates
      this._listenRealtime();

      console.log('[Sync] Online. Device:', this.deviceId);
    } catch (e) {
      console.warn('[Sync] Offline or Firebase error:', e.message);
      this.online = false;
      this._updateSyncBadge('offline');
    }

    // watch connectivity
    window.addEventListener('online', () => this._onOnline());
    window.addEventListener('offline', () => { this.online = false; this._updateSyncBadge('offline'); });
  },

  // ── PUSH EVENT ──
  async push(type, data) {
    const event = {
      type,
      deviceId: this.deviceId,
      timestamp: Date.now(),
      data
    };

    // always save locally first
    this._applyEvent(event);

    if (this.online) {
      try {
        const { addDoc, collection, serverTimestamp } = this._fs;
        await addDoc(collection(this.db, 'events'), {
          ...event,
          serverTime: serverTimestamp()
        });
        this._updateSyncBadge('synced');
      } catch (e) {
        console.warn('[Sync] Push failed, queuing:', e.message);
        this._enqueue(event);
        this._updateSyncBadge('pending');
      }
    } else {
      this._enqueue(event);
      this._updateSyncBadge('pending');
    }
  },

  // ── PULL REMOTE EVENTS ──
  async pull() {
    if (!this.online || !this.db) return;
    try {
      const { collection, query, where, orderBy, getDocs } = this._fs;
      const q = query(
        collection(this.db, 'events'),
        where('timestamp', '>', this.lastPull),
        orderBy('timestamp', 'asc')
      );
      const snap = await getDocs(q);
      let maxTs = this.lastPull;
      snap.forEach(doc => {
        const ev = doc.data();
        if (ev.deviceId !== this.deviceId) {
          this._applyEvent(ev);
        }
        if (ev.timestamp > maxTs) maxTs = ev.timestamp;
      });
      this.lastPull = maxTs;
      localStorage.setItem('mh_last_pull', String(maxTs));
      if (!snap.empty) window.dispatchEvent(new Event('mh_data_updated'));
    } catch (e) {
      console.warn('[Sync] Pull failed:', e.message);
    }
  },

  // ── FORCE FULL RE-PULL ──
  // Rebuilds local state from the ENTIRE cloud event log (ignores lastPull and
  // the device filter). Used by the "Re-sync from cloud" button so a new device
  // / installed phone app that opened empty can grab everything in one tap.
  // Returns a result object (surfaces the real error) so the UI can show it.
  async forcePull() {
    if (!this._fs || !this.db) {
      // try to init once if we haven't connected yet
      try { await this.init(); } catch (e) {}
      if (!this._fs || !this.db) return { ok: false, error: 'Not connected to the cloud yet — check your internet and try again.' };
    }
    try {
      const { collection, query, orderBy, getDocs } = this._fs;
      const snap = await getDocs(query(collection(this.db, 'events'), orderBy('timestamp', 'asc')));
      let n = 0, maxTs = 0;
      snap.forEach(doc => {
        const ev = doc.data();
        this._applyEvent(ev);                 // idempotent upserts — safe to replay all
        if (ev.timestamp > maxTs) maxTs = ev.timestamp;
        n++;
      });
      this.lastPull = maxTs;
      localStorage.setItem('mh_last_pull', String(maxTs));
      window.dispatchEvent(new Event('mh_data_updated'));
      return { ok: true, events: n };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  },

  // ── REALTIME LISTENER ──
  _listenRealtime() {
    if (!this.db) return;
    const { collection, query, where, orderBy, onSnapshot } = this._fs;
    const q = query(
      collection(this.db, 'events'),
      where('timestamp', '>', Date.now()),
      orderBy('timestamp', 'asc')
    );
    onSnapshot(q, snap => {
      snap.docChanges().forEach(change => {
        if (change.type === 'added') {
          const ev = change.doc.data();
          if (ev.deviceId !== this.deviceId) {
            this._applyEvent(ev);
            window.dispatchEvent(new Event('mh_data_updated'));
          }
        }
      });
    }, e => console.warn('[Sync] Realtime listener error:', e.message));
  },

  // ── APPLY EVENT TO LOCAL STATE ──
  _applyEvent(event) {
    // loaded from app.js globals
    switch (event.type) {
      case 'SALE':
        // avoid duplicates
        if (!sales.find(s => s.id === event.data.id)) {
          sales.unshift(event.data);
          // deduct stock
          if (event.data.arr) {
            event.data.arr.forEach(item => {
              const p = products.find(x => x.barcode === item.barcode);
              if (p) p.stock = Math.max(0, p.stock - item.qty);
            });
          }
          _localSave();
        }
        break;
      case 'SALE_UPDATE':
        // a sale was edited (e.g. one line restored to stock)
        const sui = sales.findIndex(s => s.id === event.data.id);
        if (sui >= 0) { sales[sui] = event.data; _localSave(); }
        break;
      case 'SALE_DELETE':
        // a whole sale was voided / restored to inventory
        if (sales.some(s => s.id === event.data.id)) {
          sales = sales.filter(s => s.id !== event.data.id);
          _localSave();
        }
        break;
      case 'HISTORY_CLEAR':
        sales = [];
        _localSave();
        break;
      case 'PRODUCT_UPSERT':
        const idx = products.findIndex(p => p.barcode === event.data.barcode);
        if (idx >= 0) { products[idx] = { ...products[idx], ...event.data }; }
        else { products.push(event.data); }
        _localSave();
        break;
      case 'PRODUCT_DELETE':
        products = products.filter(p => p.barcode !== event.data.barcode);
        _localSave();
        break;
      case 'STOCK_ADJUST':
        const p2 = products.find(x => x.barcode === event.data.barcode);
        if (p2) { p2.stock = event.data.stock; _localSave(); }
        break;
      case 'EVENT_UPSERT':
        const ei = events.findIndex(e => e.id === event.data.id);
        if (event.data._deleted) {
          // deletion broadcast — drop the event instead of resurrecting a stub
          if (ei >= 0) { events.splice(ei, 1); _localSave(); }
        } else if (ei >= 0) { events[ei] = event.data; _localSave(); }
        else { events.unshift(event.data); _localSave(); }
        break;
      case 'SETTINGS':
        // latest wins
        const stored = JSON.parse(localStorage.getItem('mh_settings') || '{}');
        if ((event.data.timestamp || 0) >= (stored.timestamp || 0)) {
          localStorage.setItem('mh_settings', JSON.stringify(event.data));
        }
        break;
      // ── Pre-order module (id-keyed upsert/delete, shared helper) ──
      case 'CUSTOMER_UPSERT': _mhUpsertById(customers, event.data); _localSave(); break;
      case 'POBATCH_UPSERT':  _mhUpsertById(poBatches, event.data); _localSave(); break;
      case 'POITEM_UPSERT':   _mhUpsertById(poItems,   event.data); _localSave(); break;
      // ── Reservations (holds on in-stock items) ──
      case 'RESV_UPSERT':     _mhUpsertById(reservations, event.data); _localSave(); break;
    }
  },

  // ── QUEUE MANAGEMENT ──
  _enqueue(event) {
    this.queue.push(event);
    localStorage.setItem('mh_sync_queue', JSON.stringify(this.queue));
  },

  async flushQueue() {
    if (!this.online || !this.queue.length) return;
    const { addDoc, collection, serverTimestamp } = this._fs;
    const remaining = [];
    for (const event of this.queue) {
      try {
        await addDoc(collection(this.db, 'events'), { ...event, serverTime: serverTimestamp() });
      } catch (e) {
        remaining.push(event);
      }
    }
    this.queue = remaining;
    localStorage.setItem('mh_sync_queue', JSON.stringify(this.queue));
    if (!remaining.length) this._updateSyncBadge('synced');
  },

  async _onOnline() {
    this.online = true;
    this._updateSyncBadge('syncing');
    await this.flushQueue();
    await this.pull();
    this._updateSyncBadge(this.queue.length ? 'pending' : 'synced');
  },

  // ── SYNC BADGE UI ──
  _updateSyncBadge(state) {
    const el = document.getElementById('sync-badge');
    if (!el) return;
    const map = {
      synced:  { text: '☁ Synced',   color: '#16a34a' },
      pending: { text: '⏳ Pending',  color: '#d97706' },
      syncing: { text: '↻ Syncing',  color: '#002FA7' },
      offline: { text: '⚡ Offline',  color: '#6b7280' }
    };
    const s = map[state] || map.offline;
    el.textContent = s.text;
    el.style.color = s.color;
  }
};

// expose globally
window.SyncEngine = SyncEngine;
