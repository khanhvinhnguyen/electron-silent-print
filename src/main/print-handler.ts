// electron-silent-print/src/main/print-handler.ts
import fs from 'fs';
import { IpcMain, BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { pathToFileURL } from 'url';
import { nativePrint4x6, printDeeplink } from './print-native';
import { openDirectPrintPreview, printDirect } from './print-direct';

// ==================== SHARED STATE ====================
let selectedPrinterName: string | null = null;
export function getSelectedPrinter(): string | null { return selectedPrinterName; }
export function setSelectedPrinter(name: string | null) { selectedPrinterName = name; }

let isLandscape = false;
export function getIsLandscape(): boolean { return isLandscape; }
export function setIsLandscape(value: boolean) { isLandscape = value; }

// ==================== PAGE SIZE ====================
export interface PageSizeDimensions {
  widthCm: number;
  heightCm: number;
}

const CM_TO_MICROMETERS = 10_000;

export const PAGE_SIZES = {
  Photo_10x15: { widthCm: 10.16, heightCm: 15.24 } as PageSizeDimensions,
  A6: { widthCm: 10.5, heightCm: 14.8 } as PageSizeDimensions,
  A4: 'A4',
  Letter: 'Letter',
} as const;

export type PageSizeOption = string | PageSizeDimensions;

function normalizePageSize(size: PageSizeOption): string | { width: number; height: number } {
  if (typeof size === 'string') return size;
  return {
    width: Math.round(size.widthCm * CM_TO_MICROMETERS),
    height: Math.round(size.heightCm * CM_TO_MICROMETERS),
  };
}

const DEFAULT_PAGE_SIZE: PageSizeOption = PAGE_SIZES.Photo_10x15;
let currentPageSize: PageSizeOption = DEFAULT_PAGE_SIZE;

export function getCurrentPageSize() { return currentPageSize; }
export function setCurrentPageSize(size: PageSizeOption) { currentPageSize = size; }

// ==================== PRINT REQUEST INTERFACE (ĐÃ BỔ SUNG 'image') ====================
export interface PrintRequest {
  type: 'html' | 'pdf' | 'image' | 'deeplink' | 'direct';
  content?: string;                 // dùng cho html
  filePath?: string;                // dùng cho image
  printerName?: string;
  pageSize?: PageSizeOption;
  silent?: boolean;                 // false = hiện dialog Windows
}

export interface PrintResponse {
  success: boolean;
  jobId?: string;
  message?: string;
  error?: string;
}

// ==================== SETUP HANDLERS (ĐÃ BỔ SUNG CASE 'image') ====================
export function setupPrintHandlers(ipcMain: IpcMain): void {
  // Preview đúng output in (khổ 10x15 + EXIF), không mở dialog máy in.
  ipcMain.handle('preview-print-direct', async (_event, filePath: string) => {
    if (!filePath) return { success: false, message: 'preview requires filePath' };
    console.log('[PRINT] preview-print-direct', filePath);
    return openDirectPrintPreview(filePath);
  });

  ipcMain.handle('print-request', async (event, printData: PrintRequest) => {
    const jobId = randomUUID();
    console.log(`[PRINT] Job ${jobId} started | Type: ${printData.type} | Printer: ${printData.printerName} | FilePath: ${printData.filePath} | Silent: ${printData.silent} | content: ${printData.content}`);

    try {
      let printResult: { success: boolean; message?: string };

      if (printData.type === 'html') {
        printResult = await printHTML(printData, jobId);
      } else if (printData.type === 'image') {
        // console.log(`[PRINT] Job ${jobId} print image file: ${printData.filePath}`);
        // printResult = await printImageFile(printData.filePath!, printData, jobId) as { success: boolean; message?: string };
        // console.log(`[PRINT] Job ${jobId}:`, printData.filePath);

        const deviceName =
          printData.printerName ||
          selectedPrinterName ||
          "DS-RX1";

        await nativePrint4x6(printData.filePath!, deviceName);

        return {
          success: true,
          jobId,
          message: "Native print sent"
        };
      } else if (printData.type === 'deeplink') {
        printResult = await printDeeplink(printData, jobId);
      } else if (printData.type === 'direct') {
        if (!printData.filePath) throw new Error('direct print requires filePath');
        const deviceName = printData.printerName || selectedPrinterName || undefined;
        printResult = await printDirect(printData.filePath, deviceName, printData.silent !== false);
      } else {
        throw new Error(`Unsupported print type: ${printData.type}`);
      }

      console.log(`[PRINT] Job ${jobId} completed:`, printResult);
      return { success: printResult.success, jobId, message: printResult.message };
    } catch (error: any) {
      console.error(`[PRINT] Job ${jobId} failed:`, error);
      return { success: false, error: error.message };
    }
  });
}

// ==================== IN BẰNG HTML (giữ nguyên code cũ của bạn) ====================
async function printHTML(
  printData: PrintRequest,
  jobId: string
): Promise<{ success: boolean; message?: string }> {
  console.log(`[PRINT] printHTML`);
  return new Promise((resolve) => {
    // Tạo hidden window dedicated cho printing
    const printWindow = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    });

    // Cleanup sau 30s timeout
    const timeout = setTimeout(() => {
      printWindow.destroy();
      resolve({ success: false, message: 'Print timeout after 30s' });
    }, 30000);

    // Wait cho page load xong + image fully loaded
    printWindow.webContents.once('did-finish-load', () => {
      // Inject script để detect image load
      printWindow.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const img = document.querySelector('img');
          if (!img) {
            resolve('no-image');
            return;
          }
          
          if (img.complete && img.naturalWidth > 0) {
            resolve('loaded');
            return;
          }
          
          img.onload = () => resolve('loaded');
          img.onerror = () => resolve('error');
          
          setTimeout(() => resolve('timeout'), 60000);
        });
      `).then((status: string) => {
        if (status !== 'loaded') {
          clearTimeout(timeout);
          printWindow.destroy();
          resolve({
            success: false,
            message: status === 'no-image' ? 'No image found' :
              status === 'timeout' ? 'Image load timeout' :
                'Image load error'
          });
          return;
        }

        // Thực hiện in (mặc định: giấy ảnh 10.2x15.2 cm)
        const printOpts = {
          silent: true,
          printBackground: true,
          deviceName: printData.printerName,
          pageSize: normalizePageSize(printData.pageSize ?? currentPageSize),
          marginsType: 1,
          scaleFactor: 100,
        };

        console.log(`[PRINT] Printing job ${jobId} with options:`, printOpts);

        printWindow.webContents.print(printOpts as any, (success, failureReason) => {
          clearTimeout(timeout);
          printWindow.destroy();

          if (success) {
            resolve({ success: true, message: "Print job sent" });
          } else {
            console.error(`[PRINT FAILED] Job ${jobId} - Reason:`, failureReason);
            resolve({
              success: false,
              message: failureReason || "Print failed (unknown reason)"
            });
          }
        });
      });
    });

    // Load HTML content
    printWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(printData.content ?? "")}`);

    // Handle window errors
    printWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      clearTimeout(timeout);
      printWindow.destroy();
      resolve({ success: false, message: `Load failed: ${errorDescription}` });
    });
  });
}

