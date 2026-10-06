import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { errorText, nativeCall, usePlayer, type OutputDevice } from "@/lib/player";
import { useMusicOptions } from "@/components/player/music-options";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsCard } from "../settings-card";

export function PlaybackPage() {
  const state = usePlayer();
  const { options, busy, error: optionsError, update } = useMusicOptions();
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const [error, setError] = useState<string>();
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    void nativeCall<OutputDevice[]>("output_devices").then((value) => { if (!disposed) setDevices(value); })
      .catch((cause) => { if (!disposed) setError(errorText(cause)); });
    return () => { disposed = true; };
  }, []);
  const items = [{ value: null, label: "跟随系统默认" }, ...devices.map((device) => ({ value: device.id, label: device.name }))];
  return <div className="flex flex-col gap-8">
    <div><h2 className="text-xl font-bold">播放</h2><p className="mt-2 text-sm text-muted-foreground">选择声音的去向与音质偏好。</p></div>
    <SettingsCard title="输出设备" description="选择播放设备，或跟随系统默认输出。">
      <Select items={items} value={state.deviceId} disabled={!isTauri() || switching}
        onOpenChange={(open) => { if (open) void nativeCall<OutputDevice[]>("output_devices").then(setDevices).catch((cause) => setError(errorText(cause))); }}
        onValueChange={(deviceId) => {
          setSwitching(true); setError(undefined);
          void nativeCall("player_device", { deviceId }).catch((cause) => setError(errorText(cause))).finally(() => setSwitching(false));
        }}>
        <SelectTrigger className="w-60" aria-label="输出设备"><SelectValue>{state.deviceId ? devices.find((d) => d.id === state.deviceId)?.name ?? "当前输出设备" : "跟随系统默认"}</SelectValue></SelectTrigger>
        <SelectContent alignItemWithTrigger={false}><SelectGroup>{items.map(({ value, label }) => <SelectItem key={value ?? "default"} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
    </SettingsCard>
    <SettingsCard title="允许音质降级" description="所选音质不可用时，使用可播放的音质。音质可在底部播放栏选择。">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={options.allowDowngrade} disabled={!isTauri() || busy} onChange={(event) => update({ allowDowngrade: event.target.checked })} />不可用时允许降低音质</label>
    </SettingsCard>
    {(error || optionsError) && <p role="alert" className="text-sm text-destructive">{error ?? optionsError}</p>}
  </div>;
}
