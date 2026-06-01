import { logout, requireAuth } from './auth.js';
import { applyTheme, renderShell } from './utils.js';

async function init(){
  applyTheme();
  const user = await requireAuth();
  renderShell('advanced', 'Advanced', {
    user,
    onLogout: async ()=>{
      await logout();
      window.location.href = 'login.html';
    }
  });
}

window.addEventListener('load', ()=>init());
