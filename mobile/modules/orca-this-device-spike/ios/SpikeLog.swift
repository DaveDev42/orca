import Foundation
import os

/// Every spike line goes to os_log with the `[orca-spike]` prefix so `log collect` on a Mac can pull it.
enum SpikeLog {
  private static let logger = Logger(subsystem: "dev.orca.mobile.spike", category: "spike")

  static func write(_ message: String) {
    logger.notice("[orca-spike] \(message, privacy: .public)")
  }
}
