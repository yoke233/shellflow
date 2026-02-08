import { AppLayout } from './app/AppLayout';
import { useAppController } from './app/useAppController';

function App() {
  const { themeProps, config, overlaysProps, pickersProps, layoutProps, toastProps } = useAppController();

  return (
    <AppLayout
      theme={themeProps}
      config={config}
      overlays={overlaysProps}
      pickers={pickersProps}
      layout={layoutProps}
      toasts={toastProps}
    />
  );
}

export default App;
