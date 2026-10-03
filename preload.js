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

  sysInfo: () => invoke('sysinfo:get'),
  topFolders: (root, limit) => invoke('sysinfo:topFolders', root, limit),

  readLog: () => invoke('log:read'),
  getPaths: () => invoke('paths:get'),
  openPath: (p) => invoke('shell:openPath', p),

  updateGet: () => invoke('update:get'),
  updateCheck: () => invoke('update:check'),
  updateDownload: () => invoke('update:download'),
  updateInstall: (confirmed) => invoke('update:install', confirmed),

  onCleanProgress: (cb) => subscribe('clean:progress', cb),
  onFolderProgress: (cb) => subscribe('folders:progress', cb),
  onUpdateState: (cb) => subscribe('update:state', cb),
});
