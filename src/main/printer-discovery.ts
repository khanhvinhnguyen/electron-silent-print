// electron-silent-print/src/main/printer-discovery.ts
import { IpcMain } from 'electron';

export function setupPrinterDiscovery(ipcMain: IpcMain): void {
  ipcMain.handle('get-printers', async (event) => {
    try {
      const webContents = event.sender;
      const printers = await webContents.getPrintersAsync();   // ← API đúng 2025-2026

      console.log(`[PRINTER DISCOVERY] Tìm thấy ${printers.length} máy in:`);
      printers.forEach((p, i) => {
        console.log(`  ${i + 1}. "${p.name}" | Description: ${p.description || 'N/A'}`);
      });

      return {
        success: true,
        printers: printers.map(p => ({
          name: p.name,
          displayName: p.displayName || p.name,
          description: p.description || '',
          options: p.options || {},
        })),
      };
    } catch (error: any) {
      console.error('[PRINTER DISCOVERY ERROR]', error);
      return {
        success: false,
        error: error.message || 'Lỗi lấy danh sách máy in',
      };
    }
  });
}