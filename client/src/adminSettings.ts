import { startAdminPage } from './AdminPage';
import { SiteSettingsForm } from './ui/SiteSettingsForm';

/**
 * Starts the admin settings page (admin/settings.html): settings for the whole site
 */
void startAdminPage(async (api) =>
{
	await new SiteSettingsForm(api).load();
});
