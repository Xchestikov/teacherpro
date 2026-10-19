/* TeacherPro: cross-browser updates for the existing per-user JSON profile.
   Realtime is a fast path, not a dependency: the visible-tab poll also works if
   app_data is not in Supabase's Realtime publication.
   Never overwrite unsaved local work with a remote snapshot. */
const TP_CLOUD_POLL_MS = 5000;
let tpCloudPollTimer = null;
let tpCloudChannel = null;
let tpCloudReadInFlight = false;
let tpCloudReadQueued = false;
let tpCloudRefreshTimer = null;
let tpCloudReadFailures = 0;

function stopCloudObserver() {
  clearInterval(tpCloudPollTimer);
  clearTimeout(tpCloudRefreshTimer);
  tpCloudPollTimer = null;
  tpCloudRefreshTimer = null;
  tpCloudReadQueued = false;
  tpCloudReadFailures = 0;
  if (tpCloudChannel && cloudClient?.removeChannel) {
    try { const done = cloudClient.removeChannel(tpCloudChannel); if (done?.catch) done.catch(() => {}); }
    catch (_) { /* Polling remains available. */ }
  }
  tpCloudChannel = null;
}

function scheduleCloudRefresh(delay = 250) {
  if (!cloudUser || cloudHydrating) return;
  clearTimeout(tpCloudRefreshTimer);
  tpCloudRefreshTimer = setTimeout(() => {
    tpCloudRefreshTimer = null;
    refreshCloudSnapshot();
  }, delay);
}

function startCloudObserver() {
  stopCloudObserver();
  if (!cloudClient || !cloudUser || cloudHydrating) return;
  const ownerId = cloudUser.id;
  if (typeof cloudClient.channel === 'function') {
    try {
      tpCloudChannel = cloudClient.channel('teacherpro-user-' + ownerId)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'app_data', filter: 'user_id=eq.' + ownerId
        }, () => scheduleCloudRefresh())
        .subscribe();
    } catch (_) { tpCloudChannel = null; }
  }
  tpCloudPollTimer = setInterval(() => {
    if (!document.hidden) refreshCloudSnapshot();
  }, TP_CLOUD_POLL_MS);
}

// A form can contain an unsaved draft that render() would erase.
function cloudHasUnsavedFormDraft() {
  if (document.querySelector('#modal.open')) return true;
  const active = document.activeElement;
  return !!(active && active.matches?.('input, textarea, select, [contenteditable="true"]'));
}

async function refreshCloudSnapshot() {
  if (!cloudClient || !cloudUser || cloudHydrating || cloudSyncInFlight ||
      document.hidden || navigator.onLine === false) return false;
  if (tpCloudReadInFlight) { tpCloudReadQueued = true; return false; }

  const generation = authGeneration;
  const ownerId = cloudUser.id;
  tpCloudReadInFlight = true;
  try {
    // Every five seconds check only the server revision. Avoid downloading the
    // potentially large profile JSON when another device has not saved anything.
    const { data:revision, error:revisionError } = await cloudClient.from('app_data')
      .select('updated_at').eq('user_id', ownerId).maybeSingle();
    if (generation !== authGeneration || cloudUser?.id !== ownerId) return false;
    if (revisionError) throw revisionError;
    const hadReadWarning = tpCloudReadFailures >= 3;
    if (!revision?.updated_at || revision.updated_at === cloudRevision) {
      tpCloudReadFailures = 0;
      if (hadReadWarning && !cloudDirty && !cloudConflict && cloudLastSyncOk)
        setCloudStatus('Облако синхронизировано · ' + (cloudUser.email || ''), 'ok');
      return false;
    }
    if (cloudDirty || cloudConflict) {
      markConflict(); // Preserve local work; never fetch a profile unnecessarily.
      return false;
    }
    if (cloudHasUnsavedFormDraft()) return false;

    // Only a new revision needs the full profile. Read its revision together
    // with the payload in case another save happened between the two queries.
    const { data, error } = await cloudClient.from('app_data')
      .select('payload,updated_at').eq('user_id', ownerId).maybeSingle();
    if (generation !== authGeneration || cloudUser?.id !== ownerId) return false;
    if (error) throw error;
    if (!data?.updated_at || !data.payload) throw new Error('Облачная версия недоступна.');

    // Form edits or a cloud save may have started while the request was in
    // flight. In that case do not overwrite the current in-memory data.
    if (cloudHydrating || cloudSyncInFlight || document.hidden) return false;
    if (data.updated_at === cloudRevision) {
      tpCloudReadFailures = 0;
      if (hadReadWarning && !cloudDirty && !cloudConflict && cloudLastSyncOk)
        setCloudStatus('Облако синхронизировано · ' + (cloudUser.email || ''), 'ok');
      return false;
    }
    if (cloudDirty || cloudConflict) {
      markConflict();
      return false;
    }
    if (cloudHasUnsavedFormDraft()) return false;
    db = normalizeDb(data.payload);
    cloudRevision = data.updated_at;
    cloudDirty = false;
    cloudLastSyncOk = true;
    tpCloudReadFailures = 0;
    persistLocal();
    render();
    setCloudStatus('Облако синхронизировано · ' + (cloudUser.email || ''), 'ok');
    return true;
  } catch (error) {
    if (generation === authGeneration && cloudUser?.id === ownerId) {
      tpCloudReadFailures++;
      if (tpCloudReadFailures >= 3)
        setCloudStatus('Не удалось проверить обновления на других устройствах. ' +
          (error.message || 'Проверь подключение.'), 'error');
    }
    return false;
  } finally {
    tpCloudReadInFlight = false;
    if (tpCloudReadQueued) {
      tpCloudReadQueued = false;
      scheduleCloudRefresh(300);
    }
  }
}

// These listeners are installed once (scripts are loaded once per page).
window.addEventListener('focus', () => scheduleCloudRefresh(200));
window.addEventListener('online', () => scheduleCloudRefresh(300));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scheduleCloudRefresh(200);
});
document.addEventListener('focusout', () => {
  if (cloudUser) scheduleCloudRefresh(350);
});
window.addEventListener('storage', event => {
  if (cloudUser && (event.key === userStorageKey(cloudUser.id) ||
      event.key === userMetaKey(cloudUser.id))) scheduleCloudRefresh(350);
});
