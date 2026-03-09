// src/common/types.ts
export interface PrintRequest {
  content: string;          // HTML content hoặc PDF path
  type: 'html' | 'pdf';     // Loại nội dung
  printerName?: string;     // Tên máy in (optional)
  options?: PrintOptions;   // Tùy chọn in
}

export interface PrintOptions {
  silent?: boolean;
  printBackground?: boolean;
  pageSize?: string;
  landscape?: boolean;
  marginsType?: number;
  scaleFactor?: number;
}

export interface PrintResponse {
  success: boolean;
  jobId?: string;
  message?: string;
  error?: string;
}

export interface IpcChannels {
  PRINT_REQUEST: 'print-request';
  PRINT_RESPONSE: 'print-response';
  GET_PRINTERS: 'get-printers';
  PRINTERS_RESPONSE: 'printers-response';
}