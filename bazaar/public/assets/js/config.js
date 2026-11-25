// The only file you edit to connect your own Firebase project.
// Leave firebase.apiKey empty to run the offline demo (data stays in this browser).
export const CONFIG = {
  mode: 'single',          // 'single' = one shop, 'multi' = many shops (each with its own link, logo and admin)
  defaultShop: 'main',     // shop id used in single mode
  platformName: 'Bazaar',  // shown in multi mode and on the admin login
  defaultLang: 'bn',       // 'bn' or 'en'
  firebase: { apiKey: '', authDomain: '', projectId: '', appId: '' },
  turnstileSiteKey: '',    // optional Cloudflare Turnstile site key (bot check on checkout)
};
