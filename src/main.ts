import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fixtureSnapshot } from "./fixtures/workflow-fixtures.js";

function createWindow(): void {
  const appPath = app.getAppPath();
  const rendererPath = path.join(appPath, "dist/renderer/index.html");
  const rendererUrl = pathToFileURL(rendererPath).toString();
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#101319",
    webPreferences: {
      preload: path.join(appPath, "dist/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== rendererUrl) {
      event.preventDefault();
    }
  });
  window.webContents.on("will-redirect", (event) => event.preventDefault());

  void window.loadFile(rendererPath);
}

ipcMain.handle("workflow:get-fixture", () => fixtureSnapshot);

void app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
