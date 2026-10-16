const $ = s => document.querySelector(s);
const money = n => "৳" + Number(n||0).toLocaleString("bn-BD");
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const statuses = {pending:"পেন্ডিং",confirmed:"কনফার্ম",shipping:"ডেলিভারিতে",completed:"সম্পন্ন",cancelled:"বাতিল"};
let products=[], orders=[];
async function api(url,options={}) {
  const res=await fetch(url,options);
  const data=await res.json().catch(()=>({error:"সার্ভার থেকে সঠিক উত্তর পাওয়া যায়নি।"}));
  if(!res.ok) throw new Error(data.error||"রিকোয়েস্ট সম্পন্ন হয়নি।");
  return data;
}
function msg(selector,text,error=false){const el=$(selector);el.textContent=text;el.classList.toggle("error",error)}
function toast(text){const el=$("#toast");el.textContent=text;el.classList.remove("hidden");setTimeout(()=>el.classList.add("hidden"),2600)}
async function checkLogin(){try{await api("/api/admin/me");showApp();await refreshAll()}catch{showLogin()}}
function showLogin(){$("#login-panel").classList.remove("hidden");$("#admin-app").classList.add("hidden")}
function showApp(){$("#login-panel").classList.add("hidden");$("#admin-app").classList.remove("hidden")}
$("#login-form").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:f.get("username"),password:f.get("password")})});e.currentTarget.reset();msg("#login-message","");showApp();await refreshAll()}catch(err){msg("#login-message",err.message,true)}});
$("#logout").addEventListener("click",async()=>{try{await api("/api/admin/logout",{method:"POST"});showLogin();toast("লগআউট হয়েছে।")}catch(e){toast(e.message)}});
async function refreshAll(){try{[products,orders]=await Promise.all([api("/api/products"),api("/api/admin/orders")]);const stats=await api("/api/admin/stats");$("#stat-products").textContent=stats.products.toLocaleString("bn-BD");$("#stat-orders").textContent=stats.orders.toLocaleString("bn-BD");$("#stat-revenue").textContent=money(stats.revenue);$("#stat-pending").textContent=stats.pending.toLocaleString("bn-BD");renderProducts();renderOrders()}catch(e){if(e.message.includes("লগইন"))showLogin();else toast(e.message)}}
function resetForm(){const f=$("#product-form");f.reset();f.elements.id.value="";$("#product-form-title").textContent="নতুন প্রোডাক্ট যোগ করুন";msg("#product-message","")}
$("#reset-product").addEventListener("click",resetForm);
$("#product-form").addEventListener("submit",async e=>{
  e.preventDefault();const f=e.currentTarget,id=f.elements.id.value,form=new FormData(f),button=f.querySelector('button[type="submit"]');button.disabled=true;msg("#product-message","");
  try{await api(id?`/api/admin/products/${id}`:"/api/admin/products",{method:id?"PUT":"POST",body:form});resetForm();await refreshAll();toast(id?"প্রোডাক্ট আপডেট হয়েছে।":"প্রোডাক্ট যোগ হয়েছে।")}
  catch(err){msg("#product-message",err.message,true)}finally{button.disabled=false}
});
function renderProducts(){
  $("#admin-products").innerHTML=products.length?products.map(p=>`<div class="admin-product"><div class="thumb">${p.image?`<img src="${esc(p.image)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:9px">`:"📦"}</div><div class="admin-product-info"><strong>${esc(p.name)}</strong><small>${money(p.price)} · স্টক ${p.stock} · ${esc(p.category||"অন্যান্য")}</small></div><div class="admin-product-actions"><button class="btn soft" data-edit="${p.id}">এডিট</button><button class="btn danger" data-delete-product="${p.id}">ডিলিট</button></div></div>`).join(""):'<div class="empty">কোনো প্রোডাক্ট নেই।</div>';
}
$("#admin-products").addEventListener("click",async e=>{
  const edit=e.target.closest("[data-edit]"),del=e.target.closest("[data-delete-product]");
  if(edit){const p=products.find(p=>p.id===Number(edit.dataset.edit));if(!p)return;const f=$("#product-form");f.elements.id.value=p.id;f.elements.name.value=p.name;f.elements.price.value=p.price;f.elements.stock.value=p.stock;f.elements.category.value=p.category;f.elements.description.value=p.description;f.elements.image.value="";$("#product-form-title").textContent="প্রোডাক্ট আপডেট করুন";$("#products").scrollIntoView({behavior:"smooth"});}
  if(del){const id=Number(del.dataset.deleteProduct),p=products.find(p=>p.id===id);if(!p||!confirm(`"${p.name}" ডিলিট করবেন?`))return;try{await api(`/api/admin/products/${id}`,{method:"DELETE"});await refreshAll();toast("প্রোডাক্ট ডিলিট হয়েছে।")}catch(err){toast(err.message)}}
});
function renderOrders(){
  const q=($("#order-search").value||"").toLocaleLowerCase(),list=orders.filter(o=>(o.code+" "+o.customerName+" "+o.phone).toLocaleLowerCase().includes(q));
  $("#admin-orders").innerHTML=list.length?`<table class="table"><thead><tr><th>অর্ডার</th><th>কাস্টমার</th><th>পণ্য</th><th>মোট</th><th>স্ট্যাটাস</th><th>অ্যাকশন</th></tr></thead><tbody>${list.map(o=>`<tr><td><b>${esc(o.code)}</b><br><small>${esc(o.createdAt)}</small></td><td>${esc(o.customerName)}<br>${esc(o.phone)}<br><small>${esc(o.address)}</small></td><td>${o.items.map(i=>`${esc(i.name)} × ${i.qty}`).join("<br>")}</td><td><b>${money(o.total)}</b></td><td><select data-status="${o.id}">${Object.entries(statuses).map(([v,l])=>`<option value="${v}" ${o.status===v?"selected":""}>${l}</option>`).join("")}</select></td><td><button class="btn danger" data-delete-order="${o.id}">ডিলিট</button></td></tr>`).join("")}</tbody></table>`:'<div class="empty">এখনো কোনো অর্ডার নেই।</div>';
}
$("#order-search").addEventListener("input",renderOrders);
$("#admin-orders").addEventListener("change",async e=>{const el=e.target.closest("[data-status]");if(!el)return;try{await api(`/api/admin/orders/${el.dataset.status}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:el.value})});await refreshAll();toast("অর্ডারের স্ট্যাটাস আপডেট হয়েছে।")}catch(err){toast(err.message)}});
$("#admin-orders").addEventListener("click",async e=>{const b=e.target.closest("[data-delete-order]");if(!b)return;const id=Number(b.dataset.deleteOrder);if(!confirm("এই অর্ডার স্থায়ীভাবে ডিলিট করবেন?"))return;try{await api(`/api/admin/orders/${id}`,{method:"DELETE"});await refreshAll();toast("অর্ডার ডিলিট হয়েছে।")}catch(err){toast(err.message)}});
checkLogin();