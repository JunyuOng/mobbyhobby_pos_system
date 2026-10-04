// Manager authentication is checked by Firebase functions and Firestore rules.
// This UI gate protects normal workflows; browser code alone is not an authorization boundary.
(function () {
  'use strict';
  let primaryAuth, managerAuth, sdk, functionsSdk, primaryFunctions, managerFunctions;
  let manager = false, ready = false, pending = null, expiry = null, initPromise;
  const REGION = 'asia-southeast1';
  const status = text => { const el = document.getElementById('manager-auth-status'); if (el) el.textContent = text; };
  function show() {
    document.getElementById('manager-auth-overlay')?.classList.add('open');
    const uid = document.getElementById('manager-device-uid');
    if (uid) uid.textContent = primaryAuth?.currentUser?.uid || 'Connecting…';
  }
  function hide() { document.getElementById('manager-auth-overlay')?.classList.remove('open'); }
  function runPending() { const action = pending; pending = null; hide(); if (action) action(); }
  function showSetup(value) { const el = document.getElementById('manager-setup-btn'); if (el) el.hidden = !value; }
  const Access = {
    isManager() { return manager && ready && !!managerAuth?.currentUser; },
    async init(app, initializeApp) {
      if (initPromise) return initPromise;
      initPromise = (async () => {
        sdk = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
        functionsSdk = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js');
        primaryAuth = sdk.getAuth(app);
        await new Promise(resolve => { const stop = sdk.onAuthStateChanged(primaryAuth, () => { stop(); resolve(); }); });
        if (!primaryAuth.currentUser) await sdk.signInAnonymously(primaryAuth);
        // Separate, memory-only manager session. Cashier device identity never changes.
        const managerApp = initializeApp(app.options, 'mobihobby-manager');
        managerAuth = sdk.getAuth(managerApp);
        await sdk.setPersistence(managerAuth, sdk.inMemoryPersistence);
        primaryFunctions = functionsSdk.getFunctions(app, REGION);
        managerFunctions = functionsSdk.getFunctions(managerApp, REGION);
        return primaryAuth;
      })().catch(error => { initPromise = null; throw error; });
      return initPromise;
    },
    require(action) {
      if (Access.isManager() && ready) return action();
      pending = action; show();
      status(sdk ? 'Sign in with your approved manager Google account.' : 'Manager sign-in needs an internet connection. Cashier sales stay available offline.');
    },
    cancel() { pending = null; hide(); },
    async signIn() {
      if (!sdk || !managerAuth) {
        status('Connecting…');
        await window.SyncEngine?.init();
        if (!sdk || !managerAuth) { status('Unable to connect. Check your internet connection and try again.'); return; }
      }
      const btn = document.getElementById('manager-sign-in-btn');
      if (btn) btn.disabled = true;
      status('Complete Google sign-in in the popup.');
      try {
        await sdk.signInWithPopup(managerAuth, new sdk.GoogleAuthProvider());
        const session = (await functionsSdk.httpsCallable(managerFunctions, 'managerSession')({})).data;
        if (session.role !== 'manager') throw new Error('This account is not an approved manager.');
        manager = true; ready = session.ready;
        clearTimeout(expiry);
        expiry = setTimeout(() => { Access.lock(); if (typeof enterCashierMode === 'function') enterCashierMode(); }, 15 * 60 * 1000);
        await functionsSdk.httpsCallable(managerFunctions, 'enrolCashier')({ uid: primaryAuth.currentUser.uid });
        showSetup(!ready);
        if (!ready) { status('Manager verified. Initial security setup is required before cloud writes. Follow docs/MANAGER_SECURITY.md before finishing setup.'); return; }
        status('Manager verified.');
        window.SyncEngine?._onOnline().catch(() => {});
        runPending();
      } catch (error) {
        manager = false; ready = false;
        if (managerAuth) await sdk.signOut(managerAuth).catch(() => {});
        status(error.code === 'auth/popup-closed-by-user' ? 'Sign-in cancelled.' : (error.message || 'Manager sign-in failed.'));
      } finally { if (btn) btn.disabled = false; }
    },
    async finishSetup() {
      if (!manager || !managerAuth?.currentUser) return;
      if (!confirm('Only continue after every device has uploaded its pending changes, old app sessions are closed, and the documented Firestore rules are deployed. Initialize the security catalog now?')) return;
      const btn = document.getElementById('manager-setup-btn'); if (btn) btn.disabled = true;
      status('Initializing security catalog. Existing business records are kept.');
      try {
        await functionsSdk.httpsCallable(managerFunctions, 'initializePosSecurity', { timeout: 540000 })({});
        ready = true; showSetup(false); status('Security setup complete.');
        window.SyncEngine?._onOnline().catch(() => {});
        runPending();
      } catch (error) { status(error.message || 'Setup failed. Existing data was kept.'); }
      finally { if (btn) btn.disabled = false; }
    },
    lock() {
      manager = false; ready = false; pending = null; clearTimeout(expiry); showSetup(false); hide();
      if (sdk && managerAuth) sdk.signOut(managerAuth).catch(() => {});
    },
    async send(event) {
      if (!functionsSdk) throw new Error('Cloud connection is not ready.');
      if (event.requiresManager && !Access.isManager()) {
        const error = new Error('Manager sign-in required to sync pending manager changes.'); error.code = 'manager-required'; throw error;
      }
      const service = Access.isManager() ? managerFunctions : primaryFunctions;
      // Never forward UI authorization flags as proof. The server checks the authenticated caller.
      return functionsSdk.httpsCallable(service, 'commitPosEvent')({
        eventId: event.eventId, type: event.type, timestamp: event.timestamp, deviceId: event.deviceId, data: event.data
      });
    }
  };
  window.ManagerAccess = Access;
})();
