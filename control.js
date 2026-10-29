(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const code = new URLSearchParams(location.search).get('code')?.toUpperCase();
  const message = text => { $('message').textContent = text; };
  let busy = false;
  if (!code || !/^[A-F0-9]{10}$/.test(code)) {
    $('locked').textContent = 'Ссылка на комнату недействительна';
    return;
  }
  const apiBase = new URL('./api/rooms/' + code, location.href);

  async function api(path, options = {}) {
    const response = await fetch(new URL(apiBase.href + path), {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    let data;
    try { data = await response.json(); } catch { throw Error('Сервер недоступен'); }
    if (!response.ok) throw Error(typeof data.detail === 'string' ? data.detail : 'Ошибка API');
    return data;
  }

  function invitationLink(ticket) {
    const url = new URL('./participant.html?code=' + code, location.href);
    url.hash = new URLSearchParams({ ticket }).toString();
    return url.href;
  }

  async function load() {
    const room = await api('');
    if (!room.is_host) throw Error('Доступно только владельцу комнаты');
    const details = room.can_reserve ? await api('/reservations') : null;
    $('locked').hidden = true;
    $('adminPanel').hidden = false;
    $('reservationCard').hidden = !room.can_reserve;
    $('title').textContent = room.title;
    $('roomDetails').textContent = 'Диапазон: ' + room.min + '–' + room.max +
      ' · ' + (room.no_repeats ? 'без повторений' : 'повторения возможны');
    $('latestValue').textContent = room.latest === null ? '—' : String(room.latest);
    const latest = room.history[0];
    $('latestSource').textContent = latest ?
      (latest.recipient ? latest.recipient + ' — задание №' + latest.number :
        (latest.source === 'prepared' ? 'Подготовленное распределение' : 'Случайный результат')) :
      'Пока нет результатов';
    $('guestLink').href = new URL('./room.html?code=' + code, location.href).href;

    $('drawBtn').hidden = room.self_service;
    $('selfServiceHint').hidden = !room.self_service;

    if (!details) return;
    const slotInput = $('slot');
    const minSlot = room.self_service ? 1 : details.draw_count + 1;
    slotInput.min = String(minSlot);
    if (Number(slotInput.value) < minSlot) slotInput.value = String(minSlot);
    $('number').min = String(room.min);
    $('number').max = String(room.max);
    const list = $('reservations');
    list.replaceChildren();
    if (!details.reservations.length) {
      const p = document.createElement('p');
      p.className = 'secondary';
      p.textContent = 'Пока нет назначений';
      list.append(p);
    }
    for (const entry of details.reservations) {
      const row = document.createElement('div');
      row.className = 'reservation-item';
      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = '№' + entry.slot + ' · ' + (entry.recipient || 'Без участника') +
        ' — задание №' + entry.number;
      const state = document.createElement('small');
      state.textContent = entry.revealed ? 'Уже открыто' :
        (entry.invite_issued && room.self_service ? 'Личная ссылка выдана' : 'Ожидает открытия');
      info.append(title, state);
      const actions = document.createElement('div');
      actions.className = 'actions';

      if (room.self_service && !entry.revealed) {
        const issue = document.createElement('button');
        issue.type = 'button';
        issue.textContent = entry.invite_issued ? 'Новая ссылка' : 'Личная ссылка';
        issue.className = 'outline';
        issue.addEventListener('click', () => run(async () => {
          // Hide previous invitation immediately; never show a stale link for another participant.
          $('invitationResult').hidden = true;
          $('invitationUrl').value = '';
          const result = await api('/reservations/' + entry.slot + '/invite', {
            method: 'POST', body: '{}'
          });
          $('invitationUrl').value = invitationLink(result.ticket);
          $('invitationResult').hidden = false;
          message('Ссылка создана. Скопируйте и отправьте её только участнику.');
          await load();
        }));
        actions.append(issue);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Удалить';
      remove.disabled = entry.revealed;
      remove.addEventListener('click', () => run(async () => {
        await api('/reservations/' + entry.slot, { method: 'DELETE', body: '{}' });
        $('invitationResult').hidden = true;
        await load();
        message('Назначение удалено');
      }));
      actions.append(remove);
      row.append(info, actions);
      list.append(row);
    }
  }

  async function run(task) {
    if (busy) return;
    busy = true;
    for (const button of document.querySelectorAll('#adminPanel button')) button.disabled = true;
    try {
      await task();
    } catch (error) {
      message(error.message);
    } finally {
      busy = false;
      for (const button of document.querySelectorAll('#adminPanel button')) {
        // Reload status after a successful mutation; leave revealed rows disabled.
        if (button.textContent !== 'Удалить' || !button.closest('.reservation-item')?.querySelector('small')?.textContent.includes('Уже открыто')) {
          button.disabled = false;
        }
      }
    }
  }

  $('drawBtn').addEventListener('click', () => run(async () => {
    await api('/draw', { method: 'POST', body: '{}' });
    await load();
    message('Результат открыт');
  }));
  $('resetBtn').addEventListener('click', () => {
    if (!confirm('Сбросить уже открытые результаты? Все личные ссылки останутся действительными.')) return;
    run(async () => {
      await api('/reset', { method: 'POST', body: '{}' });
      $('invitationResult').hidden = true;
      await load();
      message('История очищена; участники могут открыть назначение заново');
    });
  });

  $('reserveForm').addEventListener('submit', event => {
    event.preventDefault();
    const slot = Number($('slot').value);
    const number = Number($('number').value);
    const recipient = $('recipient').value.trim();
    if (!Number.isSafeInteger(slot) || !Number.isSafeInteger(number)) {
      message('Укажите целые числа');
      return;
    }
    if (!recipient) { message('Введите имя участника или @логин'); return; }
    run(async () => {
      await api('/reservations', {
        method: 'PUT',
        body: JSON.stringify({ slot, number, recipient })
      });
      $('invitationResult').hidden = true; // Previous ticket has been revoked.
      await load();
      message('Назначение сохранено. Для самостоятельного открытия выдайте личную ссылку.');
    });
  });

  $('copyInvitation').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('invitationUrl').value);
      message('Личная ссылка скопирована');
    } catch {
      $('invitationUrl').focus();
      $('invitationUrl').select();
      message('Выделите ссылку и скопируйте её вручную');
    }
  });

  load().catch(error => { $('locked').textContent = 'Доступ запрещён: ' + error.message; });
})();
