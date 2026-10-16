const cart = new Map();
let products = [];
const $ = (s) => document.querySelector(s);
const money = n => "৳" + Number(n || 0).toLocaleString("bn-BD");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(url, options={}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(()=>({error:"সার্ভার থেকে সঠিক উত্তর পাওয়া যায়নি।"}));
  if (!res.ok) throw new Error(data.error || "রিকোয়েস্ট সম্পন্ন হয়নি।");
  return data;
}
function toast(message) { const el=$("#toast"); el.textContent=message; el.classList.remove("hidden"); setTimeout(()=>el.classList.add("hidden"),2600); }
async function loadProducts() {
  try { products = await api("/api/products"); renderProducts(); renderCart(); }
  catch(e) { $("#product-list").innerHTML=`<p class="empty">${esc(e.message)}</p>`; }
}
function renderProducts() {
  const q = ($("#search").value || "").trim().toLocaleLowerCase();
  const list = products.filter(p => (p.name+" "+p.category+" "+p.description).toLocaleLowerCase().includes(q));
  $("#product-list").innerHTML = list.length ? list.map(p => `<article class="product"><div class="product-photo">${p.image?`<img src="${esc(p.image)}" alt="${esc(p.name)}">`:"📦"}</div><div class="product-body"><div class="category">${esc(p.category || "অন্যান্য")}</div><h3>${esc(p.name)}</h3><div class="price">${money(p.price)}</div><div class="stock">${p.stock>0?`স্টক: ${p.stock} টি`:"স্টক শেষ"}${p.description?`<br>${esc(p.description)}`:""}</div><button class="btn primary" data-add="${p.id}" ${p.stock<=0?"disabled":""}>কার্টে যোগ করুন</button></div></article>`).join("") : `<div class="empty">কোনো প্রোডাক্ট পাওয়া যায়নি।</div>`;
}
function renderCart() {
  const rows = [...cart.entries()].map(([id,qty])=>({p:products.find(p=>p.id===id),qty})).filter(x=>x.p);
  const total = rows.reduce((s,x)=>s+x.p.price*x.qty,0);
  $("#cart-items").innerHTML = rows.length ? rows.map(({p,qty})=>`<div class="cart-row"><span><b>${esc(p.name)}</b><br><small>${money(p.price)} × ${qty}</small></span><div class="qty"><button type="button" data-minus="${p.id}" aria-label="কমাও">−</button><span>${qty}</span><button type="button" data-plus="${p.id}" aria-label="বাড়াও" ${qty>=p.stock?"disabled":""}>+</button></div><b>${money(p.price*qty)}</b></div>`).join("") : "কার্ট খালি।";
  $("#cart-total").textContent = money(total);
}
$("#product-list").addEventListener("click",e=>{const b=e.target.closest("[data-add]");if(!b)return;const id=Number(b.dataset.add),p=products.find(p=>p.id===id);if(!p)return;const qty=cart.get(id)||0;if(qty>=p.stock)return toast("স্টক পর্যাপ্ত নেই।");cart.set(id,qty+1);renderCart();toast("কার্টে যোগ হয়েছে।");});
$("#cart-items").addEventListener("click",e=>{const plus=e.target.closest("[data-plus]"),minus=e.target.closest("[data-minus]");if(!plus&&!minus)return;const id=Number((plus||minus).dataset[plus?"plus":"minus"]),p=products.find(p=>p.id===id),qty=cart.get(id)||0;if(plus&&p&&qty<p.stock)cart.set(id,qty+1);if(minus){if(qty<=1)cart.delete(id);else cart.set(id,qty-1)}renderCart();});
$("#search").addEventListener("input",renderProducts);
$("#checkout-form").addEventListener("submit",async e=>{
  e.preventDefault(); const msg=$("#checkout-message");msg.classList.remove("error");msg.textContent="";
  if(!cart.size){msg.textContent="আগে কার্টে প্রোডাক্ট যোগ করুন।";msg.classList.add("error");return}
  const form=new FormData(e.currentTarget),items=[...cart.entries()].map(([id,qty])=>({id,qty}));
  const button=e.currentTarget.querySelector("button[type=submit]");button.disabled=true;button.textContent="অর্ডার হচ্ছে...";
  try { const result=await api("/api/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({customerName:form.get("customerName"),phone:form.get("phone"),address:form.get("address"),items})});cart.clear();e.currentTarget.reset();msg.textContent=`${result.message} আপনার অর্ডার আইডি: ${result.order.code}`;await loadProducts();toast("অর্ডার সফল হয়েছে!"); }
  catch(err){msg.textContent=err.message;msg.classList.add("error");}
  finally{button.disabled=false;button.textContent="অর্ডার কনফার্ম করুন";}
});
loadProducts();