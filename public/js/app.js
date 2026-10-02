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
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    wrap.querySelector('[data-signature-clear]').addEventListener('click', function () {
      reset();
      dirty = false;
      input.value = '';
    });
  });

  document.querySelectorAll('[data-print]').forEach(function (b) {
    b.addEventListener('click', function () { window.print(); });
  });
})();
