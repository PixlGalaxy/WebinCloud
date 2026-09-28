import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AppConfigProvider } from './context/AppConfigContext';
import { I18nProvider } from './i18n/I18nContext';
import { AuthProvider } from './context/AuthContext';
import { ArchiveProvider } from './context/ArchiveContext';
import ArchivePanel from './components/ArchivePanel';
import { TransferProvider } from './context/TransferContext';
import TransferPanel from './components/TransferPanel';
import { ClipboardProvider } from './context/ClipboardContext';
import UploadTray from './components/upload/UploadTray';
import { UploadProvider } from './context/UploadContext';
import { ProtectedRoute, AdminRoute } from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import FileExplorerPage from './pages/files/FileExplorerPage';
import ShareManagerPage from './pages/share/ShareManagerPage';
import UsersAdminPage from './pages/admin/UsersAdminPage';
import LogsPage from './pages/admin/LogsPage';
import ProfilePage from './pages/profile/ProfilePage';
import ShareSettingsPage from './pages/settings/ShareSettingsPage';
import SettingsPage from './pages/settings/SettingsPage';
import PublicSharePage from './pages/public/PublicSharePage';

const App = () => (
  <BrowserRouter>
    <AppConfigProvider>
      <I18nProvider>
        {/* Auth wraps Theme: appearance is account data, so it needs the signed-in user. */}
        <AuthProvider>
          <ThemeProvider>
            <ArchiveProvider>
              <TransferProvider>
                <ClipboardProvider>
                <UploadProvider>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  {/* Anonymous: reachable by anyone holding the link. */}
                  <Route path="/public/:segment/:name" element={<PublicSharePage />} />

                  <Route element={<ProtectedRoute />}>
                    <Route path="/" element={<Navigate to="/files" replace />} />
                    <Route path="/files/*" element={<FileExplorerPage />} />
                    <Route path="/share" element={<ShareManagerPage />} />
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route path="/share-settings" element={<ShareSettingsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />

                    <Route element={<AdminRoute />}>
                      <Route path="/admin/users" element={<UsersAdminPage />} />
                      <Route path="/admin/logs" element={<LogsPage />} />
                    </Route>
                  </Route>

                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>

                {/* Outside the routes so they survive navigation. */}
                <div className="fixed bottom-4 right-4 z-40 w-80 space-y-2">
                  <UploadTray />
                  <ArchivePanel />
                  <TransferPanel />
                </div>
                </UploadProvider>
                </ClipboardProvider>
              </TransferProvider>
            </ArchiveProvider>
          </ThemeProvider>
        </AuthProvider>
      </I18nProvider>
    </AppConfigProvider>
  </BrowserRouter>
);

export default App;
