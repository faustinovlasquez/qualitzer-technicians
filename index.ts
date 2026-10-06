import { registerRootComponent } from 'expo';
// Debe ir antes de App: los estilos de cada pantalla se calculan con la paleta activa al cargarse.
import './src/ui/initColorScheme';
import './src/location/locationRuntime';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
