import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { LogIn, LogOut } from "lucide-react";
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle, DialogTrigger } from "@/components/animate-ui/components/base/dialog";
import { errorText, nativeCall } from "@/lib/player";
import { ActionButton } from "./action-button";

interface Qr { key: string; image: string }
interface Status { code: number; message: string }

export function LoginDialog() {
  const [open, setOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [qr, setQr] = useState<Qr>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    void nativeCall<boolean>("login_session").then((value) => { if (!disposed) setLoggedIn(value); }).catch((cause) => { if (!disposed) setMessage(errorText(cause)); });
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
        if (status.code === 803) { setLoggedIn(true); setQr(undefined); return; }
        if (status.code === 800) { setQr(undefined); return; }
      } catch (cause) { if (!disposed) setMessage(errorText(cause)); }
      if (!disposed) timer = setTimeout(() => void poll(), 4000);
    };
    timer = setTimeout(() => void poll(), 4000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [open, qr]);

  return <Dialog open={open} onOpenChange={(value) => {
    setOpen(value);
    if (value && !loggedIn) void generate();
    if (!value) { generation.current++; setQr(undefined); setBusy(false); }
  }}>
    <DialogTrigger render={<ActionButton variant="ghost" disabled={!isTauri()} className="w-full justify-start" />}>
      <LogIn aria-hidden="true" />{loggedIn ? "网易云已登录" : "登录网易云"}
    </DialogTrigger>
    <DialogPopup className="max-w-sm">
      <DialogTitle>网易云音乐</DialogTitle><DialogDescription>{loggedIn ? "登录会话保存在系统凭据存储中。" : "使用网易云音乐扫描二维码，并在手机上确认。"}</DialogDescription>
      {!loggedIn && <div className="flex min-h-64 items-center justify-center">{qr ? <img src={qr.image} width={224} height={224} alt="网易云音乐登录二维码" className="rounded-lg bg-white" /> : <p className="text-sm text-muted-foreground">{busy ? "正在生成二维码…" : "点击下方按钮生成登录二维码。"}</p>}</div>}
      <p role="status" className="text-sm text-muted-foreground">{message}</p>
      <div className="flex justify-end gap-2">
        {loggedIn ? <ActionButton variant="outline" onClick={() => { void nativeCall("logout").then(() => { setLoggedIn(false); setMessage("已退出登录。"); }).catch((cause) => setMessage(errorText(cause))); }}><LogOut aria-hidden="true" />退出登录</ActionButton> : <ActionButton variant="secondary" disabled={busy} onClick={() => void generate()}>重新生成</ActionButton>}
        <DialogClose render={<ActionButton variant="outline" />}>关闭</DialogClose>
      </div>
    </DialogPopup>
  </Dialog>;
}
