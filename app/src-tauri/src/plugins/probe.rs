//! Opt-in real WebView probe, isolated from the user's installed plugins and queue.
use super::*;
use std::sync::atomic::AtomicBool;

pub struct Probe {
    pub success: AtomicBool,
    pub delivery_started: Mutex<Option<Instant>>,
}
pub fn directory() -> PathBuf {
    std::env::temp_dir().join(format!("nons-plugin-probe-{}", std::process::id()))
}
pub fn start(manager: Arc<PluginManager>) {
    manager.app.manage(Probe {
        success: AtomicBool::new(false),
        delivery_started: Mutex::new(None),
    });
    let watchdog = manager.app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(45)).await;
        eprintln!("PLUGIN_PROBE timeout");
        watchdog.exit(1);
    });
    tauri::async_runtime::spawn(async move {
        let result: AppResult<()> = async {
            manager.action("netease-island", "enable", true).await?;
            let deadline = Instant::now();
            while !manager.has_clipboard_subscribers() {
                if deadline.elapsed() > Duration::from_secs(20) { return Err("动态 UI 未就绪".into()); }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            let descriptor = manager.list()?.into_iter().find(|p| p.manifest.id == "netease-island").ok_or("缺少插件")?;
            let context = manager.scoped("netease-island", descriptor.generation)?;
            assert!(context.call("player.control", r#"{"action":"pause"}"#).await.is_err());
            assert!(context.call("storage.get", r#"{"key":"other"}"#).await.is_err());
            assert!(manager.resource(&tauri::http::Request::builder().uri(format!("plugin://localhost/netease-island/{}/../manifest.json", descriptor.generation)).body(Vec::new()).unwrap()).is_err());
            manager.app.get_webview_window("main").ok_or("缺少 WebView")?.eval(r#"
                (()=>{const start=Date.now();const poll=()=>{if(document.querySelector('.nons-island-title')){window.__TAURI_INTERNALS__.invoke('plugin_probe_report',{phase:'render',success:true});return;}if(Date.now()-start>12000){window.__TAURI_INTERNALS__.invoke('plugin_probe_report',{phase:'render',success:false});return;}setTimeout(poll,50);};poll();})();
            "#).map_err(|e| e.to_string())?;
            // Feed synthetic clipboard text into the same host URL filter; never overwrite the user's clipboard.
            let links = clipboard::candidates("fixture text https://music.163.com/#/song?id=347230 https://evil.test/private");
            assert_eq!(links.len(), 1);
            *manager.app.state::<Probe>().delivery_started.lock().map_err(|_| "探测计时不可用")? = Some(Instant::now());
            manager.deliver_link(&links[0]).await;
            Ok(())
        }.await;
        if let Err(error) = result {
            eprintln!("PLUGIN_PROBE failed: {error}");
            manager.app.exit(1);
        }
    });
}
#[tauri::command]
pub async fn plugin_probe_report(
    phase: String,
    success: bool,
    app: tauri::AppHandle,
    manager: State<'_, Arc<PluginManager>>,
) -> AppResult<()> {
    if !success {
        eprintln!("PLUGIN_PROBE {phase} failed");
        app.exit(1);
        return Ok(());
    }
    if phase == "render" {
        if let Some(started) = *app
            .state::<Probe>()
            .delivery_started
            .lock()
            .map_err(|_| "探测计时不可用")?
        {
            println!("PLUGIN_PROBE synthetic clipboard URL -> visible DOM latency: {} ms (one Windows debug sample)", started.elapsed().as_millis());
        }
        println!("PLUGIN_PROBE real Component -> existing Netease client -> event -> dynamic ESM -> React -> slot: passed");
        let descriptor = manager
            .list()?
            .into_iter()
            .find(|p| p.manifest.id == "netease-island")
            .ok_or("缺少插件")?;
        manager
            .inner()
            .action("netease-island", "disable", false)
            .await?;
        assert!(manager
            .scoped("netease-island", descriptor.generation)
            .is_err());
        let script = format!(
            r#"(()=>{{const start=Date.now();const poll=()=>{{if(!document.querySelector('.nons-island')){{fetch('http://plugin.localhost/netease-island/{}/ui.mjs',{{cache:'no-store'}}).then(r=>window.__TAURI_INTERNALS__.invoke('plugin_probe_report',{{phase:'disabled',success:!r.ok}})).catch(()=>window.__TAURI_INTERNALS__.invoke('plugin_probe_report',{{phase:'disabled',success:true}}));return;}}if(Date.now()-start>3000){{window.__TAURI_INTERNALS__.invoke('plugin_probe_report',{{phase:'disabled',success:false}});return;}}setTimeout(poll,50);}};poll();}})();"#,
            descriptor.generation
        );
        app.get_webview_window("main")
            .ok_or("缺少 WebView")?
            .eval(&script)
            .map_err(|e| e.to_string())?;
    } else if phase == "disabled" {
        let snapshot = manager.player.snapshot()?;
        assert!(snapshot.queue.is_empty());
        println!("PLUGIN_PROBE permission checks, stale generation, disabled resources and UI cleanup: passed");
        let source = directory().join("probe-source");
        std::fs::create_dir_all(&source).map_err(|e| e.to_string())?;
        std::fs::write(source.join("manifest.json"), serde_json::json!({"id":"probe-page","name":"Probe Page","version":"1.0.0","frontend":"ui.mjs","permissions":["ui","storage"],"engines":{"app":"^0.1.0","pluginApi":"^1.0.0","uiApi":"^1.0.0"},"contributes":{"pages":[{"id":"root","path":"/","export":"Page"}],"navigation":[{"id":"entry","label":"Probe Page","page":"root"}]}}).to_string()).map_err(|e| e.to_string())?;
        std::fs::write(source.join("ui.mjs"), r#"import{createElement as h,useState}from'./_host/react.mjs';import{usePluginRoute,usePluginNavigate}from'./_host/sdk.mjs';export function Page(){const{pathname}=usePluginRoute();const navigate=usePluginNavigate();const[count,setCount]=useState(0);return h('div',{'data-probe-page':true},h('span',{'data-probe-state':true},`${count}:${pathname}`),h('button',{'data-probe-increment':true,onClick:()=>setCount(v=>v+1)},'Increment'),h('button',{'data-probe-child':true,onClick:()=>navigate('/child')},'Child'));}"#).map_err(|e| e.to_string())?;
        manager.inner().install(source).await?;
        manager.inner().action("probe-page", "enable", true).await?;
        let descriptor = manager
            .list()?
            .into_iter()
            .find(|p| p.manifest.id == "probe-page")
            .ok_or("页面插件缺失")?;
        let context = manager.scoped("probe-page", descriptor.generation)?;
        context
            .call("storage.set", r#"{"key":"sample","value":123}"#)
            .await?;
        assert_eq!(
            context.call("storage.get", r#"{"key":"sample"}"#).await?,
            "123"
        );
        app.get_webview_window("main").ok_or("缺少 WebView")?.eval(r#"(()=>{const started=Date.now();let step=0;const poll=()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Probe Page');const state=document.querySelector('[data-probe-state]');if(step===0&&button){button.click();step=1;}else if(step===1&&state?.textContent==='0:/'){document.querySelector('[data-probe-increment]').click();step=2;}else if(step===2&&state?.textContent==='1:/'){document.querySelector('[data-probe-child]').click();step=3;}else if(step===3&&state?.textContent==='1:/child'){window.__TAURI_INTERNALS__.invoke('plugin_probe_report',{phase:'page',success:true});return;}if(Date.now()-started>8000){window.__TAURI_INTERNALS__.invoke('plugin_probe_report',{phase:'page',success:false});return;}setTimeout(poll,50);};poll();})();"#).map_err(|e| e.to_string())?;
    } else if phase == "page" {
        println!("PLUGIN_PROBE directory install, scoped storage, navigation, page and subroute state: passed");
        manager
            .inner()
            .action("probe-page", "uninstall", false)
            .await?;
        assert!(manager.database.get("probe-page", "sample")?.is_none());
        app.get_webview_window("main").ok_or("缺少 WebView")?.eval(r#"(()=>{const start=Date.now();const poll=()=>{const nav=[...document.querySelectorAll('button')].some(b=>b.textContent==='Probe Page');if(!document.querySelector('[data-probe-page]')&&!nav){window.__TAURI_INTERNALS__.invoke('plugin_probe_report',{phase:'removed',success:true});return;}if(Date.now()-start>3000){window.__TAURI_INTERNALS__.invoke('plugin_probe_report',{phase:'removed',success:false});return;}setTimeout(poll,50);};poll();})();"#).map_err(|e| e.to_string())?;
    } else if phase == "removed" {
        println!(
            "PLUGIN_PROBE uninstall removes storage, page and navigation contributions: passed"
        );
        app.state::<Probe>().success.store(true, Ordering::SeqCst);
        app.exit(0);
    }
    Ok(())
}
