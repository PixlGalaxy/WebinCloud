import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { I18nProvider } from './i18n/I18nContext';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute, AdminRoute } from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import FileExplorerPage from './pages/files/FileExplorerPage';
import ShareManagerPage from './pages/share/ShareManagerPage';
import UsersAdminPage from './pages/admin/UsersAdminPage';
import ProfilePage from './pages/profile/ProfilePage';
import PublicSharePage from './pages/public/PublicSharePage';

const App = () => (
  <BrowserRouter>
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
          {/* Anonymous: reachable by anyone holding the link. */}
          <Route path="/public/:segment/:name" element={<PublicSharePage />} />

            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Navigate to="/files" replace />} />
              <Route path="/files/*" element={<FileExplorerPage />} />
              <Route path="/share" element={<ShareManagerPage />} />
              <Route path="/profile" element={<ProfilePage />} />

              <Route element={<AdminRoute />}>
                <Route path="/admin/users" element={<UsersAdminPage />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  </BrowserRouter>
);

export default App;
