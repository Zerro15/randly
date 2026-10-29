(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const code = new URLSearchParams(location.search).get('code')?.toUpperCase();
  const token = new URLSearchParams(location.hash.slice(1)).get('ticket');
  const message = text => { $('message').textContent = text; };
  if (!code || !/^[A-F0-9]{10}$/.test(code) || !token || !/^[a-zA-Z0-9_-]{35,128}$/.test(token)) {
    message('Ссылка недействительна. Попросите организатора выдать личное приглашение.');
    return;
  }

  $('sharedLink').href = new URL('./room.html?code=' + code, location.href).href;
  const apiUrl = new URL('./api/rooms/' + code + '/reveal', location.href);

  fetch(new URL('./api/rooms/' + code, location.href), { cache: 'no-store' })
    .then(async response => {
      if (!response.ok) throw Error('Комната не найдена');
      const room = await response.json();
      if (!room.self_service) throw Error('Здесь нет самостоятельного открытия заданий');
      $('roomTitle').textContent = room.title;
      $('revealBtn').disabled = false;
      message('');
    }).catch(error => message(error.message));

  let busy = false;
  $('revealBtn').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    $('revealBtn').disabled = true;
    $('revealBtn').textContent = 'Открываем…';
    message('');
    try {
      const response = await fetch(apiUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: token }), cache: 'no-store'
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.detail || 'Не удалось открыть задание');
      $('result').textContent = String(data.number);
      $('result').classList.remove('pop');
      void $('result').offsetWidth;
      $('result').classList.add('pop');
      $('recipient').textContent = data.recipient ?
        data.recipient + ' — задание №' + data.number : 'Ваше задание №' + data.number;
      $('revealBtn').textContent = 'Задание открыто';
      message(data.already_revealed ? 'Это уже назначенное вам задание.' : 'Задание открыто и записано в общий журнал.');
    } catch (error) {
      message(error.message);
      $('revealBtn').textContent = 'Попробовать снова';
      $('revealBtn').disabled = false;
    } finally {
      busy = false;
    }
  });
})();
