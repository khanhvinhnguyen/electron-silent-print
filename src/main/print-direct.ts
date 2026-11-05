// In trực tiếp trong Electron. Không exec, không rundll32, không PowerShell,
// không protocol handler — chỉ webContents.print() sau khi bake EXIF vào pixel.
import fs from "fs";
import os from "os";
import path from "path";
import { app, BrowserWindow } from "electron";
import sharp from "sharp";

const PHOTO_SHORT_UM = 101_600; // 10.16 cm
const PHOTO_LONG_UM = 152_400; // 15.24 cm
const PHOTO_SHORT_CM = 10.16;
const PHOTO_LONG_CM = 15.24;

// Góc xoay bù (chiều kim đồng hồ) áp sau khi bake EXIF, để bù driver máy in xoay ảnh.
// Ảnh in bị xoay sai 90° → bù 270°. Nếu in ra vẫn ngược chiều thì đổi thành 90.
// Có thể override khi test bằng env PRINT_ROTATE_DEG (0 | 90 | 180 | 270).
const DEFAULT_PRINT_ROTATE_DEG = 270;

function getPrintRotateDeg(): number {
  const raw = process.env.PRINT_ROTATE_DEG;
  if (raw === undefined || raw === "") return DEFAULT_PRINT_ROTATE_DEG;
  const deg = ((Number(raw) % 360) + 360) % 360;
  return [0, 90, 180, 270].includes(deg) ? deg : DEFAULT_PRINT_ROTATE_DEG;
}

// Bản build không có console → ghi log in ra %APPDATA%\<app>\logs\print.log để chẩn đoán tại máy khách.
function printLog(...args: unknown[]): void {
  console.log("[PRINT direct]", ...args);
  try {
    const line = `${new Date().toISOString()} ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`;
    fs.appendFileSync(path.join(app.getPath("logs"), "print.log"), line);
  } catch {
    /* log best-effort */
  }
}

function paperSizeCm(landscape: boolean): { widthCm: number; heightCm: number; label: string } {
  return landscape
    ? { widthCm: PHOTO_LONG_CM, heightCm: PHOTO_SHORT_CM, label: "15.24 × 10.16 cm (ngang)" }
    : { widthCm: PHOTO_SHORT_CM, heightCm: PHOTO_LONG_CM, label: "10.16 × 15.24 cm (dọc)" };
}

async function bakeOrientation(
  inputPath: string,
  options: { applyDriverRotate?: boolean; prefix?: string } = {}
): Promise<{ filePath: string; landscape: boolean; rotateDeg: number }> {
  const { applyDriverRotate = true, prefix = "direct" } = options;
  const tempDir = path.join(os.tmpdir(), "silentprint");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const filePath = path.join(tempDir, `${prefix}_${id}.jpg`);

  const meta = await sharp(inputPath).metadata();

  // Kích thước sau EXIF (orientation 5-8 hoán đổi width/height).
  const swapped = (meta.orientation ?? 1) >= 5;
  const orientedW = (swapped ? meta.height : meta.width) ?? 0;
  const orientedH = (swapped ? meta.width : meta.height) ?? 0;
  // Chỉ xoay ảnh ngang → trang gửi driver luôn dọc (rộng < dài). Trang "rộng > dài" kèm
  // landscape: false thành DEVMODE dmPaperWidth > dmPaperLength, driver máy in ảnh có thể từ chối job.
  const rotateDeg = applyDriverRotate && orientedW > orientedH ? getPrintRotateDeg() : 0;

  // autoOrient() áp EXIF rồi xóa tag Orientation; rotate(deg) chạy sau auto-orient.
  // Lấy kích thước output (sau khi bake + xoay), không lấy width/height gốc trong header.
  let pipeline = sharp(inputPath).autoOrient();
  if (rotateDeg !== 0) pipeline = pipeline.rotate(rotateDeg);
  const { data, info } = await pipeline
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer({ resolveWithObject: true });

  printLog("bake", {
    exifOrientation: meta.orientation ?? null,
    source: { width: meta.width, height: meta.height },
    rotateDeg,
    applyDriverRotate,
    output: { width: info.width, height: info.height },
  });

  fs.writeFileSync(filePath, data);
  return { filePath, landscape: info.width > info.height, rotateDeg };
}

