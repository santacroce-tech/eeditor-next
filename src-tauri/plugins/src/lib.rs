use tauri::{
  plugin::{Builder, TauriPlugin},
  Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::IosFiles;
#[cfg(mobile)]
use mobile::IosFiles;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the ios-files APIs.
pub trait IosFilesExt<R: Runtime> {
  fn ios_files(&self) -> &IosFiles<R>;
}

impl<R: Runtime, T: Manager<R>> crate::IosFilesExt<R> for T {
  fn ios_files(&self) -> &IosFiles<R> {
    self.state::<IosFiles<R>>().inner()
  }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("ios-files")
    .setup(|app, api| {
      #[cfg(mobile)]
      let ios_files = mobile::init(app, api)?;
      #[cfg(desktop)]
      let ios_files = desktop::init(app, api)?;
      app.manage(ios_files);
      Ok(())
    })
    .build()
}
