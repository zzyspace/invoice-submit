import { mkdir, readFile, writeFile } from "node:fs/promises";

const sourcePath = new URL("../invoice-form-concept.html", import.meta.url);
const publicDir = new URL("../public/", import.meta.url);
const targets = [
  new URL("../public/index.html", import.meta.url),
  new URL("../public/invoice-form-concept.html", import.meta.url),
];

const source = await readFile(sourcePath, "utf8");

await mkdir(publicDir, { recursive: true });

for (const target of targets) {
  await writeFile(target, source, "utf8");
}
