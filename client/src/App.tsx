import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import Layout from "./components/Layout";
import SetupPage from "./pages/SetupPage";
import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import FolderPage from "./pages/FolderPage";
import ApplePhotosPage from "./pages/ApplePhotosPage";
import SearchPage from "./pages/SearchPage";
import SettingsPage from "./pages/SettingsPage";
import SurprisePage from "./pages/SurprisePage";
import FavoritesPage from "./pages/FavoritesPage";
import ReportsPage from "./pages/ReportsPage";
import SimilarPage from "./pages/SimilarPage";
import PeoplePage from "./pages/PeoplePage";
import PersonPage from "./pages/PersonPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, needsSetup, loading } = useAuth();
  if (loading) return null;
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { needsSetup, loading } = useAuth();

  if (loading) return null;

  return (
    <Routes>
      <Route path="/setup" element={needsSetup ? <SetupPage /> : <Navigate to="/login" replace />} />
      <Route path="/login" element={needsSetup ? <Navigate to="/setup" replace /> : <LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<HomePage />} />
        <Route path="/folder/:id" element={<FolderPage />} />
        <Route path="/apple-photos/:id" element={<ApplePhotosPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/surprise" element={<SurprisePage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/similar/:id" element={<SimilarPage />} />
        <Route path="/people" element={<PeoplePage />} />
        <Route path="/people/:id" element={<PersonPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
