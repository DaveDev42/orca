import { createContext } from 'react'

/** Stops the live dictation (or joins the transcription already running) and resolves once its words have been delivered or it failed. Null when the surface has no dictation. */
export const MobileDictationStopContext = createContext<(() => Promise<void>) | null>(null)
