import sharp from "sharp";
import fs from "fs";
import path from "path";
import os from "os";
import PDFDocument from "pdfkit";
import { exec } from "child_process";

const FOUR_BY_SIX_IN_POINTS = [4 * 72, 6 * 72]; // 288 x 432 points

export async function prepareImage4x6(inputPath: string) {
  const tempDir = path.join(os.tmpdir(), "silentprint");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const outputImage = path.join(tempDir, `pdf_img_${Date.now()}.jpg`);
  console.log("outputImage: ", outputImage)

  const meta = await sharp(inputPath).metadata();
  const isLandscape = (meta.width || 0) > (meta.height || 0);

  await sharp(inputPath)
    .rotate()
    .resize(
      isLandscape ? 1800 : 1200,
      isLandscape ? 1200 : 1800,
      { fit: "cover" }
    )
    .withMetadata({ density: 300 })
    .jpeg({ quality: 95 })
    .toFile(outputImage);

  return outputImage;
}

export async function create4x6Pdf(imagePath: string) {
  const tempDir = path.join(os.tmpdir(), "silentprint");
  const pdfPath = path.join(tempDir, `print_${Date.now()}.pdf`);

  const doc = new PDFDocument({
    size: FOUR_BY_SIX_IN_POINTS,
    margin: 0
  });

  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  doc.image(imagePath, 0, 0, {
    width: FOUR_BY_SIX_IN_POINTS[0],
    height: FOUR_BY_SIX_IN_POINTS[1]
  });

  doc.end();

  await new Promise(resolve => stream.on("finish", resolve));
  return pdfPath;
}