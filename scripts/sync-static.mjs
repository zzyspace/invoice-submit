import { mkdir, readFile, writeFile } from "node:fs/promises";

const publicDir = new URL("../public/", import.meta.url);
const pages = [
  {
    source: new URL("../invoice-form-concept.html", import.meta.url),
    target: new URL("../public/index.html", import.meta.url),
  },
  {
    source: new URL("../home.html", import.meta.url),
    target: new URL("../public/home.html", import.meta.url),
  },
];

await mkdir(publicDir, { recursive: true });

for (const page of pages) {
  const source = await readFile(page.source, "utf8");
  await writeFile(page.target, source, "utf8");
}
