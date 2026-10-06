import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Popover } from "@base-ui/react/popover";
import { LogOut, UserRound } from "lucide-react";
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle, DialogTrigger } from "@/components/animate-ui/components/base/dialog";
import { errorText, nativeCall } from "@/lib/player";
import { ActionButton } from "./action-button";

interface Qr { key: string; image: string }
interface Status { code: number; message: string }
interface Profile { nickname: string; avatarUrl: string }

export function LoginDialog() {
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [open, setOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [qr, setQr] = useState<Qr>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    void nativeCall<Profile | null>("account_profile").then((value) => { if (!disposed) { setProfile(value); setLoggedIn(!!value); } }).catch((cause) => { if (!disposed) setMessage(errorText(cause)); });
    return () => { disposed = true; };
  }, []);

  async function generate() {
    const serial = ++generation.current;
    setBusy(true); setQr(undefined); setMessage("正在生成二维码…");
    try { const value = await nativeCall<Qr>("qr_login"); if (serial === generation.current) { setQr(value); setMessage("请使用网易云音乐扫码登录。"); } }
    catch (cause) { if (serial === generation.current) setMessage(errorText(cause)); }
    finally { if (serial === generation.current) setBusy(false); }
  }

  useEffect(() => {
    if (!open || !qr) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const status = await nativeCall<Status>("poll_login", { key: qr.key });
        if (disposed) return;
        setMessage(status.message);
        if (status.code === 803) {
          setLoggedIn(true);
          try {
            const account = await nativeCall<Profile | null>("account_profile");
            if (!disposed) { setProfile(account); setLoggedIn(!!account); setAvatarFailed(false); setQr(undefined); setOpen(false); }
          } catch (cause) { if (!disposed) { setMessage(errorText(cause)); setQr(undefined); } }
          return;
        }
        if (status.code === 800) { setQr(undefined); return; }
      } catch (cause) { if (!disposed) setMessage(errorText(cause)); }
      if (!disposed) timer = setTimeout(() => void poll(), 4000);
    };
    timer = setTimeout(() => void poll(), 4000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [open, qr]);

  async function logout() {
    setBusy(true); setAccountError("");
    try { await nativeCall("logout"); setAccountOpen(false); setLoggedIn(false); setProfile(null); setMessage("已退出登录。"); setOpen(false); }
    catch (cause) { setAccountError(errorText(cause)); }
    finally { setBusy(false); }
  }

  const accountIdentity = <>
    {profile?.avatarUrl && !avatarFailed ? <img src={profile.avatarUrl} alt="" className="size-6 rounded-full object-cover" onError={() => setAvatarFailed(true)} /> : <UserRound aria-hidden="true" />}
    <span className="max-w-24 truncate">{profile?.nickname ?? "网易云已登录"}</span>
  </>;
  if (loggedIn) return <Popover.Root open={accountOpen} onOpenChange={setAccountOpen}>
    <Popover.Trigger openOnHover delay={180} closeDelay={250} render={<ActionButton variant="ghost" size="sm" className="gap-2" aria-label="网易云账号" />}>{accountIdentity}</Popover.Trigger>
    <Popover.Portal><Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
      <Popover.Popup className="w-72 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none">
        <p className="mb-4 text-xs text-muted-foreground">账号来源 · 网易云</p>
        <div className="flex items-center gap-3">
          {profile?.avatarUrl && !avatarFailed ? <img src={profile.avatarUrl} alt="" className="size-12 rounded-full object-cover" onError={() => setAvatarFailed(true)} /> : <UserRound className="size-12 rounded-full bg-muted p-3" aria-hidden="true" />}
          <div className="min-w-0"><Popover.Title className="truncate text-sm font-semibold">{profile?.nickname ?? "网易云已登录"}</Popover.Title><Popover.Description className="mt-1 text-xs text-muted-foreground">当前账号已登录</Popover.Description></div>
        </div>
        {accountError && <p role="alert" className="mt-3 text-sm text-destructive">{accountError}</p>}
        <div className="mt-4 border-t border-border pt-3"><ActionButton variant="ghost" className="w-full justify-start" disabled={busy} onClick={() => void logout()}><LogOut aria-hidden="true" />{busy ? "正在登出…" : "登出"}</ActionButton></div>
      </Popover.Popup>
    </Popover.Positioner></Popover.Portal>
  </Popover.Root>;

  return <div className="flex items-center gap-1"><Dialog open={open} onOpenChange={(value) => {
    setOpen(value);
    if (value && !loggedIn && isTauri()) void generate();
    if (!value) { generation.current++; setQr(undefined); setBusy(false); }
  }}>
    <DialogTrigger render={<ActionButton variant="ghost" size="sm" className="gap-2" aria-label={loggedIn ? "网易云账号" : "登录网易云音乐"} />}>
      {profile?.avatarUrl && !avatarFailed ? <img src={profile.avatarUrl} alt="" className="size-6 rounded-full object-cover" onError={() => setAvatarFailed(true)} /> : <UserRound aria-hidden="true" />}
      <span className="max-w-32 truncate">{loggedIn ? profile?.nickname ?? "网易云已登录" : "未登录"}</span>
    </DialogTrigger>
    <DialogPopup className="max-w-sm">
      <DialogTitle>网易云音乐</DialogTitle><DialogDescription>{loggedIn ? "登录会话保存在系统凭据存储中。" : "使用网易云音乐扫描二维码，并在手机上确认。"}</DialogDescription>
      {!loggedIn && <div className="flex min-h-64 items-center justify-center">{qr ? <img src={qr.image} width={224} height={224} alt="网易云音乐登录二维码" className="rounded-lg bg-white" /> : <p className="text-sm text-muted-foreground">{!isTauri() ? "请在桌面应用中扫码登录。" : busy ? "正在生成二维码…" : "点击下方按钮生成登录二维码。"}</p>}</div>}
      <p role="status" className="text-sm text-muted-foreground">{message}</p>
      <div className="flex justify-end gap-2">
        {loggedIn ? <ActionButton variant="outline" disabled={busy} onClick={() => void logout()}><LogOut aria-hidden="true" />退出登录</ActionButton> : <ActionButton variant="secondary" disabled={busy || !isTauri()} onClick={() => void generate()}>重新生成</ActionButton>}
        <DialogClose render={<ActionButton variant="outline" />}>关闭</DialogClose>
      </div>
    </DialogPopup>
  </Dialog></div>;
}
