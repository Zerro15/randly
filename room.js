(()=>{'use strict';const $=id=>document.getElementById(id),code=new URLSearchParams(location.search).get('code')?.toUpperCase();
const msg=s=>{$('message').textContent=s;};let lastId=null,working=false,fetching=false;
if(!code||!(/^[A-F0-9]{10}$/.test(code))){msg('Неверная ссылка комнаты');return;}
async function api(path,options={}){const response=await fetch('/api'+path,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...options});let data;try{data=await response.json();}catch{throw Error('Ошибка соединения');}if(!response.ok)throw Error(data.detail||'Ошибка сервера');return data;}
const url=new URL('./room.html?code='+code,location.href).href;$('inviteUrl').value=url;
$('qr').src='/api/rooms/'+code+'/qr?url='+encodeURIComponent(url);
$('qr').hidden=false;
$('qr').onerror=()=>{$('qr').hidden=true;};
$('copyBtn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(url);msg('Ссылка скопирована');}catch{msg('Скопируйте ссылку из поля выше');}});
async function refresh(){if(fetching||document.hidden)return;fetching=true;try{const room=await api('/rooms/'+code);
 $('roomTitle').textContent=room.title;$('roomInfo').textContent='Диапазон: '+room.min+'–'+room.max+' · '+(room.no_repeats?'Без повторений':'Повторения возможны')+' · Организатор: '+room.host;
 $('hostControls').hidden=!room.is_host;$('guestInfo').hidden=room.is_host;
 const id=room.history[0]?.id??null;if(lastId!==id){lastId=id;$('result').textContent=room.latest===null?'—':String(room.latest);$('result').classList.remove('pop');void $('result').offsetWidth;$('result').classList.add('pop');}
 $('roomStatus').textContent=room.latest===null?'Ожидание первой жеребьёвки':'Результат одинаковый у всех участников';
 const ol=$('drawHistory');ol.replaceChildren();if(!room.history.length){const li=document.createElement('li');li.textContent='Пока нет результатов';ol.append(li);}
 for(const entry of room.history){const li=document.createElement('li'),b=document.createElement('strong'),time=document.createElement('time');b.textContent=entry.number;time.textContent=new Date(entry.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'});li.append(b,time);ol.append(li);}
 msg('');
}catch(e){msg('Не удалось обновить комнату: '+e.message);}finally{fetching=false;}}
async function action(name){if(working)return;working=true;$('drawBtn').disabled=true;$('resetBtn').disabled=true;try{if(name==='reset'&&!confirm('Сбросить всю историю этой комнаты?'))return;await api('/rooms/'+code+'/'+name,{method:'POST',body:'{}'});await refresh();}catch(e){msg(e.message);}finally{working=false;$('drawBtn').disabled=false;$('resetBtn').disabled=false;}}
$('drawBtn').addEventListener('click',()=>action('draw'));$('resetBtn').addEventListener('click',()=>action('reset'));refresh();setInterval(refresh,2000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();