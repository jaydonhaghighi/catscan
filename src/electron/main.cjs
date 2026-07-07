const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let serverApp = null;
let mainWindow = null;
let serverUrl = null;

async function startLocalServer() {
  const serverModulePath = path.join(__dirname, '..', 'server', 'app.js');
  const { createApp } = await import(pathToFileURL(serverModulePath).href);

  serverApp = createApp({
    logger: console
  });

  await new Promise((resolve, reject) => {
    serverApp.server.once('error', reject);
    serverApp.server.listen(0, '127.0.0.1', resolve);
  });

  const address = serverApp.server.address();
  serverUrl = `http://127.0.0.1:${address.port}`;
  console.info(JSON.stringify({
    time: new Date().toISOString(),
    level: 'info',
    event: 'desktop.server.start',
    url: serverUrl
  }));
  return serverUrl;
}

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 950,
    minWidth: 1040,
    minHeight: 720,
    title: 'catscan',
    backgroundColor: '#050505',
    icon: path.join(__dirname, '..', 'public', 'assets', 'catscan-favicon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadURL(url);

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!serverUrl || targetUrl.startsWith(serverUrl)) {
      return;
    }

    event.preventDefault();
    shell.openExternal(targetUrl);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function installMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Open Full Disk Access Settings',
          click: () => {
            shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function stopLocalServer() {
  if (!serverApp?.server?.listening) {
    return;
  }

  serverApp.server.close();
}

app.setName('catscan');

app.whenReady().then(async () => {
  installMenu();
  const url = await startLocalServer();
  createMainWindow(url);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverUrl) {
      createMainWindow(serverUrl);
    }
  });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopLocalServer();
});
