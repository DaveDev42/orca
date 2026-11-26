import ExpoModulesCore
import UIKit

public class OrcaThisDeviceSpikeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OrcaThisDeviceSpike")

    Events("onTunnelChunk")

    OnCreate {
      SpikeProxy.shared.onChunk = { [weak self] connection, direction, seq, data in
        self?.sendEvent(
          "onTunnelChunk",
          ["conn": connection, "dir": direction, "seq": seq, "b64": data.base64EncodedString()])
      }
    }

    Function("environment") { () -> [String: Any] in
      let version = ProcessInfo.processInfo.operatingSystemVersion
      return [
        "systemVersion": UIDevice.current.systemVersion,
        "major": version.majorVersion,
        "model": UIDevice.current.model,
        "proxyConfigurationsAvailable": version.majorVersion >= 17
      ]
    }

    /// Starts the proxy and the local server (both idempotent) and reports their ports.
    AsyncFunction("start") { () -> [String: Any] in
      let proxyPort = try SpikeProxy.shared.start()
      let localPort = try SpikeLocalServer.shared.start()
      return ["proxyPort": Int(proxyPort), "localPort": Int(localPort)]
    }

    Function("setPages") { (pages: [String: String]) in
      SpikeLocalServer.shared.setPages(pages)
    }

    Function("setEgressMode") { (mode: String) in
      SpikeProxy.shared.setEgressViaJS(mode == "js")
    }

    Function("proxyEntryCount") { () -> Int in
      SpikeProxy.shared.entryCount()
    }

    Function("proxyEntries") { (since: Int) -> [[String: Any]] in
      SpikeProxy.shared.entries(since: since)
    }

    Function("jsChunkCount") { () -> Int in
      SpikeProxy.shared.chunkCount()
    }

    /// Synchronous so a chunk's way back costs one JSI call, like a tunnel client handing bytes to the socket.
    Function("tunnelReply") { (connection: Int, direction: Int, seq: Int, data: Data) in
      SpikeProxy.shared.deliver(connection: connection, direction: direction, seq: seq, data: data)
    }

    Function("log") { (line: String) in
      SpikeLog.write(line)
    }

    AsyncFunction("clearWebsiteData") { (promise: Promise) in
      if #available(iOS 17.0, *) {
        SpikeStores.clearAll { promise.resolve() }
      } else {
        promise.resolve()
      }
    }

    View(OrcaSpikeWebView.self) {
      Events("onSpikeEvent")

      Prop("useProxy") { (view: OrcaSpikeWebView, value: Bool) in view.useProxy = value }
      Prop("applyCredential") { (view: OrcaSpikeWebView, value: Bool) in view.applyCredential = value }
      Prop("blockWebRTC") { (view: OrcaSpikeWebView, value: Bool) in view.blockWebRTC = value }
      Prop("acceptBadCerts") { (view: OrcaSpikeWebView, value: Bool) in view.acceptBadCerts = value }

      AsyncFunction("loadUrl") { (view: OrcaSpikeWebView, url: String) in
        view.loadUrl(url)
      }.runOnQueue(.main)

      AsyncFunction("loadHtml") { (view: OrcaSpikeWebView, html: String, baseUrl: String) in
        view.loadHtml(html, baseUrl: baseUrl)
      }.runOnQueue(.main)

      OnViewDidUpdateProps { (view: OrcaSpikeWebView) in
        view.propsDidUpdate()
      }
    }
  }
}
