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

  // ======================================================================
  // Saisie des formulaires : étapes, blocs à ajouter, récapitulatif,
  // vérification au fil de l'eau, dates rapides, photos. Sans JavaScript,
  // le formulaire reste une page unique et fonctionne comme avant.
  // ======================================================================
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var TEL_RE = /^[+()0-9.\s-]{6,25}$/;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_RE = /^\d{2}:\d{2}$/;
  var REQUIRED = 'Champ obligatoire.';
  var toArray = function (l) { return Array.prototype.slice.call(l); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowTime() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function frDate(v) { var p = String(v).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : v; }

  // Champ réellement proposé à l'utilisateur (ni masqué par une condition, ni bloc non ajouté)
  var isActive = function (f) { return !f.closest('[hidden]') && !f.closest('.repeat-off'); };
  var inputsOf = function (f) { return toArray(f.querySelectorAll('[name]')); };

  function fieldLabel(f) {
    if (f.hasAttribute('data-label')) return f.getAttribute('data-label');
    var l = f.querySelector('.label, .consent span');
    return l ? l.textContent.replace(/\s*\*\s*$/, '').replace(/\s+/g, ' ').trim() : f.getAttribute('data-field');
  }

  // Même règles que la validation du serveur (src/forms/engine.js)
  function fieldError(f) {
    var type = f.getAttribute('data-type');
    var required = f.hasAttribute('data-required');
    var inputs = inputsOf(f);
    if (!inputs.length || type === 'heading' || type === 'signature') return null;
    if (type === 'radio' || type === 'checkboxes' || type === 'consent') {
      return required && !inputs.some(function (i) { return i.checked; }) ? REQUIRED : null;
    }
    if (type === 'file') return required && !(inputs[0].files && inputs[0].files.length) ? REQUIRED : null;
    if (type === 'matrix') {
      var filled = false, err = null;
      inputs.forEach(function (i) {
        if (i.validity && i.validity.badInput) { err = err || (i.getAttribute('aria-label') + ' : nombre invalide.'); return; }
        var v = i.value.trim();
        if (!v) return;
        filled = true;
        if (i.type === 'number') {
          var n = Number(v.replace(',', '.'));
          if (i.min !== '' && n < Number(i.min)) err = err || (i.getAttribute('aria-label') + ' : minimum ' + i.min + '.');
          if (i.max !== '' && n > Number(i.max)) err = err || (i.getAttribute('aria-label') + ' : maximum ' + i.max + '.');
        }
      });
      return err || (required && !filled ? REQUIRED : null);
    }
    var el = inputs[0];
    var v = el.value.trim();
    if (!v) {
      if (el.validity && el.validity.badInput) return type === 'number' ? 'Nombre invalide.' : 'Valeur invalide.';
      return required ? REQUIRED : null;
    }
    switch (type) {
      case 'text': case 'tel': case 'email':
        if (v.length > 200) return '200 caractères maximum.';
        if (type === 'email' && !EMAIL_RE.test(v)) return 'Adresse e-mail invalide (exemple : nom@domaine.fr).';
        if (type === 'tel' && !TEL_RE.test(v)) return 'Numéro de téléphone invalide.';
        break;
      case 'textarea': if (v.length > 10000) return '10 000 caractères maximum.'; break;
      case 'date': if (!DATE_RE.test(v) || isNaN(Date.parse(v))) return 'Date invalide.'; break;
      case 'time': if (!TIME_RE.test(v)) return 'Heure invalide.'; break;
      case 'number': {
        var n = Number(v.replace(',', '.'));
        if (!isFinite(n)) return 'Nombre invalide.';
        if (el.min !== '' && n < Number(el.min)) return 'Minimum : ' + el.min + '.';
        if (el.max !== '' && n > Number(el.max)) return 'Maximum : ' + el.max + '.';
        break;
      }
    }
    var pattern = f.getAttribute('data-pattern');
    if (pattern && !new RegExp(pattern).test(v)) return f.getAttribute('data-pattern-message');
    return null;
  }

  function showError(f, msg) {
    var p = f.querySelector(':scope > .error-msg');
    f.classList.toggle('has-error', Boolean(msg));
    if (msg) {
      if (!p) { p = document.createElement('p'); p.className = 'error-msg'; f.appendChild(p); }
      p.id = p.id || 'err_' + f.getAttribute('data-field');
      p.textContent = msg;
    } else if (p) p.remove();
    inputsOf(f).forEach(function (i) {
      if (msg) { i.setAttribute('aria-invalid', 'true'); i.setAttribute('aria-describedby', p.id); }
      else { i.removeAttribute('aria-invalid'); i.removeAttribute('aria-describedby'); }
    });
  }

  // Vérifie les champs d'un ensemble d'éléments, affiche les erreurs, renvoie les champs en erreur
  function checkFields(containers) {
    var bad = [];
    containers.forEach(function (c) {
      toArray(c.querySelectorAll('[data-field]')).filter(isActive).forEach(function (f) {
        var msg = fieldError(f);
        showError(f, msg);
        if (msg) bad.push(f);
      });
    });
    return bad;
  }

  function setupLiveValidation(form) {
    // À la sortie d'un champ : on signale un format incorrect, pas un champ laissé vide (signalé à l'étape suivante)
    form.addEventListener('focusout', function (e) {
      var f = e.target.closest && e.target.closest('[data-field]');
      if (!f || !e.target.name || (e.relatedTarget && f.contains(e.relatedTarget)) || !isActive(f)) return;
      var msg = fieldError(f);
      if (msg === REQUIRED && !f.classList.contains('has-error')) return;
      showError(f, msg);
    });
    // Un champ en erreur est revérifié à chaque frappe : le message disparaît dès que c'est corrigé
    function recheck(e) {
      var f = e.target.closest && e.target.closest('[data-field]');
      if (f && f.classList.contains('has-error')) showError(f, fieldError(f));
    }
    form.addEventListener('input', recheck);
    form.addEventListener('change', recheck);
  }

  // ---- Blocs répétables : « + Ajouter un autre pilote / témoin… » ----
  function hasValues(el) {
    return inputsOf(el).some(function (i) {
      if (i.type === 'checkbox' || i.type === 'radio') return i.checked;
      if (i.type === 'file') return i.files && i.files.length;
      return i.value.trim() !== '';
    });
  }
  function clearInputs(el) {
    inputsOf(el).forEach(function (i) {
      if (i.type === 'checkbox' || i.type === 'radio') i.checked = false;
      else if (i.tagName === 'SELECT') i.selectedIndex = 0;
      else i.value = '';
    });
    toArray(el.querySelectorAll('[data-field]')).forEach(function (f) { showError(f, null); });
  }
  function setupRepeats(form) {
    var groups = {};
    toArray(form.querySelectorAll('[data-repeat]')).forEach(function (s) {
      (groups[s.getAttribute('data-repeat')] = groups[s.getAttribute('data-repeat')] || []).push(s);
    });
    Object.keys(groups).forEach(function (g) {
      var secs = groups[g];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'add-repeat';
      btn.innerHTML = '<span aria-hidden="true">+</span> ' + esc(secs[0].getAttribute('data-repeat-add'));
      if (secs[0].hasAttribute('data-step')) btn.setAttribute('data-step', secs[0].getAttribute('data-step'));
      function place() {
        var shown = secs.filter(function (s) { return !s.classList.contains('repeat-off'); });
        var anchor = shown[shown.length - 1];
        if (anchor) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
        else secs[0].parentNode.insertBefore(btn, secs[0]);
        btn.hidden = shown.length === secs.length;
      }
      secs.forEach(function (s) {
        if (!s.hasAttribute('data-optional')) return;
        if (s.open || hasValues(s)) s.open = true; else s.classList.add('repeat-off');
        var rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn small ghost remove-repeat';
        rm.textContent = 'Retirer ce bloc';
        rm.addEventListener('click', function () {
          clearInputs(s);
          s.classList.add('repeat-off');
          place();
          form.dispatchEvent(new Event('change', { bubbles: true }));
          btn.focus();
        });
        s.appendChild(rm);
      });
      btn.addEventListener('click', function () {
        var next = secs.filter(function (s) { return s.classList.contains('repeat-off'); })[0];
        if (!next) return;
        next.classList.remove('repeat-off');
        next.open = true;
        place();
        form.dispatchEvent(new Event('change', { bubbles: true }));
        var first = next.querySelector('input:not([type=hidden]), select, textarea');
        if (first) first.focus();
        next.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      place();
    });
  }

  // ---- Tableau dont les colonnes suivent les blocs ajoutés (ex. une colonne par concurrent) ----
  function syncColumns(form) {
    toArray(form.querySelectorAll('[data-columns-follow]')).forEach(function (f) {
      var secs = toArray(form.querySelectorAll('[data-repeat="' + f.getAttribute('data-columns-follow') + '"]'));
      toArray(f.querySelectorAll('thead th[data-col]')).forEach(function (th) {
        var ci = Number(th.getAttribute('data-col'));
        var sec = secs[ci];
        var on = Boolean(sec) && !sec.classList.contains('repeat-off');
        var base = th.getAttribute('data-base') || th.textContent;
        th.setAttribute('data-base', base);
        // En-tête : « Concurrent 1 – Durand (n° 27) » d'après le bloc correspondant
        var name = sec && sec.querySelector('[name$="driver_last_name"]');
        var num = sec && sec.querySelector('[name$="_number"]');
        var label = base + (name && name.value.trim() ? ' – ' + name.value.trim() : '') + (num && num.value.trim() ? ' (n° ' + num.value.trim() + ')' : '');
        th.textContent = label;
        th.classList.toggle('col-off', !on);
        toArray(f.querySelectorAll('td[data-col="' + ci + '"]')).forEach(function (td) {
          td.classList.toggle('col-off', !on);
          td.setAttribute('data-col-label', label);
          var i = td.querySelector('[name]');
          if (!i) return;
          if (!on) i.value = '';
          i.disabled = !on;
          // Ligne « Numéro » : reprend le numéro du concurrent s'il est vide
          if (on && !i.value && num && num.value.trim() && /^Num/.test(td.parentNode.querySelector('th').textContent)) i.value = num.value.trim();
        });
      });
      f.hidden = !secs.some(function (s) { return !s.classList.contains('repeat-off'); });
    });
  }

  // ---- Dates et heures en un geste ----
  function setupQuickDates(form) {
    toArray(form.querySelectorAll('input[type=date][name], input[type=time][name]')).forEach(function (inp) {
      if (inp.closest('table')) return;
      var bar = document.createElement('div');
      bar.className = 'quick';
      function add(label, fn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'quick-btn';
        b.textContent = label;
        b.addEventListener('click', function () { fn(); fire(inp); });
        bar.appendChild(b);
        return b;
      }
      if (inp.type === 'date') add("Aujourd'hui", function () { inp.value = today(); });
      else add('Maintenant', function () { inp.value = nowTime(); });
      var same = inp.getAttribute('data-same-as');
      var src = same && form.querySelector('[name="' + same + '"]');
      if (src) {
        var b = add(inp.getAttribute('data-same-as-label'), function () { inp.value = src.value; });
        var sync = function () { b.hidden = !src.value; };
        src.addEventListener('input', sync);
        src.addEventListener('change', sync);
        sync();
      }
      inp.insertAdjacentElement('afterend', bar);
    });
  }
  function fillAutoNow(form) {
    toArray(form.querySelectorAll('input[data-auto-now]')).forEach(function (i) {
      if (i.value) return;
      i.value = i.type === 'date' ? today() : nowTime();
      fire(i);
    });
  }

  // ---- Choix en pastilles : un second appui sur un choix unique le désélectionne ----
  function setupRadioToggle(form) {
    toArray(form.querySelectorAll('.choices input[type=radio]')).forEach(function (r) {
      r.setAttribute('data-was', r.checked ? '1' : '');
      r.addEventListener('click', function () {
        if (r.getAttribute('data-was') === '1') { r.checked = false; fire(r); }
        toArray(form.querySelectorAll('input[type=radio][name="' + r.name + '"]')).forEach(function (x) { x.setAttribute('data-was', x.checked ? '1' : ''); });
      });
    });
  }

  // ---- Photos et fichiers : appareil photo, aperçu, retrait, compression des images lourdes ----
  var MAX_IMAGE_SIDE = 2400;
  function compress(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5 * 1024 * 1024 || !window.createImageBitmap) return Promise.resolve(file);
    return createImageBitmap(file).then(function (bmp) {
      var scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
      var c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function (resolve) {
        c.toBlob(function (blob) {
          if (!blob || blob.size >= file.size) return resolve(file);
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
        }, 'image/jpeg', 0.82);
      });
    }).catch(function () { return file; });
  }
  var sizeLabel = function (b) { return b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' Ko' : (b / 1024 / 1024).toFixed(1).replace('.', ',') + ' Mo'; };
  function setupFiles(form) {
    var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    toArray(form.querySelectorAll('input[type=file][name]')).forEach(function (input) {
      var dt;
      try { dt = new DataTransfer(); } catch (e) { return; } // navigateur ancien : champ natif conservé
      var max = input.multiple ? 10 : 1;
      var ui = document.createElement('div');
      ui.className = 'file-ui';
      ui.innerHTML =
        '<div class="file-actions">' +
        (touch ? '<button type="button" class="btn ghost small" data-camera>Prendre une photo</button>' : '') +
        '<button type="button" class="btn ghost small" data-pick>' + (touch ? 'Choisir dans la galerie / les fichiers' : 'Choisir des fichiers') + '</button></div>' +
        '<ul class="file-list"></ul><p class="help file-status" aria-live="polite"></p>';
      var camera = document.createElement('input');
      camera.type = 'file'; camera.accept = 'image/*'; camera.setAttribute('capture', 'environment');
      var picker = document.createElement('input');
      picker.type = 'file'; picker.accept = input.accept; picker.multiple = input.multiple;
      [camera, picker].forEach(function (i) { i.className = 'visually-hidden'; i.tabIndex = -1; i.setAttribute('aria-hidden', 'true'); ui.appendChild(i); });
      input.classList.add('visually-hidden');
      input.tabIndex = -1;
      input.insertAdjacentElement('afterend', ui);
      var list = ui.querySelector('.file-list');
      var status = ui.querySelector('.file-status');
      var submit = form.querySelector('button[type=submit]');
      var busy = 0;
      function sync() {
        input.files = dt.files;
        list.innerHTML = '';
        toArray(dt.files).forEach(function (f, idx) {
          var li = document.createElement('li');
          var isImg = /^image\//.test(f.type);
          li.innerHTML = (isImg ? '<img alt="">' : '<span class="file-icon" aria-hidden="true">PDF</span>') +
            '<span class="file-name">' + esc(f.name) + ' <span class="muted">· ' + sizeLabel(f.size) + '</span></span>' +
            '<button type="button" class="file-remove" aria-label="Retirer ' + esc(f.name) + '">×</button>';
          if (isImg) { var img = li.querySelector('img'); img.src = URL.createObjectURL(f); img.onload = function () { URL.revokeObjectURL(img.src); }; }
          li.querySelector('button').addEventListener('click', function () {
            var next = new DataTransfer();
            toArray(dt.files).forEach(function (x, j) { if (j !== idx) next.items.add(x); });
            dt = next;
            sync();
          });
          list.appendChild(li);
        });
        fire(input);
      }
      function addFiles(files) {
        files = toArray(files);
        if (!files.length) return;
        if (!input.multiple) dt = new DataTransfer();
        var room = max - dt.files.length;
        if (files.length > room) { status.textContent = max + ' fichiers maximum pour ce champ.'; files = files.slice(0, Math.max(room, 0)); }
        busy++;
        if (submit) submit.disabled = true;
        if (files.some(function (f) { return f.size >= 1.5 * 1024 * 1024 && /^image\//.test(f.type); })) status.textContent = 'Optimisation des photos…';
        Promise.all(files.map(compress)).then(function (out) {
          out.forEach(function (f) { dt.items.add(f); });
          busy--;
          if (!busy && submit) submit.disabled = false;
          if (status.textContent === 'Optimisation des photos…') status.textContent = '';
          sync();
        });
      }
      [camera, picker].forEach(function (i) {
        i.addEventListener('change', function () { addFiles(i.files); i.value = ''; });
      });
      if (ui.querySelector('[data-camera]')) ui.querySelector('[data-camera]').addEventListener('click', function () { camera.click(); });
      ui.querySelector('[data-pick]').addEventListener('click', function () { picker.click(); });
    });
  }

  // ---- Valeur lisible d'un champ, pour le récapitulatif ----
  function fieldText(f) {
    var type = f.getAttribute('data-type');
    var inputs = inputsOf(f);
    if (type === 'radio' || type === 'checkboxes') return inputs.filter(function (i) { return i.checked; }).map(function (i) { return i.value; }).join(', ');
    if (type === 'consent') return inputs[0] && inputs[0].checked ? 'Oui' : '';
    if (type === 'file') return toArray(inputs[0].files || []).map(function (x) { return x.name; }).join(', ');
    if (type === 'matrix') {
      var cols = toArray(f.querySelectorAll('thead th')).slice(1).map(function (th) { return th.textContent; });
      return toArray(f.querySelectorAll('tbody tr')).map(function (tr) {
        var cells = toArray(tr.querySelectorAll('td')).map(function (td, ci) {
          var i = td.querySelector('[name]');
          return i && i.value.trim() ? cols[ci] + ' ' + i.value.trim() : '';
        }).filter(Boolean);
        return cells.length ? tr.querySelector('th').textContent + ' : ' + cells.join(', ') : '';
      }).filter(Boolean).join(' ; ');
    }
    var el = inputs[0];
    if (!el) return '';
    if (el.tagName === 'SELECT') return el.value ? el.options[el.selectedIndex].text : '';
    if (type === 'date') return el.value ? frDate(el.value) : '';
    return el.value.trim();
  }
  function sectionTitle(s) {
    var t = s.querySelector('.legend-title');
    return t ? t.textContent : '';
  }

  // ---- Formulaire en étapes ----
  function setupStepper(form) {
    var children = toArray(form.children).filter(function (el) { return el.hasAttribute('data-step'); });
    if (!children.length) return null;
    var steps = [];
    children.forEach(function (el) {
      var label = el.getAttribute('data-step');
      var last = steps[steps.length - 1];
      if (!last || last.label !== label) steps.push((last = { label: label, els: [] }));
      last.els.push(el);
    });
    var lastIdx = steps.length - 1;
    var head = document.createElement('div');
    head.className = 'stepper card';
    head.innerHTML =
      '<div class="stepper-top"><span class="stepper-count"></span><span class="stepper-missing" aria-live="polite"></span></div>' +
      '<div class="stepper-title"></div>' +
      '<div class="stepper-bar" aria-hidden="true"><span></span></div>' +
      '<ol class="stepper-list">' + steps.map(function (st, i) {
        return '<li><button type="button" data-goto="' + i + '"><span class="n">' + (i + 1) + '</span> ' + esc(st.label) + '</button></li>';
      }).join('') + '</ol>';
    form.insertBefore(head, children[0]);

    var recap = document.createElement('div');
    recap.className = 'recap card';
    form.insertBefore(recap, steps[lastIdx].els[0]);
    steps[lastIdx].els.unshift(recap);

    var actions = form.querySelector('.actions');
    var submit = form.querySelector('button[type=submit]');
    var nav = document.createElement('div');
    nav.className = 'step-nav';
    nav.innerHTML = '<button type="button" class="btn ghost" data-prev>Précédent</button><button type="button" class="btn primary" data-next>Suivant</button>';
    form.insertBefore(nav, actions);
    nav.appendChild(submit);
    var prev = nav.querySelector('[data-prev]');
    var next = nav.querySelector('[data-next]');
    var cur = 0;
    var visited = {};

    var stepOf = function (el) { for (var i = 0; i < steps.length; i++) if (steps[i].els.some(function (s) { return s.contains(el); })) return i; return 0; };
    var activeFields = function (i) {
      var out = [];
      steps[i].els.forEach(function (el) { out = out.concat(toArray(el.querySelectorAll('[data-field]')).filter(isActive)); });
      return out;
    };
    function missing() {
      var out = [];
      steps.forEach(function (st, i) { activeFields(i).forEach(function (f) { if (fieldError(f) === REQUIRED) out.push({ f: f, step: i }); }); });
      return out;
    }
    function updateStatus() {
      var miss = missing();
      var m = head.querySelector('.stepper-missing');
      m.textContent = miss.length ? miss.length + ' champ' + (miss.length > 1 ? 's' : '') + ' obligatoire' + (miss.length > 1 ? 's' : '') + ' à compléter' : 'Champs obligatoires complétés';
      m.classList.toggle('ok', !miss.length);
      toArray(head.querySelectorAll('[data-goto]')).forEach(function (b, i) {
        var todo = miss.some(function (x) { return x.step === i; });
        var err = steps[i].els.some(function (el) { return el.querySelector('.has-error'); });
        b.classList.toggle('done', Boolean(visited[i] && !todo && !err && i !== cur));
        b.classList.toggle('todo', Boolean((visited[i] || err) && (todo || err) && i !== cur));
      });
    }
    function buildRecap() {
      var miss = missing();
      var html = '<h2>Récapitulatif</h2><p class="muted">Relisez votre saisie. Cliquez sur « Modifier » pour revenir sur une étape.</p>';
      if (miss.length) {
        html += '<div class="alert error"><strong>' + miss.length + ' champ' + (miss.length > 1 ? 's' : '') + ' obligatoire' + (miss.length > 1 ? 's' : '') + ' à compléter :</strong><ul>' +
          miss.map(function (x) { return '<li><a href="#" data-focus="' + esc(x.f.getAttribute('data-field')) + '">' + esc(fieldLabel(x.f)) + '</a> <span class="muted">(étape ' + (x.step + 1) + ')</span></li>'; }).join('') + '</ul></div>';
      }
      steps.forEach(function (st, i) {
        if (i === lastIdx) return;
        var body = '';
        st.els.forEach(function (el) {
          var rows = toArray(el.querySelectorAll('[data-field]')).filter(isActive).map(function (f) {
            var t = fieldText(f);
            return t ? '<dt>' + esc(fieldLabel(f)) + '</dt><dd>' + esc(t) + '</dd>' : '';
          }).join('');
          if (rows) body += (st.els.length > 1 && sectionTitle(el) ? '<h4>' + esc(sectionTitle(el)) + '</h4>' : '') + '<dl>' + rows + '</dl>';
        });
        html += '<section class="recap-step"><div class="recap-step-head"><h3>' + (i + 1) + '. ' + esc(st.label) + '</h3>' +
          '<button type="button" class="btn small ghost" data-goto="' + i + '">Modifier</button></div>' +
          (body || '<p class="muted small">Rien de renseigné.</p>') + '</section>';
      });
      recap.innerHTML = html;
    }
    function show(i, scroll) {
      visited[cur] = true;
      cur = Math.max(0, Math.min(lastIdx, i));
      steps.forEach(function (st, j) { st.els.forEach(function (el) { el.classList.toggle('step-off', j !== cur); }); });
      if (actions) actions.classList.toggle('step-off', cur !== lastIdx);
      prev.hidden = cur === 0;
      next.hidden = cur === lastIdx;
      submit.hidden = cur !== lastIdx;
      head.querySelector('.stepper-count').textContent = 'Étape ' + (cur + 1) + ' sur ' + steps.length;
      head.querySelector('.stepper-title').textContent = steps[cur].label;
      head.querySelector('.stepper-bar span').style.width = ((cur + 1) / steps.length) * 100 + '%';
      toArray(head.querySelectorAll('[data-goto]')).forEach(function (b, j) {
        if (j === cur) { b.setAttribute('aria-current', 'step'); b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
        else b.removeAttribute('aria-current');
      });
      if (cur === lastIdx) { fillAutoNow(form); buildRecap(); }
      updateStatus();
      if (scroll !== false) head.scrollIntoView({ block: 'start' });
    }
    function focusField(f) {
      show(stepOf(f), false);
      var s = f.closest('details');
      if (s) s.open = true;
      f.scrollIntoView({ block: 'center' });
      var i = f.querySelector('[name]:not(.visually-hidden), .file-ui button, [name]');
      if (i) i.focus({ preventScroll: true });
    }
    prev.addEventListener('click', function () { show(cur - 1); });
    next.addEventListener('click', function () {
      var bad = checkFields(steps[cur].els);
      if (bad.length) { focusField(bad[0]); updateStatus(); return; }
      show(cur + 1);
    });
    form.addEventListener('click', function (e) {
      var g = e.target.closest('[data-goto]');
      if (g && form.contains(g)) { e.preventDefault(); show(Number(g.getAttribute('data-goto'))); return; }
      var fo = e.target.closest('[data-focus]');
      if (fo) {
        e.preventDefault();
        var f = form.querySelector('[data-field="' + fo.getAttribute('data-focus') + '"]');
        if (f) { showError(f, fieldError(f)); focusField(f); }
      }
    });
    var statusTimer;
    form.addEventListener('input', function () { clearTimeout(statusTimer); statusTimer = setTimeout(updateStatus, 300); });
    form.addEventListener('change', function () { clearTimeout(statusTimer); statusTimer = setTimeout(updateStatus, 50); });

    // Après un renvoi du serveur avec erreurs : ouvrir l'étape de la première erreur
    var firstErr = form.querySelector('.has-error');
    show(firstErr ? stepOf(firstErr) : 0, Boolean(firstErr));
    return { focusField: focusField };
  }

  function enhanceForm(form) {
    setupRepeats(form);
    syncColumns(form);
    form.addEventListener('change', function () { syncColumns(form); });
    setupQuickDates(form);
    setupRadioToggle(form);
    setupFiles(form);
    setupLiveValidation(form);
    var stepper = form.hasAttribute('data-stepper') ? setupStepper(form) : null;
    if (!stepper) fillAutoNow(form);

    // Entrée dans un champ : passe au champ suivant au lieu d'envoyer le formulaire
    form.addEventListener('keydown', function (e) {
      var t = e.target;
      if (e.key !== 'Enter' || t.tagName !== 'INPUT' || ['checkbox', 'radio', 'file', 'submit', 'button'].indexOf(t.type) !== -1) return;
      e.preventDefault();
      var all = toArray(form.querySelectorAll('input:not([type=hidden]):not(.visually-hidden), select, textarea')).filter(function (x) { return x.offsetParent !== null && !x.disabled; });
      var nx = all[all.indexOf(t) + 1];
      if (nx) nx.focus(); else t.blur();
    });

    // Envoi : tout est revérifié ; on ouvre l'étape de la première erreur
    form.addEventListener('submit', function (e) {
      var containers = toArray(form.children);
      var bad = checkFields(containers);
      if (!bad.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (stepper) stepper.focusField(bad[0]);
      else { bad[0].scrollIntoView({ block: 'center' }); var i = bad[0].querySelector('[name]'); if (i) i.focus({ preventScroll: true }); }
    });
  }

  document.querySelectorAll('form.dyn-form').forEach(function (form) {
    refresh(form);
    form.addEventListener('change', function () { refresh(form); });
    enhanceForm(form);
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
    form.addEventListener('submit', function (e) { if (e.defaultPrevented) return; submitting = true; clearTimeout(timer); });
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
