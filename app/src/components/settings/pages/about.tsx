import appIcon from "../../../../app-icon.png";
import yesPlayMusicLicense from "../../../../../notices/YesPlayMusic-LICENSE.txt?raw";
import { SettingsCard } from "../settings-card";

export function AboutPage({ version }: { version: string }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <img src={appIcon} alt="" className="size-32 rounded-2xl" draggable={false} />
        <h2 className="text-3xl font-bold tracking-tight">Nons</h2>
      </div>
      <SettingsCard title="版本号" description="当前应用版本。">
        <span className="text-sm tabular-nums">v{version}</span>
      </SettingsCard>
      <SettingsCard title="音乐库界面" description="参考并移植 YesPlayMusic 的音乐库布局与交互。">
        <a className="text-sm underline underline-offset-4" href="https://github.com/qier222/YesPlayMusic" target="_blank" rel="noreferrer">YesPlayMusic</a>
        <details className="mt-3 text-xs"><summary className="cursor-pointer">MIT 许可证 · qier222</summary><pre className="mt-3 whitespace-pre-wrap font-sans leading-5 text-muted-foreground">{yesPlayMusicLicense}</pre></details>
      </SettingsCard>
    </div>
  );
}
