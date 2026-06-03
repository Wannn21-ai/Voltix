import { auth } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { applyTheme, qs, showToast } from './utils.js';

export function initLogin(){
  applyTheme();

  const emailEl = qs('email');
  const passEl = qs('password');
  const loginBtn = qs('loginBtn');
  const regBtn = qs('registerBtn');
  const form = qs('authForm');
  const message = qs('authMessage');

  onAuthStateChanged(auth, user=>{
    if(user){
      window.location.href = 'dashboard.html';
    }
  });

  form.addEventListener('submit', event=>{
    event.preventDefault();
    loginBtn.click();
  });

  loginBtn.addEventListener('click', async ()=>{
    await runAuthAction('Login', message, async ()=>{
      await signInWithEmailAndPassword(auth, emailEl.value.trim(), passEl.value);
      window.location.href = 'dashboard.html';
    });
  });

  regBtn.addEventListener('click', async ()=>{
    await runAuthAction('Register', message, async ()=>{
      await createUserWithEmailAndPassword(auth, emailEl.value.trim(), passEl.value);
      window.location.href = 'dashboard.html';
    });
  });
}

export function requireAuth(redirectTo = 'login.html'){
  return new Promise(resolve=>{
    const unsubscribe = onAuthStateChanged(auth, user=>{
      unsubscribe();
      if(!user){
        window.location.href = redirectTo;
        return;
      }
      resolve(user);
    });
  });
}

export async function logout(){
  await signOut(auth);
}

async function runAuthAction(label, message, action){
  setAuthMessage(message, `${label} in progress...`, '');
  try{
    await action();
  }catch(error){
    console.error(`[auth] ${label.toLowerCase()} failed`, error);
    setAuthMessage(message, `${label} failed: ${error.message}`, 'error');
    showToast(`${label} failed`);
  }
}

function setAuthMessage(element, text, type){
  if(!element) return;
  element.textContent = text;
  element.className = type ? `status-message ${type}` : 'status-message';
}