function writePrintHtml(imagePath: string, landscape: boolean): string {
  const { widthCm, heightCm } = paperSizeCm(landscape);
  const htmlPath = imagePath.replace(/\.jpg$/i, ".html");
  const imageName = path.basename(imagePath);

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page { size: ${widthCm}cm ${heightCm}cm; margin: 0; }
  html, body { margin: 0; padding: 0; width: ${widthCm}cm; height: ${heightCm}cm; overflow: hidden; background: #fff; }
  img { display: block; width: ${widthCm}cm; height: ${heightCm}cm; object-fit: cover; }
</style>
</head>
<body><img id="photo" src="${imageName}"></body>
</html>`;

  fs.writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
}

function writePreviewHtml(
  imagePath: string,
  landscape: boolean,
  driverRotateDeg: number
): string {
  const paper = paperSizeCm(landscape);
  const htmlPath = imagePath.replace(/\.jpg$/i, "_preview.html");
  const imageName = path.basename(imagePath);
  // Scale paper so the long edge fits ~640px on screen
  const longCm = Math.max(paper.widthCm, paper.heightCm);
  const scale = 640 / longCm;
  const frameW = Math.round(paper.widthCm * scale);
  const frameH = Math.round(paper.heightCm * scale);

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Print preview</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    background: #2a2a2a;
    color: #eee;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .meta {
    text-align: center;
    font-size: 13px;
    line-height: 1.5;
    opacity: 0.9;
  }
  .paper {
    width: ${frameW}px;
    height: ${frameH}px;
    background: #fff;
    box-shadow: 0 12px 40px rgba(0,0,0,.45);
    overflow: hidden;
  }
  .paper img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
</head>
<body>
  <div class="meta">
    <div><strong>Khổ in:</strong> ${paper.label}</div>
    <div>Preview = ảnh sau EXIF (đúng hướng ra giấy). Driver rotate khi in: ${driverRotateDeg}°</div>
  </div>
  <div class="paper">
    <img id="photo" src="${imageName}" alt="print preview">
  </div>
</body>
</html>`;

  fs.writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
}

let previewWindow: BrowserWindow | null = null;

/** Mở cửa sổ xem trước đúng hướng/khổ ảnh sẽ ra giấy (không áp xoay bù driver). */
export async function openDirectPrintPreview(
  filePath: string
): Promise<{ success: boolean; landscape?: boolean; message?: string }> {
  try {
    const driverRotateDeg = getPrintRotateDeg();
    // Preview phản ánh output vật lý: chỉ bake EXIF, không xoay bù driver.
    const baked = await bakeOrientation(filePath, {
      applyDriverRotate: false,
      prefix: "preview",
    });
    const htmlPath = writePreviewHtml(baked.filePath, baked.landscape, driverRotateDeg);
    const paper = paperSizeCm(baked.landscape);

    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.focus();
      await previewWindow.loadFile(htmlPath);
      previewWindow.setTitle(`Print preview — ${paper.label}`);
      return { success: true, landscape: baked.landscape };
    }

    const winW = baked.landscape ? 900 : 520;
    const winH = baked.landscape ? 620 : 900;

    previewWindow = new BrowserWindow({
      width: winW,
      height: winH,
      resizable: true,
      title: `Print preview — ${paper.label}`,
      backgroundColor: "#2a2a2a",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    previewWindow.on("closed", () => {
      previewWindow = null;
      // Cleanup temp preview files (best-effort)
      for (const p of [baked.filePath, htmlPath]) {
        try {
          if (p && fs.existsSync(p)) fs.unlinkSync(p);
        } catch {
          /* ignore */
        }
      }
    });

    await previewWindow.loadFile(htmlPath);
    return { success: true, landscape: baked.landscape };
  } catch (error: any) {
    return { success: false, message: error?.message || "Preview failed" };
  }
}

export function printDirect(
  filePath: string,
  printerName: string | undefined,
  silent: boolean
): Promise<{ success: boolean; message?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let printWindow: BrowserWindow | null = null;
    let bakedPath = "";
    let htmlPath = "";

    const finish = (result: { success: boolean; message?: string }) => {
      if (settled) return;
      settled = true;
      printLog("result", result);
      clearTimeout(timeout);
      if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
      const tempDir = path.join(os.tmpdir(), "silentprint") + path.sep;
      const owned = [bakedPath, htmlPath];
      if (filePath.startsWith(tempDir)) owned.push(filePath);
      for (const p of owned) {
        if (p && fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch { /* temp cleanup */ }
        }
      }
      resolve(result);
    };

    const timeout = setTimeout(() => {
      finish({ success: false, message: "Print timeout after 30s" });
    }, 30000);

    void (async () => {
      try {
        const baked = await bakeOrientation(filePath);
        bakedPath = baked.filePath;
        htmlPath = writePrintHtml(baked.filePath, baked.landscape);

        // Khổ giấy khớp pixel đã bake. landscape: false để Chromium không xoay thêm.
        const pageSize = baked.landscape
          ? { width: PHOTO_LONG_UM, height: PHOTO_SHORT_UM }
          : { width: PHOTO_SHORT_UM, height: PHOTO_LONG_UM };

        printWindow = new BrowserWindow({
          show: false,
          width: 800,
          height: 600,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
          },
        });

        printWindow.webContents.once("did-fail-load", (_event, _code, description) => {
          finish({ success: false, message: `Load failed: ${description}` });
        });

        printWindow.webContents.once("did-finish-load", () => {
          printWindow!.webContents
            .executeJavaScript(`
              new Promise((resolve) => {
                const img = document.getElementById("photo");
                if (!img) { resolve("no-image"); return; }
                if (img.complete && img.naturalWidth > 0) { resolve("loaded"); return; }
                img.onload = () => resolve("loaded");
                img.onerror = () => resolve("error");
                setTimeout(() => resolve("timeout"), 20000);
              });
            `)
            .then((status: string) => {
              if (status !== "loaded" || !printWindow || printWindow.isDestroyed()) {
                finish({
                  success: false,
                  message:
                    status === "no-image"
                      ? "No image found"
                      : status === "timeout"
                        ? "Image load timeout"
                        : "Image load error",
                });
                return;
              }

              const printOpts = {
                silent,
                printBackground: true,
                deviceName: printerName || undefined,
                color: true,
                landscape: false,
                pageSize,
                margins: { marginType: "none" as const },
                scaleFactor: 100,
                preferCSSPageSize: true,
              };

              printLog("print", { landscapeImage: baked.landscape, printerName, printOpts });
              void printWindow.webContents.getPrintersAsync().then((printers) =>
                printLog("printers", printers.map((p) => ({ name: p.name, options: p.options })))
              ).catch(() => {});

              printWindow.webContents.print(printOpts, (success, failureReason) => {
                finish({
                  success,
                  message: success ? "Print job sent" : failureReason || "Print failed",
                });
              });
            })
            .catch((error: Error) => {
              finish({ success: false, message: error.message });
            });
        });

        await printWindow.loadFile(htmlPath);
      } catch (error: any) {
        finish({ success: false, message: error?.message || "Direct print failed" });
      }
    })();
  });
}
