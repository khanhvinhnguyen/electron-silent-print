// In trực tiếp trong Electron. Không exec, không rundll32, không PowerShell,
// không protocol handler — chỉ webContents.print() sau khi bake EXIF vào pixel.
import fs from "fs";
import os from "os";
import path from "path";
import { BrowserWindow } from "electron";
import sharp from "sharp";

const PHOTO_SHORT_UM = 101_600; // 10.16 cm
const PHOTO_LONG_UM = 152_400; // 15.24 cm

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

async function bakeOrientation(inputPath: string): Promise<{ filePath: string; landscape: boolean }> {
  const tempDir = path.join(os.tmpdir(), "silentprint");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const filePath = path.join(tempDir, `direct_${id}.jpg`);

  const rotateDeg = getPrintRotateDeg();
  const meta = await sharp(inputPath).metadata();

  // autoOrient() áp EXIF rồi xóa tag Orientation; rotate(deg) chạy sau auto-orient.
  // Lấy kích thước output (sau khi bake + xoay), không lấy width/height gốc trong header.
  let pipeline = sharp(inputPath).autoOrient();
  if (rotateDeg !== 0) pipeline = pipeline.rotate(rotateDeg);
  const { data, info } = await pipeline
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer({ resolveWithObject: true });

  console.log("[PRINT direct] bake", {
    exifOrientation: meta.orientation ?? null,
    source: { width: meta.width, height: meta.height },
    rotateDeg,
    output: { width: info.width, height: info.height },
  });

  fs.writeFileSync(filePath, data);
  return { filePath, landscape: info.width > info.height };
}

function writePrintHtml(imagePath: string, landscape: boolean): string {
  const widthCm = landscape ? "15.24cm" : "10.16cm";
  const heightCm = landscape ? "10.16cm" : "15.24cm";
  const htmlPath = imagePath.replace(/\.jpg$/i, ".html");
  const imageName = path.basename(imagePath);

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page { size: ${widthCm} ${heightCm}; margin: 0; }
  html, body { margin: 0; padding: 0; width: ${widthCm}; height: ${heightCm}; overflow: hidden; background: #fff; }
  img { display: block; width: ${widthCm}; height: ${heightCm}; object-fit: cover; }
</style>
</head>
<body><img id="photo" src="${imageName}"></body>
</html>`;

  fs.writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
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

              console.log("[PRINT direct]", { landscapeImage: baked.landscape, printerName, printOpts });

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
