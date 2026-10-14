import { packager } from "@electron/packager";
import { rmSync } from "node:fs";

rmSync("out", { recursive: true, force: true });
const paths = await packager({
  dir: ".",
  name: "meu-bot",
  out: "out",
  platform: "darwin",
  arch: process.arch === "arm64" ? "arm64" : "x64",
  asar: true,
  overwrite: true,
  appBundleId: "local.meu-bot",
  icon: "assets/icon.icns",
  appCategoryType: "public.app-category.productivity",
  prune: true,
  extraResource: ["backend-colima"],
  ignore: [/^\/hermes-agent($|\/)/, /^\/backend-colima($|\/)/, /^\/backend-vm($|\/)/, /^\/docs($|\/)/, /^\/assets($|\/)/, /^\/build($|\/)/, /^\/src($|\/)/, /^\/scripts($|\/)/, /^\/tsconfig/, /^\/\.gitignore$/, /^\/out($|\/)/],
});
console.log("Empacotado em:", paths.join(", "));
