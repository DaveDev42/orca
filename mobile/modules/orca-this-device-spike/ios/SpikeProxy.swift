import Foundation
import Network
import Security

/// In-app loopback HTTP CONNECT proxy. Every request needs the per-launch Basic credential (407 otherwise).
/// Egress is Network.framework direct. In "js" mode each chunk also takes a round trip through the JS thread
/// (an event out, a `tunnelReply` back) before it is written, to price what a real tunnel client would cost.
final class SpikeProxy {
  static let shared = SpikeProxy()

  /// Everything below is touched on this queue only.
  let queue = DispatchQueue(label: "orca.spike.proxy")
  let username: String
  let password: String
  private(set) var port: UInt16 = 0
  private var listener: NWListener?
  private var connections: [Int: SpikeProxyConnection] = [:]
  private var nextConnectionId = 1
  private var entries: [[String: Any]] = []
  private let startedAt = Date()

  /// Read per chunk, so flipping it also affects tunnels that are already open.
  private var egressViaJSValue = false
  var egressViaJS: Bool { egressViaJSValue }
  /// (connection, direction, sequence, bytes). Direction 0 = client to upstream, 1 = upstream to client.
  var onChunk: ((Int, Int, Int, Data) -> Void)?
  private(set) var jsChunkCount = 0

  private init() {
    username = SpikeProxy.randomToken()
    password = SpikeProxy.randomToken()
  }

  private static func randomToken() -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    // Fail closed: never fall back to a predictable (all-zero) credential.
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      fatalError("SecRandomCopyBytes failed; refusing to start the spike proxy")
    }
    return Data(bytes).base64EncodedString()
      .replacingOccurrences(of: "+", with: "A")
      .replacingOccurrences(of: "/", with: "B")
      .replacingOccurrences(of: "=", with: "")
  }

  /// Compares without returning early on the first differing byte.
  func authorizationMatches(_ candidate: String?) -> Bool {
    guard let candidate else { return false }
    let a = Array(candidate.utf8)
    let b = Array(expectedAuthorization.utf8)
    var diff = UInt8(truncatingIfNeeded: a.count ^ b.count)
    for index in 0..<max(a.count, b.count) {
      diff |= (index < a.count ? a[index] : 0) ^ (index < b.count ? b[index] : 0)
    }
    return diff == 0
  }

  var expectedAuthorization: String {
    "Basic " + Data("\(username):\(password)".utf8).base64EncodedString()
  }

  /// Idempotent. Called off the main queue (it waits for the listener to be ready).
  func start() throws -> UInt16 {
    if let listener, case .ready = listener.state, port != 0 { return port }
    let (newListener, newPort) = try SpikeLoopbackListener.start(
      queue: queue, label: "proxy"
    ) { [weak self] connection in
      self?.accept(connection)
    }
    queue.sync {
      listener = newListener
      port = newPort
    }
    return newPort
  }

  func setEgressViaJS(_ value: Bool) {
    queue.async {
      self.egressViaJSValue = value
      SpikeLog.write("egress mode \(value ? "js" : "native")")
    }
  }

  private func accept(_ connection: NWConnection) {
    let id = nextConnectionId
    nextConnectionId += 1
    let proxyConnection = SpikeProxyConnection(id: id, client: connection, proxy: self)
    connections[id] = proxyConnection
    proxyConnection.start()
  }

  func forget(_ id: Int) {
    connections.removeValue(forKey: id)
  }

  func record(kind: String, target: String, auth: String, extra: String = "") {
    let index = entries.count
    let millis = Int(Date().timeIntervalSince(startedAt) * 1000)
    let entry: [String: Any] = [
      "i": index, "t": millis, "kind": kind, "target": target, "auth": auth, "extra": extra
    ]
    entries.append(entry)
    SpikeLog.write("proxy \(kind) \(target) auth=\(auth) \(extra)")
  }

  func entryCount() -> Int {
    queue.sync { entries.count }
  }

  func entries(since index: Int) -> [[String: Any]] {
    queue.sync { index >= entries.count ? [] : Array(entries[max(0, index)...]) }
  }

  func chunkCount() -> Int {
    queue.sync { jsChunkCount }
  }

  func noteJSChunk() {
    jsChunkCount += 1
  }

  /// Called from the JS thread; hops onto the proxy queue.
  func deliver(connection id: Int, direction: Int, seq: Int, data: Data) {
    queue.async {
      self.connections[id]?.deliver(direction: direction, seq: seq, data: data)
    }
  }
}

/// One accepted client connection: parse the first request, authenticate it, then tunnel or forward.
final class SpikeProxyConnection {
  let id: Int
  private let client: NWConnection
  private unowned let proxy: SpikeProxy
  private var upstream: NWConnection?
  private var buffer = Data()
  private var authFailures = 0
  private var closed = false
  private var target = ""
  private var up: SpikePipe?
  private var down: SpikePipe?
  private var finishedPipes = 0