// ==================== IN TRỰC TIẾP TỪ FILE ẢNH (MỚI) ====================
async function printImageFile(filePath: string, printData: PrintRequest, jobId: string) {
  console.log(`[PRINT] printImageFile`);

  return new Promise((resolve) => {

    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true
      }
    });

    console.log(`[PRINT] window created`);

    // ---------- READ FILE ----------
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');

    const ext = filePath.split('.').pop()?.toLowerCase();
    const mime =
      ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : 'image/png';

    const html = `
      <html>
        <head>
          <style>
            body { margin: 0; padding: 0 }
            .page {
              width: 1200px
              height: 1800px
            }
            img {
              width: 1200px;
              height: 1800px;
              object-fit: cover;
            }
          </style>
        </head>
        <body>
          <div class="page">
            <img id="photo" src="data:${mime};base64,${base64}" />
          </div>
        </body>
      </html>
    `;

    // ---------- FIX: DO NOT USE loadURL(data:) ----------
    printWindow.loadURL('about:blank');

    printWindow.webContents.once('dom-ready', async () => {
      console.log('[PRINT] dom-ready');

      // Inject HTML safely
      await printWindow.webContents.executeJavaScript(`
        document.open();
        document.write(\`${html.replace(/`/g, '\\`')}\`);
        document.close();
      `);

      // Wait for image render
      await printWindow.webContents.executeJavaScript(`
        new Promise(resolve => {
          const img = document.getElementById('photo');
          if (!img) resolve();
          else if (img.complete) resolve();
          else img.onload = resolve;
        });
      `);

      console.log('[PRINT] image rendered');

      // ---------- AUTO DEFAULT PRINTER ----------
      let deviceName =
        printData.printerName ||
        selectedPrinterName ||
        undefined;

      if (printData.silent !== false && !deviceName) {
        const printers = await printWindow.webContents.getPrintersAsync();
        if (!printers.length) {
          printWindow.destroy();
          resolve({ success: false, message: 'No printers found' });
          return;
        }

        deviceName = printers[0].name; // default
        console.log('[AUTO DEFAULT PRINTER]', deviceName);
      }

      console.log("printData.silent: ", printData.silent)
      const printOpts = {
        // silent: printData.silent !== false,
        silent: true,
        printBackground: true,
        deviceName,
        pageSize: normalizePageSize(PAGE_SIZES.Photo_10x15),
        marginsType: 1,
        scaleFactor: 100,
        color: true,
      };

      console.log('[PRINT OPTIONS]', printOpts);

      printWindow.webContents.print(printOpts as any, (success, failureReason) => {
        console.log('[PRINT RESULT]', success, failureReason);
        printWindow.destroy();
        resolve({
          success,
          message: success ? 'OK' : failureReason
        });
      });
    });

    // Extra safety log
    printWindow.webContents.on('did-fail-load', (_, code, desc) => {
      console.log('[LOAD FAILED]', code, desc);
    });
  });
}
