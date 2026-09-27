import { CircleUser } from 'lucide-react';
import { avatarsApi } from '../../api/users';

interface AvatarProps {
  user: { id: string; avatar_path: string | null; username: string; display_name: string | null; updated_at: string } | null;
  size?: number;
  className?: string;
}

const Avatar = ({ user, size = 32, className = '' }: AvatarProps) => {
  if (!user?.avatar_path) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 ${className}`}
        style={{ width: size, height: size }}
      >
        <CircleUser size={size * 0.75} />
      </div>
    );
  }

  return (
    <img
      // Cache-busted with updated_at, since a same-extension re-upload keeps the filename.
      src={`${avatarsApi.url(user.id)}?v=${encodeURIComponent(user.updated_at)}`}
      alt={user.display_name ?? user.username}
      className={`shrink-0 rounded-full object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
};

export default Avatar;
