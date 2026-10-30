import JSZip from "jszip";

export async function zipFiles(
  files: Record<string, string | Buffer>,
): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name.replace(/\\/g, "/"), content);
  }
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
