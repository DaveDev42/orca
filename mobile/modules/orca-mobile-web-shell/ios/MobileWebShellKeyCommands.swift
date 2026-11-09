import ExpoModulesCore
import ObjectiveC
import UIKit

/// One chord the page claimed, as the shell screen passes it down. The page validated the shape.
struct MobileWebShellKeyCommandRecord: Record {
  @Field var id: String = ""
  @Field var input: String = ""
  @Field var modifiers: [String] = []
  @Field var title: String = ""
}

/// iPad hardware-keyboard chords for one shell view: registered on the key window's root view
/// controller with priority over system behavior, so Cmd+W reaches the page instead of closing the
/// window, and listed in the Cmd-hold overlay. Only one view's set is installed at a time.
final class MobileWebShellKeyCommands {
  private static let action = NSSelectorFromString("orcaWebShellKeyCommand:")
  private static weak var owner: MobileWebShellKeyCommands?
  private static weak var installedOn: UIViewController?
  private static var installed: [UIKeyCommand] = []

  private weak var view: UIView?
  private let onCommand: (String) -> Void
  private var records: [MobileWebShellKeyCommandRecord] = []

  init(view: UIView, onCommand: @escaping (String) -> Void) {
    self.view = view
    self.onCommand = onCommand
  }

  func setCommands(_ next: [MobileWebShellKeyCommandRecord]) {
    let same =
      next.count == records.count
      && zip(next, records).allSatisfy { a, b in
        a.id == b.id && a.input == b.input && a.modifiers == b.modifiers && a.title == b.title
      }
    if same { return }
    records = next
    refresh()
  }

  /// Install while the view is in a window and the page claims something; remove otherwise.
  func refresh() {
    guard let root = view?.window?.rootViewController, !records.isEmpty else {
      if Self.owner === self { Self.uninstall() }
      return
    }
    Self.uninstall()
    Self.respond(on: type(of: root))
    Self.installed = records.compactMap(Self.keyCommand)
    Self.installed.forEach(root.addKeyCommand)
    Self.installedOn = root
    Self.owner = self
  }

  private static func uninstall() {
    if let root = installedOn {
      installed.forEach(root.removeKeyCommand)
    }
    installed = []
    installedOn = nil
    owner = nil
  }

  private static func keyCommand(_ record: MobileWebShellKeyCommandRecord) -> UIKeyCommand? {
    guard let input = input(record.input) else { return nil }
    var flags: UIKeyModifierFlags = []
    for modifier in record.modifiers {
      switch modifier {
      case "command": flags.insert(.command)
      case "shift": flags.insert(.shift)
      case "alternate": flags.insert(.alternate)
      case "control": flags.insert(.control)
      default: return nil
      }
    }
    let command = UIKeyCommand(
      title: record.title, action: action, input: input, modifierFlags: flags,
      propertyList: record.id)
    command.discoverabilityTitle = record.title
    command.wantsPriorityOverSystemBehavior = true
    return command
  }

  private static func input(_ name: String) -> String? {
    switch name {
    case "escape": return UIKeyCommand.inputEscape
    case "enter": return "\r"
    case "tab": return "\t"
    case "space": return " "
    case "arrowUp": return UIKeyCommand.inputUpArrow
    case "arrowDown": return UIKeyCommand.inputDownArrow
    case "arrowLeft": return UIKeyCommand.inputLeftArrow
    case "arrowRight": return UIKeyCommand.inputRightArrow
    default: return name.count == 1 ? name : nil
    }
  }

  /// The root view controller sits at the end of every responder chain in its window, whether
  /// WebKit holds first responder or nothing does, so it gets the action added at runtime.
  private static func respond(on controllerClass: AnyClass) {
    if class_respondsToSelector(controllerClass, action) { return }
    let block: @convention(block) (AnyObject, UIKeyCommand) -> Void = { _, command in
      MobileWebShellKeyCommands.fire(command)
    }
    class_addMethod(controllerClass, action, imp_implementationWithBlock(block), "v@:@")
  }

  private static func fire(_ command: UIKeyCommand) {
    guard let owner, let id = command.propertyList as? String else { return }
    // Mid-composition (Korean, Japanese, Chinese IME) the chord belongs to the input method.
    if MobileWebShellFirstResponder.isComposing() {
      return
    }
    owner.onCommand(id)
  }
}

/// UIKit has no public getter for the first responder; a nil-targeted action lands on it.
private enum MobileWebShellFirstResponder {
  private static weak var found: UIResponder?

  static func find() -> UIResponder? {
    found = nil
    UIApplication.shared.sendAction(
      #selector(UIResponder.orcaWebShellCaptureFirstResponder), to: nil, from: nil, for: nil)
    return found
  }

  /// Read by selector, not by casting: WKContentView answers markedTextRange whether or not it
  /// formally adopts UITextInput.
  static func isComposing() -> Bool {
    let markedTextRange = #selector(getter: UITextInput.markedTextRange)
    guard let responder = find(), responder.responds(to: markedTextRange) else { return false }
    return responder.perform(markedTextRange)?.takeUnretainedValue() != nil
  }

  fileprivate static func capture(_ responder: UIResponder) {
    found = responder
  }
}

extension UIResponder {
  @objc fileprivate func orcaWebShellCaptureFirstResponder() {
    MobileWebShellFirstResponder.capture(self)
  }
}
