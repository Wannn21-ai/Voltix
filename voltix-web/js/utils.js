export function showToast(msg, timeout=3000){
  const el = document.getElementById('toast');
  if(!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(()=>{ el.style.display='none'; }, timeout);
}

export function fmt(v, decimals=2){
  if(v === null || v === undefined || isNaN(Number(v))) return '-';
  const n = Number(v);
  return n.toFixed(decimals);
}
