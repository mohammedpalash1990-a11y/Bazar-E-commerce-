// The only file you edit to connect your own Firebase project.
// Leave firebase.apiKey empty to run the offline demo (data stays in this browser).
export const CONFIG = {
  mode: 'single',          // 'single' = one shop, 'multi' = many shops (each with its own link, logo and admin)
  defaultShop: 'main',     // shop id used in single mode
  platformName: 'Bazaar',  // shown in multi mode and on the admin login
  defaultLang: 'bn',       // 'bn' or 'en'
  firebase: { apiKey: 'AIzaSyCZfmf8A57NJWLin_xf9wNKptE8K9D4kEM', authDomain: 'e-comerce-e5345.firebaseapp.com', projectId: 'e-comerce-e5345', appId: '1:108480539953:web:56f4b73691eb8ac4379410' },
  turnstileSiteKey: '',    // optional Cloudflare Turnstile site key (bot check on checkout)
};
