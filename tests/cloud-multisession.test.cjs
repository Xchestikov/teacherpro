/* Isolated checks of cross-browser sync with fake cloud data. No real accounts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'cloud-multisession.js'), 'utf8');

function setup() {
  let backend = {payload: {clients: [{id: 1, name: 'remote'}]}, updated_at: 'r2'};
  const events = {};
  const queries = [];
  let beforeFullRead = null;
  let interval, scheduled, renderCount = 0, writes = 0, conflicts = 0, removed = 0;
  let subscribed = false, liveCallback, lastStatus;
  const doc = {
    hidden: false,
    activeElement: null,
    querySelector: selector => selector === '#modal.open' && ctx.modalOpen ? {} : null,
    addEventListener: (event, fn) => { events['document:' + event] = fn; }
  };
  const cloudClient = {
    from(table) {
      assert.equal(table, 'app_data');
      let projection;
      return {
        select(columns) {
          assert.ok(['updated_at','payload,updated_at'].includes(columns));
          projection = columns;
          queries.push(columns);
          return this;
        },
        eq(column, id) { assert.equal(column, 'user_id'); assert.equal(id, ctx.cloudUser.id); return this; },
        async maybeSingle() {
          if (backend.error) return {data:null, error:backend.error};
          if (projection === 'payload,updated_at') {
            if (beforeFullRead) await beforeFullRead();
            if (backend.fullError) return {data:null, error:backend.fullError};
          }
          const data = projection === 'updated_at'
            ? {updated_at:backend.updated_at}
            : {payload:backend.payload,updated_at:backend.updated_at};
          return {data:structuredClone(data), error:null};
        }
      };
    },
    channel(name) {
      assert.match(name, /^teacherpro-user-/);
      return {
        on(event, opts, callback) {
          assert.equal(event, 'postgres_changes');
          assert.equal(opts.filter, 'user_id=eq.account-A');
          liveCallback = callback;
          return this;
        },
        subscribe() { subscribed = true; return this; }
      };
    },
    removeChannel() { removed++; return Promise.resolve(); }
  };
  const ctx = {
    cloudClient,
    cloudUser: {id:'account-A', email:'teacher@test.invalid'},
    cloudHydrating: false,
    cloudSyncInFlight: false,
    cloudDirty: false,
    cloudConflict: false,
    cloudRevision: 'r1',
    cloudLastSyncOk: true,
    authGeneration: 7,
    db: {clients:[{id:1,name:'local'}]},
    modalOpen: false,
    render() {renderCount++;},
    persistLocal() {writes++;},
    markConflict() {conflicts++;ctx.cloudConflict = true;},
    normalizeDb(payload) {return payload;},
    setCloudStatus(msg, state) {lastStatus = {msg, state};},
    userStorageKey(id) {return 'user:' + id;},
    userMetaKey(id) {return 'meta:' + id;},
    window: {addEventListener(event, fn) {events['window:'+event] = fn;}},
    document: doc,
    navigator: {onLine:true},
    setInterval(fn, ms) {assert.equal(ms, 5000, 'fallback cloud polling runs every five seconds');interval=fn; return 1;},
    clearInterval() {interval=null;},
    setTimeout(fn) {scheduled=fn; return 2;},
    clearTimeout() {scheduled=null;},
    console
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const call = expression => vm.runInContext(expression, ctx);
  return {ctx,call,events,queries,clearQueries(){queries.length=0;},setBeforeFullRead(fn){beforeFullRead=fn;},setBackend(next){backend=next;},counts(){return {renderCount,writes,conflicts,removed,subscribed,lastStatus}},tick:()=>interval?.(),notify:()=>liveCallback?.(),flush:()=>scheduled?.()};
}

async function run() {
  const t = setup();
  t.call('startCloudObserver()');
  assert.equal(t.counts().subscribed, true, 'should subscribe to live notifications');

  assert.equal(await t.call('refreshCloudSnapshot()'), true, 'clean browser loads remote version');
  assert.equal(t.ctx.db.clients[0].name, 'remote');
  assert.equal(t.ctx.cloudRevision, 'r2');
  assert.equal(t.counts().writes, 1);
  assert.deepEqual(t.queries, ['updated_at','payload,updated_at'],
    'new revision triggers one metadata read and one full payload read');

  t.clearQueries();
  assert.equal(await t.call('refreshCloudSnapshot()'), false, 'same revision is a no-op');
  assert.deepEqual(t.queries, ['updated_at'], 'unchanged revision never downloads the JSON payload');
  assert.equal(t.counts().renderCount, 1);

  t.ctx.db.clients[0].name = 'unsaved local';
  t.ctx.cloudDirty = true;
  t.setBackend({payload:{clients:[{id:1,name:'new remote'}]},updated_at:'r3'});
  assert.equal(await t.call('refreshCloudSnapshot()'), false);
  assert.equal(t.ctx.db.clients[0].name, 'unsaved local', 'never overwrite local changes');
  assert.equal(t.counts().conflicts, 1, 'conflict should be shown');
  assert.deepEqual(t.queries, ['updated_at','updated_at'],
    'dirty local data detects conflict using only the revision');

  t.ctx.cloudDirty = false;
  t.ctx.cloudConflict = false;
  t.ctx.cloudSyncInFlight = true;
  assert.equal(await t.call('refreshCloudSnapshot()'), false, 'do not refresh during a save');
  t.ctx.cloudSyncInFlight = false;
  t.ctx.modalOpen = true;
  t.clearQueries();
  assert.equal(await t.call('refreshCloudSnapshot()'), false, 'do not erase form drafts');
  assert.deepEqual(t.queries,['updated_at'], 'open form delays full profile download');
  t.ctx.modalOpen = false;
  assert.equal(await t.call('refreshCloudSnapshot()'), true, 'refresh after editing');
  assert.equal(t.ctx.db.clients[0].name, 'new remote');

  t.setBackend({payload:{clients:[{id:1,name:'realtime'}]},updated_at:'r4'});
  t.notify();
  t.flush();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(t.ctx.db.clients[0].name, 'realtime', 'realtime callback should fetch cloud snapshot');

  // If the user starts editing while the full fetch is in flight, preserve it.
  t.setBackend({payload:{clients:[{id:1,name:'another remote'}]},updated_at:'r5'});
  t.setBeforeFullRead(async () => {
    t.ctx.db.clients[0].name = 'local edit during request';
    t.ctx.cloudDirty = true;
  });
  t.clearQueries();
  assert.equal(await t.call('refreshCloudSnapshot()'), false);
  assert.deepEqual(t.queries,['updated_at','payload,updated_at']);
  assert.equal(t.ctx.db.clients[0].name, 'local edit during request');
  assert.equal(t.counts().conflicts, 2, 'late local edit triggers conflict rather than lost data');
  t.setBeforeFullRead(null);
  t.ctx.cloudDirty = false;
  t.ctx.cloudConflict = false;
  t.setBackend({payload:{clients:[{id:1,name:'realtime'}]},updated_at:'r4'});

  // Failure during a payload download must accumulate errors across metadata checks.
  t.setBackend({payload:{clients:[{id:1,name:'new remote'}]},updated_at:'r5',
    fullError:{message:'temporary payload failure'}});
  await t.call('refreshCloudSnapshot()');
  await t.call('refreshCloudSnapshot()');
  await t.call('refreshCloudSnapshot()');
  assert.equal(t.counts().lastStatus.state, 'error', 'warn after repeated payload download failures');
  t.setBackend({payload:{clients:[{id:1,name:'new remote'}]},updated_at:'r5'});
  assert.equal(await t.call('refreshCloudSnapshot()'), true, 'successful payload download restores sync');
  assert.equal(t.ctx.db.clients[0].name, 'new remote');
  assert.equal(t.counts().lastStatus.state, 'ok');

  t.setBackend({error:{message:'temporary network failure'}});
  await t.call('refreshCloudSnapshot()');
  await t.call('refreshCloudSnapshot()');
  await t.call('refreshCloudSnapshot()');
  assert.equal(t.counts().lastStatus.state, 'error', 'warn after repeated polling failures');
  t.setBackend({payload:{clients:[{id:1,name:'new remote'}]}, updated_at:'r5'});
  await t.call('refreshCloudSnapshot()');
  assert.equal(t.counts().lastStatus.state, 'ok', 'recovered connection clears warning');

  t.call('stopCloudObserver()');
  assert.equal(t.counts().removed, 1, 'channel is removed when account changes');

  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.ok(app.includes("signOut({scope:'local'})"),'logout should only affect this device');
  assert.ok(app.includes('startCloudObserver()'), 'observer should start after login');
  assert.ok(app.includes('stopCloudObserver()'), 'observer should stop after logout');
  assert.ok(!html.includes('cloudStatusGlobal'), 'global green status banner must be absent');
  assert.ok(html.includes('./cloud-multisession.js'), 'observer must load after app');
  console.log('OK: 5-second metadata polling, conditional payload fetching, draft safety, conflict protection, independent logout, clean header');
}

run().catch(error=>{console.error(error);process.exitCode=1;});
