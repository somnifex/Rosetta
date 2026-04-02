use tauri::{Manager, Theme, WebviewWindow};

const THEME_SETTING_KEY: &str = "general.theme";

pub fn sync_main_window_theme(
    app: &tauri::AppHandle,
    settings: &crate::settings::SettingsManager,
) {
    let theme = settings.get_with_default(THEME_SETTING_KEY, "system");

    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = apply_window_theme(&window, &theme) {
            log::warn!("Failed to sync main window theme: {}", error);
        }
    }
}

#[tauri::command]
pub fn sync_window_theme(window: WebviewWindow, theme: String) -> Result<(), String> {
    apply_window_theme(&window, &theme)
}

fn apply_window_theme(window: &WebviewWindow, theme: &str) -> Result<(), String> {
    let preferred_theme = match theme {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        "system" | "" => None,
        _ => None,
    };

    window
        .set_theme(preferred_theme)
        .map_err(|error| error.to_string())?;

    let resolved_theme = preferred_theme.unwrap_or_else(|| window.theme().unwrap_or(Theme::Light));
    apply_windows_titlebar_colors(window, resolved_theme);

    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_windows_titlebar_colors(window: &WebviewWindow, theme: Theme) {
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
        DWMWA_USE_IMMERSIVE_DARK_MODE,
    };

    let Ok(hwnd) = window.hwnd() else {
        log::warn!("Failed to resolve native window handle for title bar sync.");
        return;
    };

    let is_dark = matches!(theme, Theme::Dark);
    let immersive_dark_mode: u32 = u32::from(is_dark);
    let caption_color = if is_dark {
        colorref(0x10, 0x11, 0x14)
    } else {
        colorref(0xff, 0xff, 0xff)
    };
    let border_color = caption_color;
    let text_color = if is_dark {
        colorref(0xe7, 0xe9, 0xef)
    } else {
        colorref(0x17, 0x17, 0x17)
    };

    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &immersive_dark_mode as *const _ as _,
            std::mem::size_of_val(&immersive_dark_mode) as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_COLOR,
            &caption_color as *const _ as _,
            std::mem::size_of_val(&caption_color) as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &border_color as *const _ as _,
            std::mem::size_of_val(&border_color) as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_TEXT_COLOR,
            &text_color as *const _ as _,
            std::mem::size_of_val(&text_color) as u32,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_windows_titlebar_colors(_window: &WebviewWindow, _theme: Theme) {}

#[cfg(target_os = "windows")]
const fn colorref(red: u8, green: u8, blue: u8) -> u32 {
    (red as u32) | ((green as u32) << 8) | ((blue as u32) << 16)
}
