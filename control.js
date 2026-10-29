(()=>{'use strict';
const $=id=>document.getElementById(id);
const code=new URLSearchParams(location.search).get('code')?.toUpperCase();
const msg=text=>{$('message').textContent=text;};
let busy=false,loaded=false;
if(!code||!/^[A-F0-9]{10}$/.test(code)){$('locked').textContent='Ссылка на комнату недействительна';return;}
const base=new URL('./api/rooms/'+code,location.href);
async function api(path,options={}){const url=new URL(base.href+path);const res=await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...options});let value;try{value=await res.json();}catch{throw Error('Сервер недоступен');}if(!res.ok)throw Error(typeof value.detail==='string'?value.detail:'Ошибка API');return value;}
async function load(){if(busy)return;try{
 const data=await api('');
 if(!data.is_host)throw Error('Только владелец комнаты может открывать панель управления');
 const reservationData=data.can_reserve?await api('/reservations'):null;
 $('locked').hidden=true;$('adminPanel').hidden=false;$('reservationCard').hidden=!data.can_reserve;loaded=true;
 $('title').textContent=data.title;
 $('roomDetails').textContent='Диапазон '+data.min+'–'+data.max+' · '+(data.no_repeats?'без повторений':'повторения разрешены');
 $('latestValue').textContent=data.latest===null?'—':String(data.latest);
 $('latestSource').textContent=data.history[0]?.source==='prepared'?'Подготовленный результат':data.latest===null?'Пока нет результатов':'Случайный результат';
 $('guestLink').href=new URL('./room.html?code='+code,location.href).href;
 if(reservationData){
 const slot=$('slot');slot.min=String(reservationData.draw_count+1);if(Number(slot.value)<reservationData.draw_count+1)slot.value=String(reservationData.draw_count+1);
 $('number').min=String(data.min);$('number').max=String(data.max);
 const list=$('reservations');list.replaceChildren();
 if(!reservationData.reservations.length){const p=document.createElement('p');p.className='secondary';p.textContent='Пока нет бронирований';list.append(p);}
 for(const entry of reservationData.reservations){
  const row=document.createElement('div');row.className='reservation-item';
  const details=document.createElement('div'),title=document.createElement('strong'),status=document.createElement('small');
  title.textContent=entry.recipient?entry.recipient+' — задание №'+entry.number:'Розыгрыш №'+entry.slot+' → '+entry.number;status.textContent=entry.revealed?'Уже открыт':'Ожидает открытия';details.append(title,status);
  const button=document.createElement('button');button.type='button';button.textContent='Удалить';button.disabled=entry.revealed;
  button.addEventListener('click',()=>act('/reservations/'+entry.slot,'DELETE'));
  row.append(details,button);list.append(row);
 }
 }
 msg('');
}catch(err){if(!loaded){$('locked').textContent='Доступ запрещён или требуется вход. '+err.message;}else msg(err.message);}}
async function act(path,method='POST',data={}){if(busy)return;busy=true;$('drawBtn').disabled=true;$('resetBtn').disabled=true;
try{if(path==='/reset'&&!confirm('Сбросить историю? Результаты с бронью снова будут открываться с первого шага.'))return;
 await api(path,{method,body:JSON.stringify(data)});await loadInternal();
}catch(err){msg(err.message);}finally{busy=false;$('drawBtn').disabled=false;$('resetBtn').disabled=false;}}
async function loadInternal(){busy=false;await load();busy=true;}
$('drawBtn').addEventListener('click',()=>act('/draw'));
$('resetBtn').addEventListener('click',()=>act('/reset'));
$('reserveForm').addEventListener('submit',e=>{e.preventDefault();
const slot=Number($('slot').value),number=Number($('number').value);
if(!Number.isSafeInteger(slot)||!Number.isSafeInteger(number)){msg('Нужны целые числа');return;}
const recipient=$('recipient').value.trim();if(!recipient){msg('Укажите участника или @логин');return;}
act('/reservations','PUT',{slot,number,recipient});});
load();
})();
