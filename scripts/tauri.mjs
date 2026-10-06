import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const app = join(root, "app");
const gst = join(root, ".local", "gstreamer");
const env = { ...process.env };

// Match native.ps1's project-local runtime without changing the system environment.
if (process.platform === "win32" && existsSync(join(gst, "VERSION"))) {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
  const bin = join(gst, "bin");
  const entries = (env[pathKey] ?? "").split(";");
  env[pathKey] = [bin, ...entries.filter((entry) => entry.toLowerCase() !== bin.toLowerCase())].join(";");
  env.GST_PLUGIN_PATH = join(gst, "lib", "gstreamer-1.0");
  env.GST_PLUGIN_SCANNER = join(gst, "libexec", "gstreamer-1.0", "gst-plugin-scanner.exe");
  for (const [key, library] of Object.entries({
    GLIB_2_0: "glib-2.0-0",
    GOBJECT_2_0: "gobject-2.0-0",
    GIO_2_0: "gio-2.0-0",
    GSTREAMER_1_0: "gstreamer-1.0-0",
    GSTREAMER_BASE_1_0: "gstbase-1.0-0",
  })) {
    env[`SYSTEM_DEPS_${key}_NO_PKG_CONFIG`] = "1";
    env[`SYSTEM_DEPS_${key}_LIB`] = library;
    env[`SYSTEM_DEPS_${key}_SEARCH_NATIVE`] = join(gst, "lib");
  }
}

const require = createRequire(join(app, "package.json"));
const cli = require.resolve("@tauri-apps/cli/tauri.js");
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: app,
  env,
  stdio: "inherit",
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