  init(id: Int, client: NWConnection, proxy: SpikeProxy) {
    self.id = id
    self.client = client
    self.proxy = proxy
  }

  func start() {
    client.stateUpdateHandler = { [weak self] state in
      switch state {
      case .failed, .cancelled:
        self?.close()
      default:
        break
      }
    }
    client.start(queue: proxy.queue)
    readHead()
  }

  private func readHead() {
    client.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, isComplete, error in
      guard let self, !self.closed else { return }
      if let data { self.buffer.append(data) }
      if let range = self.buffer.range(of: Data("\r\n\r\n".utf8)) {
        let head = self.buffer.subdata(in: 0..<range.lowerBound)
        self.buffer = self.buffer.subdata(in: range.upperBound..<self.buffer.count)
        self.handleHead(head)
      } else if error != nil || isComplete || self.buffer.count > 65536 {
        self.close()
      } else {
        self.readHead()
      }
    }
  }

  private func handleHead(_ head: Data) {
    let text = String(decoding: head, as: UTF8.self)
    var lines = text.components(separatedBy: "\r\n")
    let requestLine = lines.removeFirst()
    let parts = requestLine.split(separator: " ", maxSplits: 2).map(String.init)
    guard parts.count == 3 else {
      reply("400 Bad Request")
      close()
      return
    }
    let method = parts[0].uppercased()
    let uri = parts[1]
    var headers: [(String, String)] = []
    for line in lines {
      guard let colon = line.firstIndex(of: ":") else { continue }
      let name = String(line[..<colon]).trimmingCharacters(in: .whitespaces)
      let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
      headers.append((name, value))
    }
    let authorization = headers.first { $0.0.lowercased() == "proxy-authorization" }?.1
    let label = method == "CONNECT" ? uri : (URL(string: uri).flatMap(Self.hostPort) ?? uri)

    guard proxy.authorizationMatches(authorization) else {
      authFailures += 1
      let state = authorization == nil ? "none" : "bad"
      proxy.record(kind: "407", target: label, auth: state, extra: "attempt=\(authFailures) conn=\(id)")
      if authFailures >= 3 {
        reply("407 Proxy Authentication Required", extra: "Proxy-Authenticate: Basic realm=\"orca-spike\"\r\nConnection: close\r\n")
        close()
      } else {
        reply("407 Proxy Authentication Required", extra: "Proxy-Authenticate: Basic realm=\"orca-spike\"\r\n") { [weak self] in
          self?.readHead()
        }
      }
      return
    }

    let mode = proxy.egressViaJS ? "js" : "native"
    if method == "CONNECT" {
      guard let (host, port) = Self.splitHostPort(uri, defaultPort: 443) else {
        reply("400 Bad Request")
        close()
        return
      }
      target = "\(host):\(port)"
      proxy.record(kind: "CONNECT", target: target, auth: "ok", extra: "mode=\(mode) conn=\(id)")
      connectUpstream(host: host, port: port) { [weak self] in
        self?.reply("200 Connection Established", extra: "") {
          self?.beginPipes(initial: self?.buffer ?? Data())
          self?.buffer = Data()
        }
      }
    } else if let url = URL(string: uri), let host = url.host, url.scheme == "http" {
      let port = url.port ?? 80
      target = "\(host):\(port)"
      proxy.record(kind: "FORWARD", target: target, auth: "ok", extra: "mode=\(mode) method=\(method) conn=\(id)")
      var path = url.path.isEmpty ? "/" : url.path
      if let query = url.query { path += "?" + query }
      var out = "\(method) \(path) HTTP/1.1\r\n"
      for (name, value) in headers where !name.lowercased().hasPrefix("proxy-") && name.lowercased() != "connection" {
        out += "\(name): \(value)\r\n"
      }
      out += "Connection: close\r\n\r\n"
      var initial = Data(out.utf8)
      initial.append(buffer)
      buffer = Data()
      connectUpstream(host: host, port: UInt16(port)) { [weak self] in
        self?.beginPipes(initial: initial)
      }
    } else {
      proxy.record(kind: "REJECT", target: label, auth: "ok", extra: "method=\(method)")
      reply("400 Bad Request")
      close()
    }
  }

  private static func hostPort(_ url: URL) -> String? {
    guard let host = url.host else { return nil }
    return "\(host):\(url.port ?? (url.scheme == "https" ? 443 : 80))"
  }

  private static func splitHostPort(_ value: String, defaultPort: Int) -> (String, UInt16)? {
    var host = value
    var port = defaultPort
    if value.hasPrefix("["), let end = value.firstIndex(of: "]") {
      host = String(value[value.index(after: value.startIndex)..<end])
      let rest = value[value.index(after: end)...]
      if rest.hasPrefix(":"), let parsed = Int(rest.dropFirst()) { port = parsed }
    } else if let colon = value.lastIndex(of: ":") {
      host = String(value[..<colon])
      guard let parsed = Int(value[value.index(after: colon)...]) else { return nil }
      port = parsed
    }
    guard !host.isEmpty, port > 0, port < 65536 else { return nil }
    return (host, UInt16(port))
  }

  private func reply(_ status: String, extra: String = "", then: (() -> Void)? = nil) {
    let text = "HTTP/1.1 \(status)\r\n\(extra.contains("Content-Length") || status.hasPrefix("200") ? "" : "Content-Length: 0\r\n")\(extra)\r\n"
    client.send(content: Data(text.utf8), completion: .contentProcessed { [weak self] error in
      if error != nil { self?.close(); return }
      then?()
    })
  }

  private func connectUpstream(host: String, port: UInt16, ready: @escaping () -> Void) {
    guard let nwPort = NWEndpoint.Port(rawValue: port) else {
      reply("400 Bad Request")
      close()
      return
    }
    let connection = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: .tcp)
    upstream = connection
    var signalled = false
    connection.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      switch state {
      case .ready:
        if !signalled {
          signalled = true
          ready()
        }
      case .failed(let error):
        if !signalled {
          signalled = true
          self.proxy.record(kind: "UPSTREAM_FAIL", target: self.target, auth: "ok", extra: "\(error)")
          self.reply("502 Bad Gateway")
        }
        self.close()
      case .cancelled:
        self.close()
      default:
        break
      }
    }
    connection.start(queue: proxy.queue)
  }

  private func beginPipes(initial: Data) {
    guard let upstream, !closed else { return }
    let up = SpikePipe(owner: self, proxy: proxy, source: client, destination: upstream, direction: 0)
    let down = SpikePipe(owner: self, proxy: proxy, source: upstream, destination: client, direction: 1)
    self.up = up
    self.down = down
    if !initial.isEmpty { up.inject(initial) }
    up.pump()
    down.pump()
  }

  func deliver(direction: Int, seq: Int, data: Data) {
    (direction == 0 ? up : down)?.deliver(seq: seq, data: data)
  }

  func pipeFinished() {
    finishedPipes += 1
    if finishedPipes >= 2 { close() }
  }

  func close() {
    if closed { return }
    closed = true
    if target != "" {
      proxy.record(
        kind: "CLOSE", target: target, auth: "ok",
        extra: "conn=\(id) up=\(up?.bytes ?? 0) down=\(down?.bytes ?? 0)")
    }
    client.cancel()
    upstream?.cancel()
    up = nil
    down = nil
    proxy.forget(id)
  }
}

