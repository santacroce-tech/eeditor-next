import SwiftRs
import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

// Lets the user point EEditor at an external folder (Files / Downloads / iCloud) via the iOS
// document picker, and keeps access alive across launches with a security-scoped bookmark.
// Once access is active, the folder is reachable through normal file APIs (so the Rust fs layer
// can read/write the notes in it).
class IosFilesPlugin: Plugin, UIDocumentPickerDelegate {
  static let bookmarkKey = "eeditor.workspace.bookmark"
  private var pendingInvoke: Invoke?
  private var activeScopedURL: URL?

  // MARK: pick a folder

  @objc public func pickFolder(_ invoke: Invoke) throws {
    self.pendingInvoke = invoke
    DispatchQueue.main.async {
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder], asCopy: false)
      picker.delegate = self
      picker.allowsMultipleSelection = false
      if let vc = self.topViewController() {
        vc.present(picker, animated: true)
      } else {
        invoke.reject("no view controller to present the folder picker")
        self.pendingInvoke = nil
      }
    }
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let url = urls.first else {
      self.pendingInvoke?.resolve([:])
      self.pendingInvoke = nil
      return
    }
    let accessing = url.startAccessingSecurityScopedResource()
    // persist a bookmark so we can re-open this folder on the next launch
    do {
      let bookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
      UserDefaults.standard.set(bookmark, forKey: IosFilesPlugin.bookmarkKey)
    } catch {
      // non-fatal: the folder still works for this session
    }
    if let prev = self.activeScopedURL, prev != url {
      prev.stopAccessingSecurityScopedResource()
    }
    self.activeScopedURL = accessing ? url : nil
    self.pendingInvoke?.resolve(["path": url.path])
    self.pendingInvoke = nil
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    self.pendingInvoke?.resolve([:])
    self.pendingInvoke = nil
  }

  // MARK: restore the previously-picked folder (called on startup)

  @objc public func restoreFolder(_ invoke: Invoke) throws {
    guard let bookmark = UserDefaults.standard.data(forKey: IosFilesPlugin.bookmarkKey) else {
      invoke.resolve([:])
      return
    }
    var stale = false
    do {
      let url = try URL(
        resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
      let accessing = url.startAccessingSecurityScopedResource()
      if accessing {
        self.activeScopedURL = url
        invoke.resolve(["path": url.path])
      } else {
        invoke.resolve([:])
      }
    } catch {
      invoke.resolve([:])
    }
  }

  // MARK: helpers

  private func topViewController() -> UIViewController? {
    for scene in UIApplication.shared.connectedScenes {
      guard let windowScene = scene as? UIWindowScene else { continue }
      for window in windowScene.windows where window.isKeyWindow {
        var vc = window.rootViewController
        while let presented = vc?.presentedViewController { vc = presented }
        return vc
      }
    }
    return nil
  }
}

@_cdecl("init_plugin_ios_files")
func initPlugin() -> Plugin {
  return IosFilesPlugin()
}
