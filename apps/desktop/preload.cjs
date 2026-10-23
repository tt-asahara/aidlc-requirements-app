const { contextBridge, ipcRenderer } = require("electron");
const actions = new Set([
  "state",
  "settings.chooseCli",
  "settings.panes",
  "settings.chooseStore",
  "local.create",
  "local.open",
  "files.refresh",
  "files.select",
  "preview.bounds",
  "preview.capture",
  "draft.copy",
  "terminal.start",
  "terminal.version",
  "terminal.input",
  "terminal.resize",
  "terminal.stop",
  "share.host",
  "share.connect",
  "share.disconnect",
  "share.list",
  "share.create",
  "share.open",
  "share.begin",
  "share.publish",
  "share.end",
  "share.restore",
  "share.invite",
  "share.comment",
  "share.revoke",
  "harness.fetch",
  "harness.import",
  "harness.plan",
  "harness.apply",
  "harness.rollback",
]);
contextBridge.exposeInMainWorld(
  "workbench",
  Object.freeze({
    invoke(action, body = {}) {
      if (!actions.has(action))
        return Promise.reject(new Error("Unsupported action"));
      return ipcRenderer.invoke("v3:request", action, body);
    },
    onState(listener) {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on("v3:state", handler);
      return () => ipcRenderer.removeListener("v3:state", handler);
    },
    onTerminal(listener) {
      const handler = (_event, message) => listener(message);
      ipcRenderer.on("v3:terminal", handler);
      return () => ipcRenderer.removeListener("v3:terminal", handler);
    },
  }),
);
