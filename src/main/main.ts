// electron-silent-print/src/main/main.ts
import { app, BrowserWindow, ipcMain, screen, Menu, MenuItemConstructorOptions, globalShortcut } from 'electron';
import path from 'path';
import dotenv from 'dotenv';
import { setupPrintHandlers } from './print-handler';
import { setupPrinterDiscovery } from './printer-discovery';

// Load .env
dotenv.config({ path: path.join(__dirname, '../../.env') });
// File .env đặt cạnh file exe (hoặc PORTABLE_EXECUTABLE_DIR) ghi đè bản trong asar,
// để chỉnh PRINT_ROTATE_DEG... tại chỗ mà không cần build lại.
dotenv.config({
  path: path.join(process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath), '.env'),
  override: true,
});

const NODE_ENV = process.env.NODE_ENV || 'development';
const ENV = {
  NODE_ENV,
  REMOTE_UI_URL: process.env.REMOTE_UI_URL || 'http://localhost:5173',
  ENABLE_DEVTOOLS: process.env.ENABLE_DEVTOOLS === 'true' || (process.env.ENABLE_DEVTOOLS === undefined && NODE_ENV !== 'production'),
  DEBUG_LOGS: process.env.DEBUG_LOGS === 'true',
  APP_NAME: process.env.APP_NAME || 'Bia SaiGon',
  APP_VERSION: app.getVersion()
};

let mainWindow: BrowserWindow | null = null;
let previewWindow: BrowserWindow | null = null;     // ← Preview Dialog
let selectedPrinterName: string | null = null;      // ← Chọn máy in
let isLandscape = false;                            // ← Orientation
let isFullScreen = true;

/** Accept self-signed certs from local Vite HTTPS (ERR_CERT_AUTHORITY_INVALID). */
function isLocalDevUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
  if (isLocalDevUrl(url)) {
    event.preventDefault();
    callback(true);
    return;
  }
  callback(false);
});

function createWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width,
    height,
    minWidth: 800,
    minHeight: 600,
    fullscreen: true,
    fullscreenable: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    },
    icon: path.join(
      __dirname,
      '../../assets/icons',
      process.platform === 'win32' ? 'icon.ico' : process.platform === 'darwin' ? 'icon.icns' : 'icon.png'
    ),
    show: false
  });

  if (ENV.ENABLE_DEVTOOLS) win.webContents.openDevTools({ mode: 'right' });

  win.once('ready-to-show', () => win.show());
  return win;
}

async function loadRemoteUI(window: BrowserWindow): Promise<void> {
  try {
    await window.loadURL(ENV.REMOTE_UI_URL);
    if (ENV.DEBUG_LOGS) console.log('[MAIN] Remote UI loaded');
  } catch (error: any) {
    console.error('[MAIN] Failed to load Remote UI:', error);
    window.loadFile(path.join(__dirname, '../../assets/error.html'));
  }
}

// ==================== PRINT PREVIEW DIALOG ====================
ipcMain.handle('open-print-preview', async (_, htmlContent: string) => {
  if (previewWindow) { previewWindow.focus(); return; }

  previewWindow = new BrowserWindow({
    width: 800,
    height: 1100,
    resizable: true,
    title: "Xem trước ảnh in (10.2cm x 15.2cm)",
    parent: mainWindow || undefined,
    modal: true,
    webPreferences: { webSecurity: false }
  });

  previewWindow.loadURL('about:blank');
  previewWindow.webContents.once('dom-ready', () => {
    previewWindow!.webContents.executeJavaScript(`
      document.open();
      document.write(\`${htmlContent.replace(/`/g, '\\`')}\`);
      document.close();
    `);
  });

  previewWindow.on('closed', () => { previewWindow = null; });
});

ipcMain.handle('save-image-to-temp', async (_, blobData: ArrayBuffer) => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const tempDir = path.join(os.tmpdir(), 'silentprint');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const filePath = path.join(tempDir, `print_${Date.now()}.png`);
  fs.writeFileSync(filePath, Buffer.from(blobData));
  return filePath;
});

// ==================== MENU BAR (Printer + Orientation) ====================
async function createApplicationMenu() {
  if (!mainWindow) return;

  const printers = await mainWindow.webContents.getPrintersAsync();

  const printerSubmenu: MenuItemConstructorOptions[] = [
    { label: 'Refresh Printer List', click: () => createApplicationMenu() },
    { type: 'separator' }
  ];

  printers.forEach(p => {
    printerSubmenu.push({
      label: p.name,
      type: 'checkbox',
      checked: p.name === selectedPrinterName,
      click: () => { selectedPrinterName = p.name; createApplicationMenu(); }
    });
  });

  const orientationSubmenu: MenuItemConstructorOptions[] = [
    { label: 'Portrait',  type: 'radio', checked: !isLandscape, accelerator: 'Ctrl+Shift+P',
      click: () => { isLandscape = false; createApplicationMenu(); }},
    { label: 'Landscape', type: 'radio', checked: isLandscape,  accelerator: 'Ctrl+Shift+L',
      click: () => { isLandscape = true;  createApplicationMenu(); }}
  ];

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { role: 'quit' },
        { type: 'separator' },
        { label: 'Thoát Fullscreen', accelerator: 'F11', click: () => { isFullScreen = !isFullScreen; mainWindow?.setFullScreen(isFullScreen); }}
      ]
    },
    {
      label: 'Printer',
      submenu: [
        ...printerSubmenu,
        { type: 'separator' },
        { label: 'Orientation', submenu: orientationSubmenu }
      ]
    },
    { label: 'Help', submenu: [{ role: 'about' }] }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ==================== PHÍM TẮT ====================
function registerShortcuts() {
  globalShortcut.register('F11', () => {
    if (mainWindow) {
      isFullScreen = !isFullScreen;
      mainWindow.setFullScreen(isFullScreen);
    }
  });

  globalShortcut.register('Escape', () => {
    if (mainWindow && mainWindow.isFullScreen()) {
      isFullScreen = false;
      mainWindow.setFullScreen(false);
    }
  });

  globalShortcut.register('Ctrl+Shift+P', () => { isLandscape = false; createApplicationMenu(); });
  globalShortcut.register('Ctrl+Shift+L', () => { isLandscape = true;  createApplicationMenu(); });
}

app.whenReady().then(async () => {
  if (ENV.DEBUG_LOGS) {
    console.log('='.repeat(50));
    console.log('ENVIRONMENT:', ENV);
    console.log('='.repeat(50));
  }

  mainWindow = createWindow();
  
  setupPrintHandlers(ipcMain);
  setupPrinterDiscovery(ipcMain);

  if (mainWindow) {
    await loadRemoteUI(mainWindow);
    // createApplicationMenu();
    // registerShortcuts();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      if (mainWindow) {
        loadRemoteUI(mainWindow);
        // createApplicationMenu();
        // registerShortcuts();
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});