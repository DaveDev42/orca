import AVFoundation
import Foundation
import os.log

// Every AVAudioSession call and route notification is logged with the [orca-audio] prefix (Console.app, process
// filter on the app). A clean dictation start shows: setCategory, setPreferredSampleRate, setActive(true), ONE route
// change into the Bluetooth HFP input, engine start. Anything more is a flap.
private let orcaAudioLog = OSLog(subsystem: "com.davedev42.orca.mobile", category: "orca-audio")

func orcaAudioLogLine(_ message: String) {
    os_log("[orca-audio] %{public}@", log: orcaAudioLog, type: .default, message)
    NSLog("[orca-audio] %@", message)
}

class AudioEngine {
    private var avAudioEngine = AVAudioEngine()
    private var engineConfigChangeObserver: Any?
    private var sessionInterruptionObserver: Any?
    private var mediaServicesResetObserver: Any?
    private var routeChangeObserver: Any?
    private var pendingEngineRestart: DispatchWorkItem?

    public private(set) var voiceIOFormat: AVAudioFormat
    public private(set) var isRecording = false
    private var interruptionIntent = RecordingInterruptionIntent()
    private var isTornDown = false
    // True once this engine activated the session; cleared whenever something may have deactivated it behind our back.
    private var sessionActive = false

    public var onMicDataCallback: ((Data) -> Void)?
    public var onInputVolumeCallback: ((Float) -> Void)?
    public var onAudioInterruptionCallback: ((String) -> Void)?

    // Start/stop cues: played through the engine's own output (the active route, so over a car's HFP link too) once the
    // session is active and the engine runs, on every start, warm or cold. The mic tap drops buffers until the cue has
    // finished so the tone never reaches the recognizer.
    private let cuePlayer = AVAudioPlayerNode()
    private lazy var startCueBuffer = AudioEngine.makeCueBuffer(format: voiceIOFormat, frequency: 880, seconds: 0.15, gain: 0.12)
    private lazy var stopCueBuffer = AudioEngine.makeCueBuffer(format: voiceIOFormat, frequency: 660, seconds: 0.08, gain: 0.06)
    private var micMutedUntil: TimeInterval = 0
    private static let cueTailSeconds: TimeInterval = 0.08

    private var inputBuffer = [Float](repeating: 0, count: 2048)
    private var inputBufferIndex = 0

    enum AudioEngineError: Error {
        case audioFormatError
    }

    init() throws {
        guard let format = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1) else {
            throw AudioEngineError.audioFormatError
        }
        voiceIOFormat = format
        print("Voice IO format: \(String(describing: voiceIOFormat))")

        engineConfigChangeObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: avAudioEngine,
            queue: .main) { [weak self] _ in
                self?.handleEngineConfigurationChange()
            }
        sessionInterruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main) { [weak self] notification in
                self?.handleAudioSessionInterruption(notification)
            }
        mediaServicesResetObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main) { [weak self] _ in
                self?.handleMediaServicesWereReset()
            }

        // Order matters for a Bluetooth car: every route-affecting setting (category, voice processing, graph) is
        // applied while the session is still inactive, then the session is activated once and the engine started.
        // Enabling voice processing or reconfiguring the engine after activation bounces HFP and the car flips in
        // and out of call mode several times before audio is usable.
        routeChangeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main) { notification in
                // Log only. Reacting to a route change we caused ourselves would renegotiate the link again.
                let reason = (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) ?? 0
                let route = AVAudioSession.sharedInstance().currentRoute
                let inputs = route.inputs.map { $0.portType.rawValue }.joined(separator: ",")
                let outputs = route.outputs.map { $0.portType.rawValue }.joined(separator: ",")
                var previous = ""
                if let prev = notification.userInfo?[AVAudioSessionRouteChangePreviousRouteKey] as? AVAudioSessionRouteDescription {
                    let pin = prev.inputs.map { $0.portType.rawValue }.joined(separator: ",")
                    let pout = prev.outputs.map { $0.portType.rawValue }.joined(separator: ",")
                    previous = " prev-in=[\(pin)] prev-out=[\(pout)]"
                }
                orcaAudioLogLine("route change reason=\(reason) in=[\(inputs)] out=[\(outputs)]\(previous)")
            }
        self.configureAudioSession()
        do {
            try self.setup()
        } catch {
            // Hand the session back so a failed initialize leaves no other app's audio ducked.
            tearDown()
            throw error
        }
        self.activateAudioSession()
        self.start()
    }

    deinit {
        if let observer = engineConfigChangeObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = sessionInterruptionObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = mediaServicesResetObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = routeChangeObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    // How long a torn-down session stays active, so back-to-back dictations keep the car in call mode.
    private static let sessionLingerSeconds: TimeInterval = 2.0
    private static var pendingDeactivation: DispatchWorkItem?

    func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()

        do {
            // One category/mode/options write. Only HFP is needed (the mic is the Bluetooth hands-free input);
            // allowBluetoothA2DP adds a second Bluetooth profile the car would negotiate for nothing here.
            orcaAudioLogLine("setCategory playAndRecord voiceChat [defaultToSpeaker, allowBluetooth]")
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        } catch {
            orcaAudioLogLine("setCategory failed: \(error.localizedDescription)")
        }

        // iOS mutes haptics while input runs by default; dictation taps the user on start and stop.
        do {
            orcaAudioLogLine("setAllowHapticsAndSystemSoundsDuringRecording true")
            try session.setAllowHapticsAndSystemSoundsDuringRecording(true)
        } catch {
            print("Could not allow haptics during recording: \(error.localizedDescription)")
        }

        // Still inactive here, so this only seeds the activation below; it is never a renegotiation on a live link.
        do {
            orcaAudioLogLine("setPreferredSampleRate \(voiceIOFormat.sampleRate)")
            try session.setPreferredSampleRate(voiceIOFormat.sampleRate)
        } catch {
            print("Could not set the preferred sample rate: \(error.localizedDescription)")
        }
    }

    func activateAudioSession() {
        // A dictation that follows a recent one reuses the still-active session instead of waiting for it to drop.
        AudioEngine.pendingDeactivation?.cancel()
        AudioEngine.pendingDeactivation = nil
        do {
            orcaAudioLogLine("setActive true (activate)")
            try AVAudioSession.sharedInstance().setActive(true)
            sessionActive = true
        } catch {
            orcaAudioLogLine("setActive true failed: \(error)")
        }
    }

    func setup() throws {
        let input = avAudioEngine.inputNode
        // Throw rather than return: an engine with no mic tap would report recording and capture nothing.
        // Still before activation: enabling voice processing on a live session renegotiates the route.
        orcaAudioLogLine("setVoiceProcessingEnabled true (session active=\(sessionActive))")
        try input.setVoiceProcessingEnabled(true)

        avAudioEngine.inputNode.isVoiceProcessingInputMuted = !isRecording

        // Voice processing runs input and output as one unit, so keep the output side wired even though nothing plays.
        avAudioEngine.connect(avAudioEngine.mainMixerNode, to: avAudioEngine.outputNode, format: voiceIOFormat)
        avAudioEngine.attach(cuePlayer)
        avAudioEngine.connect(cuePlayer, to: avAudioEngine.mainMixerNode, format: voiceIOFormat)

        input.installTap(onBus: 0, bufferSize: 2048, format: voiceIOFormat) { [weak self] buffer, when in
            if self?.isRecording == true, ProcessInfo.processInfo.systemUptime >= (self?.micMutedUntil ?? 0) {
                self?.processMicrophoneBuffer(buffer)
                self?.updateInputVolume()
            }
        }

        // No prepare() here: it initialises the voice-processing I/O unit, which can claim the Bluetooth route
        // before the explicit activation. start() prepares as part of the one activation sequence.
    }

    private static func makeCueBuffer(format: AVAudioFormat, frequency: Double, seconds: Double, gain: Float) -> AVAudioPCMBuffer? {
        let frames = AVAudioFrameCount(format.sampleRate * seconds)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
              let samples = buffer.floatChannelData?[0] else { return nil }
        buffer.frameLength = frames
        let fade = Double(frames) * 0.2
        for i in 0..<Int(frames) {
            let t = Double(i) / format.sampleRate
            // Short linear fade in/out so the tone does not click.
            let envelope = min(1.0, Double(i) / fade, Double(Int(frames) - i) / fade)
            samples[i] = gain * Float(envelope * sin(2.0 * Double.pi * frequency * t))
        }
        return buffer
    }

    // Only with a running engine (session active, route up). Never throws; a missed cue must not fail the dictation.
    private func playCue(_ buffer: AVAudioPCMBuffer?, seconds: TimeInterval) {
        guard let buffer = buffer, avAudioEngine.isRunning else { return }
        micMutedUntil = ProcessInfo.processInfo.systemUptime + seconds + AudioEngine.cueTailSeconds
        cuePlayer.stop()
        cuePlayer.scheduleBuffer(buffer, completionHandler: nil)
        cuePlayer.play()
    }

    func processMicrophoneBuffer(_ buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData?[0] else {
            print("Error: Could not access channel data")
            return
        }

        let frameCount = Int(buffer.frameLength)
        var int16Samples = [Int16](repeating: 0, count: frameCount)

        for i in 0..<frameCount {
            let floatSample = max(-1.0, min(1.0, channelData[i]))
            int16Samples[i] = Int16(floatSample * Float(Int16.max))

            inputBuffer[inputBufferIndex] = floatSample
            inputBufferIndex = (inputBufferIndex + 1) % inputBuffer.count
        }

        let data = Data(bytes: int16Samples, count: frameCount * MemoryLayout<Int16>.size)

        onMicDataCallback?(data)
    }

    func start() {
        guard !isTornDown else { return }
        do {
            orcaAudioLogLine("engine start")
            try avAudioEngine.start()
        } catch {
            orcaAudioLogLine("engine start failed: \(error)")
        }
    }

    func bypassVoiceProcessing(_ bypass: Bool) {
        let input = avAudioEngine.inputNode
        input.isVoiceProcessingBypassed = bypass
    }

    func toggleRecording(_ val: Bool, preservingInterruptionIntent: Bool = false) -> Bool {
        guard !val || !isTornDown else { return false }
        if !preservingInterruptionIntent {
            // An explicit stop also cancels a resume queued before JavaScript cancelled dictation.
            interruptionIntent.cancel()
        }
        if val {
            do {
                // Only re-activate a session that really went inactive (interruption, system keyboard dictation). A
                // stopped engine does not mean an inactive session: the engine's own start follows an async route
                // change, and a second setActive(true) on top of it is one more call-mode negotiation.
                if !sessionActive {
                    orcaAudioLogLine("setActive true (re-activate, session was lost)")
                    try AVAudioSession.sharedInstance().setActive(true)
                    sessionActive = true
                }
                if !avAudioEngine.isRunning {
                    orcaAudioLogLine("engine start (toggleRecording)")
                    try avAudioEngine.start()
                }
            } catch {
                isRecording = false
                avAudioEngine.inputNode.isVoiceProcessingInputMuted = true
                orcaAudioLogLine("could not activate microphone recording: \(error)")
                return false
            }
        }
        let wasRecording = isRecording
        isRecording = val
        if val {
            // Every start, warm or cold: the engine is running here, so the route is as ready as it will get.
            playCue(startCueBuffer, seconds: 0.15)
        } else if wasRecording {
            playCue(stopCueBuffer, seconds: 0.08)
        }
        if !isRecording {
            avAudioEngine.inputNode.isVoiceProcessingInputMuted = true
            inputBuffer = [Float](repeating: 0, count: 2048)
            updateInputVolume()
        } else {
            avAudioEngine.inputNode.isVoiceProcessingInputMuted = false
        }
        orcaAudioLogLine("recording \(isRecording ? "started" : "stopped")")

        return isRecording
    }

    func stopRecording(clearInterruptionResume: Bool = true, lingerSession: Bool = false){
        if lingerSession {
            scheduleSessionDeactivation()
        } else {
            deactivateAudioSession()
        }
        toggleRecording(false, preservingInterruptionIntent: !clearInterruptionResume)
    }

    private func deactivateAudioSession() {
        AudioEngine.pendingDeactivation?.cancel()
        AudioEngine.pendingDeactivation = nil
        sessionActive = false
        do {
            orcaAudioLogLine("setActive false notifyOthersOnDeactivation (release)")
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            orcaAudioLogLine("setActive false failed: \(error)")
        }
    }

    // Engine I/O is already stopped here, so the delayed deactivation cannot hit a busy session. A new engine
    // activating the session cancels it.
    private func scheduleSessionDeactivation() {
        AudioEngine.pendingDeactivation?.cancel()
        let work = DispatchWorkItem {
            AudioEngine.pendingDeactivation = nil
            do {
                orcaAudioLogLine("setActive false notifyOthersOnDeactivation (linger release)")
                try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            } catch {
                orcaAudioLogLine("setActive false failed: \(error)")
            }
        }
        AudioEngine.pendingDeactivation = work
        DispatchQueue.main.asyncAfter(deadline: .now() + AudioEngine.sessionLingerSeconds, execute: work)
    }

    func tearDown() {
        guard !isTornDown else { return }
        isTornDown = true
        pendingEngineRestart?.cancel()
        pendingEngineRestart = nil
        orcaAudioLogLine("tearDown")
        // Stop I/O first; deactivating a session with running I/O returns a busy error. Drop the input tap and give
        // the session back right away (notifyOthersOnDeactivation): a lingering session keeps a Bluetooth car in
        // call mode and other apps' music stays stopped.
        avAudioEngine.stop()
        avAudioEngine.inputNode.removeTap(onBus: 0)
        stopRecording()
    }

    // The engine posts this after our own activation/start (the route moved to HFP) and when the route changes under
    // us. It never touches the session: a running engine needs nothing, and a stopped one is restarted once after the
    // route has settled, so our own change cannot loop into another rebuild.
    private func handleEngineConfigurationChange() {
        orcaAudioLogLine("engine configuration change running=\(avAudioEngine.isRunning) torn-down=\(isTornDown)")
        guard !isTornDown, !avAudioEngine.isRunning, pendingEngineRestart == nil else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            self.pendingEngineRestart = nil
            if !self.isTornDown && !self.avAudioEngine.isRunning {
                self.start()
            }
        }
        pendingEngineRestart = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
    }

    private func handleAudioSessionInterruption(_ notification: Notification) {
        guard !isTornDown else { return }
        guard let userInfo = notification.userInfo,
              let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

        switch type {
        case .began:
            orcaAudioLogLine("interruption began")
            // The system has already deactivated the session; our own setActive(false) on top of it is one more
            // call-to-media switch before the matching resume switches back.
            sessionActive = false
            interruptionIntent.began(wasRecording: isRecording)
            _ = toggleRecording(false, preservingInterruptionIntent: true)
            onAudioInterruptionCallback?("began")
        case .ended:
            let rawOptions = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let shouldResume = AVAudioSession.InterruptionOptions(rawValue: rawOptions).contains(.shouldResume)
            orcaAudioLogLine("interruption ended shouldResume=\(shouldResume)")
            switch interruptionIntent.ended(shouldResume: shouldResume, isRecording: isRecording) {
            case .resume:
                let resumed = toggleRecording(true)
                onAudioInterruptionCallback?(resumed ? "ended" : "blocked")
            case .blocked:
                onAudioInterruptionCallback?("blocked")
            case .none:
                break // A newer explicit start already owns the microphone.
            }
        @unknown default:
            stopRecording()
            onAudioInterruptionCallback?("blocked")
        }
    }

    private func handleMediaServicesWereReset() {
        guard !isTornDown else { return }
        orcaAudioLogLine("media services were reset")
        sessionActive = false
        self.avAudioEngine.stop()
        // A media-services reset drops the category too, so rebuild in the same inactive-then-activate order.
        self.configureAudioSession()
        do {
            try self.setup()
        } catch {
            print("Could not rebuild the audio engine: \(error)")
            tearDown()
            onAudioInterruptionCallback?("blocked")
            return
        }
        self.activateAudioSession()
        self.start()
    }

    private func updateInputVolume() {
        let volume = calculateRMSLevel(from: inputBuffer)
        onInputVolumeCallback?(volume)
    }

    private func calculateRMSLevel(from buffer: [Float]) -> Float {
        let epsilon: Float = 1e-5 // To avoid log(0)
        let rmsValue = sqrt(buffer.reduce(0) { $0 + $1 * $1 } / Float(buffer.count))

        let dbValue = 20 * log10(max(rmsValue, epsilon))

        // Normalize the assumed audible range [-80, 0] dB.
        let minDb: Float = -80.0
        let normalizedValue = max(0.0, min(1.0, (dbValue - minDb) / abs(minDb)))

        let expFactor: Float = 2.0
        let adjustedValue = pow(normalizedValue, expFactor)

        return adjustedValue
    }
}
