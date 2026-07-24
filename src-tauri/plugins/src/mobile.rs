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
  /// Present the native folder picker; blocks until the user picks or cancels. Returns the folder's
  /// path (security-scoped access is held by the native plugin for the session), or `None`.
  pub fn pick_folder(&self) -> crate::Result<Option<String>> {
    let resp: FolderResponse = self.0.run_mobile_plugin("pickFolder", ())?;
    Ok(resp.path.filter(|p| !p.is_empty()))
  }

  /// Re-open the folder picked on a previous launch (via a persisted security-scoped bookmark).
  pub fn restore_folder(&self) -> crate::Result<Option<String>> {
    let resp: FolderResponse = self.0.run_mobile_plugin("restoreFolder", ())?;
    Ok(resp.path.filter(|p| !p.is_empty()))
  }
}
