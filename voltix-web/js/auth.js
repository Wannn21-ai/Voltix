import { auth } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';

export function initLogin(){
  const emailEl = document.getElementById('email');
  const passEl = document.getElementById('password');
  const loginBtn = document.getElementById('loginBtn');
  const regBtn = document.getElementById('registerBtn');

  loginBtn.addEventListener('click', async ()=>{
    try{
      await signInWithEmailAndPassword(auth, emailEl.value, passEl.value);
      window.location.href = 'dashboard.html';
    }catch(e){
      alert('Login failed: '+e.message);
    }
  });

  regBtn.addEventListener('click', async ()=>{
    try{
      await createUserWithEmailAndPassword(auth, emailEl.value, passEl.value);
      window.location.href = 'dashboard.html';
    }catch(e){
      alert('Register failed: '+e.message);
    }
  });

  onAuthStateChanged(auth,user=>{
    if(user){
      // stay on page or redirect to dashboard
    }
  });
}

export function requireAuth(redirectTo='login.html'){
  return new Promise((resolve)=>{
    onAuthStateChanged(auth,user=>{
      if(!user) location.href = redirectTo;
      else resolve(user);
    });
  });
}

export function logout(){
  return signOut(auth);
}
