import ExpoModulesCore
import Network
import UIKit
import WebKit

/// Data stores for the spike: one per proxy configuration, created once per process.
/// Proxy settings are applied before the store's first use and never changed afterwards.
enum SpikeStores {
  private static var stores: [String: AnyObject] = [:]

  @available(iOS 17.0, *)
  static func store(useProxy: Bool, applyCredential: Bool, nonce: Int) -> WKWebsiteDataStore {
    let key = (useProxy ? (applyCredential ? "proxy-cred" : "proxy") : "direct") + "-\(nonce)"
    if let existing = stores[key] as? WKWebsiteDataStore { return existing }
    // nonce 0 keeps the original identifiers; a non-zero nonce is a brand-new store (cold network session).
    let suffix = useProxy ? (applyCredential ? "03" : "02") : "01"
    let tail = nonce == 0 ? "0000000000\(suffix)" : String(format: "%012lX", (nonce << 8) | Int(suffix)!)
    let group = nonce == 0 ? "8000" : "8001"
    let store = WKWebsiteDataStore(forIdentifier: UUID(uuidString: "A5B1E5E0-0000-4000-\(group)-\(tail)")!)
    if useProxy {
      let port = (try? SpikeProxy.shared.start()) ?? 0
      if let nwPort = NWEndpoint.Port(rawValue: port), port != 0 {
        let configuration = ProxyConfiguration(
          httpCONNECTProxy: NWEndpoint.hostPort(host: "127.0.0.1", port: nwPort), tlsOptions: nil)
        if applyCredential {
          configuration.applyCredential(
            username: SpikeProxy.shared.username, password: SpikeProxy.shared.password)
        }
        store.proxyConfigurations = [configuration]
        SpikeLog.write("store \(key) proxyConfigurations=\(store.proxyConfigurations.count) port=\(port)")
      } else {
        SpikeLog.write("store \(key) has NO proxy: listener not ready")
      }
    }
    stores[key] = store
    return store
  }

  @available(iOS 17.0, *)
  static func clearAll(_ done: @escaping () -> Void) {
    let all = stores.values.compactMap { $0 as? WKWebsiteDataStore }
    guard !all.isEmpty else { return done() }
    let group = DispatchGroup()
    for store in all {
      group.enter()
      store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {
        group.leave()
      }
    }
    group.notify(queue: .main, execute: done)
  }
}

private let blockWebRTCSource = """
(function () {
  var names = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription', 'RTCIceCandidate'];
  names.forEach(function (name) {
    try { delete window[name]; } catch (e) {}
    try { Object.defineProperty(window, name, { value: undefined, configurable: true, writable: true }); } catch (e) {}
  });
})();
"""

private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
  weak var target: OrcaSpikeWebView?
  init(_ target: OrcaSpikeWebView) { self.target = target }
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    target?.pageMessage(message.body)
  }
}

/// The WKWebView the spike exercises. Props are read on the first commit; the screen remounts it to change them.
final class OrcaSpikeWebView: ExpoView, WKNavigationDelegate, WKDownloadDelegate {
  let onSpikeEvent = EventDispatcher()

  var useProxy = true
  var applyCredential = false
  var blockWebRTC = false
  var storeNonce = 0
  var acceptBadCerts = false
  private var webView: WKWebView?

