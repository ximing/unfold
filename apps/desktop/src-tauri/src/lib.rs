#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .menu(build_menu)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "reload" {
                reload_main(app);
            }
        })
        .setup(|app| {
            let main = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .expect("main window")
                .clone();
            tauri::WebviewWindowBuilder::from_config(app.handle(), &main)?
                .on_navigation(|url| navigation_allowed(url))
                .on_new_window(|url, _features| {
                    let _ = open::that(url.as_str());
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            #[cfg(not(target_os = "macos"))]
            install_tray(app)?;
            Ok(())
        })
        .on_window_event(on_window_event)
        .build(tauri::generate_context!())
        .expect("error while running Unfold")
        .run(on_run_event);
}

fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    #[cfg(target_os = "macos")]
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (window, event);
}

fn on_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Reopen {
        has_visible_windows,
        ..
    } = event
    {
        if !has_visible_windows {
            show_main(app);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
}

fn show_main(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn document_allowed(config: &tauri::Config, url: &url::Url) -> bool {
    let mut allowed: Vec<&url::Url> = Vec::new();
    if let Some(dist) = config.build.frontend_dist.as_ref() {
        if let tauri::utils::config::FrontendDist::Url(prod) = dist {
            allowed.push(prod);
        }
    }
    // cfg(dev) 由 tauri-build 在未启用 custom-protocol 时设置，与 tauri dev 的 get_app_url 一致。
    // tauri build --debug 有 debug_assertions，但没有 cfg(dev)，窗口加载的是 frontendDist。
    if cfg!(dev) {
        if let Some(dev) = config.build.dev_url.as_ref() {
            allowed.push(dev);
        }
    }
    allowed.iter().any(|base| {
        url.scheme() == base.scheme()
            && url.host() == base.host()
            && url.port_or_known_default() == base.port_or_known_default()
    })
}

/// wry 对子框架同样调用这个回调，且没有 is_main_frame。
/// 不按主机拒绝 http/https，否则子框架导航会被一起取消。
fn navigation_allowed(url: &url::Url) -> bool {
    if url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost") {
        return false;
    }
    url.as_str() == "about:blank"
        || url.scheme() == "about"
        || url.scheme() == "http"
        || url.scheme() == "https"
}

fn app_home(config: &tauri::Config) -> Option<url::Url> {
    if cfg!(dev) {
        if let Some(dev) = config.build.dev_url.clone() {
            return Some(dev);
        }
    }
    match config.build.frontend_dist.as_ref() {
        Some(tauri::utils::config::FrontendDist::Url(prod)) => Some(prod.clone()),
        _ => None,
    }
}

fn reload_main(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let on_app = window
        .url()
        .ok()
        .is_some_and(|url| document_allowed(app.config(), &url));
    if on_app {
        let _ = window.reload();
        return;
    }
    if let Some(home) = app_home(app.config()) {
        let _ = window.navigate(home);
    }
}

fn build_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};

    let about = AboutMetadata {
        name: Some("Unfold".into()),
        ..Default::default()
    };
    let reload = MenuItem::with_id(app, "reload", "重新加载", true, Some("CmdOrCtrl+R"))?;
    let edit = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("撤销"))?,
            &PredefinedMenuItem::redo(app, Some("重做"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("复制"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "显示",
        true,
        &[
            &reload,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, Some("全屏"))?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "窗口",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("最小化"))?,
            &PredefinedMenuItem::maximize(app, Some("缩放"))?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_items(
            app,
            "Unfold",
            true,
            &[
                &PredefinedMenuItem::about(app, Some("关于 Unfold"), Some(about))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, Some("服务"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, Some("隐藏 Unfold"))?,
                &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
                &PredefinedMenuItem::show_all(app, Some("全部显示"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, Some("退出 Unfold"))?,
            ],
        )?;
        return Menu::with_items(app, &[&app_menu, &edit, &view, &window]);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let file = Submenu::with_items(
            app,
            "文件",
            true,
            &[
                &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
                &PredefinedMenuItem::quit(app, Some("退出"))?,
            ],
        )?;
        let help = Submenu::with_items(
            app,
            "帮助",
            true,
            &[&PredefinedMenuItem::about(
                app,
                Some("关于 Unfold"),
                Some(about),
            )?],
        )?;
        Menu::with_items(app, &[&file, &edit, &view, &window, &help])
    }
}

#[cfg(not(target_os = "macos"))]
fn install_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::image::Image;
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::Manager;

    let show = MenuItem::with_id(app, "show", "打开 Unfold", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    let tray = TrayIconBuilder::with_id("tray")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Unfold")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    app.manage(tray);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::navigation_allowed;

    #[test]
    fn navigation_rejects_tauri_and_allows_the_site() {
        assert!(!navigation_allowed(&"tauri://localhost".parse().unwrap()));
        assert!(!navigation_allowed(
            &"https://tauri.localhost/index.html".parse().unwrap()
        ));
        assert!(navigation_allowed(
            &"https://unfold.aimo.plus/library".parse().unwrap()
        ));
        assert!(navigation_allowed(
            &"http://localhost:5173/c/1".parse().unwrap()
        ));
        assert!(navigation_allowed(&"about:blank".parse().unwrap()));
        assert!(!navigation_allowed(
            &"file:///tmp/index.html".parse().unwrap()
        ));
        assert!(!navigation_allowed(&"javascript:alert(1)".parse().unwrap()));
    }
}