/// One direction of a tunnel. Up to `window` chunks are in flight; the writes keep receive order.
final class SpikePipe {
  private weak var owner: SpikeProxyConnection?
  private unowned let proxy: SpikeProxy
  private let source: NWConnection
  private let destination: NWConnection
  private let direction: Int
  private let window = 8
  private var nextSeq = 0
  private var nextDeliver = 0
  private var pending: [Int: Data] = [:]
  private var inflight = 0
  private var receiving = false
  private var sourceDone = false
  private var finished = false
  private(set) var bytes = 0

  init(owner: SpikeProxyConnection, proxy: SpikeProxy, source: NWConnection, destination: NWConnection, direction: Int) {
    self.owner = owner
    self.proxy = proxy
    self.source = source
    self.destination = destination
    self.direction = direction
  }

  /// Bytes that arrived with the request head, before the first receive.
  func inject(_ data: Data) {
    route(data)
  }

  func pump() {
    guard !receiving, !sourceDone, inflight < window else { return }
    receiving = true
    source.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
      guard let self else { return }
      self.receiving = false
      if let data, !data.isEmpty { self.route(data) }
      if error != nil {
        self.owner?.close()
        return
      }
      if isComplete {
        self.sourceDone = true
        self.finishIfDrained()
      } else {
        self.pump()
      }
    }
  }

  private func route(_ data: Data) {
    let seq = nextSeq
    nextSeq += 1
    inflight += 1
    bytes += data.count
    if proxy.egressViaJS, let hop = proxy.onChunk, let owner {
      proxy.noteJSChunk()
      hop(owner.id, direction, seq, data)
    } else {
      deliver(seq: seq, data: data)
    }
  }

  func deliver(seq: Int, data: Data) {
    pending[seq] = data
    while let next = pending.removeValue(forKey: nextDeliver) {
      nextDeliver += 1
      destination.send(content: next, completion: .contentProcessed { [weak self] error in
        guard let self else { return }
        self.inflight -= 1
        if error != nil {
          self.owner?.close()
          return
        }
        self.pump()
        self.finishIfDrained()
      })
    }
  }

  private func finishIfDrained() {
    guard sourceDone, inflight == 0, !finished else { return }
    finished = true
    destination.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .idempotent)
    owner?.pipeFinished()
  }
}
