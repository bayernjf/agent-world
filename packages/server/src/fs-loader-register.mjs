// Register the fs-isolation ESM loader. Loaded via `--import` when forking
// isolated worker plugins, so `node:fs/promises` imports are intercepted
// before the plugin module is evaluated.
import { register } from "node:module";

register("./fs-loader.mjs", import.meta.url);
