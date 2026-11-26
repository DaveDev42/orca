import { useRouter } from 'expo-router'
import ThisDeviceSpikeScreen from '../src/settings/this-device-spike/this-device-spike-screen'

// Hidden: reached only by tapping the version on About five times.
export default function ThisDeviceSpikeRoute() {
  const router = useRouter()
  return <ThisDeviceSpikeScreen onBack={() => router.back()} />
}
