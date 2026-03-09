import sharp from "sharp";
import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { create4x6Pdf, prepareImage4x6 } from "./print-pdf";
import { PrintRequest } from "./print-handler";

async function prepare4x6Image(inputPath: string): Promise<string> {
    const tempDir = path.join(os.tmpdir(), "silentprint");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const outputPath = path.join(
        tempDir,
        `native_${Date.now()}.jpg`
    );
    console.log("outputPath: ", outputPath)

    await sharp(inputPath)
        .rotate() // Fix EXIF
        .resize(1200, 1800, { fit: "cover" }) // 4x6 @300dpi
        .withMetadata({ density: 300 })
        .jpeg({ quality: 100 })
        .toFile(outputPath);

    return outputPath;
}

function sendToPrinter(filePath: string, printerName: string): Promise<void> {
    console.log("sendToPrinter:", filePath, printerName)

    return new Promise((resolve, reject) => {
        const command = `rundll32.exe shimgvw.dll,ImageView_PrintTo "${filePath}" "${printerName}"`;
        console.log("command: ", command)

        exec(command, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function printPdf(filePath: string, printerName: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const command = `powershell -Command "Start-Process -FilePath '${filePath}' -Verb PrintTo -ArgumentList '${printerName}'"`;
        console.log("command: ", command)

        exec(command, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

export function printDeeplink(printData: PrintRequest,
    jobId: string): Promise<{ success: boolean; message?: string }> {
    console.log("printDeeplink:", printData, jobId)

    return new Promise((resolve, reject) => {
        const command = `start ${printData.content}`;
        console.log("command: ", command)

        exec(command, (error) => {
            if (error) reject(error);
            else resolve({
                success: true,
                message: "Deeplink executed"
            });
        });
    });
}
export async function nativePrint4x6(
    inputPath: string,
    printerName: string
) {
    console.log("nativePrint4x6")
    //   const preparedImage = await prepare4x6Image(inputPath);
    //   await sendToPrinter(preparedImage, printerName);
    const img = await prepareImage4x6(inputPath);
    const pdf = await create4x6Pdf(img);
    await printPdf(pdf, printerName);
}
