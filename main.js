const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1200,
    minHeight: 760,
    frame: false,
    backgroundColor: '#0e0f11',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false // Allows loading local models and assets easily
    }
  });

  mainWindow.removeMenu();
  if (process.env.TEST_MODE === '1') {
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[RENDERER L${level}] ${message} (${sourceId}:${line})`);
    });
  }
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
    if (process.env.TEST_MODE === '1') {
      console.log('ELECTRON_TEST_READY: Window showed successfully!');
      setTimeout(async () => {
        try {
          const check = await mainWindow.webContents.executeJavaScript(`({
            hasApp: Boolean(window.app),
            hasLeaflet: Boolean(window.L),
            hasJSZip: Boolean(window.JSZip),
            hasJsPDF: Boolean(window.jspdf && window.jspdf.jsPDF),
            layersCount: window.app && window.app.slicingResult ? window.app.slicingResult.layers.length : 0,
            currentPreset: window.app ? window.app.currentPreset : null
          })`);
          console.log('ELECTRON_APP_CHECK:', JSON.stringify(check));
        } catch (err) {
          console.error('ELECTRON_APP_CHECK_ERR:', err);
        }
        app.quit();
      }, 1500);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handlers for Custom Dark Window Controls
ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
    return false;
  }
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  } else {
    mainWindow.maximize();
    return true;
  }
});

ipcMain.handle('window:fullscreen', () => {
  if (!mainWindow) return false;
  const nextState = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(nextState);
  return nextState;
});

ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.close();
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handler for Native File Open Dialog
ipcMain.handle('dialog:open-file', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importer un fichier 3D (Architecture)',
    filters: [
      { name: 'Modèles 3D compatibles', extensions: ['stl', 'obj', 'gltf', 'glb', 'fbx'] },
      { name: 'Stéréolithographie (*.stl)', extensions: ['stl'] },
      { name: 'Wavefront OBJ (*.obj)', extensions: ['obj'] },
      { name: 'GL Transmission Format (*.gltf, *.glb)', extensions: ['gltf', 'glb'] },
      { name: 'Filmbox FBX (*.fbx)', extensions: ['fbx'] },
      { name: 'Tous les fichiers', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const fileExt = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);

  return {
    name: fileName,
    ext: fileExt,
    path: filePath,
    buffer: fileBuffer.buffer
  };
});

// IPC handler for Native File Save Dialog (SVG, DXF, etc.)
ipcMain.handle('dialog:save-file', async (event, { defaultName, content, filterType }) => {
  let filters = [];
  if (filterType === 'svg') {
    filters = [{ name: 'Planches de découpe Vectorielles (*.svg)', extensions: ['svg'] }];
  } else if (filterType === 'dxf') {
    filters = [{ name: 'Fichiers CAO AutoCAD / Rhino (*.dxf)', extensions: ['dxf'] }];
  } else if (filterType === 'pdf') {
    filters = [{ name: 'Planches Vectorielles 1:1 (*.pdf)', extensions: ['pdf'] }];
  } else if (filterType === 'zip') {
    filters = [{ name: 'Archive ZIP de découpe (*.zip)', extensions: ['zip'] }];
  } else {
    filters = [{ name: 'Tous les fichiers', extensions: ['*'] }];
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter le plan de fabrication',
    defaultPath: defaultName || 'maquette-plans',
    filters: filters
  });

  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true };
  }

  try {
    fs.writeFileSync(result.filePath, content, typeof content === 'string' ? 'utf8' : undefined);
    return { success: true, filePath: result.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
