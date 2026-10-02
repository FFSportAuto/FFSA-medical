(function () {
  'use strict';

  // ---- Champs conditionnels (data-show-if) ----
  function currentValue(form, name) {
    var inputs = form.querySelectorAll('[name="' + name + '"]');
    if (!inputs.length) return undefined;
    var first = inputs[0];
    if (first.type === 'checkbox') {
      return Array.prototype.filter.call(inputs, function (i) { return i.checked; }).map(function (i) { return i.value; });
    }
    if (first.type === 'radio') {
      var c = Array.prototype.find.call(inputs, function (i) { return i.checked; });
      return c ? c.value : '';
    }
    return first.value;
  }

  function met(form, cond) {
    var v = currentValue(form, cond.field);
    if ('equals' in cond) return v === cond.equals;
    if ('in' in cond) return cond.in.indexOf(v) !== -1;
    if ('includes' in cond) return Array.isArray(v) && v.indexOf(cond.includes) !== -1;
    return true;
  }

  function refresh(form) {
    form.querySelectorAll('[data-show-if]').forEach(function (el) {
      var visible = met(form, JSON.parse(el.getAttribute('data-show-if')));
      el.hidden = !visible;
      el.querySelectorAll('input, select, textarea').forEach(function (i) { i.disabled = !visible; });
    });
    // Un champ masqué par sa section doit le rester même si sa propre condition est vraie
    form.querySelectorAll('fieldset[hidden] [data-show-if]').forEach(function (el) {
      el.querySelectorAll('input, select, textarea').forEach(function (i) { i.disabled = true; });
    });
  }

  document.querySelectorAll('form.dyn-form').forEach(function (form) {
    refresh(form);
    form.addEventListener('change', function () { refresh(form); });
    form.addEventListener('submit', function () {
      var btn = form.querySelector('button[type=submit]');
      setTimeout(function () { btn.disabled = true; btn.textContent = 'Envoi en cours…'; }, 0);
    });
  });

  // ---- Signature manuscrite ----
  document.querySelectorAll('[data-signature]').forEach(function (wrap) {
    var canvas = wrap.querySelector('canvas');
    var input = wrap.querySelector('input[type=hidden]');
    var ctx = canvas.getContext('2d');
    var drawing = false;
    var dirty = false;

    function reset() {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#0b1f44';
    }
    reset();
    if (input.value) {
      var img = new Image();
      img.onload = function () { ctx.drawImage(img, 0, 0); dirty = true; };
      img.src = input.value;
    }

    function pos(e) {
      var r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
    }
    canvas.addEventListener('pointerdown', function (e) {
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      var p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      dirty = true;
    });
    function end() {
      if (!drawing) return;
      drawing = false;
      if (dirty) input.value = canvas.toDataURL('image/png');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    wrap.querySelector('[data-signature-clear]').addEventListener('click', function () {
      reset();
      dirty = false;
      input.value = '';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (!window.confirm(f.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // ---- Brouillon enregistré automatiquement ----
  document.querySelectorAll('form[data-draft-url]').forEach(function (form) {
    var url = form.getAttribute('data-draft-url');
    var status = document.querySelector('[data-draft-status]');
    var csrf = form.querySelector('input[name=_csrf]').value;
    var timer = null;
    var submitting = false;
    function show(text, cls) {
      if (!status) return;
      status.textContent = text;
      status.className = 'draft-status' + (cls ? ' ' + cls : '');
    }
    function snapshot() {
      var data = {};
      new FormData(form).forEach(function (v, k) {
        if (k === '_csrf' || (typeof File !== 'undefined' && v instanceof File)) return;
        if (k in data) data[k] = [].concat(data[k], v); else data[k] = v;
      });
      return data;
    }
    function save() {
      if (submitting) return;
      show('Enregistrement du brouillon…', 'pending');
      fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(snapshot()) })
        .then(function (r) { if (!r.ok || (r.headers.get('content-type') || '').indexOf('json') === -1) throw new Error(); return r.json(); })
        .then(function (j) {
          var t = new Date(j.savedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
          show('Brouillon enregistré à ' + t + '. Vous pouvez fermer la page et reprendre plus tard.');
        })
        .catch(function () { show('Brouillon non enregistré (connexion ou session expirée). Nouvel essai à la prochaine saisie.', 'failed'); });
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(save, 1500); }
    form.addEventListener('input', schedule);
    form.addEventListener('change', schedule);
    form.addEventListener('submit', function () { submitting = true; clearTimeout(timer); });
  });

  document.querySelectorAll('[data-fill-login]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.getElementById('email').value = b.getAttribute('data-fill-login');
      document.getElementById('password').value = b.getAttribute('data-fill-password');
      document.getElementById('password').form.requestSubmit();
    });
  });

  document.querySelectorAll('[data-print]').forEach(function (b) {
    b.addEventListener('click', function () { window.print(); });
  });
})();
