'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

function subscribe(channel, cb) {
  const listener = (event, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('optimizer', {
  listTargets: () => invoke('targets:list'),
  diskFree: () => invoke('disk:free'),

  scanUser: (ids) => invoke('scan:user', ids),
  scanSystem: (ids) => invoke('scan:system', ids),
  cleanUser: (ids, confirmed) => invoke('clean:user', ids, confirmed),
  cleanSystem: (ids, confirmed) => invoke('clean:system', ids, confirmed),

  browserStatus: () => invoke('browsers:status'),
  closeBrowsers: () => invoke('browsers:close'),

  startupList: () => invoke('startup:list'),
  startupSet: (id, enabled, confirmed) => invoke('startup:set', id, enabled, confirmed),

  gpuMeta: () => invoke('gpu:meta'),
  gpuList: () => invoke('gpu:list'),
  gpuInstalled: (force) => invoke('gpu:installed', force),
  gpuGet: (profile, name) => invoke('gpu:get', profile, name),
  gpuGetAll: (profile, name) => invoke('gpu:getAll', profile, name),
  gpuCatalog: (force) => invoke('gpu:catalog', force),
  gpuIcons: (paths) => invoke('gpu:icons', paths),
  gpuSet: (profile, name, id, value, confirmed) => invoke('gpu:set', profile, name, id, value, confirmed),
  gpuReset: (profile, name, id, confirmed) => invoke('gpu:reset', profile, name, id, confirmed),
  gpuPickExe: () => invoke('gpu:pickExe'),
  gpuAddApp: (exePath, confirmed) => invoke('gpu:addApp', exePath, confirmed),
  gpuDelProfile: (profile, name, confirmed) => invoke('gpu:delProfile', profile, name, confirmed),

  powerGet: () => invoke('power:get'),
  powerSet: (key, confirmed) => invoke('power:set', key, confirmed),
  powerSetGuid: (guid, confirmed) => invoke('power:setGuid', guid, confirmed),

  gameGet: () => invoke('game:get'),
  gameApply: (id, mode, confirmed) => invoke('game:apply', id, mode, confirmed),
  gameRestore: (confirmed) => invoke('game:restore', confirmed),

  tiersInfo: () => invoke('tiers:info'),
  tiersPreview: (key) => invoke('tiers:preview', key),
  tiersApply: (key, confirmed) => invoke('tiers:apply', key, confirmed),
  tiersRestore: (confirmed) => invoke('tiers:restore', confirmed),

  memTrim: (confirmed) => invoke('mem:trim', confirmed),

  sysInfo: () => invoke('sysinfo:get'),
  metrics: () => invoke('metrics:get'),
  topFolders: (root, limit) => invoke('sysinfo:topFolders', root, limit),

  readLog: () => invoke('log:read'),
  getPaths: () => invoke('paths:get'),
  openPath: (p) => invoke('shell:openPath', p),

  ledgerList: (limit) => invoke('ledger:list', limit),
  ledgerUndo: (id, confirmed) => invoke('ledger:undo', id, confirmed),
  ledgerUndoAll: (confirmed) => invoke('ledger:undoAll', confirmed),

  healthQuick: () => invoke('health:quick'),
  healthDeep: () => invoke('health:deep'),
  healthExport: () => invoke('health:export'),

  restorePointStatus: (force) => invoke('restorepoint:status', force),
  restorePointCreate: (confirmed) => invoke('restorepoint:create', confirmed),

  driversList: () => invoke('drivers:list'),
  driversRemove: (pubs, confirmed) => invoke('drivers:remove', pubs, confirmed),

  winsxsAnalyze: () => invoke('winsxs:analyze'),
  winsxsCleanup: (mode, confirmed) => invoke('winsxs:cleanup', mode, confirmed),

  baselineGet: () => invoke('baseline:get'),
  baselineSnapshot: (slot, withBench) => invoke('baseline:snapshot', slot, withBench),
  baselineClear: () => invoke('baseline:clear'),

  updateGet: () => invoke('update:get'),
  updateCheck: () => invoke('update:check'),
  updateDownload: () => invoke('update:download'),
  updateInstall: (confirmed) => invoke('update:install', confirmed),

  settingsGet: () => invoke('settings:get'),
  settingsSet: (patch) => invoke('settings:set', patch),

  winMinimize: () => invoke('win:minimize'),
  winClose: () => invoke('win:close'),
  winHide: () => invoke('win:hide'),
  winQuit: () => invoke('win:quit'),
  winCloseAnswer: (choice) => invoke('win:closeAnswer', choice),
  winCloseReset: () => invoke('win:closeReset'),
  appVersion: () => invoke('app:version'),
  onCleanProgress: (cb) => subscribe('clean:progress', cb),
  onFolderProgress: (cb) => subscribe('folders:progress', cb),
  onUpdateState: (cb) => subscribe('update:state', cb),
  onHealthProgress: (cb) => subscribe('health:progress', cb),
  onRestorePointState: (cb) => subscribe('restorepoint:state', cb),
  onWinsxsProgress: (cb) => subscribe('winsxs:progress', cb),
  onCloseAsk: (cb) => subscribe('win:closeAsk', cb),
  onWinShow: (cb) => subscribe('win:show', cb),
  onWinActive: (cb) => subscribe('win:active', cb),
});
