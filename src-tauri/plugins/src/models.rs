use serde::{Deserialize, Serialize};

/// Response from the native folder picker / bookmark restore: the selected folder's path, or `None`.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderResponse {
    pub path: Option<String>,
}
