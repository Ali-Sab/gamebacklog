import { useAuth, AuthProvider } from "./context/AuthContext";
import { AppProvider, useApp } from "./context/AppContext";
import { ToastProvider } from "./components/shared/Toast";
import { LoadingScreen } from "./screens/LoadingScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { MainApp } from "./components/layout/MainApp";
import { useTheme } from "./themes";

function AppInner() {
  const { currentScreen } = useAuth();
  const { theme, setTheme } = useTheme();

  if (currentScreen === "loading") return <LoadingScreen />;
  if (currentScreen === "setup") return <SetupScreen />;
  if (currentScreen === "login") return <LoginScreen />;
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
