/** ESM namespaces have non-configurable exports; freeze a plain snapshot instead. */
export function installBridge(react: object, jsx: object, sdk: object) {
  if (Object.prototype.hasOwnProperty.call(globalThis, "__NONS_PLUGIN_HOST__")) return;
  Object.defineProperty(globalThis, "__NONS_PLUGIN_HOST__", {
    value: Object.freeze({ react, jsx, sdk: Object.freeze({ ...sdk }) }),
    configurable: false,
    writable: false,
  });
}
