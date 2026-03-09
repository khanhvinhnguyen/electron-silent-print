// electron-silent-print/src/preload/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

interface PrintRequest {
  type: 'html' | 'pdf' | 'image';
  content?: string;
  filePath?: string;           // ← Bổ sung
  printerName?: string;
  pageSize?: string | { widthCm: number; heightCm: number };
  silent?: boolean;
}

interface PrintResponse {
  success: boolean;
  jobId?: string;
  message?: string;
  error?: string;
}

interface PageSizePreset {
  key: string;
  label: string;
  value: string | { widthCm: number; heightCm: number };
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Print API - interface match với frontend
  print: (data: PrintRequest): Promise<PrintResponse> => {
    return ipcRenderer.invoke('print-request', data);
  },

  // Printer discovery
  getPrinters: () => {
    return ipcRenderer.invoke('get-printers');
  },

  // Page size API
  getPageSizePresets: (): Promise<PageSizePreset[]> => {
    return ipcRenderer.invoke('get-page-size-presets');
  },
  getCurrentPageSize: (): Promise<string | { widthCm: number; heightCm: number }> => {
    return ipcRenderer.invoke('get-current-page-size');
  },
  setPageSize: (size: string | { widthCm: number; heightCm: number }): Promise<{ success: boolean; pageSize: any }> => {
    return ipcRenderer.invoke('set-page-size', size);
  },
  openPrintPreview: (html: string) => ipcRenderer.invoke('open-print-preview', html),
  saveImageToTemp: (blob: Blob) => ipcRenderer.invoke('save-image-to-temp', blob),
});

export {};