  func propsDidUpdate() {
    guard webView == nil else { return }
    let configuration = WKWebViewConfiguration()
    configuration.allowsInlineMediaPlayback = true
    configuration.mediaTypesRequiringUserActionForPlayback = []
    var storeNote = "default store (iOS < 17)"
    if #available(iOS 17.0, *) {
      configuration.websiteDataStore = SpikeStores.store(useProxy: useProxy, applyCredential: applyCredential, nonce: storeNonce)
      storeNote = "forIdentifier store, \(configuration.websiteDataStore.proxyConfigurations.count) proxyConfigurations"
    }
    let controller = WKUserContentController()
    controller.add(WeakScriptHandler(self), name: "spike")
    if blockWebRTC {
      controller.addUserScript(
        WKUserScript(source: blockWebRTCSource, injectionTime: .atDocumentStart, forMainFrameOnly: false))
    }
    configuration.userContentController = controller
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.navigationDelegate = self
    if #available(iOS 16.4, *) { view.isInspectable = true }
    view.translatesAutoresizingMaskIntoConstraints = false
    addSubview(view)
    NSLayoutConstraint.activate([
      view.topAnchor.constraint(equalTo: topAnchor),
      view.bottomAnchor.constraint(equalTo: bottomAnchor),
      view.leadingAnchor.constraint(equalTo: leadingAnchor),
      view.trailingAnchor.constraint(equalTo: trailingAnchor)
    ])
    webView = view
    emit(["kind": "ready", "store": storeNote, "useProxy": useProxy, "applyCredential": applyCredential, "blockWebRTC": blockWebRTC])
  }

  deinit {
    webView?.stopLoading()
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: "spike")
  }

  private func emit(_ payload: [String: Any]) {
    SpikeLog.write("event \(payload)")
    onSpikeEvent(payload)
  }

  /// Navigation ids let the JS side ignore finish/fail events from an earlier navigation.
  private var nextNavId = 1
  private var navIds: [(WKNavigation, Int)] = []

  private func navId(for navigation: WKNavigation?) -> Int? {
    guard let navigation else { return nil }
    return navIds.first { $0.0 === navigation }?.1
  }

  func loadUrl(_ value: String) -> Int {
    let id = nextNavId
    nextNavId += 1
    guard let url = URL(string: value) else {
      emit(["kind": "nav", "phase": "fail", "url": value, "error": "bad url", "code": 0, "navId": id])
      return id
    }
    if let navigation = webView?.load(
      URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 30))
    {
      navIds.append((navigation, id))
      if navIds.count > 16 { navIds.removeFirst(navIds.count - 16) }
    }
    return id
  }

  func loadHtml(_ html: String, baseUrl: String) {
    webView?.loadHTMLString(html, baseURL: URL(string: baseUrl))
  }

  func pageMessage(_ body: Any) {
    let json: String
    if let string = body as? String {
      json = string
    } else if JSONSerialization.isValidJSONObject(body), let data = try? JSONSerialization.data(withJSONObject: body) {
      json = String(decoding: data, as: UTF8.self)
    } else {
      json = "\(body)"
    }
    emit(["kind": "page", "json": json])
  }

  private func navPayload(
    _ phase: String, _ webView: WKWebView, navigation: WKNavigation? = nil, error: Error? = nil
  ) -> [String: Any] {
    var payload: [String: Any] = ["kind": "nav", "phase": phase, "url": webView.url?.absoluteString ?? ""]
    if let id = navId(for: navigation) { payload["navId"] = id }
    if let error = error as NSError? {
      payload["error"] = error.localizedDescription
      payload["code"] = error.code
      payload["domain"] = error.domain
    }
    return payload
  }

  // MARK: WKNavigationDelegate

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    emit(navPayload("start", webView, navigation: navigation))
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    emit(navPayload("finish", webView, navigation: navigation))
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    emit(navPayload("fail", webView, navigation: navigation, error: error))
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    emit(navPayload("fail", webView, navigation: navigation, error: error))
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    emit(["kind": "nav", "phase": "terminated", "url": webView.url?.absoluteString ?? ""])
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    let disposition = (navigationResponse.response as? HTTPURLResponse)?
      .value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
    if !navigationResponse.canShowMIMEType || disposition.hasPrefix("attachment") {
      decisionHandler(.download)
    } else {
      decisionHandler(.allow)
    }
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
    emit(["kind": "download", "phase": "start", "url": navigationResponse.response.url?.absoluteString ?? ""])
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(
    _ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    let space = challenge.protectionSpace
    let method = space.authenticationMethod
    let proxyPort = Int(SpikeProxy.shared.port)
    let isProxy = space.isProxy() || (space.host == "127.0.0.1" && space.port == proxyPort)
    var payload: [String: Any] = [
      "kind": "challenge", "method": method, "host": "\(space.host):\(space.port)", "isProxy": isProxy,
      "previousFailures": challenge.previousFailureCount
    ]
    if isProxy,
      method == NSURLAuthenticationMethodHTTPBasic || method == NSURLAuthenticationMethodDefault {
      if challenge.previousFailureCount >= 2 {
        payload["answer"] = "cancel"
        emit(payload)
        completionHandler(.cancelAuthenticationChallenge, nil)
        return
      }
      payload["answer"] = "credential"
      emit(payload)
      completionHandler(
        .useCredential,
        URLCredential(user: SpikeProxy.shared.username, password: SpikeProxy.shared.password, persistence: .forSession))
    } else if method == NSURLAuthenticationMethodServerTrust, acceptBadCerts, let trust = space.serverTrust {
      payload["answer"] = "accept-trust"
      emit(payload)
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      payload["answer"] = "default"
      emit(payload)
      completionHandler(.performDefaultHandling, nil)
    }
  }

  // MARK: WKDownloadDelegate

  func download(
    _ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
    completionHandler: @escaping (URL?) -> Void
  ) {
    let destination = FileManager.default.temporaryDirectory.appendingPathComponent("spike-dl-\(UUID().uuidString)")
    downloadDestinations[ObjectIdentifier(download)] = destination
    completionHandler(destination)
  }

  private var downloadDestinations: [ObjectIdentifier: URL] = [:]

  func downloadDidFinish(_ download: WKDownload) {
    let key = ObjectIdentifier(download)
    var size = 0
    if let url = downloadDestinations[key] {
      size = ((try? FileManager.default.attributesOfItem(atPath: url.path)[.size]) as? NSNumber)?.intValue ?? 0
      try? FileManager.default.removeItem(at: url)
    }
    downloadDestinations.removeValue(forKey: key)
    emit(["kind": "download", "phase": "finish", "bytes": size])
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
    emit(["kind": "download", "phase": "fail", "error": error.localizedDescription])
  }
}
