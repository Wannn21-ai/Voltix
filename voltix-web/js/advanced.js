import { logout, requireAuth } from './auth.js';
import { applyTheme, initShell } from './utils.js';

async function init(){
  applyTheme();
  const user = await requireAuth();
  initShell({
    active: 'advanced',
    user,
    onLogout: async ()=>{
      await logout();
      window.location.href = 'login.html';
    }
  });
}

window.addEventListener('load', ()=>init());
