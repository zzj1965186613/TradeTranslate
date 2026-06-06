import { cpSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");

cpSync(resolve(root, "manifest.json"), resolve(dist, "manifest.json"));
cpSync(resolve(root, "popup.html"), resolve(dist, "popup.html"));
cpSync(resolve(root, "icons"), resolve(dist, "icons"), { recursive: true });

console.log("Static files copied to dist/");
