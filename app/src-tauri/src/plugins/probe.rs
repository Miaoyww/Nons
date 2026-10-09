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
        tokio::time::sleep(Duration::from_secs(90)).await;
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
            assert!(context.call("player.read", r#"{}"#).await.is_err());
            assert!(context.call("storage.get", r#"{"key":"other"}"#).await.is_err());
            assert!(context.call("http.request", r#"{"url":"https://unauthorized.test/"}"#).await.is_err());
            let mut denied = context.clone();
            denied.permissions.remove("clipboard:read");
            denied.permissions.remove("http:request");
            assert!(denied.call("clipboard.read-text", "{}").await.is_err());
            assert!(denied.call("http.request", r#"{"url":"https://music.163.com/"}"#).await.is_err());
            assert!(manager.resource(&tauri::http::Request::builder().uri(format!("plugin://localhost/netease-island/{}/../manifest.json", descriptor.generation)).body(Vec::new()).unwrap()).is_err());
            manager.app.get_webview_window("main").ok_or("缺少 WebView")?.eval(r#"
                (()=>{const start=Date.now();const poll=()=>{if(document.querySelector('.nons-island-title')){window.__TAURI_INTERNALS__.invoke('plugin_probe_report',{phase:'render',success:true});return;}if(Date.now()-start>12000){window.__TAURI_INTERNALS__.invoke('plugin_probe_report',{phase:'render',success:false});return;}setTimeout(poll,50);};poll();})();
            "#).map_err(|e| e.to_string())?;
            // Deliver synthetic raw text; filtering belongs to the plugin.
            let text = "fixture text https://music.163.com/#/song?id=347230 https://evil.test/private";
            *manager.app.state::<Probe>().delivery_started.lock().map_err(|_| "探测计时不可用")? = Some(Instant::now());
            manager.queue_clipboard(text.to_string());
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
        std::fs::write(source.join("manifest.json"), serde_json::json!({"id":"probe-page","name":"Probe Page","version":"1.0.0","frontend":"ui.mjs","permissions":["ui","storage"],"engines":{"app":"^1.0.0","pluginApi":"^1.0.0","uiApi":"^1.0.0"},"contributes":{"pages":[{"id":"root","path":"/","export":"Page"}],"navigation":[{"id":"entry","label":"Probe Page","page":"root"}]}}).to_string()).map_err(|e| e.to_string())?;
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
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target/plugin-fixtures/settings-fixture");
        manager.inner().install(fixture).await?;
        manager
            .inner()
            .action("settings-fixture", "enable", true)
            .await?;
        app.get_webview_window("main").ok_or("缺少 WebView")?.eval(r#"
          (async()=>{
            const invoke=window.__TAURI_INTERNALS__.invoke;
            const wait=async(find)=>{const start=Date.now();while(Date.now()-start<8000){const found=find();if(found)return found;await new Promise(r=>setTimeout(r,40));}throw Error('DOM timeout');};
            const waitAsync=async(find)=>{const start=Date.now();while(Date.now()-start<8000){if(await find())return;await new Promise(r=>setTimeout(r,40));}throw Error('save timeout');};
            const button=(text)=>[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()===text);
            try{
              (await wait(()=>document.querySelector('button[aria-label="设置"]'))).click();
              (await wait(()=>button('插件设置'))).click();
              (await wait(()=>document.querySelector('button[aria-label="设置 灵动岛"]'))).click();
              const toggle=await wait(()=>document.querySelector('[role=dialog] [role=switch]'));
              const descriptor=(await invoke('plugin_list')).find(p=>p.manifest.id==='netease-island');
              const get=()=>invoke('plugin_settings',{id:'netease-island',generation:descriptor.generation,operation:'get',args:{}});
              const before=await get();toggle.click();
              await waitAsync(async()=>(await get()).snapshot.revision>before.snapshot.revision);
              const after=await get();if(after.snapshot.revision<=before.snapshot.revision||after.snapshot.values.pauseOnHover===before.snapshot.values.pauseOnHover)throw Error('switch not saved');
              (await wait(()=>button('全部恢复默认'))).click();
              await waitAsync(async()=>(await get()).snapshot.values.pauseOnHover===true);
              await wait(()=>button('返回插件列表')&&!button('返回插件列表').disabled);
              button('返回插件列表').click();
              (await wait(()=>document.querySelector('button[aria-label="设置 配置示例"]'))).click();
              const input=await wait(()=>document.querySelector('[aria-label="欢迎语"]'));
              await wait(()=>input.value);
              const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
              input.focus();setter.call(input,'probe-config');input.dispatchEvent(new Event('input',{bubbles:true}));
              await new Promise(r=>setTimeout(r,0));input.blur();
              const fixture=(await invoke('plugin_list')).find(p=>p.manifest.id==='settings-fixture');
              await waitAsync(async()=>(await invoke('plugin_settings',{id:fixture.manifest.id,generation:fixture.generation,operation:'get',args:{}})).snapshot.values.greeting==='probe-config');
              (await wait(()=>button('打开子页面'))).click();
              await wait(()=>document.querySelector('[data-settings-route]')?.textContent==='/settings/advanced');
              if(document.querySelector('[data-probe-state]')?.textContent!=='1:/child')throw Error('main route changed');
              button('写入并读取专属文件').click();
              await wait(()=>[...document.querySelectorAll('[role=dialog] [role=status]')].some(p=>p.textContent==='文件内容：probe-config'));
              document.querySelector('[aria-label="关闭设置"]').click();
              await invoke('plugin_probe_report',{phase:'configuration',success:true});
            }catch(error){console.error(error);await invoke('plugin_probe_report',{phase:'configuration',success:false});}
          })();
        "#).map_err(|e| e.to_string())?;
    } else if phase == "configuration" {
        let configs = manager.configurations.snapshot("settings-fixture")?;
        assert_eq!(configs.values["greeting"], "probe-config");
        let data = manager.files.data_directory("settings-fixture")?;
        assert_eq!(
            std::fs::read(data.join("sample.bin")).map_err(|e| e.to_string())?,
            b"probe-config"
        );
        let external = directory().join("external");
        std::fs::create_dir_all(&external).map_err(|e| e.to_string())?;
        std::fs::write(external.join("keep"), b"external").map_err(|e| e.to_string())?;
        manager
            .files
            .grant("settings-fixture", external.clone(), true)?;
        manager
            .inner()
            .action("settings-fixture", "uninstall-keep-data", false)
            .await?;
        assert!(manager.files.grants("settings-fixture")?.is_empty());
        assert!(data.join("sample.bin").exists());
        assert_eq!(
            manager.database.config_read("settings-fixture")?.1["greeting"],
            "probe-config"
        );
        manager
            .inner()
            .install(
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("target/plugin-fixtures/settings-fixture"),
            )
            .await?;
        assert_eq!(
            manager.configurations.snapshot("settings-fixture")?.values["greeting"],
            "probe-config"
        );
        manager
            .inner()
            .action("settings-fixture", "uninstall", false)
            .await?;
        assert!(!data.exists());
        assert_eq!(manager.database.config_read("settings-fixture")?.0, 0);
        assert!(external.join("keep").exists());
        println!("PLUGIN_PROBE generated autosave/reset, custom configuration routes, binary SDK, retained reinstall and uninstall cleanup: passed");
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
