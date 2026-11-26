import type { PermissionResponse } from 'expo-modules-core'
import ExpoTwoWayAudioModule from './ExpoTwoWayAudioModule'

export async function initialize() {
  return await ExpoTwoWayAudioModule.initialize()
}

export function bypassVoiceProcessing(bypass: boolean) {
  return ExpoTwoWayAudioModule.bypassVoiceProcessing(bypass)
}

export function toggleRecording(val: boolean): boolean {
  return ExpoTwoWayAudioModule.toggleRecording(val)
}

export function isRecording(): boolean {
  return ExpoTwoWayAudioModule.isRecording()
}

// Writes one `[orca-audio] js: ...` line to the device log. Never throws and does nothing where the native module
// has no such function (web, Android, older binaries).
export function audioLog(message: string): void {
  try {
    ExpoTwoWayAudioModule.audioLog?.(message)
  } catch {
    // Logging is best effort.
  }
}

export function tearDown() {
  return ExpoTwoWayAudioModule.tearDown()
}

export function restart() {
  return ExpoTwoWayAudioModule.restart()
}

export async function getMicrophonePermissionsAsync(): Promise<PermissionResponse> {
  return ExpoTwoWayAudioModule.getMicrophonePermissionsAsync()
}

export async function requestMicrophonePermissionsAsync(): Promise<PermissionResponse> {
  return ExpoTwoWayAudioModule.requestMicrophonePermissionsAsync()
}

export function getMicrophoneModeIOS() {
  return ExpoTwoWayAudioModule.getMicrophoneModeIOS()
}

export function setMicrophoneModeIOS() {
  return ExpoTwoWayAudioModule.setMicrophoneModeIOS()
}
