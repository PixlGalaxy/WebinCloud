import { File } from 'lucide-react';
import { iconColorFor, iconFor, officeFamilyOf, officeLogoFor, type OfficeFamily } from './paths';

interface Props {
  type: 'file' | 'folder';
  name: string;
  size?: number;
  className?: string;
  /** True once thumbnails are on: shows the real brand logo instead of a plain colored icon. */
  showLogo?: boolean;
}

const OFFICE_COLOR: Record<OfficeFamily, string> = {
  word: 'text-sky-600 dark:text-sky-500',
  excel: 'text-green-600 dark:text-green-500',
  powerpoint: 'text-orange-600 dark:text-orange-500',
  access: 'text-red-400 dark:text-red-300',
  project: 'text-teal-600 dark:text-teal-500',
  visio: 'text-blue-600 dark:text-blue-500',
};

// The word/excel/powerpoint webp logos have more built-in transparent margin
// than a Lucide glyph, so at the same nominal size they read visibly smaller.
const LOGO_SCALE = 1.7;

/**
 * An Office file (Word/Excel/PowerPoint family) gets its brand logo once
 * thumbnails are on, and a colored generic file icon otherwise. Anything
 * else always uses the regular Lucide icon for its type.
 */
const FileIcon = ({ type, name, size = 18, className, showLogo = false }: Props) => {
  const family = officeFamilyOf(type, name);

  if (family) {
    if (showLogo) {
      const logo = officeLogoFor(family);
      const logoSize = size * LOGO_SCALE;
      return <img src={logo} alt="" width={logoSize} height={logoSize} className={className} />;
    }
    return <File size={size} className={OFFICE_COLOR[family]} />;
  }

  const Icon = iconFor(type, name);
  const color = iconColorFor(type, name);
  return <Icon size={size} className={color ?? className} />;
};

export default FileIcon;
