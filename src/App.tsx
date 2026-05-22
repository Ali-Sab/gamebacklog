import { useAuth, AuthProvider } from "./context/AuthContext";
import { AppProvider, useApp } from "./context/AppContext";
import { ToastProvider } from "./components/shared/Toast";
import { LoadingScreen } from "./screens/LoadingScreen";
import { MainApp } from "./components/layout/MainApp";
import { useTheme } from "./themes";

function AppInner() {
  const { currentScreen } = useAuth();
  const { theme, setTheme } = useTheme();

  if (currentScreen === "loading") return <LoadingScreen />;
  return <MainApp theme={theme} onThemeChange={setTheme} />;
}

function AppWithAuth() {
  const { loadApp } = useApp();
  return (
    <AuthProvider onMain={loadApp}>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </AuthProvider>
  );
}

export function App() {
  return (
    <AppProvider>
      <AppWithAuth />
    </AppProvider>
  );
}
