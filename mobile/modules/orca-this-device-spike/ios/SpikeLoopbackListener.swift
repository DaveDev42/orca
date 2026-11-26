import Foundation
import Network

enum SpikeListenerError: Error {
  case notReady(String)
}

/// A TCP listener bound to 127.0.0.1 only, on a kernel-chosen port.
enum SpikeLoopbackListener {
  static func start(
    queue: DispatchQueue,
    label: String,
    onConnection: @escaping (NWConnection) -> Void
  ) throws -> (NWListener, UInt16) {
    let params = NWParameters.tcp
    params.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: .any)
    let listener = try NWListener(using: params)
    let ready = DispatchSemaphore(value: 0)
    var failure: String?
    listener.stateUpdateHandler = { state in
      switch state {
      case .ready:
        ready.signal()
      case .failed(let error):
        failure = "\(error)"
        SpikeLog.write("listener \(label) failed: \(error)")
        ready.signal()
      case .cancelled:
        SpikeLog.write("listener \(label) cancelled")
      default:
        break
      }
    }
    listener.newConnectionHandler = onConnection
    listener.start(queue: queue)
    if ready.wait(timeout: .now() + 5) == .timedOut {
      listener.cancel()
      throw SpikeListenerError.notReady("\(label) timed out")
    }
    if let failure {
      throw SpikeListenerError.notReady("\(label) \(failure)")
    }
    guard let port = listener.port?.rawValue else {
      throw SpikeListenerError.notReady("\(label) has no port")
    }
    SpikeLog.write("listener \(label) ready on 127.0.0.1:\(port)")
    return (listener, port)
  }
}
