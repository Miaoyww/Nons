import appIcon from "../../../../app-icon.png";
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
    </div>
  );
}
