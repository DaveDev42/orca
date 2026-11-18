import AVFoundation
import Foundation

class AudioEngine {
    private var avAudioEngine = AVAudioEngine()
    private var engineConfigChangeObserver: Any?
    private var sessionInterruptionObserver: Any?
    private var mediaServicesResetObserver: Any?
    private var routeChangeObserver: Any?

    public private(set) var voiceIOFormat: AVAudioFormat
    public private(set) var isRecording = false
    private var interruptionIntent = RecordingInterruptionIntent()
    private var isTornDown = false

    public var onMicDataCallback: ((Data) -> Void)?
    public var onInputVolumeCallback: ((Float) -> Void)?
    public var onAudioInterruptionCallback: ((String) -> Void)?

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
                self?.checkEngineIsRunning()
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
                // Diagnostic: a clean start logs one route change into the Bluetooth HFP input.
                let reason = (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) ?? 0
                let route = AVAudioSession.sharedInstance().currentRoute
                let inputs = route.inputs.map { $0.portType.rawValue }.joined(separator: ",")
                let outputs = route.outputs.map { $0.portType.rawValue }.joined(separator: ",")
                print("[AudioEngine] route change reason=\(reason) in=[\(inputs)] out=[\(outputs)]")
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
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP])
        } catch {
            print("Could not set the audio category: \(error.localizedDescription)")
        }

        // iOS mutes haptics while input runs by default; dictation taps the user on start and stop.
        do {
            try session.setAllowHapticsAndSystemSoundsDuringRecording(true)
        } catch {
            print("Could not allow haptics during recording: \(error.localizedDescription)")
        }

        do {
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
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("Could not set the audio session as active")
        }
    }

    func setup() throws {
        let input = avAudioEngine.inputNode
        // Throw rather than return: an engine with no mic tap would report recording and capture nothing.
        try input.setVoiceProcessingEnabled(true)

        avAudioEngine.inputNode.isVoiceProcessingInputMuted = !isRecording

        // Voice processing runs input and output as one unit, so keep the output side wired even though nothing plays.
        avAudioEngine.connect(avAudioEngine.mainMixerNode, to: avAudioEngine.outputNode, format: voiceIOFormat)

        input.installTap(onBus: 0, bufferSize: 2048, format: voiceIOFormat) { [weak self] buffer, when in
            if self?.isRecording == true {
                self?.processMicrophoneBuffer(buffer)
                self?.updateInputVolume()
            }
        }

        avAudioEngine.prepare()
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
            try avAudioEngine.start()
        } catch {
            print("Could not start audio engine: \(error)")
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
                // System keyboard dictation can leave an existing engine's session inactive.
                try AVAudioSession.sharedInstance().setActive(true)
                if !avAudioEngine.isRunning {
                    try avAudioEngine.start()
                }
            } catch {
                isRecording = false
                avAudioEngine.inputNode.isVoiceProcessingInputMuted = true
                print("Could not activate microphone recording: \(error)")
                return false
            }
        }
        isRecording = val
        if !isRecording {
            avAudioEngine.inputNode.isVoiceProcessingInputMuted = true
            inputBuffer = [Float](repeating: 0, count: 2048)
            updateInputVolume()
        } else {
            avAudioEngine.inputNode.isVoiceProcessingInputMuted = false
        }
        print("Recording \(isRecording ? "started" : "stopped")")

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
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            print("Could not set the audio session to inactive: \(error)")
        }
    }

    // Engine I/O is already stopped here, so the delayed deactivation cannot hit a busy session. A new engine
    // activating the session cancels it.
    private func scheduleSessionDeactivation() {
        AudioEngine.pendingDeactivation?.cancel()
        let work = DispatchWorkItem {
            AudioEngine.pendingDeactivation = nil
            do {
                try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            } catch {
                print("Could not set the audio session to inactive: \(error)")
            }
        }
        AudioEngine.pendingDeactivation = work
        DispatchQueue.main.asyncAfter(deadline: .now() + AudioEngine.sessionLingerSeconds, execute: work)
    }

    func tearDown() {
        guard !isTornDown else { return }
        isTornDown = true
        // Stop I/O first; deactivating a session with running I/O returns a busy error.
        avAudioEngine.stop()
        stopRecording(lingerSession: true)
    }

    private func checkEngineIsRunning() {
        guard !isTornDown else { return }
        if !avAudioEngine.isRunning {
            start()
        }
    }

    private func handleAudioSessionInterruption(_ notification: Notification) {
        guard !isTornDown else { return }
        guard let userInfo = notification.userInfo,
              let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

        switch type {
        case .began:
            interruptionIntent.began(wasRecording: isRecording)
            self.stopRecording(clearInterruptionResume: false)
            onAudioInterruptionCallback?("began")
        case .ended:
            let rawOptions = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let shouldResume = AVAudioSession.InterruptionOptions(rawValue: rawOptions).contains(.shouldResume)
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
