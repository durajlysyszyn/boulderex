import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import PhotoScreen from './src/screens/PhotoScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <PhotoScreen />
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
