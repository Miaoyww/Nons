const modifierOrder = ["Ctrl", "Alt", "Shift", "Super"] as const;
const aliases: Record<string, string> = { ctrl: "Ctrl", control: "Ctrl", alt: "Alt", shift: "Shift", meta: "Super", cmd: "Super", command: "Super", super: "Super" };
const namedKeys = ["Space", "Enter", "Escape", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Backquote", "Comma", "Period", "Slash", "NumpadAdd", "NumpadSubtract", "NumpadMultiply", "NumpadDivide", "NumpadDecimal", "NumpadEnter"];
function mainKey(value: string) {
  const key = value.replace(/^Key/i, "").replace(/^Digit/i, "");
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(key)) return key.toUpperCase();
  if (/^Numpad[0-9]$/i.test(key)) return `Numpad${key[key.length - 1]}`;
  return namedKeys.find((name) => name.toLowerCase() === key.toLowerCase());
}
export function normalizeShortcut(value: string): string | undefined {
  if (!value.trim()) return "";
  const keys = value.split("+").map((part) => part.trim());
  if (keys.length < 2 || keys.length > 3) return;
  const key = mainKey(keys[keys.length - 1]);
  const modifiers = keys.slice(0, -1).map((part) => aliases[part.toLowerCase()]);
  if (!key || modifiers.some((part) => !part) || new Set(modifiers).size !== modifiers.length) return;
  return [...modifierOrder.filter((part) => modifiers.includes(part)), key].join("+");
}
export function captureShortcut(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "isComposing">): { binding?: string; error?: string } {
  if (event.isComposing || /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(event.code)) return {};
  const modifiers = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Super"].filter(Boolean);
  if (!modifiers.length) return { error: "请按组合键，至少包含一个修饰键。" };
  if (modifiers.length > 2) return { error: "最多三个键：一个或两个修饰键，加一个普通键。" };
  const key = mainKey(event.code);
  if (!key) return { error: "不支持此按键，请换一个组合键。" };
  return { binding: [...modifiers, key].join("+") };
}
