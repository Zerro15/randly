(()=>{'use strict';const $=id=>document.getElementById(id),code=new URLSearchParams(location.search).get('code')?.toUpperCase();
const msg=s=>{$('message').textContent=s;};let lastId=null,working=false,fetching=false;
if(!code||!(/^[A-F0-9]{10}$/.test(code))){msg('Неверная ссылка комнаты');return;}
async function api(path,options={}){const response=await fetch(new URL('./api'+path, location.href),{credentials:'same-origin',headers:{'Content-Type':'application/json'},...options});let data;try{data=await response.json();}catch{throw Error('Ошибка соединения');}if(!response.ok)throw Error(data.detail||'Ошибка сервера');return data;}
const url=new URL('./room.html?code='+code,location.href).href;$('inviteUrl').value=url;
$('qr').src=new URL('./api/rooms/'+code+'/qr?url='+encodeURIComponent(url),location.href).href;
$('qr').hidden=false;
$('qr').onerror=()=>{$('qr').hidden=true;};
$('copyBtn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(url);msg('Ссылка скопирована');}catch{msg('Скопируйте ссылку из поля выше');}});
async function refresh(){if(fetching||document.hidden)return;fetching=true;try{const room=await api('/rooms/'+code);
 $('roomTitle').textContent=room.title;$('roomInfo').textContent='Диапазон: '+room.min+'–'+room.max+' · '+(room.no_repeats?'Без повторений':'Повторения возможны')+' · Организатор: '+room.host+(room.prepared_mode?' · Возможны подготовленные результаты':' · Случайная жеребьёвка');
 const id=room.history[0]?.id??null;if(lastId!==id){lastId=id;$('result').textContent=room.latest===null?'—':String(room.latest);$('result').classList.remove('pop');void $('result').offsetWidth;$('result').classList.add('pop');}
 $('roomStatus').textContent=room.latest===null?'Ожидание первой жеребьёвки':(room.history[0]?.source==='prepared'?'Подготовленный результат · общий для всех':'Случайный результат · общий для всех');
 const ol=$('drawHistory');ol.replaceChildren();if(!room.history.length){const li=document.createElement('li');li.textContent='Пока нет результатов';ol.append(li);}
 for(const entry of room.history){const li=document.createElement('li'),b=document.createElement('strong'),time=document.createElement('time');b.textContent=entry.number+(entry.source==='prepared'?' · подготовлено':'');time.textContent=new Date(entry.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'});li.append(b,time);ol.append(li);}
 msg('');
}catch(e){msg('Не удалось обновить комнату: '+e.message);}finally{fetching=false;}}
refresh();setInterval(refresh,2000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();