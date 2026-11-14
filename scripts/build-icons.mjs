// Renders icons/icon-*.png from the SVG below with an installed Chrome.
// Usage: CHROME=<path> node scripts/build-icons.mjs   (development only)
import { writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect x="4" y="4" width="120" height="120" rx="28" fill="#b3261e"/>
  <rect x="26" y="34" width="62" height="50" rx="8" fill="none" stroke="#fff" stroke-width="9"/>
  <path d="M26 50h62" stroke="#fff" stroke-width="9"/>
  <circle cx="88" cy="88" r="24" fill="#b3261e" stroke="#fff" stroke-width="9"/>
  <path d="M71 105l34-34" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
</svg>`;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  const png = await page.screenshot({ omitBackground: true, type: "png" });
  await writeFile(new URL(`../icons/icon-${size}.png`, import.meta.url), png);
}
await writeFile(new URL("../icons/icon.svg", import.meta.url), svg);
await browser.close();
console.log("Icons written.");
