import AppearanceDefaultsCard from './AppearanceDefaultsCard';
import BrandingCard from './BrandingCard';
import FilesDefaultsCard from './FilesDefaultsCard';
import ServerSecurityCard from './ServerSecurityCard';
import ServicesCard from './ServicesCard';

/** Everything that used to live in .env, now editable without a container recreate. */
const SettingsAdminSection = () => (
  <div className="space-y-6">
    <AppearanceDefaultsCard />
    <FilesDefaultsCard />
    <BrandingCard />
    <ServerSecurityCard />
    <ServicesCard />
  </div>
);

export default SettingsAdminSection;
