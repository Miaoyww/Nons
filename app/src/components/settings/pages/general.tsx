import { Monitor, Moon, Sun } from "lucide-react";
import type { Theme } from "@/hooks/use-theme";
import { SettingsCard } from "../settings-card";
import { FontPicker } from "../font-picker";
import { useFontSettings } from "@/hooks/use-font-settings";

const themes = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
] as const;

export function GeneralPage({ theme, onThemeChange }: { theme: Theme; onThemeChange: (theme: Theme) => void }) {
  const { fonts, setFont } = useFontSettings();
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-xl font-bold">界面</h2>
        <p className="mt-2 text-sm text-muted-foreground">调整 Nons 的外观。</p>
      </div>
      <SettingsCard title="界面主题" description="选择浅色、深色，或跟随系统的外观设置。">
        <div role="radiogroup" aria-label="界面主题" className="flex flex-wrap gap-1.5">
          {themes.map(({ value, label, icon: Icon }) => (
            <label key={value} className="relative cursor-pointer">
              <input className="peer sr-only" type="radio" name="theme" value={value}
                checked={theme === value} onChange={() => onThemeChange(value)} />
              <span className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs text-muted-foreground transition-colors hover:bg-accent peer-checked:bg-secondary peer-checked:text-secondary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                <Icon className="size-3.5" aria-hidden="true" />{label}
              </span>
            </label>
          ))}
        </div>
      </SettingsCard>
      <SettingsCard title="应用字体" description="搜索并选择已安装字体，即时生效并自动保存。缺失字符由系统字体补全。">
        <FontPicker label="应用字体" value={fonts.app} onChange={(family) => setFont("app", family)} defaultLabel="应用默认字体" />
      </SettingsCard>
    </div>
  );
}
