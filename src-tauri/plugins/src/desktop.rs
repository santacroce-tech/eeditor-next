use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

pub fn init<R: Runtime, C: DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> crate::Result<IosFiles<R>> {
  Ok(IosFiles(app.clone()))
}

/// Desktop is a no-op: the app uses the dialog plugin's native folder picker there instead.
pub struct IosFiles<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> IosFiles<R> {
  pub fn pick_folder(&self) -> crate::Result<Option<String>> {
    Ok(None)
  }
  pub fn restore_folder(&self) -> crate::Result<Option<String>> {
    Ok(None)
  }
}
