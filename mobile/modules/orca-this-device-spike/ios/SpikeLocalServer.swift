import Foundation
import Network

/// A tiny HTTP server on its own loopback port: the pages the spike loads from http://localhost:<port>/
/// and a few byte-count endpoints. Whether a request got here through the proxy is answered by the proxy log,
/// not by this server (the proxy itself connects from 127.0.0.1 too).
final class SpikeLocalServer {
  static let shared = SpikeLocalServer()

  private let queue = DispatchQueue(label: "orca.spike.local")
  private var listener: NWListener?
  private(set) var port: UInt16 = 0
  private var pages: [String: String] = [:]
  private var hits = 0
  private var holders: [ObjectIdentifier: NWConnection] = [:]
  private let chunk = Data((0..<65536).map { UInt8(truncatingIfNeeded: $0 &* 31 &+ 7) })

  func start() throws -> UInt16 {
    if let listener, listener.state == .ready, port != 0 { return port }
    let (newListener, newPort) = try SpikeLoopbackListener.start(queue: queue, label: "local") { [weak self] connection in
      self?.accept(connection)
    }
    queue.sync {
      listener = newListener
      port = newPort
    }
    return newPort
  }

  func setPages(_ next: [String: String]) {
    queue.async { self.pages = next }
  }

  func hitCount() -> Int {
    queue.sync { hits }
  }

  private func accept(_ connection: NWConnection) {
    let key = ObjectIdentifier(connection)
    holders[key] = connection
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .failed, .cancelled:
        self?.holders.removeValue(forKey: key)
      default:
        break
      }
    }
    connection.start(queue: queue)
    read(connection, buffer: Data())
  }

  private func read(_ connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, isComplete, error in
      guard let self else { return }
      var buffer = buffer
      if let data { buffer.append(data) }
      if let range = buffer.range(of: Data("\r\n\r\n".utf8)) {
        self.respond(connection, head: String(decoding: buffer[..<range.lowerBound], as: UTF8.self))
      } else if error != nil || isComplete || buffer.count > 65536 {
        connection.cancel()
      } else {
        self.read(connection, buffer: buffer)
      }
    }
  }

  private func respond(_ connection: NWConnection, head: String) {
    let lines = head.components(separatedBy: "\r\n")
    let parts = lines[0].split(separator: " ").map(String.init)
    let hostHeader = lines.dropFirst().first { $0.lowercased().hasPrefix("host:") } ?? "host: ?"
    guard parts.count >= 2 else {
      connection.cancel()
      return
    }
    hits += 1
    let target = parts[1]
    let components = URLComponents(string: "http://x" + target)
    let path = components?.path ?? "/"
    let query = components?.queryItems ?? []
    func intQuery(_ name: String, _ fallback: Int) -> Int {
      query.first { $0.name == name }?.value.flatMap(Int.init) ?? fallback
    }
    SpikeLog.write("local \(parts[0]) \(target) \(hostHeader)")

    if path == "/bytes" || path == "/download" {
      let count = max(0, min(intQuery("n", 1_000_000), 200_000_000))
      var header = "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: \(count)\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n"
      if path == "/download" { header += "Content-Disposition: attachment; filename=\"spike.bin\"\r\n" }
      header += "\r\n"
      connection.send(content: Data(header.utf8), completion: .contentProcessed { [weak self] error in
        if error != nil { connection.cancel(); return }
        self?.stream(connection, remaining: count)
      })
      return
    }
    if path == "/ping" {
      send(connection, body: "pong", type: "text/plain")
      return
    }
    if path == "/" {
      send(connection, body: pages["hello"] ?? "<title>orca-spike-local-ok</title>local ok", type: "text/html; charset=utf-8")
      return
    }
    if path.hasPrefix("/p/"), let page = pages[String(path.dropFirst(3))] {
      send(connection, body: page, type: "text/html; charset=utf-8")
      return
    }
    send(connection, body: "not found", type: "text/plain", status: "404 Not Found")
  }

  private func send(_ connection: NWConnection, body: String, type: String, status: String = "200 OK") {
    let bytes = Data(body.utf8)
    let header = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(bytes.count)\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
    var out = Data(header.utf8)
    out.append(bytes)
    connection.send(content: out, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in
      connection.cancel()
    })
  }

  private func stream(_ connection: NWConnection, remaining: Int) {
    if remaining <= 0 {
      connection.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in
        connection.cancel()
      })
      return
    }
    let size = min(remaining, chunk.count)
    connection.send(content: chunk.prefix(size), completion: .contentProcessed { [weak self] error in
      if error != nil { connection.cancel(); return }
      self?.stream(connection, remaining: remaining - size)
    })
  }
}
