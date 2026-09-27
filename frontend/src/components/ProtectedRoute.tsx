import { Navigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Navbar from './Navbar';
import Footer from './Footer';
import ForceChangePasswordModal from './ForceChangePasswordModal';

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <Loader2 className="animate-spin text-indigo-500" size={32} />
    </div>
  );
}

export function ProtectedRoute() {
  const { user, isLoading, mustChangePassword } = useAuth();

  if (isLoading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      <Navbar />
      <main className="w-full flex-1 p-6">
        <Outlet />
      </main>
      <Footer />
      {mustChangePassword && <ForceChangePasswordModal />}
    </div>
  );
}

export function AdminRoute() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <Spinner />;
  if (!user || user.role !== 'admin') return <Navigate to="/files" replace />;

  return <Outlet />;
}
