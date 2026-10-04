'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { validateEnvelope, validateCashierSale } = require('../functions/validation');
const root = path.resolve(__dirname, '..');
function sale(overrides = {}) { return { id:'s_test', salesType:'Physical', platform:'None', arr:[{barcode:'MH1',price:100,qty:1}], subtotal:'100.00', discount:'0.00', total:'100.00', ...overrides }; }
const catalog = new Map([['MH1',{price:100}]]);
test('cashier sale at 20 percent is allowed; above 20 percent is rejected', () => {
  assert.equal(validateCashierSale(sale({discount:'20.00',total:'80.00'}),catalog),true);
  assert.throws(()=>validateCashierSale(sale({discount:'20.01',total:'79.99'}),catalog),/20%/);
});
test('item override cannot bypass discount approval', () => {
  assert.throws(()=>validateCashierSale(sale({arr:[{barcode:'MH1',price:100,discPrice:50,qty:1}],subtotal:'50.00',total:'50.00'}),catalog),/20%/);
});
test('forged base price, negative quantities, malformed totals and reservation conversion are rejected', () => {
  for (const s of [
    sale({arr:[{barcode:'MH1',price:1,qty:1}],subtotal:'1',total:'1'}),
    sale({arr:[{barcode:'MH1',price:100,qty:-1}]}),
    sale({total:'1'}), sale({discount:'NaN'}), sale({fromReservation:'R1'}),
    sale({arr:[{barcode:'MH1',price:100,qty:1},{barcode:'MH1',price:100,qty:1}]})
  ]) assert.throws(()=>validateCashierSale(s,catalog));
});
test('deleted or missing catalog product requires manager review', () => {
  assert.throws(()=>validateCashierSale(sale(),new Map()),/unavailable/);
  assert.throws(()=>validateCashierSale(sale(),new Map([['MH1',{price:100,deleted:true}]])),/unavailable/);
});
test('event envelope rejects unsupported types and invalid stock', () => {
  const e={eventId:'a'.repeat(32),type:'PRODUCT_UPSERT',deviceId:'POS_TEST',timestamp:1,data:{barcode:'MH1',price:100,stock:0}};
  assert.doesNotThrow(()=>validateEnvelope(e));
  assert.throws(()=>validateEnvelope({...e,type:'GRANT_MANAGER'}));
  assert.throws(()=>validateEnvelope({...e,data:{...e.data,stock:-1}}));
});
function browserFixture() {
  const storage = new Map(), elements = new Map();
  function element(id) { if (!elements.has(id)) elements.set(id,{value:'',textContent:'',innerHTML:'',style:{},classList:{add(){},remove(){},contains(){return false},toggle(){}},focus(){},dataset:{}}); return elements.get(id); }
  const context = vm.createContext({
    console, crypto:webcrypto, setTimeout(){return 1},clearTimeout(){}, Event:class {},
    localStorage:{ getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)) },
    document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){}},
    navigator:{},confirm:()=>true, location:{reload(){}}
  });
  context.window = context;
  context.addEventListener=()=>{}; context.dispatchEvent=()=>{};
  context.ManagerAccess={isManager:()=>false,require:()=>{},lock(){}};
  vm.runInContext(fs.readFileSync(path.join(root,'mobihobby/sync.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'mobihobby/app.js'),'utf8'),context);
  return {context,storage,element,run:code=>vm.runInContext(code,context)};
}
test('destructive entry points cannot mutate state without manager authorization', () => {
  const f=browserFixture();
  f.run("products=[{barcode:'MH1',name:'Car',price:100,stock:5}];sales=[{id:'s1'}];poItems=[{id:'i1'}];customers=[{id:'c1'}];poBatches=[{id:'b1'}]");
  for(const call of ["deleteProduct('MH1')","adjustStock('MH1',-1)","clearHistory()","deletePoItem('i1')","deletePoBatch('b1')","deleteFromForm()","restoreToInventory(0)","createNewEvent()","confirmImport()"]) f.run(call);
  assert.equal(f.run('products.length'),1);assert.equal(f.run('products[0].stock'),5);
  assert.equal(f.run('sales.length'),1);assert.equal(f.run('poItems.length'),1);
});
test('queue captures a detached snapshot before network use', async () => {
  const f=browserFixture(); f.context.ManagerAccess.isManager=()=>true;
  await f.run("var product={barcode:'MH1',stock:2,price:100};SyncEngine.push('PRODUCT_UPSERT',product);");
  f.run("product.stock=9");
  assert.equal(f.context.SyncEngine.queue[0].data.stock,2);
  assert.equal(JSON.parse(f.storage.get('mh_sync_queue'))[0].data.stock,2);
});
test('failed uploads preserve their event IDs and payloads for retry', async () => {
  const f=browserFixture(), engine=f.context.SyncEngine;
  engine.auth={};engine.online=true;
  let calls=[]; f.context.ManagerAccess.send=async e=>{calls.push(e.eventId);throw Error('network failure')};
  await engine.push('SALE',sale());
  const id=engine.queue[0].eventId;
  f.context.ManagerAccess.send=async e=>calls.push(e.eventId);
  await engine.flushQueue();
  assert.equal(engine.queue.length,0);assert.deepEqual(calls,[id,id]);
});
test('events queued while a flush awaits are not discarded', async () => {
  const f=browserFixture(), engine=f.context.SyncEngine;engine.auth={};engine.online=true;
  let release;const first=new Promise(r=>release=r);const sent=[];
  f.context.ManagerAccess.send=async e=>{sent.push(e.eventId);if(sent.length===1)await first};
  const one=engine.push('SALE',sale({id:'one'}));
  const two=engine.push('SALE',sale({id:'two'}));
  release();await Promise.all([one,two]);
  assert.equal(engine.queue.length,0);assert.equal(sent.length,2);
});
test('legacy queue is retained and requires manager review', () => {
  const f=browserFixture(), engine=f.context.SyncEngine;
  engine.queue=[{type:'SALE',data:sale(),timestamp:1,deviceId:'old'}];
  engine._prepareLegacyQueue();
  assert.equal(engine.queue[0].requiresManager,true);assert.equal(engine.queue[0].eventId.length,32);
});
test('final checkout rechecks stock and cannot sell an item taken after confirmation', () => {
  const f=browserFixture();
  f.run("products=[{barcode:'MH1',name:'Car',price:100,stock:1}];sellCart=[{barcode:'MH1',name:'Car',price:100,qty:1}];sellSaleType='Physical';_pendingSaleCtx=_resolveSaleContext(false);products[0].stock=0;completeSell()");
  assert.equal(f.run('sales.length'),0);assert.equal(f.run('products[0].stock'),0);
});
test('discount approval includes a manager override carried into cashier mode', () => {
  const f=browserFixture();
  f.run("products=[{barcode:'MH1',name:'Car',price:100,stock:1}];sellCart=[{barcode:'MH1',name:'Car',price:100,discPrice:40,qty:1}];lockSaleType='Physical'");
  assert.equal(f.run('_resolveSaleContext(true).needsApproval'),true);
});

test('HTML text and inline handler values cannot inject markup or script',()=>{const f=browserFixture();const payload='"/><img src=x onerror=alert(1)>';f.context.payload=payload;assert.equal(f.run('_esc(payload)').includes('<img'),false);assert.equal(f.run('_js(payload)').includes('<img'),false);assert.equal(f.run('_js(payload)').includes('"'),false);});
