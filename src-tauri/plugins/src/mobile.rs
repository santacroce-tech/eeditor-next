use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_ios_files);

pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> crate::Result<IosFiles<R>> {
  #[cfg(target_os = "android")]
  let handle = api.register_android_plugin("", "IosFilesPlugin")?;
  #[cfg(target_os = "ios")]
  let handle = api.register_ios_plugin(init_plugin_ios_files)?;
  Ok(IosFiles(handle))
}

/// Access to the ios-files APIs.
pub struct IosFiles<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> IosFiles<R> {
  /// Present the native folder picker. Non-blocking: the blocking bridge call runs on a spawned
  /// thread (so the main thread stays free to present the picker) and `f` gets the folder path.
  pub fn pick_folder<F: FnOnce(Option<String>) + Send + 'static>(&self, f: F) {
    let handle = self.0.clone();
    std::thread::spawn(move || {
      let res = handle.run_mobile_plugin::<FolderResponse>("pickFolder", ());
      f(res.ok().and_then(|r| r.path).filter(|p| !p.is_empty()));
    });
  }

  /// Re-open the folder picked on a previous launch (persisted security-scoped bookmark). Same
  /// non-blocking pattern.
  pub fn restore_folder<F: FnOnce(Option<String>) + Send + 'static>(&self, f: F) {
    let handle = self.0.clone();
    std::thread::spawn(move || {
      let res = handle.run_mobile_plugin::<FolderResponse>("restoreFolder", ());
      f(res.ok().and_then(|r| r.path).filter(|p| !p.is_empty()));
    });
  }
}
