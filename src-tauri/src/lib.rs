mod history;
mod scanner;
mod usage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      scanner::scan_skills,
      scanner::trash_skill,
      scanner::disable_skill,
      scanner::enable_skill,
      scanner::backup_config,
      scanner::restore_config,
      usage::scan_usage,
      history::list_projects,
      history::list_sessions,
      history::read_session,
      history::search_history
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
